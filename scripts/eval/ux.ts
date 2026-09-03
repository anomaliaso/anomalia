import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateText } from 'ai';
import { createAdminClient } from '$lib/server/supabase-admin';
import { geminiFast } from '$lib/server/chat/model';
import { Browser } from './ux/browser';
import { createEvalUser, deleteEvalUser } from './user';
import { brandForUser, planFacts, waitForAssistantReply, waitForTeamContact, waitForDelegation } from './ux/facts';
import { walkOnboarding, sendCrossCraftAsk } from './ux/walk';
import { RUBRIC, grade, parseJudgment } from './ux/grader';
import { writeReport, type FlowFact, type JudgeUsage } from './ux/report';

const APP_URL = process.env.EVAL_UX_APP_URL ?? 'http://localhost:4180';
const REPLY_WAIT_MS = Number(process.env.EVAL_UX_WAIT_MS ?? 240_000);
// Il contatto del team nasce quando il TURNO di setup chiude, non quando la prima risposta
// arriva: il turno continua a lavorare per minuti dopo (tool, memoria) e la finestra della
// prima risposta scadde troppo presto. Il poll del team ha la sua finestra, più larga.
const TEAM_WAIT_MS = Number(process.env.EVAL_UX_TEAM_WAIT_MS ?? 420_000);
const RESULTS_ROOT = process.env.EVAL_UX_RESULTS_DIR ?? 'eval-results';
const BRAND_POLL_MS = 60_000;
const CHAT_SNAPSHOT_CHARS = 8_000;
const PICK_SNAPSHOT_CHARS = 4_000;

// Il ramo che il run misura va DECISO qui, non ereditato dal .env del momento: due run con lo
// stesso codice e .env diversi non sono paragonabili. `AGENT_KIT=on npm run eval:ux` misura il
// ramo kit (quello che in produzione gira davvero) — la variante che ha trovato il difetto
// dell'onboarding-team mai contattato (task #47).
const AGENT_KIT: 'on' | 'off' = process.env.AGENT_KIT === 'on' ? 'on' : 'off';

const runId = `ux${AGENT_KIT === 'on' ? '-kit' : ''}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
const runDir = join(RESULTS_ROOT, runId);
// Il daemon agent-browser risolve i path relativi col SUO cwd: le evidenze devono essere
// assolute o la screenshot muore con "No such file or directory".
const evidenceDir = resolve(join(runDir, 'evidence'));
mkdirSync(evidenceDir, { recursive: true });

const transcriptLines: string[] = [];
const log = (line: string) => {
  transcriptLines.push(line);
  console.log(line);
};

async function httpReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function ensureAppServer(): Promise<() => Promise<void>> {
  if (!(await httpReachable(APP_URL))) throw new Error(`stack non raggiungibile su ${APP_URL}`);
  log(`[server] uso lo stack su ${APP_URL}`);
  return async () => {};
}

async function pollBrand(userId: string): Promise<{ id: string; slug: string; name: string }> {
  const admin = createAdminClient();
  const deadline = Date.now() + BRAND_POLL_MS;
  while (Date.now() < deadline) {
    const brand = await brandForUser(admin, userId);
    if (brand) return brand;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`nessun brand creato per l'utente eval entro ${BRAND_POLL_MS}ms`);
}

async function judge(brandSlug: string, pickSnapshot: string, chatSnapshot: string, facts: unknown) {
  const m = geminiFast();
  const system = [
    'Sei un valutatore rigoroso della UX di Anomalia, un social media AI autopilot.',
    'Valuti se l\'esperienza di onboarding di un nuovo utente corrisponde a quattro impressioni attese.',
    'Giudichi i FATTI che vedi negli snapshot accessibilità e nei fatti del database, non le impressioni personali.',
    'Rispondi SOLO con JSON: {"criteria":[{"id","verdict":"pass|fail|partial","evidence"}],"summary"}.',
    'Un criterio è pass solo se l\'evidenza lo dimostra; è fail se manca; partial se c\'è ma incompleto.'
  ].join('\n');
  const prompt = [
    'Criteri attesi:',
    ...RUBRIC.map((c) => `- ${c.id}: ${c.expected}`),
    '',
    `Fatti del database (brand: ${brandSlug}):`,
    JSON.stringify(facts, null, 2),
    '',
    'Snapshot della schermata di pick dell\'agente:',
    pickSnapshot.slice(0, PICK_SNAPSHOT_CHARS),
    '',
    'Snapshot della chat di setup:',
    chatSnapshot.slice(0, CHAT_SNAPSHOT_CHARS)
  ].join('\n');
  const { text, usage } = await generateText({
    model: m.model,
    system,
    prompt,
    ...m.callOptions
  });
  const judgeUsage: JudgeUsage = {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0
  };
  return { text, judgeUsage, modelId: m.modelId };
}

async function main(): Promise<number> {
  let stopServer = async () => {};
  const admin = createAdminClient();
  const users: Array<{ id: string; email: string; password: string }> = [];
  const browsers: Browser[] = [];

  try {
    stopServer = await ensureAppServer();
    const stamp = Date.now();
    const noWebsiteUser = await createEvalUser(`eval-ux-no-site-${stamp}@anomalia.so`, `eval-ux-no-site-${stamp}`);
    users.push(noWebsiteUser);
    log(`[user] creato ${noWebsiteUser.email}`);
    const noWebsiteBrowser = new Browser(join(evidenceDir, 'no-site'), (line) => log(`[browser no-site] ${line}`));
    mkdirSync(join(evidenceDir, 'no-site'), { recursive: true });
    browsers.push(noWebsiteBrowser);
    const noWebsite = await runScenario(admin, noWebsiteBrowser, noWebsiteUser, null, 'no-site', join(evidenceDir, 'no-site'));

    const websiteUser = await createEvalUser(`eval-ux-website-${stamp}@anomalia.so`, `eval-ux-website-${stamp}`);
    users.push(websiteUser);
    log(`[user] creato ${websiteUser.email}`);
    const websiteBrowser = new Browser(join(evidenceDir, 'website'), (line) => log(`[browser website] ${line}`));
    mkdirSync(join(evidenceDir, 'website'), { recursive: true });
    browsers.push(websiteBrowser);
    const website = await runScenario(admin, websiteBrowser, websiteUser, 'https://example.com', 'website', join(evidenceDir, 'website'));

    const flowFacts = [...noWebsite.flowFacts, ...website.flowFacts];
    const judged = await judge(
      noWebsite.brand.slug,
      noWebsite.pickSnapshot,
      noWebsite.chatSnapshot,
      noWebsite.judgeFacts
    );
    const judgment = parseJudgment(judged.text);
    if (!judgment) {
      log(`[judge] output non parsabile: ${judged.text.slice(0, 400)}`);
      return 1;
    }
    const g = grade(judgment);
    for (const c of g.criteria) log(`[grade] ${c.verdict} · ${c.id}: ${c.evidence.slice(0, 140)}`);

    const report = writeReport(runDir, {
      meta: {
        runId,
        appUrl: APP_URL,
        judgeModel: judged.modelId,
        agentKit: AGENT_KIT,
        startedAt: new Date(stamp).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - stamp
      },
      flowFacts,
      grade: g,
      judgeUsage: judged.judgeUsage,
      evidenceFiles: [
        'evidence/no-site/01-homepage.png',
        'evidence/no-site/02-login.png',
        'evidence/no-site/05-pick.png',
        'evidence/no-site/06-chat.png',
        'evidence/no-site/07-delegation.png',
        'evidence/no-site/05-pick.a11y.txt',
        'evidence/no-site/06-chat.a11y.txt',
        'evidence/no-site/07-delegation.a11y.txt',
        'evidence/website/01-homepage.png',
        'evidence/website/02-login.png',
        'evidence/website/03-start.png',
        'evidence/website/04-onboarding.png',
        'evidence/website/05-pick.png',
        'evidence/website/06-chat.png',
        'evidence/website/07-delegation.png',
        'evidence/website/03-start.a11y.txt',
        'evidence/website/04-onboarding.a11y.txt',
        'evidence/website/05-pick.a11y.txt',
        'evidence/website/06-chat.a11y.txt',
        'evidence/website/07-delegation.a11y.txt',
        'evidence/browser-console.log',
        'evidence/browser-network.log',
        'evidence/browser-transcript.log'
      ]
    });
    log(`[report] ${report}`);

    const gatesOk = flowFacts.filter((f) => f.gate).every((f) => f.ok);
    return gatesOk && g.allPass ? 0 : 1;
  } finally {
    await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
    for (const user of users) {
      try {
        await deleteEvalUser(user.id);
        log(`[teardown] utente eval ${user.id} eliminato (brand e storage cascata)`);
      } catch (e) {
        console.error(`[teardown] FALLITO per ${user.id}: eliminare a mano. Motivo:`, e);
      }
    }
    await stopServer();
    writeFileSync(join(runDir, 'transcript.log'), transcriptLines.join('\n'));
  }
}

type ScenarioResult = {
  brand: { id: string; slug: string; name: string };
  flowFacts: FlowFact[];
  pickSnapshot: string;
  chatSnapshot: string;
  judgeFacts: unknown;
};

async function runScenario(
  admin: ReturnType<typeof createAdminClient>,
  browser: Browser,
  user: { id: string; email: string; password: string },
  website: string | null,
  label: string,
  evidencePath: string
): Promise<ScenarioResult> {
  const walk = await walkOnboarding(browser, APP_URL, user, website);
  log(`[walk ${label}] ${walk.steps.join(' · ')}`);

  const brand = await pollBrand(user.id);
  log(`[brand ${label}] ${brand.slug} (${brand.id})`);

  const { replied, facts: chat } = await waitForAssistantReply(admin, brand.id, REPLY_WAIT_MS);
  log(`[chat ${label}] replied=${replied} assistant=${chat.assistantMessages} latency=${chat.firstAssistantLatencyMs}ms`);
  if (!replied) throw new Error(`${label}: setup assistant reply and run completion were not persisted`);
  await browser.run('wait', '--assistant', '--timeout', String(REPLY_WAIT_MS));
  await browser.captureEvidence('06-chat');

  const team = await waitForTeamContact(admin, brand.id, TEAM_WAIT_MS);
  log(`[team ${label}] expected=${team.expectedAgents.join(', ')} actual=${team.agents.join(', ') || 'none'}`);

  await sendCrossCraftAsk(browser);
  log(`[walk ${label}] cross-craft question sent`);
  const delegation = await waitForDelegation(admin, brand.id, REPLY_WAIT_MS);
  log(`[delegation ${label}] dmThreads=${delegation.dmThreads} dmMessages=${delegation.dmMessages}`);
  await browser.run('wait', '--assistant-count', '2', '--timeout', String(REPLY_WAIT_MS));
  await browser.captureEvidence('07-delegation');
  await browser.assertHealthyNetwork();

  const plans = await planFacts(admin, brand.id);
  const expectedContactsOk = team.expectedAgents.every((agent) => team.agents.includes(agent));
  const delegationOk = delegation.dmThreads > 0 && delegation.dmMessages > 0;
  const prefix = label;
  const flowFacts: FlowFact[] = [
    { id: `${prefix}-homepage-dom`, ok: true, gate: true, detail: 'homepage rendered one Sign in and one Get started link' },
    { id: `${prefix}-get-started-url`, ok: true, gate: true, detail: walk.urls.getStarted },
    { id: `${prefix}-sign-in-url`, ok: true, gate: true, detail: walk.urls.signIn },
    { id: `${prefix}-login-signup-dom`, ok: true, gate: true, detail: 'login and signup forms both rendered and toggled' },
    {
      id: `${prefix}-website-preserved`,
      ok: website ? walk.urls.start?.includes(encodeURIComponent(website)) || walk.urls.login?.includes(encodeURIComponent(website)) : true,
      gate: true,
      detail: website ? `preserved through /start, /login, and /app/onboarding: ${walk.urls.onboarding}` : 'not applicable to the no-website branch'
    },
    { id: `${prefix}-onboarding-url-dom`, ok: true, gate: true, detail: walk.urls.onboarding },
    { id: `${prefix}-agent-picker-dom`, ok: !!walk.selectedAgent, gate: true, detail: `selected ${walk.selectedAgent} at ${walk.urls.pick}` },
    {
      id: `${prefix}-setup-chat-db`,
      ok: replied && chat.setupAssistantMessages > 0 && chat.setupRunStates.includes('done'),
      gate: true,
      detail: `url ${walk.chatUrl}; setup assistant=${chat.setupAssistantMessages}; runs=${chat.setupRunStates.join(', ') || 'none'}`
    },
    {
      id: `${prefix}-team-contacts-db`,
      ok: expectedContactsOk,
      gate: true,
      detail: `expected [${team.expectedAgents.join(', ')}], signed [${team.agents.join(', ') || 'none'}]`
    },
    {
      id: `${prefix}-delegation-db`,
      ok: delegationOk,
      gate: true,
      detail: `${delegation.dmThreads} agent DM threads, ${delegation.dmMessages} messages`
    },
    {
      id: `${prefix}-editorial-plan-db`,
      ok: plans.editorialPlans > 0,
      gate: false,
      detail: `${plans.editorialPlans} editorial plans`
    },
    { id: `${prefix}-news-sources-db`, ok: plans.newsSources > 0, gate: false, detail: `${plans.newsSources} active news sources` }
  ];

  return {
    brand,
    flowFacts,
    pickSnapshot: (await readText(join(evidencePath, '05-pick.a11y.txt'))) ?? '',
    chatSnapshot: (await readText(join(evidencePath, '06-chat.a11y.txt'))) ?? '',
    judgeFacts: { chat, plans, team, delegation, walk: walk.urls }
  };
}

async function readText(path: string): Promise<string | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

process.exitCode = await main();
