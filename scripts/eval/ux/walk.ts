import type { Browser } from './browser';

const WAIT_URL_TIMEOUT_MS = 30_000;

export type WalkResult = {
  steps: string[];
  chatUrl: string | null;
};

const BRAND_NAME = 'Eval UX Brand';

async function clickText(browser: Browser, text: string): Promise<void> {
  await browser.run('find', 'text', text, 'click');
}

export async function walkOnboarding(
  browser: Browser,
  appUrl: string,
  creds: { email: string; password: string }
): Promise<WalkResult> {
  const steps: string[] = [];

  // Il profilo del browser sopravvive tra le run: una sessione aperta manda /login in redirect
  // e la walk parte nel posto sbagliato (LESSONS, *Il profilo del browser conserva sessioni*).
  await browser.run('cookies', 'clear');
  await browser.run('storage', 'local', 'clear');

  await browser.open(`${appUrl}/login`);
  await browser.run('fill', 'input[name="email"]', creds.email);
  await browser.run('fill', 'input[name="password"]', creds.password);
  await browser.run('click', 'button.cta');
  await browser.run('wait', '--url', '/app/onboarding', '--timeout', String(WAIT_URL_TIMEOUT_MS));
  steps.push('login → /app/onboarding');

  await clickText(browser, 'Non ho un sito web');
  await browser.run('fill', 'input[placeholder="Latina Coffee Co."]', BRAND_NAME);
  await clickText(browser, 'Continua');
  await throughIntroCarousel(browser);
  await browser.run('wait', '--text', 'Da chi parti', '--timeout', String(PICK_TIMEOUT_MS));
  steps.push('entry → pick');

  await browser.captureEvidence('01-pick');
  await clickText(browser, 'Inizia la chat');
  await browser.run('wait', '--url', '/chat', '--timeout', String(WAIT_URL_TIMEOUT_MS));
  steps.push('pick → setup chat');

  return { steps, chatUrl: null };
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
const INTRO_STEP_MS = 1_500;
const PICK_TIMEOUT_MS = 60_000;

async function throughIntroCarousel(browser: Browser): Promise<void> {
  for (let slide = 0; slide < INTRO_SLIDES_MAX; slide++) {
    const snapshot = await browser.snapshot();
    if (snapshot.includes('Da chi parti')) return;
    if (!snapshot.includes('Avanti')) {
      await sleep(INTRO_STEP_MS);
      continue;
    }
    await clickText(browser, 'Avanti');
    await sleep(INTRO_STEP_MS);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
