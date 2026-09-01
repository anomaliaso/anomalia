// Spend + abuse guard for the PUBLIC free tools under /api/tools.
//
// Those routes take a URL or a niche string from anyone on the internet, with no session, and
// some of them spend real money per call (Gemini web-search grounding, DataForSEO tasks). Two
// separate things can go wrong, so there are two separate defences here:
//
//   1. COST — a per-IP daily cap stops one script, and a per-tool GLOBAL daily cap bounds the
//      worst case no matter how many IPs show up. The global cap is the number that makes the
//      bill knowable: worst case/day = globalPerDay × costPerRun (see TOOL_CAPS below).
//   2. SSRF — every tool fetches a user-supplied URL server-side. Without a guard that is a
//      request forger pointed at cloud metadata and private networks. safeFetchUrl resolves the
//      host, rejects private/loopback/link-local targets, re-checks every redirect hop, and caps
//      body size and time.
import { swallow } from '$lib/server/swallow';
import { env } from '$env/dynamic/private';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase-admin';

type ToolCap = {
  /** Requests per IP per day. */
  perIp: number;
  /** Requests per day across everyone — the hard ceiling on this tool's daily spend. */
  globalPerDay: number;
  /** Rough USD per run. 0 = parse-only (no paid API), which also makes the guard fail-open. */
  costPerRun: number;
};

// Worst-case daily spend is globalPerDay × costPerRun. Summed over every paid tool below that
// is ~$25/day — the ceiling, not the expectation. Tighten globalPerDay to lower it; nothing
// else needs to change.
const PARSE_ONLY: ToolCap = { perIp: 30, globalPerDay: 5000, costPerRun: 0 };
// Gemini call with web-search grounding — the most expensive thing a free tool can do.
const AI_BACKED: ToolCap = { perIp: 3, globalPerDay: 200, costPerRun: 0.04 };
// One or two DataForSEO Labs live tasks (~$0.013 each).
const DFS_LABS: ToolCap = { perIp: 5, globalPerDay: 400, costPerRun: 0.03 };
// DataForSEO Backlinks — priced well above Labs, and the classic free-tool abuse magnet.
const DFS_BACKLINKS: ToolCap = { perIp: 2, globalPerDay: 60, costPerRun: 0.06 };

const TOOL_CAPS: Record<string, ToolCap> = {
  // The pre-login guest preview (/start/preview): site analysis + one caption pass + one image,
  // for anyone on the internet with no session. It is the most expensive unauthenticated call we
  // make, and no credit gate stands behind it (renderPostImage gates on a brand context a guest
  // does not have), so this cap IS the spending limit: 200 x $0.08 = ~$16/day worst case.
  'guest-preview': { perIp: 3, globalPerDay: 200, costPerRun: 0.08 },
  // Existing tools (previously unguarded).
  'keyword-research': AI_BACKED,
  // Site fetch + grounded AI discovery + DataForSEO overview (+ optional Reddit samples).
  'conversation-gap': AI_BACKED,
  'geo-audit': AI_BACKED,
  // The agent-team tool is a CONVERSATION, so it is metered per MESSAGE, not per scan: a chat has
  // no natural end, and a per-conversation cap would be a free model with extra steps. Its own
  // shape, then — more turns than a one-shot tool gets, each one cheaper (no grounding, a cached
  // site read), and a global ceiling that keeps the worst case in the same order as the rest.
  'agent-team': { perIp: 15, globalPerDay: 600, costPerRun: 0.02 },
  'llms-txt-generator': AI_BACKED,
  'llms-txt-validator': PARSE_ONLY,
  'sitemap-analyzer': PARSE_ONLY,
  // Parse-only additions.
  'meta-tags': PARSE_ONLY,
  'schema-validator': PARSE_ONLY,
  'robots-tester': PARSE_ONLY,
  'redirect-checker': PARSE_ONLY,
  'heading-audit': PARSE_ONLY,
  'broken-links': PARSE_ONLY,
  // PSI is free but quota-limited (25k/day). PARSE_ONLY's 5000/day global keeps us far under it
  // even if every other quota consumer in the account fires at once.
  'page-speed': PARSE_ONLY,
  // Data-backed additions.
  'keyword-difficulty': DFS_LABS,
  'traffic-estimator': DFS_LABS,
  'long-tail': DFS_LABS,
  'competitor-gap': DFS_LABS,
  'rank-checker': DFS_LABS,
  'ai-visibility': DFS_LABS,
  'backlink-checker': DFS_BACKLINKS
};

// Hashed so we never store a raw IP. Salted with the service-role key (always set in prod) so
// the hashes aren't a rainbow-table away from the original address.
function bucketFor(ip: string): string {
  return createHash('sha256').update(`${ip}|${process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'dev'}`).digest('hex').slice(0, 32);
}

export type GuardResult = { ok: true } | { ok: false; response: Response };

/**
 * Count this request against the tool's caps. Returns a ready-to-return 429/503 when the caller
 * must stop BEFORE spending anything.
 *
 * Fail behaviour is deliberate: if the counter itself is unavailable, parse-only tools carry on
 * (they cost nothing, and breaking them buys us nothing) while paid tools refuse. An uncountable
 * paid call is precisely the one we can't afford to let through.
 */
export async function guardTool(tool: string, clientIp: string): Promise<GuardResult> {
  const cap = TOOL_CAPS[tool] ?? PARSE_ONLY;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('bump_tool_usage', { p_tool: tool, p_bucket: bucketFor(clientIp) });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    const ipCount = Number(row?.ip_count ?? 0);
    const globalCount = Number(row?.global_count ?? 0);

    if (ipCount > cap.perIp) {
      return {
        ok: false,
        response: json(
          { error: 'Daily limit reached for this free tool. Sign up for unlimited runs.', limit: cap.perIp, scope: 'ip' },
          { status: 429, headers: { 'Retry-After': String(secondsUntilUtcMidnight()) } }
        )
      };
    }
    if (globalCount > cap.globalPerDay) {
      return {
        ok: false,
        response: json(
          { error: 'This free tool hit its daily capacity. Try again tomorrow.', scope: 'global' },
          { status: 429, headers: { 'Retry-After': String(secondsUntilUtcMidnight()) } }
        )
      };
    }
    return { ok: true };
  } catch (e) {
    console.error('[tool-guard] counter unavailable:', e);
    if (cap.costPerRun === 0) return { ok: true };
    return { ok: false, response: json({ error: 'Tool temporarily unavailable. Try again shortly.' }, { status: 503 }) };
  }
}

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.round((midnight - now.getTime()) / 1000));
}

// ---------------------------------------------------------------------------
// SSRF-safe fetching
// ---------------------------------------------------------------------------

// NOTE: brand-analysis.ts has its own isUrlSafe, kept deliberately separate. That one matches
// hostname PATTERNS only, which is fine for URLs we already trust (a brand's own site). These
// tools take a URL from an anonymous stranger, so the check has to survive a public hostname
// whose DNS record points at 127.0.0.1 — hence the resolve-then-check below.
//
// IPv4 private/loopback/link-local + IPv6 loopback/unique-local/link-local. 169.254.169.254 (the
// cloud metadata endpoint) falls inside the link-local range and is the whole reason this exists.
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v6 === '::1' || v6 === '::') return true;
  if (/^f[cd]/.test(v6)) return true; // unique-local
  if (/^fe[89ab]/.test(v6)) return true; // link-local
  return false;
}

/** Reject anything that isn't a public http(s) host. Throws with a user-safe message. */
async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) URLs are supported');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('That host is not reachable');
  }
  // A hostname can resolve to a private address even when it looks public (DNS rebinding), so
  // check the resolved addresses rather than the string.
  const addrs = await lookup(host, { all: true }).catch((error) => { swallow('resolve host addresses', error); return []; });
  if (!addrs.length) throw new Error('Could not resolve that host');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error('That host is not reachable');
}

export type SafeFetchResult = { url: string; status: number; ok: boolean; headers: Headers; body: string };

/**
 * Fetch a user-supplied URL with the guardrails a public endpoint needs: public hosts only
 * (re-checked on every redirect hop, since a public URL can redirect to 127.0.0.1), a byte
 * budget so a multi-GB response can't exhaust the function, and a wall-clock timeout.
 */
export async function safeFetchUrl(
  input: string,
  opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number; method?: 'GET' | 'HEAD' } = {}
): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxRedirects = opts.maxRedirects ?? 4;

  let current = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  const deadline = Date.now() + timeoutMs;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Request timed out');

    const res = await fetch(current, {
      method: opts.method ?? 'GET',
      headers: { 'User-Agent': `Anomalia-Tools/1.0 (+${env.CRAWLER_CONTACT_URL || 'https://anomalia.so'})`, Accept: '*/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(remaining)
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (hop === maxRedirects) throw new Error('Too many redirects');
      current = new URL(res.headers.get('location') as string, current);
      continue;
    }

    // Trust the declared length only to reject early; the read below is what actually enforces
    // the budget (Content-Length is attacker-controlled and often absent).
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared && declared > maxBytes) throw new Error('That page is too large to analyse');

    return { url: current.toString(), status: res.status, ok: res.ok, headers: res.headers, body: await readCapped(res, maxBytes) };
  }
  throw new Error('Too many redirects');
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        break; // Keep what we have — a truncated <head> is still analysable.
      }
      chunks.push(value);
    }
  } catch {
    // Partial body is fine; the caller parses what arrived.
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

/**
 * The whole body of a URL-in / report-out tool route: cap the caller, validate the URL, run the
 * analysis, and turn any failure into a clean 4xx. Every free tool follows this shape, so the
 * routes themselves stay down to the one line that is actually specific to them.
 */
export async function runUrlTool<T>(
  tool: string,
  clientIp: string,
  rawUrl: unknown,
  analyse: (url: string) => Promise<T>
): Promise<Response> {
  const input = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!input) return json({ error: 'A website URL is required' }, { status: 400 });

  const guard = await guardTool(tool, clientIp);
  if (!guard.ok) return guard.response;

  try {
    return json({ success: true, result: await analyse(input) });
  } catch (e) {
    // safeFetchUrl throws user-safe messages ("That host is not reachable", "Request timed out");
    // anything else is ours and shouldn't leak.
    const msg = e instanceof Error ? e.message : '';
    const known = /not reachable|too large|timed out|redirects|resolve|http\(s\)/i.test(msg);
    if (!known) console.error(`[tool:${tool}]`, e);
    return json({ error: known ? msg : 'Could not analyse that URL. Check it and try again.' }, { status: known ? 400 : 500 });
  }
}

/** Follow the redirect chain, returning every hop. Used by the redirect-checker tool. */
export async function traceRedirects(
  input: string,
  maxHops = 8
): Promise<Array<{ url: string; status: number; location: string | null }>> {
  let current = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  const hops: Array<{ url: string; status: number; location: string | null }> = [];
  const seen = new Set<string>();

  for (let i = 0; i < maxHops; i++) {
    if (seen.has(current.toString())) {
      hops.push({ url: current.toString(), status: 0, location: 'redirect loop' });
      break;
    }
    seen.add(current.toString());
    await assertPublicUrl(current);
    const res = await fetch(current, {
      method: 'GET',
      headers: { 'User-Agent': `Anomalia-Tools/1.0 (+${env.CRAWLER_CONTACT_URL || 'https://anomalia.so'})` },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000)
    });
    const location = res.headers.get('location');
    hops.push({ url: current.toString(), status: res.status, location });
    res.body?.cancel().catch(() => {});
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current);
      continue;
    }
    break;
  }
  return hops;
}
