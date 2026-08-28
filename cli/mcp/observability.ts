/**
 * MCP observability: Sentry (errors) + Supabase mcp_logs (structured logs).
 * All sinks are optional — missing env vars disable that sink silently.
 */
import * as Sentry from '@sentry/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type McpLogEvent = {
  level: LogLevel;
  source?: 'mcp-http' | 'mcp-stdio' | 'mcp';
  event: string;
  message: string;
  requestId?: string;
  method?: string;
  path?: string;
  toolName?: string;
  userId?: string;
  brandSlug?: string;
  statusCode?: number;
  durationMs?: number;
  error?: unknown;
  context?: Record<string, unknown>;
};

let sentryReady = false;
let supabaseAdmin: SupabaseClient | null | undefined;

function ensureSentry() {
  if (sentryReady) return;
  sentryReady = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    enableLogs: false,
    initialScope: {
      tags: { service: 'anomalia-mcp' },
    },
  });
}

function getSupabaseAdmin(): SupabaseClient | null {
  if (supabaseAdmin !== undefined) return supabaseAdmin;
  const url = process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    supabaseAdmin = null;
    return null;
  }
  supabaseAdmin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return supabaseAdmin;
}

function errorFields(error: unknown): { error_name?: string; error_stack?: string; message?: string } {
  if (error instanceof Error) {
    return { error_name: error.name, error_stack: error.stack, message: error.message };
  }
  if (error === undefined || error === null) return {};
  return { error_name: typeof error, message: String(error) };
}

/** Fire-and-forget structured log to stderr + Sentry + Supabase mcp_logs. */
export function mcpLog(entry: McpLogEvent): void {
  void mcpLogAsync(entry);
}

export async function mcpLogAsync(entry: McpLogEvent): Promise<void> {
  ensureSentry();
  const err = errorFields(entry.error);
  const line = {
    level: entry.level,
    source: entry.source ?? 'mcp-http',
    event: entry.event,
    message: entry.message,
    requestId: entry.requestId,
    method: entry.method,
    path: entry.path,
    toolName: entry.toolName,
    userId: entry.userId,
    brandSlug: entry.brandSlug,
    statusCode: entry.statusCode,
    durationMs: entry.durationMs,
    errorName: err.error_name,
    context: entry.context,
  };

  // Always mirror to stderr (Vercel function logs)
  const payload = JSON.stringify(line);
  if (entry.level === 'error') console.error(`[mcp] ${payload}`);
  else if (entry.level === 'warn') console.warn(`[mcp] ${payload}`);
  else console.error(`[mcp] ${payload}`); // stdout reserved on stdio MCP; stderr is safe for both

  try {
    if (process.env.SENTRY_DSN) {
      if (entry.level === 'error') {
        Sentry.withScope((scope) => {
          scope.setTag('mcp.event', entry.event);
          scope.setTag('mcp.source', entry.source ?? 'mcp-http');
          if (entry.toolName) scope.setTag('mcp.tool', entry.toolName);
          if (entry.brandSlug) scope.setTag('mcp.brand', entry.brandSlug);
          if (entry.requestId) scope.setTag('mcp.request_id', entry.requestId);
          if (entry.userId) scope.setUser({ id: entry.userId });
          scope.setContext('mcp', line as Record<string, unknown>);
          if (entry.error instanceof Error) Sentry.captureException(entry.error);
          else Sentry.captureMessage(entry.message, 'error');
        });
      } else if (entry.level === 'warn') {
        Sentry.captureMessage(entry.message, 'warning');
      }
      // info/debug stay in stderr + supabase only (avoid Sentry noise)
    }
  } catch (e) {
    console.error('[mcp] sentry log failed', e);
  }

  try {
    const sb = getSupabaseAdmin();
    if (sb) {
      const { error } = await sb.from('mcp_logs').insert({
        level: entry.level,
        source: entry.source ?? 'mcp-http',
        event: entry.event,
        message: entry.message,
        request_id: entry.requestId ?? null,
        method: entry.method ?? null,
        path: entry.path ?? null,
        tool_name: entry.toolName ?? null,
        user_id: entry.userId ?? null,
        brand_slug: entry.brandSlug ?? null,
        status_code: entry.statusCode ?? null,
        duration_ms: entry.durationMs ?? null,
        error_name: err.error_name ?? null,
        error_stack: err.error_stack ?? null,
        context: entry.context ?? {},
      });
      if (error) console.error('[mcp] supabase mcp_logs insert failed', error.message);
    }
  } catch (e) {
    console.error('[mcp] supabase log failed', e);
  }
}

export async function flushObservability(): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  try {
    ensureSentry();
    await Sentry.flush(2000);
  } catch {
    // ignore
  }
}
