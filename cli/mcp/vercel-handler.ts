/**
 * Vercel Node handler source — bundled by scripts/build-vercel.mjs into api/*.js
 * so @vercel/node never has to resolve Bun-style `.ts` import specifiers at runtime.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { routeMcpHttp } from './http-router.ts';
import { flushObservability, mcpLog } from './observability.ts';

type VercelReq = IncomingMessage & {
  query?: Record<string, string | string[]>;
  body?: unknown;
  cookies?: Record<string, string>;
};

type VercelRes = ServerResponse & {
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
  send: (body: unknown) => void;
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function toWebRequest(req: VercelReq, forcePath: string): Promise<Request> {
  const headersIn = req.headers;
  const host = headersIn['x-forwarded-host'] ?? headersIn.host ?? 'localhost';
  const proto = (headersIn['x-forwarded-proto'] as string) ?? 'https';
  const incoming = req.url ?? '/';
  const search = incoming.includes('?') ? incoming.slice(incoming.indexOf('?')) : '';
  const url = `${proto}://${host}${forcePath}${search}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(headersIn)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.set(key, value);
  }

  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers });
  }

  const body = await readBody(req);
  return new Request(url, {
    method,
    headers,
    body: body.length ? new Uint8Array(body) : undefined,
  });
}

function createHandler(forcePath: string) {
  return async function handler(req: VercelReq, res: VercelRes) {
    const started = Date.now();
    const requestId =
      (req.headers['x-vercel-id'] as string | undefined) ??
      (req.headers['x-request-id'] as string | undefined) ??
      crypto.randomUUID();

    try {
      const request = await toWebRequest(req, forcePath);
      mcpLog({
        level: 'info',
        event: 'http.request',
        message: `${req.method ?? 'GET'} ${forcePath}`,
        requestId,
        method: req.method,
        path: forcePath,
      });

      const response = await routeMcpHttp(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'transfer-encoding') return;
        res.setHeader(key, value);
      });
      const buf = Buffer.from(await response.arrayBuffer());
      res.end(buf);

      mcpLog({
        level: response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info',
        event: 'http.response',
        message: `status ${response.status}`,
        requestId,
        method: req.method,
        path: forcePath,
        statusCode: response.status,
        durationMs: Date.now() - started,
      });
    } catch (e) {
      mcpLog({
        level: 'error',
        event: 'http.unhandled',
        message: e instanceof Error ? e.message : String(e),
        requestId,
        method: req.method,
        path: forcePath,
        statusCode: 500,
        durationMs: Date.now() - started,
        error: e,
      });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: e instanceof Error ? e.message : 'Internal error' },
            id: null,
          }),
        );
      }
    } finally {
      await flushObservability();
    }
  };
}

export default createHandler;
export const health = createHandler('/health');
export const mcp = createHandler('/mcp');
export const oauthProtectedResource = createHandler('/.well-known/oauth-protected-resource');
