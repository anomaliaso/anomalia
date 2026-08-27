// Server-side Seline (@seline-analytics/node). The browser script in app.html tracks page
// views; this module identifies authenticated users into Profiles via setUser, and can fire
// custom events that require a userId. Fire-and-forget — never blocks a request.
//
// No default token. The value is public (same data-token as the client script) but it is OURS:
// baked in as a fallback, every self-hosted install identified its own logged-in users — email
// and name — into Anomalia's Seline project. Without PUBLIC_SELINE_TOKEN this module no-ops,
// like Sentry without a DSN.

import { swallow } from '$lib/server/swallow';
import { Seline } from '@seline-analytics/node';
import { env } from '$env/dynamic/public';

let client: ReturnType<typeof Seline> | null = null;
/** Per-instance debounce so SPA navigations don't POST /s/su on every load. */
const identifiedAt = new Map<string, number>();
const IDENTIFY_TTL_MS = 5 * 60 * 1000;

function seline() {
  const token = env.PUBLIC_SELINE_TOKEN?.trim();
  if (!token) return null;
  if (!client) client = Seline({ token });
  return client;
}

/**
 * Create/update a Seline Profile for a logged-in user. Safe to call on every session start;
 * debounced per userId within this server instance.
 */
export function selineSetUser(userId: string, fields: Record<string, unknown> = {}) {
  if (!userId) return;
  const now = Date.now();
  const last = identifiedAt.get(userId);
  if (last && now - last < IDENTIFY_TTL_MS) return;
  identifiedAt.set(userId, now);
  try {
    seline()?.setUser({ userId, fields });
  } catch (error) { swallow('identify user in seline', error); }
}

/** Track a custom event attributed to a known userId. */
export function selineTrack(userId: string, name: string, data?: Record<string, unknown>) {
  if (!userId || !name) return;
  try {
    seline()?.track({ userId, name, data: data ?? null });
  } catch (error) { swallow('track seline event', error); }
}
