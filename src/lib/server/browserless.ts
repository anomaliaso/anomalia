/**
 * Browserless v2 REST client (cloud headless browser).
 *
 * Used by brand analysis to render JS-heavy sites (Framer/Webflow/Next) so client-rendered
 * navigation links + content are reachable, and to harvest real images. The token comes ONLY
 * from the env, never from caller input.
 *
 * OPTIONAL by design: when BROWSERLESS_API_KEY is unset, `isBrowserlessConfigured()` returns
 * false and callers fall back to static fetch — analysis never hard-fails on a missing key.
 * Ported from dalnulla (api/lib/browserless.ts), adapted to SvelteKit's $env/dynamic/private.
 */
import { env } from '$env/dynamic/private';

const DEFAULT_BASE_URL = 'https://production-sfo.browserless.io';

// Cap timeout for /function: default 30s, hard max 60s. Browserless bills per use, so we
// bound a single execution's duration.
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;

/** True when a Browserless token is configured. Callers gate escalation on this. */
export function isBrowserlessConfigured(): boolean {
    return !!env.BROWSERLESS_API_KEY;
}

function baseUrl(): string {
    return (env.BROWSERLESS_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function token(): string {
    const t = env.BROWSERLESS_API_KEY;
    if (!t) throw new Error('BROWSERLESS_API_KEY is not set');
    return t;
}

function mapHttpError(status: number, raw: string): Error {
    if (status === 401) return new Error('Browserless auth failed (401) — check BROWSERLESS_API_KEY');
    if (status === 408) return new Error('Browserless request timed out (408) — retry or raise timeout');
    if (status === 429) return new Error('Browserless rate limit hit (429) — retry shortly');
    return new Error(`Browserless error ${status}: ${raw.slice(0, 300)}`);
}

async function postJson(path: string, body: unknown): Promise<Response> {
    const res = await fetch(`${baseUrl()}${path}${path.includes('?') ? '&' : '?'}token=${token()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw mapHttpError(res.status, await res.text().catch(() => ''));
    return res;
}

/**
 * Run custom Puppeteer code in the cloud. `code` is a string of the form
 * `export default async ({ page, context }) => { ...; return value }`.
 * Returns the function's JSON value, or { contentType, base64 } for binary responses.
 */
export async function browserlessFunction(
    code: string,
    context: Record<string, unknown> = {},
    opts: { timeoutMs?: number } = {},
): Promise<unknown> {
    const timeout = Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    // NB: /function rejects unknown body properties — timeout goes on the query string.
    const res = await postJson(`/function?timeout=${timeout}`, { code, context });
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) return await res.json();
    if (ct.startsWith('text/')) return await res.text();
    const buf = Buffer.from(await res.arrayBuffer());
    return { contentType: ct || 'application/octet-stream', base64: buf.toString('base64') };
}

/** Download a page's fully-rendered HTML (after JS runs). */
export async function browserlessContent(
    url: string,
    opts: { waitForTimeout?: number } = {},
): Promise<string> {
    const body: Record<string, unknown> = { url };
    if (opts.waitForTimeout) body.waitForTimeout = opts.waitForTimeout;
    const res = await postJson(`/content`, body);
    return await res.text();
}

