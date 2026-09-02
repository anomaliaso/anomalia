import type { Browser } from './browser';

const WAIT_URL_TIMEOUT_MS = 30_000;
const PICK_TIMEOUT_MS = 120_000;
// /start now reads the site and renders one post before login: site analysis plus a caption pass
// plus an image, inline in one request. That is minutes, not seconds.
const GUEST_POST_TIMEOUT_MS = 300_000;

export type WalkResult = {
  steps: string[];
  chatUrl: string;
  urls: Record<string, string>;
  website: string | null;
  selectedAgent: string;
  /** A post was rendered and shown BEFORE any account existed. False on the no-website branch. */
  guestPostShown: boolean;
};

const BRAND_NAME = 'Eval UX Brand';

function assertWebsite(url: string, expected: string): void {
  const actual = new URL(url).searchParams.get('website');
  if (actual !== expected) throw new Error(`website was not preserved: expected ${expected}, got ${actual ?? 'none'}`);
}

export async function walkOnboarding(
  browser: Browser,
  appUrl: string,
  creds: { email: string; password: string },
  website: string | null = null
): Promise<WalkResult> {
  const steps: string[] = [];
  const urls: Record<string, string> = {};
  let guestPostShown = false;

  await browser.open(`${appUrl}/`);
  if (Number(await browser.run('count', 'header.nav a.nav-login')) !== 1) {
    throw new Error('homepage has no single Sign in link');
  }
  if (Number(await browser.run('count', 'header.nav a.nav-cta[href="/app"]')) !== 1) {
    throw new Error('homepage has no single Get started link');
  }
  await browser.captureEvidence('01-homepage');

  await browser.run('click', 'header.nav a.nav-cta[href="/app"]');
  await browser.run('wait', '--url', '/login', '--timeout', String(WAIT_URL_TIMEOUT_MS));
  urls.getStarted = (await browser.run('get', 'url')).trim();
  steps.push('homepage → Get started → login');

  await browser.open(`${appUrl}/`);
  await browser.run('click', 'header.nav a.nav-login');
  await browser.run('wait', '--url', '/login', '--timeout', String(WAIT_URL_TIMEOUT_MS));
  urls.signIn = (await browser.run('get', 'url')).trim();
  await browser.run('click', 'p.toggle button.textlink');
  await browser.run('wait', '--selector', 'form[action="?/signup"]', '--timeout', String(WAIT_URL_TIMEOUT_MS));
  await browser.run('click', 'p.toggle button.textlink');
  await browser.run('wait', '--selector', 'form[action="?/login"]', '--timeout', String(WAIT_URL_TIMEOUT_MS));
  await browser.captureEvidence('02-login');
  steps.push('Sign in → signup/signin');

  if (website) {
    await browser.open(`${appUrl}/`);
    await browser.run('fill', 'form.hero-url-cta input[name="website"]', website);
    await browser.run('click', 'form.hero-url-cta button.hero-url-go');
    await browser.run('wait', '--url', '/start', '--timeout', String(WAIT_URL_TIMEOUT_MS));
    urls.start = (await browser.run('get', 'url')).trim();
    assertWebsite(urls.start, website);
    // The guest post is the whole point of this step: wait for the card, not for a form.
    await browser.run('wait', '--selector', '.post-card img.post-img', '--timeout', String(GUEST_POST_TIMEOUT_MS));
    guestPostShown = true;
    await browser.captureEvidence('03-start');
    await browser.run('click', '.cta-row-setup button.primary');
    await browser.run('wait', '--url', '/login', '--timeout', String(WAIT_URL_TIMEOUT_MS));
    urls.login = (await browser.run('get', 'url')).trim();
    assertWebsite(urls.login, website);
    await browser.run('click', 'p.toggle button.textlink');
    await browser.run('wait', '--selector', 'form[action="?/signup"]', '--timeout', String(WAIT_URL_TIMEOUT_MS));
    await browser.run('click', 'p.toggle button.textlink');
    await browser.run('wait', '--selector', 'form[action="?/login"]', '--timeout', String(WAIT_URL_TIMEOUT_MS));
  } else {
    await browser.open(`${appUrl}/login`);
    await browser.run('cookies', 'clear');
    await browser.run('storage', 'local', 'clear');
    await browser.open(`${appUrl}/login`);
    urls.login = (await browser.run('get', 'url')).trim();
  }

  await browser.run('fill', 'input[name="email"]', creds.email);
  await browser.run('fill', 'input[name="password"]', creds.password);
  await browser.run('click', 'button.cta');
  await browser.run('wait', '--url', '/app/onboarding', '--timeout', String(WAIT_URL_TIMEOUT_MS));
  urls.onboarding = (await browser.run('get', 'url')).trim();
  if (website) assertWebsite(urls.onboarding, website);
  await browser.captureEvidence('04-onboarding');
  steps.push(website ? 'website URL → guest start → preserved login → onboarding' : 'login → /app/onboarding');

  if (!website) {
    await browser.run('click', '.entry-manual .nosite-btn');
    await browser.run('fill', '.entry-manual input[placeholder="Latina Coffee Co."]', BRAND_NAME);
    await browser.run('click', '.entry-manual button.primary');
  }
  await throughIntroCarousel(browser);
  urls.pick = (await browser.run('get', 'url')).trim();
  await browser.captureEvidence('05-pick');
  steps.push('entry → pick');

  await browser.run('click', '.intro-foot button.wide-btn');
  await browser.run('wait', '--url', '/chat', '--timeout', String(WAIT_URL_TIMEOUT_MS));
  const chatUrl = (await browser.run('get', 'url')).trim();
  const slug = chatUrl.match(/\/app\/([^/]+)\/chat\//)?.[1];
  if (!slug) throw new Error(`setup chat URL is malformed: ${chatUrl}`);
  const selectedAgent = (await browser.run('storage', 'local', 'get', `anomalia:first-agent:${slug}`)).trim();
  if (!selectedAgent) throw new Error(`agent picker did not persist a selection for ${slug}`);
  urls.chat = chatUrl;
  await browser.captureEvidence('06-chat');
  steps.push('pick → setup chat');

  return { steps, chatUrl, urls, website, selectedAgent, guestPostShown };
}

/**
 * La domanda cross-craft della prova di delega: due mestieri diversi in una frase, nessuna
 * istruzione esplicita di delegare. Il fatto misurato dopo è se i DM agente-agente nascono.
 */
const CROSS_CRAFT_ASK =
  'Do the SEO audit of my site and give me two post ideas for the launch, in your language.';

export async function sendCrossCraftAsk(browser: Browser): Promise<void> {
  await browser.run('fill', 'textarea.ch-input', CROSS_CRAFT_ASK);
  await browser.run('click', 'button.ch-send');
}

const INTRO_SLIDES_MAX = 6;
const INTRO_STEP_MS = 400;

async function throughIntroCarousel(browser: Browser): Promise<void> {
  const deadline = Date.now() + PICK_TIMEOUT_MS;
  for (let slide = 0; slide < INTRO_SLIDES_MAX; slide++) {
    const snapshot = await browser.snapshot();
    if (snapshot.includes('Meet your first agent') || snapshot.includes('Da chi parti')) return;
    if (Date.now() >= deadline) throw new Error('onboarding did not reach the agent picker');
    if (!snapshot.includes('Next') && !snapshot.includes('Avanti')) {
      await sleep(INTRO_STEP_MS);
      continue;
    }
    await browser.run('click', '.intro-foot button.wide-btn');
    await sleep(INTRO_STEP_MS);
  }
  throw new Error('onboarding intro carousel exceeded its slide limit');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
