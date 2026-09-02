import { describe, expect, it } from 'vitest';
import {
  applyDemoLogin,
  buildLoginSteps,
  DEFAULT_EMAIL_SELECTOR,
  DEFAULT_PASSWORD_SELECTOR,
  DEFAULT_SUBMIT_SELECTOR,
  formatDemoAccountPrompt,
  MAX_DEMO_INSTRUCTIONS,
  normalizeInstructions,
  pagesFromInstructions,
  parsePagesText,
  redactSecret,
  resolvePageUrl,
  sameAppHost,
  stripUrlNoise,
  isStillOnLoginPage,
  type DemoAccountSecret
} from '$lib/server/demo-account';

const secret = (over: Partial<DemoAccountSecret> = {}): DemoAccountSecret => ({
  loginUrl: 'https://app.example.com/login',
  username: 'demo@example.com',
  password: 's3cret-pass',
  pages: ['https://app.example.com/dashboard'],
  instructions: null,
  emailSelector: null,
  passwordSelector: null,
  submitSelector: null,
  successSelector: null,
  hasPassword: true,
  lastHarvestedAt: null,
  lastHarvestCount: null,
  lastError: null,
  ...over
});

describe('demo account URL helpers', () => {
  it('resolves app-relative paths against the login origin', () => {
    expect(resolvePageUrl('/dashboard', 'https://app.example.com/login')).toBe(
      'https://app.example.com/dashboard'
    );
    expect(resolvePageUrl('https://app.example.com/settings', 'https://app.example.com/login')).toBe(
      'https://app.example.com/settings'
    );
  });

  it('rejects unsafe URLs', () => {
    expect(resolvePageUrl('file:///etc/passwd', 'https://app.example.com/login')).toBeNull();
    expect(resolvePageUrl('javascript:alert(1)', 'https://app.example.com/login')).toBeNull();
    expect(resolvePageUrl('http://127.0.0.1/admin', 'https://app.example.com/login')).toBeNull();
    expect(resolvePageUrl('/ok', 'https://app.example.com/login')).toBeTruthy();
  });

  it('parses a pages textarea, dedupes, and caps at 8', () => {
    const text = [
      '/dashboard',
      '/settings',
      'https://app.example.com/dashboard',
      '',
      '/projects',
      '/a',
      '/b',
      '/c',
      '/d',
      '/e',
      '/f'
    ].join('\n');
    const pages = parsePagesText(text, 'https://app.example.com/login');
    expect(pages[0]).toContain('/dashboard');
    expect(pages.filter((p) => p.includes('/dashboard'))).toHaveLength(1);
    expect(pages.length).toBe(8);
  });

  it('treats www and bare host as the same app', () => {
    expect(sameAppHost('https://www.example.com/a', 'https://example.com/login')).toBe(true);
    expect(sameAppHost('https://app.example.com/a', 'https://example.com/login')).toBe(false);
  });

  it('strips trailing slashes for identity', () => {
    expect(stripUrlNoise('https://app.example.com/dashboard/')).toBe(
      stripUrlNoise('https://app.example.com/dashboard')
    );
  });
});

describe('demo login steps', () => {
  it('types the stored username and password into default selectors', () => {
    const steps = buildLoginSteps(secret());
    const types = steps.filter((s) => s.action === 'type');
    expect(types).toHaveLength(2);
    expect(types[0]).toMatchObject({ text: 'demo@example.com', selector: DEFAULT_EMAIL_SELECTOR });
    expect(types[1]).toMatchObject({ text: 's3cret-pass', selector: DEFAULT_PASSWORD_SELECTOR });
    expect(DEFAULT_SUBMIT_SELECTOR).toMatch(/:has\(input\[type="password"\]\)/);
    // Unscoped `button[type="submit"]` would click OAuth buttons that appear first in the DOM.
    expect(DEFAULT_SUBMIT_SELECTOR).not.toMatch(/(^|,)\s*button\[type="submit"\]/);
    const withSuccess = buildLoginSteps(secret({ successSelector: '[data-sidebar]' }));
    const successWait = withSuccess.find((s) => s.action === 'wait' && 'selector' in s && s.selector === '[data-sidebar]');
    expect(successWait).toMatchObject({ visible: false });
  });

  it('injects login when the target is on the app host', () => {
    const out = applyDemoLogin({ url: 'https://app.example.com/billing' }, secret());
    expect(out.url).toBeUndefined();
    expect(out.steps?.some((s) => s.action === 'type' && s.text === 's3cret-pass')).toBe(true);
    const gotos = out.steps?.filter((s) => s.action === 'goto') ?? [];
    expect(gotos.map((g) => g.url)).toEqual([
      'https://app.example.com/login',
      'https://app.example.com/billing'
    ]);
    expect(out.steps?.at(-1)?.action).toBe('screenshot');
  });

  it('does not inject login for a different marketing-site host', () => {
    const out = applyDemoLogin({ url: 'https://example.com/pricing' }, secret());
    expect(out.steps).toBeUndefined();
    expect(out.url).toBe('https://example.com/pricing');
  });

  it('does not override an agent-supplied type workflow unless forced', () => {
    const custom = applyDemoLogin(
      {
        steps: [
          { action: 'goto', url: 'https://app.example.com/login' },
          { action: 'type', selector: '#email', text: 'other' }
        ]
      },
      secret()
    );
    expect(custom.steps?.[1]).toMatchObject({ action: 'type', text: 'other' });

    const forced = applyDemoLogin(
      {
        useDemoAccount: true,
        steps: [
          { action: 'goto', url: 'https://app.example.com/login' },
          { action: 'type', selector: '#email', text: 'other' }
        ],
        url: 'https://app.example.com/home'
      },
      secret()
    );
    expect(forced.steps?.some((s) => s.action === 'type' && s.text === 's3cret-pass')).toBe(true);
    expect(forced.steps?.some((s) => s.action === 'type' && s.text === 'other')).toBe(false);
  });

  it('never injects when useDemoAccount is false', () => {
    const out = applyDemoLogin(
      { url: 'https://app.example.com/dashboard', useDemoAccount: false },
      secret()
    );
    expect(out.steps).toBeUndefined();
    expect(out.url).toBe('https://app.example.com/dashboard');
  });

  it('redacts the password from error strings', () => {
    expect(redactSecret('typed s3cret-pass into #pw', 's3cret-pass')).toBe('typed •••• into #pw');
  });
});

describe('demo account custom instructions', () => {
  it('trims, caps length, and redacts a pasted password', () => {
    expect(normalizeInstructions('  hello  ')).toBe('hello');
    expect(normalizeInstructions('')).toBeNull();
    expect(normalizeInstructions(`pw is s3cret-pass`, 's3cret-pass')).toBe('pw is ••••');
    const long = 'x'.repeat(MAX_DEMO_INSTRUCTIONS + 50);
    expect(normalizeInstructions(long)?.length).toBe(MAX_DEMO_INSTRUCTIONS);
  });

  it('extracts app paths and URLs, ignoring fractions like /30', () => {
    const text = `Start on /dashboard (hero). Then https://app.example.com/billing.\nGEO is 0/30. Also /settings/team.`;
    const pages = pagesFromInstructions(text, 'https://app.example.com/login');
    expect(pages).toEqual([
      'https://app.example.com/billing',
      'https://app.example.com/dashboard',
      'https://app.example.com/settings/team'
    ]);
  });

  it('injects user notes into the chat prompt and wraps them as data', () => {
    const withNotes = formatDemoAccountPrompt({
      loginUrl: 'https://app.example.com/login',
      username: 'demo@example.com',
      pages: ['https://app.example.com/dashboard'],
      instructions: 'Push the weekly chart on /dashboard. Skip /admin.'
    });
    expect(withNotes).toContain('## PRODUCT DEMO ACCOUNT');
    expect(withNotes).toContain('-----');
    expect(withNotes).toContain('Push the weekly chart on /dashboard. Skip /admin.');
    expect(withNotes).toContain('prefer the pages they name');
    expect(withNotes).toContain('retry in this turn');
    expect(withNotes).toContain('update_demo_account');
    expect(withNotes).toContain('click_text');

    const empty = formatDemoAccountPrompt({
      loginUrl: 'https://app.example.com/login',
      username: 'demo@example.com',
      pages: []
    });
    expect(empty).toContain('No extra product-usage notes yet');
    expect(empty).toContain('diagnostic_image_url');
  });
});

describe('demo account agent tools', () => {
  /**
   * La proprietà è che CHI cattura la UI del prodotto ci arrivi, non che i tre nomi stiano in una
   * lista precisa. Fino al 22/8/2026 stavano in SHARED_TOOL_KEYS, cioè li pagavano a ogni step
   * anche i mestieri che non fanno screenshot; adesso sono di chi compone visuali (`content`,
   * `motion`) e del `web`, che cattura una pagina per un articolo. Asserire sul risultato di
   * `pickTools` copre il requisito vero e non si rompe la prossima volta che cambia la strada.
   */
  it('è in mano ai mestieri che catturano la UI del prodotto', async () => {
    const { pickTools } = await import('$lib/server/chat/agents');
    const { createChatTools } = await import('$lib/agent/tools/index');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = createChatTools({} as any, 'b1', 'Europe/Rome', 'u1');
    for (const agent of ['content', 'motion'] as const) {
      const keys = Object.keys(pickTools(all, agent));
      for (const k of ['update_demo_account', 'harvest_product_ui', 'capture_website']) {
        expect(keys, `${agent}: ${k}`).toContain(k);
      }
    }
  });
});

describe('login landing detection', () => {
  const LOGIN = 'https://www.anomalia.so/login';

  it('flags a capture that never left the sign-in page', () => {
    expect(isStillOnLoginPage(LOGIN, LOGIN)).toBe(true);
    expect(isStillOnLoginPage('https://www.anomalia.so/login?next=/app', LOGIN)).toBe(true);
    expect(isStillOnLoginPage('https://www.anomalia.so/login/', LOGIN)).toBe(true);
  });

  it('flags sign-in / sign-up routes that differ from the saved login URL', () => {
    expect(isStillOnLoginPage('https://app.other.com/sign-in', LOGIN)).toBe(true);
    expect(isStillOnLoginPage('https://app.other.com/auth/signin', LOGIN)).toBe(true);
    expect(isStillOnLoginPage('https://app.other.com/signup', LOGIN)).toBe(true);
  });

  it('passes a real authenticated app page', () => {
    expect(isStillOnLoginPage('https://www.anomalia.so/app/anomalia', LOGIN)).toBe(false);
    expect(isStillOnLoginPage('https://www.anomalia.so/app/anomalia/calendar', LOGIN)).toBe(false);
    // "login" as a substring of a longer segment is not a login route.
    expect(isStillOnLoginPage('https://www.anomalia.so/app/logins-report', LOGIN)).toBe(false);
    expect(isStillOnLoginPage(null, LOGIN)).toBe(false);
  });
});

describe('third-party platform logins are refused, not just discouraged', () => {
  it('never injects a stored login on a platform we must not automate', () => {
    // A row saved before the rule existed must stop working, not keep working quietly.
    const social = secret({ loginUrl: 'https://www.instagram.com/accounts/login' });
    const out = applyDemoLogin({ url: 'https://www.instagram.com/direct/inbox' }, social);
    expect(out.steps).toBeUndefined();
    expect(out.url).toBe('https://www.instagram.com/direct/inbox');
  });

  it('still injects for the brand’s own product', () => {
    const out = applyDemoLogin({ url: 'https://app.example.com/dashboard' }, secret());
    expect(out.steps?.some((s) => s.action === 'type')).toBe(true);
  });

  // captureWebsite turns this into an explicit platform_login_not_allowed failure rather than
  // capturing the public page and calling it a success — see website-capture.test.ts.
  it('does not let useDemoAccount:true force a platform login', () => {
    const social = secret({ loginUrl: 'https://www.linkedin.com/login' });
    const out = applyDemoLogin(
      { url: 'https://www.linkedin.com/feed', useDemoAccount: true },
      social
    );
    expect(out.steps).toBeUndefined();
  });
});
