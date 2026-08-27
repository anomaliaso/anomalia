/**
 * End-to-end check for the Product demo account capture, against the saved
 * production login. Two cases:
 *
 *   A. happy path  — capture an authenticated app page, assert we left /login
 *   B. broken login — same page with a deliberately wrong submit selector,
 *                     assert the guard downgrades it to an agentic failure
 *                     instead of filing a sign-in screenshot as product UI
 *
 *   npx vite-node --config scripts/vite-node.config.ts scripts/verify-demo-capture.ts
 *
 * Media rows created here are deleted again at the end — this is a check, not a harvest.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAdminClient } from '../src/lib/server/supabase-admin';
import { isBrowserlessConfigured } from '../src/lib/server/browserless';
import { loadDemoAccountSecret } from '../src/lib/server/demo-account';
import { captureWebsite } from '../src/lib/server/website-capture';

const OUT = process.env.VERIFY_OUT ?? '/tmp/demo-capture-verify';

if (!isBrowserlessConfigured()) throw new Error('BROWSERLESS_API_KEY is not set');

const admin = createAdminClient();
mkdirSync(OUT, { recursive: true });

const { data: rows } = await admin
  .from('brand_demo_accounts')
  .select('brand_id, login_url, pages')
  .limit(1);
const row = rows?.[0];
if (!row) throw new Error('no brand_demo_accounts row to verify against');

const secret = await loadDemoAccountSecret(admin, row.brand_id);
if (!secret) throw new Error('demo account row exists but the Vault password is missing');

const pages = Array.isArray(row.pages) ? (row.pages as string[]) : [];
const target = pages[0] ?? new URL('/', row.login_url).toString();
const { data: owner } = await admin
  .from('brands')
  .select('org_id, organizations(owner_id)')
  .eq('id', row.brand_id)
  .maybeSingle();
const userId = (owner?.organizations as { owner_id?: string } | null)?.owner_id;
if (!userId) throw new Error('could not resolve the brand owner');

const created: string[] = [];
const save = async (url: string | undefined, file: string) => {
  if (!url) return false;
  const res = await fetch(url);
  if (!res.ok) return false;
  writeFileSync(join(OUT, file), Buffer.from(await res.arrayBuffer()));
  return true;
};

// ── A. happy path ────────────────────────────────────────────────────────────
console.log(`[verify] A: capturing ${target} with the saved demo login…`);
const good = await captureWebsite({
  supabase: admin,
  brandId: row.brand_id,
  userId,
  url: target,
  useDemoAccount: true,
  demoSecret: secret,
  title: 'Demo capture verification (temporary)',
  catalog: false
});

if (good.ok && good.media_id) created.push(good.media_id);
if (!good.ok && good.diagnostic_media_id) created.push(good.diagnostic_media_id);
await save(good.ok ? good.image_url : good.diagnostic_image_url, 'A-authenticated.png');

const landedOnApp = good.ok && !/\/(log-?in|sign-?in)(\/|$|\?)/.test(good.page_url ?? '');

// ── B. broken login must not pass as success ─────────────────────────────────
console.log('[verify] B: same page with a deliberately wrong submit selector…');
const broken = await captureWebsite({
  supabase: admin,
  brandId: row.brand_id,
  userId,
  url: target,
  useDemoAccount: true,
  demoSecret: { ...secret, submitSelector: '#definitely-not-the-submit-button' },
  title: 'Demo capture verification (temporary)',
  catalog: false
});

if (!broken.ok && broken.diagnostic_media_id) created.push(broken.diagnostic_media_id);
if (broken.ok && broken.media_id) created.push(broken.media_id);
await save(broken.ok ? broken.image_url : broken.diagnostic_image_url, 'B-broken-login.png');

const report = {
  brand_id: row.brand_id,
  target,
  A_happy_path: good.ok
    ? {
        ok: true,
        page_url: good.page_url,
        page_title: good.page_title,
        size: `${good.width}x${good.height}`,
        left_the_login_page: landedOnApp
      }
    : { ok: false, error: good.error, page_url: good.page_url, failed_step: good.failed_step },
  B_broken_login: broken.ok
    ? { ok: true, page_url: broken.page_url, LEAK: 'a failed login was filed as a successful capture' }
    : {
        ok: false,
        error: broken.error,
        page_url: broken.page_url,
        failed_step: broken.failed_step,
        button_hints: (broken.hints?.buttons ?? []).map((b) => b.text).filter(Boolean).slice(0, 8),
        has_diagnostic_image: !!broken.diagnostic_image_url,
        has_retry_hint: !!broken.retry_hint
      }
};

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

// Leave production as we found it.
for (const id of created) {
  await admin.from('brand_media').delete().eq('id', id).eq('brand_id', row.brand_id);
}
console.log(`[verify] cleaned up ${created.length} temporary media rows`);

const passed = landedOnApp && !broken.ok;
console.log(passed ? '[verify] PASS' : '[verify] FAIL');
if (!passed) process.exit(1);
