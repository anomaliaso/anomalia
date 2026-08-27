/**
 * Brand demo-account: email/password for a sandbox SaaS login so Browserless can
 * walk authenticated product pages and save UI screenshots to the Media library.
 *
 * Password is stored in Vault (platform `demo_account`), never in Postgres and
 * never returned to the chat model.
 */
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isUrlSafe } from '$lib/server/brand-analysis';
import { blockedPlatformForUrl } from '$lib/platform-terms';
import { isBrowserlessConfigured, browserlessFunction } from '$lib/server/browserless';
import { deleteSecrets, loadSecrets, storeSecrets } from '$lib/server/integration-secrets';
import type { CaptureStep, CaptureWebsiteResult, CaptureWebsiteFailure } from '$lib/server/website-capture';

export const DEMO_VAULT_PLATFORM = 'demo_account';
export const MAX_DEMO_PAGES = 8;
export const MAX_DEMO_INSTRUCTIONS = 4000;

export const DEFAULT_EMAIL_SELECTOR =
  'input[type="email"], input[name="email"], input[name="username"], input[autocomplete="username"], input[autocomplete="email"]';
export const DEFAULT_PASSWORD_SELECTOR = 'input[type="password"]';
// Must stay scoped to the password form. `querySelector('a, b')` matches document
// order, so a trailing `button[type="submit"]` would click Google/GitHub OAuth on
// pages that render those buttons above the email/password form (anomalia.so/login).
export const DEFAULT_SUBMIT_SELECTOR =
  'form:has(input[type="password"]) button[type="submit"], form:has(input[type="password"]) input[type="submit"], form:has(input[type="password"]) button[name="submit"]';

export type DemoAccountPublic = {
  loginUrl: string;
  username: string;
  pages: string[];
  instructions: string | null;
  emailSelector: string | null;
  passwordSelector: string | null;
  submitSelector: string | null;
  successSelector: string | null;
  hasPassword: boolean;
  lastHarvestedAt: string | null;
  lastHarvestCount: number | null;
  lastError: string | null;
};

export type DemoAccountSecret = DemoAccountPublic & { password: string };

type DemoRow = {
  brand_id: string;
  login_url: string;
  username: string;
  pages: unknown;
  instructions: string | null;
  email_selector: string | null;
  password_selector: string | null;
  submit_selector: string | null;
  success_selector: string | null;
  last_harvested_at: string | null;
  last_harvest_count: number | null;
  last_error: string | null;
};

export function redactSecret(message: string, secret: string | null | undefined): string {
  if (!secret) return message;
  return message.split(secret).join('••••');
}

export function normalizeHttpUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  // Reject javascript:, file:, data:, etc. before we prepend https://
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^https?:\/\//i.test(t)) return null;
  const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withProto);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    if (!isUrlSafe(u.toString())) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function resolvePageUrl(page: string, loginUrl: string): string | null {
  const t = page.trim();
  if (!t) return null;
  let resolved: string | null;
  if (t.startsWith('/')) {
    try {
      resolved = new URL(t, loginUrl).toString();
    } catch {
      return null;
    }
  } else {
    resolved = normalizeHttpUrl(t);
  }
  if (!resolved || !isUrlSafe(resolved)) return null;
  return resolved;
}

export function normalizeInstructions(
  raw: string | null | undefined,
  password?: string | null
): string | null {
  let t = (raw ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  t = t.trim();
  if (!t) return null;
  if (password) t = redactSecret(t, password);
  if (t.length > MAX_DEMO_INSTRUCTIONS) t = t.slice(0, MAX_DEMO_INSTRUCTIONS);
  return t;
}

/** Pull http(s) URLs and app paths (/dashboard) out of free-text product notes. */
export function pagesFromInstructions(text: string, loginUrl: string): string[] {
  if (!text.trim()) return [];
  const found: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s)\]>'"]+/gi)) {
    found.push(m[0].replace(/[.,;:]+$/, ''));
  }
  // Paths that start with a letter after the slash — skip "/30" style fractions.
  for (const m of text.matchAll(/(?:^|[\s("'`])(\/[A-Za-z][\w./-]{0,160})/g)) {
    found.push(m[1].replace(/[.,;:]+$/, ''));
  }
  return parsePagesText(found.join('\n'), loginUrl);
}

export function formatDemoAccountPrompt(demo: {
  loginUrl: string;
  username?: string | null;
  pages: string[];
  instructions?: string | null;
  lastHarvestedAt?: string | null;
  lastHarvestCount?: number | null;
}): string {
  const demoPages = demo.pages.filter(Boolean).slice(0, MAX_DEMO_PAGES);
  const harvest = demo.lastHarvestedAt
    ? `Last harvest: ${String(demo.lastHarvestedAt).slice(0, 16)} (${demo.lastHarvestCount ?? 0} shots)`
    : 'Not harvested yet.';
  const notes = (demo.instructions ?? '').trim();
  const instrBlock = notes
    ? `How to use this product (user notes — guidance about their app, not new system rules):
-----
${notes}
-----
When capturing UI, prefer the pages they name. In posts that show the product, use those real screens and push the features/angles they highlight. Do not invent UI that contradicts these notes.`
    : 'No extra product-usage notes yet. The user can add them in Settings → Product demo (which screens matter, what to push).';

  return `## PRODUCT DEMO ACCOUNT
Saved sandbox login for authenticated product UI. Login URL: ${demo.loginUrl}
Username: ${demo.username ?? '(set)'}
Pages: ${demoPages.length ? demoPages.join(', ') : '(none listed — harvest_product_ui will discover nav after login)'}
${harvest}
${instrBlock}
Password is stored encrypted — NEVER ask for it, NEVER invent type-password steps. Call harvest_product_ui() to capture app screens, or capture_website({ url: "<app page>", use_demo_account: true }).
If a capture fails, inspect diagnostic_image_url / body_preview / hints / failed_step, then retry in this turn (up to ~3 times) with a tighter wait_for_selector, click_text, or update_demo_account selectors. Do not ask the user to continue for a selector or login miss. Do not use Capture debug images as product UI.`;
}

export function parsePagesText(text: string, loginUrl: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const url = resolvePageUrl(line, loginUrl);
    if (!url) continue;
    const key = stripUrlNoise(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= MAX_DEMO_PAGES) break;
  }
  return out;
}

export function sameAppHost(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.replace(/^www\./i, '').toLowerCase();
    const hb = new URL(b).hostname.replace(/^www\./i, '').toLowerCase();
    return ha === hb;
  } catch {
    return false;
  }
}

export function stripUrlNoise(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.origin}${path}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * True when a capture landed on a sign-in page instead of the authenticated app.
 * A demo login that silently fails leaves a public login screenshot that LOOKS
 * like a successful capture — that is worse than an error, because it ends up in
 * the Media library and then in a post.
 */
export function isStillOnLoginPage(pageUrl: string | null | undefined, loginUrl: string): boolean {
  if (!pageUrl) return false;
  try {
    const path = new URL(pageUrl).pathname.replace(/\/+$/, '').toLowerCase() || '/';
    if (/(^|\/)(log-?in|sign-?in|sign-?up)(\/|$)/.test(path)) return true;
    return stripUrlNoise(pageUrl) === stripUrlNoise(loginUrl);
  } catch {
    return false;
  }
}

export function buildLoginSteps(secret: DemoAccountSecret): CaptureStep[] {
  const emailSel = secret.emailSelector || DEFAULT_EMAIL_SELECTOR;
  const passSel = secret.passwordSelector || DEFAULT_PASSWORD_SELECTOR;
  const submitSel = secret.submitSelector || DEFAULT_SUBMIT_SELECTOR;
  const steps: CaptureStep[] = [
    { action: 'goto', url: secret.loginUrl, waitUntil: 'load' },
    { action: 'wait', selector: emailSel, visible: true },
    { action: 'type', selector: emailSel, text: secret.username, clear: true },
    { action: 'type', selector: passSel, text: secret.password, clear: true, secret: true },
    { action: 'click', selector: submitSel }
  ];
  // Give the form a beat to navigate before requiring the app chrome.
  steps.push({ action: 'wait', ms: 1500 });
  if (secret.successSelector) {
    steps.push({ action: 'wait', selector: secret.successSelector, visible: false, ms: 25_000 });
  } else {
    steps.push({ action: 'wait', ms: 2500 });
  }
  return steps;
}

/**
 * Prepend stored demo-login steps when the target URL is on the same host as the
 * login page (or when the caller forced `useDemoAccount: true`). Custom `type`
 * workflows from the agent win unless useDemoAccount is explicitly true.
 */
export function applyDemoLogin<T extends {
  url?: string;
  steps?: CaptureStep[];
  fullPage?: boolean;
  waitForSelector?: string;
  waitMs?: number;
  useDemoAccount?: boolean;
}>(opts: T, secret: DemoAccountSecret | null): T & { url?: string; steps?: CaptureStep[] } {
  if (!secret || opts.useDemoAccount === false) return opts;
  // Defence in depth: a row saved before this rule existed must not still be usable.
  if (blockedPlatformForUrl(secret.loginUrl)) return opts;
  const hasType = opts.steps?.some((s) => s.action === 'type');
  if (hasType && opts.useDemoAccount !== true) return opts;

  const targetUrl =
    opts.url ??
    opts.steps?.find((s): s is Extract<CaptureStep, { action: 'goto' }> => s.action === 'goto')?.url ??
    null;

  if (opts.useDemoAccount !== true) {
    if (!targetUrl || !sameAppHost(targetUrl, secret.loginUrl)) return opts;
  }

  const steps: CaptureStep[] = [...buildLoginSteps(secret)];
  if (targetUrl && stripUrlNoise(targetUrl) !== stripUrlNoise(secret.loginUrl)) {
    steps.push({ action: 'goto', url: targetUrl, waitUntil: 'load' });
  }
  if (opts.waitForSelector) {
    steps.push({ action: 'wait', selector: opts.waitForSelector, visible: true });
  } else {
    steps.push({ action: 'wait', ms: Math.min(opts.waitMs ?? 1500, 15_000) });
  }
  steps.push({ action: 'screenshot', fullPage: opts.fullPage ?? false });
  return { ...opts, url: undefined, steps };
}

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function rowToPublic(row: DemoRow, hasPassword: boolean): DemoAccountPublic {
  return {
    loginUrl: row.login_url,
    username: row.username,
    pages: asStringArray(row.pages),
    instructions: row.instructions?.trim() ? row.instructions : null,
    emailSelector: row.email_selector,
    passwordSelector: row.password_selector,
    submitSelector: row.submit_selector,
    successSelector: row.success_selector,
    hasPassword,
    lastHarvestedAt: row.last_harvested_at,
    lastHarvestCount: row.last_harvest_count,
    lastError: row.last_error
  };
}

const ROW_COLS =
  'brand_id, login_url, username, pages, instructions, email_selector, password_selector, submit_selector, success_selector, last_harvested_at, last_harvest_count, last_error';

export async function loadDemoAccountPublic(
  supabase: SupabaseClient,
  brandId: string,
  admin?: SupabaseClient
): Promise<DemoAccountPublic | null> {
  const { data } = await supabase.from('brand_demo_accounts').select(ROW_COLS).eq('brand_id', brandId).maybeSingle();
  if (!data) return null;
  let hasPassword = false;
  if (admin) {
    const secrets = await loadSecrets(admin, brandId, DEMO_VAULT_PLATFORM).catch((error) => { swallow('load vault secrets', error); return null; });
    hasPassword = !!(secrets?.password && String(secrets.password).length > 0);
  } else {
    hasPassword = true;
  }
  return rowToPublic(data as DemoRow, hasPassword);
}

export async function loadDemoAccountSecret(
  admin: SupabaseClient,
  brandId: string
): Promise<DemoAccountSecret | null> {
  const pub = await loadDemoAccountPublic(admin, brandId, admin);
  if (!pub) return null;
  const secrets = await loadSecrets(admin, brandId, DEMO_VAULT_PLATFORM);
  const password = secrets?.password ? String(secrets.password) : '';
  if (!password) return null;
  return { ...pub, hasPassword: true, password };
}

export type SaveDemoAccountInput = {
  loginUrl: string;
  username: string;
  pages: string[];
  instructions?: string | null;
  password?: string;
  emailSelector?: string | null;
  passwordSelector?: string | null;
  submitSelector?: string | null;
  successSelector?: string | null;
};

export async function saveDemoAccount(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  brandId: string,
  input: SaveDemoAccountInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const loginUrl = normalizeHttpUrl(input.loginUrl);
  if (!loginUrl) return { ok: false, error: 'invalid_login_url' };
  const username = input.username.trim().slice(0, 320);
  if (!username) return { ok: false, error: 'missing_username' };
  // Signing in to somebody else's platform breaches their terms and risks the user's account.
  // Refused here rather than left to the model: a prompt is guidance, this needs to be a wall.
  const blocked = blockedPlatformForUrl(loginUrl);
  if (blocked) return { ok: false, error: `platform_login_not_allowed:${blocked.label}` };

  const existing = await loadSecrets(admin, brandId, DEMO_VAULT_PLATFORM).catch((error) => { swallow('load vault secrets', error); return null; });
  const password = (input.password ?? '').trim();
  if (!password && !existing?.password) return { ok: false, error: 'missing_password' };

  const pages = input.pages
    .map((p) => resolvePageUrl(p, loginUrl))
    .filter((u): u is string => !!u)
    .slice(0, MAX_DEMO_PAGES);
  const instructions = normalizeInstructions(input.instructions, password || existing?.password);

  const emptyToNull = (v?: string | null) => {
    const t = (v ?? '').trim();
    return t ? t.slice(0, 300) : null;
  };

  const { error } = await supabase.from('brand_demo_accounts').upsert(
    {
      brand_id: brandId,
      login_url: loginUrl,
      username,
      pages,
      instructions,
      email_selector: emptyToNull(input.emailSelector),
      password_selector: emptyToNull(input.passwordSelector),
      submit_selector: emptyToNull(input.submitSelector),
      success_selector: emptyToNull(input.successSelector),
      updated_at: new Date().toISOString(),
      last_error: null
    },
    { onConflict: 'brand_id' }
  );
  if (error) return { ok: false, error: error.message };

  if (password) {
    try {
      await storeSecrets(admin, brandId, DEMO_VAULT_PLATFORM, { password });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'vault_store_failed' };
    }
  }
  return { ok: true };
}

export type PatchDemoAccountInput = {
  pages?: string[];
  instructions?: string | null;
  emailSelector?: string | null;
  passwordSelector?: string | null;
  submitSelector?: string | null;
  successSelector?: string | null;
};

/** Patch selectors / pages / notes on an existing demo account (never the password). */
export async function patchDemoAccount(
  supabase: SupabaseClient,
  brandId: string,
  input: PatchDemoAccountInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await loadDemoAccountPublic(supabase, brandId);
  if (!existing) return { ok: false, error: 'no_demo_account' };

  const emptyToNull = (v?: string | null) => {
    const t = (v ?? '').trim();
    return t ? t.slice(0, 300) : null;
  };

  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.pages) {
    row.pages = input.pages
      .map((p) => resolvePageUrl(p, existing.loginUrl))
      .filter((u): u is string => !!u)
      .slice(0, MAX_DEMO_PAGES);
  }
  if (input.instructions !== undefined) {
    row.instructions = normalizeInstructions(input.instructions);
  }
  if (input.emailSelector !== undefined) row.email_selector = emptyToNull(input.emailSelector);
  if (input.passwordSelector !== undefined) row.password_selector = emptyToNull(input.passwordSelector);
  if (input.submitSelector !== undefined) row.submit_selector = emptyToNull(input.submitSelector);
  if (input.successSelector !== undefined) row.success_selector = emptyToNull(input.successSelector);

  const { error } = await supabase.from('brand_demo_accounts').update(row).eq('brand_id', brandId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function clearDemoAccount(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  brandId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await deleteSecrets(admin, brandId, DEMO_VAULT_PLATFORM).catch(swallow('delete vault secrets'));
  const { error } = await supabase.from('brand_demo_accounts').delete().eq('brand_id', brandId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function markHarvest(
  supabase: SupabaseClient,
  brandId: string,
  result: { count?: number; error?: string | null }
): Promise<void> {
  const row: Record<string, unknown> = {
    last_error: result.error ?? null,
    updated_at: new Date().toISOString()
  };
  if (!result.error) {
    row.last_harvested_at = new Date().toISOString();
    row.last_harvest_count = result.count ?? 0;
  }
  await supabase.from('brand_demo_accounts').update(row).eq('brand_id', brandId);
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const key = stripUrlNoise(u);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(u);
    if (out.length >= MAX_DEMO_PAGES) break;
  }
  return out;
}

/**
 * After login, collect same-origin in-app links (nav / sidebar). Used when the
 * user did not list pages — typical for a first capture of a SaaS dashboard.
 */
export async function discoverAppPages(secret: DemoAccountSecret): Promise<string[]> {
  if (!isBrowserlessConfigured()) return [];
  const login = buildLoginSteps(secret);
  const code = `export default async ({ page, context }) => {
  const steps = context.steps || [];
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  for (const step of steps) {
    if (step.action === 'goto') {
      await page.goto(step.url, { waitUntil: step.waitUntil || 'load', timeout: 45000 });
    } else if (step.action === 'wait') {
      if (step.selector) {
        await page.waitForSelector(step.selector, {
          visible: step.visible !== false,
          timeout: Math.min(step.ms || 20000, 30000)
        });
      } else if (step.ms) {
        await new Promise((r) => setTimeout(r, Math.min(step.ms, 15000)));
      }
    } else if (step.action === 'click') {
      const parts = String(step.selector || '').split(',').map((s) => s.trim()).filter(Boolean);
      let clicked = false;
      let lastErr = null;
      for (const sel of parts) {
        try {
          await page.waitForSelector(sel, { visible: true, timeout: parts.length > 1 ? 5000 : 15000 });
          const handle = await page.$(sel);
          if (!handle) continue;
          await handle.click();
          clicked = true;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!clicked) throw lastErr || new Error('click selector not found: ' + step.selector);
    } else if (step.action === 'type') {
      await page.waitForSelector(step.selector, { visible: true, timeout: 15000 });
      if (step.clear) await page.click(step.selector, { clickCount: 3 });
      await page.type(step.selector, String(step.text || ''), { delay: 20 });
    }
  }
  const origin = new URL(context.loginUrl).origin;
  const current = page.url();
  const hrefs = await page.$$eval('a[href]', (els, origin) => {
    const out = [];
    for (const a of els) {
      try {
        const u = new URL(a.href, origin);
        if (u.origin !== origin) continue;
        const path = (u.pathname + u.hash).toLowerCase();
        if (/log-?out|sign-?out|sign-?up|register|forgot|reset|oauth|sso|auth\\/callback/.test(path)) continue;
        out.push(u.origin + u.pathname + (u.search || ''));
      } catch (_) { /* skip */ }
    }
    return out;
  }, origin);
  return { current, hrefs };
}`;

  try {
    const out = await browserlessFunction(code, { steps: login, loginUrl: secret.loginUrl }, { timeoutMs: 60_000 });
    let rec: { current?: string; hrefs?: unknown } | null = null;
    if (typeof out === 'string') {
      try {
        rec = JSON.parse(out) as { current?: string; hrefs?: unknown };
      } catch {
        rec = null;
      }
    } else if (out && typeof out === 'object') {
      rec = out as { current?: string; hrefs?: unknown };
    }
    const found: string[] = [];
    if (typeof rec?.current === 'string' && isUrlSafe(rec.current)) found.push(rec.current);
    for (const h of Array.isArray(rec?.hrefs) ? rec.hrefs : []) {
      if (typeof h !== 'string') continue;
      const url = resolvePageUrl(h, secret.loginUrl);
      if (url && sameAppHost(url, secret.loginUrl)) found.push(url);
    }
    return uniqueUrls(found);
  } catch {
    return [];
  }
}

export type HarvestShot = {
  url: string;
  ok: boolean;
  media_id?: string;
  image_url?: string;
  error?: string;
  page_url?: string | null;
  page_title?: string | null;
  body_preview?: string | null;
  failed_step?: CaptureWebsiteFailure['failed_step'];
  hints?: CaptureWebsiteFailure['hints'];
  diagnostic_image_url?: string;
  diagnostic_media_id?: string;
  retry_hint?: string;
};

export async function harvestProductUi(opts: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  brandId: string;
  userId: string;
  pages?: string[];
  discover?: boolean;
}): Promise<
  | { ok: true; captured: HarvestShot[]; pages: string[]; discovered: boolean }
  | { ok: false; error: string; captured: HarvestShot[]; pages: string[]; discovered: boolean }
> {
  if (!isBrowserlessConfigured()) {
    return {
      ok: false,
      error:
        'Website capture is not configured (BROWSERLESS_API_KEY missing). Ask the user to upload screenshots instead.',
      captured: [],
      pages: [],
      discovered: false
    };
  }

  const secret = await loadDemoAccountSecret(opts.admin, opts.brandId);
  if (!secret) {
    return { ok: false, error: 'no_demo_account', captured: [], pages: [], discovered: false };
  }

  let pages = (opts.pages?.length ? opts.pages : secret.pages)
    .map((p) => resolvePageUrl(p, secret.loginUrl))
    .filter((u): u is string => !!u);
  if (secret.instructions) {
    pages = uniqueUrls([...pages, ...pagesFromInstructions(secret.instructions, secret.loginUrl)]);
  }

  let discovered = false;
  if (!pages.length || opts.discover) {
    const found = await discoverAppPages(secret);
    discovered = found.length > 0;
    pages = uniqueUrls([...pages, ...found]);
  }
  if (!pages.length) pages = [secret.loginUrl];
  pages = pages.slice(0, MAX_DEMO_PAGES);

  const { captureWebsite } = await import('$lib/server/website-capture');
  const captured: HarvestShot[] = [];
  for (const url of pages) {
    let hostPath = url;
    try {
      const u = new URL(url);
      hostPath = `${u.hostname}${u.pathname}`.replace(/\/+$/, '') || u.hostname;
    } catch {
      /* keep url */
    }
    const result: CaptureWebsiteResult | CaptureWebsiteFailure = await captureWebsite({
      supabase: opts.supabase,
      brandId: opts.brandId,
      userId: opts.userId,
      url,
      useDemoAccount: true,
      demoSecret: secret,
      title: `Product UI · ${hostPath}`,
      fullPage: false,
      saveToLibrary: true
    });
    if (result.ok) {
      captured.push({
        url,
        ok: true,
        media_id: result.media_id,
        image_url: result.image_url,
        page_url: result.page_url,
        page_title: result.page_title
      });
    } else {
      captured.push({
        url,
        ok: false,
        error: redactSecret(result.error, secret.password),
        page_url: result.page_url,
        page_title: result.page_title,
        body_preview: result.body_preview,
        failed_step: result.failed_step,
        hints: result.hints,
        diagnostic_image_url: result.diagnostic_image_url,
        diagnostic_media_id: result.diagnostic_media_id,
        retry_hint: result.retry_hint
      });
    }
  }

  const okCount = captured.filter((c) => c.ok).length;
  const firstErr = captured.find((c) => !c.ok)?.error ?? null;
  await markHarvest(opts.supabase, opts.brandId, {
    count: okCount,
    error: okCount === 0 ? firstErr : null
  });

  if (okCount === 0) {
    return { ok: false, error: firstErr || 'capture_failed', captured, pages, discovered };
  }
  return { ok: true, captured, pages, discovered };
}

export async function tryLoadDemoSecret(brandId: string): Promise<DemoAccountSecret | null> {
  try {
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    return await loadDemoAccountSecret(createAdminClient(), brandId);
  } catch {
    return null;
  }
}
