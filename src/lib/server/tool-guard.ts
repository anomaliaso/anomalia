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

const TOOL_CAPS: Record<string, ToolCap> = {
  // The pre-login guest preview (/start/preview): site analysis + one caption pass + one image,
  // for anyone on the internet with no session. It is the most expensive unauthenticated call we
  // make, and no credit gate stands behind it (renderPostImage gates on a brand context a guest
  // does not have), so this cap IS the spending limit: 200 x $0.08 = ~$16/day worst case.
  'guest-preview': { perIp: 3, globalPerDay: 200, costPerRun: 0.08 },
  'keyword-research': AI_BACKED,
  'geo-audit': AI_BACKED,
  // The agent-team tool is a CONVERSATION, so it is metered per MESSAGE, not per scan: a chat has
  // no natural end, and a per-conversation cap would be a free model with extra steps. Its own
  // shape, then — more turns than a one-shot tool gets, each one cheaper (no grounding, a cached
  // site read), and a global ceiling that keeps the worst case in the same order as the rest.
  'agent-team': { perIp: 15, globalPerDay: 600, costPerRun: 0.02 },
  'llms-txt-generator': AI_BACKED,
  'llms-txt-validator': PARSE_ONLY,
  'sitemap-analyzer': PARSE_ONLY
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
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (v6 === '::1' || v6 === '::') return true;
  if (/^f[cd]/.test(v6)) return true; // unique-local
  if (/^fe[89ab]/.test(v6)) return true; // link-local

  // An IPv6 address can carry an IPv4 one inside it, and the address finally dialled is that
  // IPv4 one — so it has to face the IPv4 rules above. Reading only the prefix calls
  // ::ffff:127.0.0.1 public and then opens a connection to loopback. `lookup` returns AAAA
  // records verbatim, so this is a form a hostname can genuinely deliver.
  const inner = embeddedIpv4(v6);
  return inner ? isPrivateAddress(inner) : false;
}

/** The 8 hextets of an IPv6 address, `::` expanded. Null when it is not one. */
function hextetsOf(v6: string): string[] | null {
  const halves = v6.split('::');
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(':') : [];
  if (halves.length === 1) return left.length === 8 ? left : null;

  const right = halves[1] ? halves[1].split(':') : [];
  const gap = 8 - left.length - right.length;
  if (gap < 0) return null;

  return [...left, ...Array(gap).fill('0'), ...right];
}

function quadOf(high: string, low: string): string {
  const h = parseInt(high, 16);
  const l = parseInt(low, 16);
  if (!Number.isFinite(h) || !Number.isFinite(l)) return '';
  return `${(h >> 8) & 255}.${h & 255}.${(l >> 8) & 255}.${l & 255}`;
}

/**
 * The IPv4 address embedded in an IPv6 one, in every shape a resolver can hand back: mapped and
 * compatible (`::ffff:127.0.0.1`, `::ffff:7f00:1`, `::127.0.0.1`), 6to4 (`2002:7f00:1::`) and
 * NAT64 (`64:ff9b::7f00:1`).
 */
function embeddedIpv4(v6: string): string | null {
  const dotted = v6.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (dotted) return dotted[1];

  const parts = hextetsOf(v6);
  if (!parts) return null;

  const value = (hextet: string) => parseInt(hextet, 16);
  const leadingZeros = parts.slice(0, 5).every((p) => value(p) === 0);

  if (leadingZeros && (value(parts[5]) === 0xffff || value(parts[5]) === 0)) {
    return quadOf(parts[6], parts[7]) || null;
  }
  if (value(parts[0]) === 0x64 && value(parts[1]) === 0xff9b) return quadOf(parts[6], parts[7]) || null;
  if (value(parts[0]) === 0x2002) return quadOf(parts[1], parts[2]) || null;

  return null;
}

/**
 * Why a guarded fetch refused. The message stays what it always was — callers that match on it
 * keep working — but a caller that has to MAP the refusal onto its own vocabulary reads the
 * reason instead of the prose.
 */
export type SafeFetchReason = 'not_public' | 'too_large' | 'fetch_failed';

export class SafeFetchError extends Error {
  constructor(
    readonly reason: SafeFetchReason,
    message: string
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

/**
 * How much latitude the scheme gets, per caller.
 *
 * It is an argument and not an `if` at the call site because the redirect chain has to obey it
 * too: a caller that demands https and only checks the URL it was handed still ships the file in
 * clear the moment a hop answers `302 Location: http://…`. Declared here, it applies to every hop.
 */
export type UrlScheme = 'https-only' | 'http-or-https';

const SCHEMES_ALLOWED: Record<UrlScheme, readonly string[]> = {
  'https-only': ['https:'],
  'http-or-https': ['http:', 'https:']
};

const SCHEME_REFUSAL: Record<UrlScheme, string> = {
  'https-only': 'Only https URLs are supported',
  'http-or-https': 'Only http(s) URLs are supported'
};

/**
 * Reject anything that isn't a public host on an allowed scheme. Throws with a user-safe message.
 *
 * Exported because /start/preview is the same shape of caller as the tools above — an
 * anonymous stranger's URL — and must not fall back to the hostname-pattern check.
 */
export async function assertPublicUrl(url: URL, scheme: UrlScheme = 'http-or-https'): Promise<void> {
  if (!SCHEMES_ALLOWED[scheme].includes(url.protocol)) {
    throw new SafeFetchError('not_public', SCHEME_REFUSAL[scheme]);
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new SafeFetchError('not_public', 'That host is not reachable');
  }
  // A hostname can resolve to a private address even when it looks public (DNS rebinding), so
  // check the resolved addresses rather than the string.
  const addrs = await lookup(host, { all: true }).catch((error) => { swallow('resolve host addresses', error); return []; });
  if (!addrs.length) throw new SafeFetchError('not_public', 'Could not resolve that host');
  if (addrs.some((a) => isPrivateAddress(a.address))) {
    throw new SafeFetchError('not_public', 'That host is not reachable');
  }
}

/**
 * The name the platform CDNs already know the archivers by. It predates the guard and is kept
 * verbatim: a CDN that starts refusing an unfamiliar agent answers 403, and a 403 here is
 * indistinguishable from the expired link this whole archive exists to beat.
 */
export const ARCHIVE_USER_AGENT = 'Mozilla/5.0 (compatible; AnomaliaArchive/1.0)';

export type SafeFetchResult = { url: string; status: number; ok: boolean; headers: Headers; body: string };

type HopOptions = {
  timeoutMs?: number;
  maxRedirects?: number;
  method?: 'GET' | 'HEAD';
  /** Checked on every hop, not just the first. Defaults to accepting http and https. */
  scheme?: UrlScheme;
  /**
   * Platform CDNs answer differently depending on who is asking, and an archiver that suddenly
   * changed its name would start collecting 403s that look exactly like expired links.
   */
  userAgent?: string;
};

/**
 * Walk the redirect chain to the response that actually carries a body, gating every hop.
 *
 * The gate runs per hop and not once at the start, because that is the whole attack: a public
 * URL is allowed to answer `302 Location: http://169.254.169.254/`, and a guard that trusted the
 * first URL would follow it. The wall clock is shared across hops so a chain of slow redirects
 * cannot outlive the budget one hop at a time.
 */
async function fetchFollowingGatedRedirects(
  input: string,
  opts: HopOptions
): Promise<{ url: URL; res: Response }> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxRedirects = opts.maxRedirects ?? 4;
  const scheme = opts.scheme ?? 'http-or-https';
  const userAgent = opts.userAgent ?? `Anomalia-Tools/1.0 (+${env.CRAWLER_CONTACT_URL || 'https://anomalia.so'})`;

  let current = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  const deadline = Date.now() + timeoutMs;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current, scheme);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SafeFetchError('fetch_failed', 'Request timed out');

    const res = await fetch(current, {
      method: opts.method ?? 'GET',
      headers: { 'User-Agent': userAgent, Accept: '*/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(remaining)
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (hop === maxRedirects) throw new SafeFetchError('fetch_failed', 'Too many redirects');
      current = new URL(res.headers.get('location') as string, current);
      continue;
    }

    return { url: current, res };
  }
  throw new SafeFetchError('fetch_failed', 'Too many redirects');
}

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
  const { url, res } = await fetchFollowingGatedRedirects(input, opts);

  // Trust the declared length only to reject early; the read below is what actually enforces
  // the budget (Content-Length is attacker-controlled and often absent).
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared && declared > maxBytes) throw new SafeFetchError('too_large', 'That page is too large to analyse');

  return { url: url.toString(), status: res.status, ok: res.ok, headers: res.headers, body: await readCapped(res, maxBytes) };
}

export type SafeFetchBytesResult = { url: string; status: number; ok: boolean; mime: string; bytes: Buffer };

/**
 * The same guarded walk, for a body that is not text.
 *
 * It differs from safeFetchUrl in the one place that matters for a file: passing the ceiling
 * TRUNCATES a page (a cut `<head>` still parses) and must REJECT a download (a cut JPEG is a
 * corrupt asset stored as if it were whole).
 */
export async function safeFetchBytes(
  input: string,
  opts: { maxBytes: number; timeoutMs?: number; maxRedirects?: number; scheme?: UrlScheme; userAgent?: string }
): Promise<SafeFetchBytesResult> {
  const { url, res } = await fetchFollowingGatedRedirects(input, opts);

  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared && declared > opts.maxBytes) throw new SafeFetchError('too_large', 'That file is too large');

  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return {
    url: url.toString(),
    status: res.status,
    ok: res.ok,
    mime,
    bytes: await readAllOrReject(res, opts.maxBytes)
  };
}

async function readAllOrReject(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new SafeFetchError('too_large', 'That file is too large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
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

