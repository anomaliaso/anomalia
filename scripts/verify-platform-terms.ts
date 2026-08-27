/**
 * Integration check for the third-party platform rule:
 *
 *   1. the guardrail reaches the prompt the model actually receives (not just the unit test)
 *   2. saving a social-platform login is refused before anything is written
 *
 *   npx vite-node --config scripts/vite-node.config.ts scripts/verify-platform-terms.ts
 *
 * Read-only: the save it attempts is the one that must fail.
 */
import { createAdminClient } from '../src/lib/server/supabase-admin';
import { buildSystemPrompt } from '../src/lib/server/chat/system-prompt';
import { saveDemoAccount } from '../src/lib/server/demo-account';

const admin = createAdminClient();

const { data: brand } = await admin
  .from('brands')
  .select('id, org_id, slug, name, timezone, website, content_prefs')
  .limit(1)
  .maybeSingle();
if (!brand) throw new Error('no brand to build a prompt for');

const prompt = await buildSystemPrompt(admin, brand, 'en');
const checks: Array<[string, boolean]> = [
  ['## THIRD-PARTY PLATFORM TERMS present', prompt.includes('## THIRD-PARTY PLATFORM TERMS')],
  ['forbids browser sign-in', /never drive a browser to sign in/i.test(prompt)],
  ['forbids browser publishing', /No posting, commenting, replying/i.test(prompt)],
  ['names platforms', prompt.includes('Instagram')],
  ['keeps public capture allowed', /DO NOT OVER-REFUSE/.test(prompt)],
  ['AI Act block still there', prompt.includes('## EU AI ACT')]
];

// The save must be refused, and refused before any write.
const before = await admin.from('brand_demo_accounts').select('brand_id').eq('brand_id', brand.id).maybeSingle();
const attempt = await saveDemoAccount(admin, admin, brand.id, {
  loginUrl: 'https://www.instagram.com/accounts/login/',
  username: 'someone@example.com',
  password: 'irrelevant',
  pages: []
});
const after = await admin.from('brand_demo_accounts').select('brand_id, login_url').eq('brand_id', brand.id).maybeSingle();

checks.push([
  'instagram login refused',
  !attempt.ok && attempt.error.startsWith('platform_login_not_allowed')
]);
checks.push([
  'nothing written on refusal',
  (before.data === null && after.data === null) ||
    (after.data?.login_url ? !after.data.login_url.includes('instagram.com') : true)
]);

for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
console.log(`\nerror returned: ${attempt.ok ? '(none — WRONG)' : attempt.error}`);
console.log(`prompt length: ${prompt.length} chars`);

if (checks.some(([, ok]) => !ok)) process.exit(1);
