import { spawn } from 'node:child_process';
import { openSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateText } from 'ai';
import { createAdminClient } from '$lib/server/supabase-admin';
import { geminiFast } from '$lib/server/chat/model';
import { Browser } from './ux/browser';
import { createEvalUser, deleteEvalUser } from './ux/user';
import { brandForUser, planFacts, waitForAssistantReply } from './ux/facts';
import { walkOnboarding } from './ux/walk';
import { RUBRIC, grade, parseJudgment } from './ux/grader';
import { writeReport, type FlowFact, type JudgeUsage } from './ux/report';

const APP_URL = process.env.EVAL_UX_APP_URL ?? 'http://localhost:4180';
const VITE_PORT = Number(APP_URL.split(':').pop() ?? 4180);
const REPLY_WAIT_MS = Number(process.env.EVAL_UX_WAIT_MS ?? 240_000);
const RESULTS_ROOT = process.env.EVAL_UX_RESULTS_DIR ?? 'eval-results';
const BRAND_POLL_MS = 60_000;
const HEALTH_TIMEOUT_MS = 90_000;
const CHAT_SNAPSHOT_CHARS = 8_000;
const PICK_SNAPSHOT_CHARS = 4_000;

const runId = `ux-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
const runDir = join(RESULTS_ROOT, runId);
const evidenceDir = join(runDir, 'evidence');
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

function startViteServer(): Promise<() => Promise<void>> {
  return new Promise((resolve, reject) => {
    const logFd = openSync(join(runDir, 'server.log'), 'a');
    const child = spawn('npx', ['vite', 'dev', '--port', String(VITE_PORT), '--strictPort'], {
      env: { ...process.env, NO_HMR: '1' },
      detached: true,
      stdio: ['ignore', logFd, logFd]
    });
    const startedAt = Date.now();
    const poll = setInterval(async () => {
      if (await httpReachable(APP_URL)) {
        clearInterval(poll);
        resolve(async () => {
          try {
            process.kill(-child.pid!, 'SIGTERM');
          } catch {}
        });
      } else if (Date.now() - startedAt > HEALTH_TIMEOUT_MS || child.exitCode !== null) {
        clearInterval(poll);
        reject(new Error(`vite dev non è partito sulla porta ${VITE_PORT} (log: ${join(runDir, 'server.log')})`));
      }
    }, 1_500);
    child.on('error', (e) => {
      clearInterval(poll);
      reject(e);
    });
  });
}

async function ensureAppServer(): Promise<() => Promise<void>> {
  if (await httpReachable(APP_URL)) return async () => {};
  log(`[server] ${APP_URL} non risponde, avvio vite dev…`);
  return startViteServer();
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
  const stopServer = await ensureAppServer();
  const admin = createAdminClient();
  let userId: string | null = null;
  let browser: Browser | null = null;

  try {
    const stamp = Date.now();
    const user = await createEvalUser(`eval-ux-${stamp}@anomalia.so`, `eval-ux-${stamp}`);
    userId = user.id;
    log(`[user] creato ${user.email}`);

    browser = new Browser(evidenceDir, (line) => log(`[browser] ${line}`));
    const walk = await walkOnboarding(browser, APP_URL, user);
    log(`[walk] ${walk.steps.join(' · ')}`);

    const brand = await pollBrand(user.id);
    log(`[brand] ${brand.slug} (${brand.id})`);

    const { replied, facts: chat } = await waitForAssistantReply(admin, brand.id, REPLY_WAIT_MS);
    log(`[chat] replied=${replied} assistant=${chat.assistantMessages} latency=${chat.firstAssistantLatencyMs}ms`);

    const chatUrl = (await browser.run('get', 'url')).trim();
    await browser.captureEvidence('02-chat');
    const pick = await readText(join(evidenceDir, '01-pick.a11y.txt'));
    const chatSnap = await readText(join(evidenceDir, '02-chat.a11y.txt'));

    const plans = await planFacts(admin, brand.id);
    const flowFacts: FlowFact[] = [
      { id: 'brand-created', ok: true, gate: true, detail: `brand ${brand.slug} creato dall'onboarding` },
      {
        id: 'setup-chat-reply',
        ok: replied,
        gate: true,
        detail: replied
          ? `prima risposta agente in ${chat.firstAssistantLatencyMs}ms (${chat.assistantMessages} messaggi assistente)`
          : `nessuna risposta entro ${REPLY_WAIT_MS / 1000}s`
      },
      {
        id: 'editorial-plan',
        ok: plans.editorialPlans > 0,
        gate: false,
        detail: `${plans.editorialPlans} piani editoriali (fase strategy/plan saltata nel percorso chat-prima)`
      },
      { id: 'news-sources', ok: plans.newsSources > 0, gate: false, detail: `${plans.newsSources} fonti radar attive` }
    ];

    const judged = await judge(brand.slug, pick ?? '', chatSnap ?? '', { chat, plans });
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
        startedAt: new Date(stamp).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - stamp
      },
      flowFacts,
      grade: g,
      judgeUsage: judged.judgeUsage,
      evidenceFiles: ['evidence/01-pick.png', 'evidence/02-chat.png', 'evidence/01-pick.a11y.txt', 'evidence/02-chat.a11y.txt']
    });
    log(`[report] ${report}`);

    const gatesOk = flowFacts.filter((f) => f.gate).every((f) => f.ok);
    return gatesOk && g.allPass ? 0 : 1;
  } finally {
    await browser?.close().catch(() => {});
    if (userId) {
      try {
        await deleteEvalUser(userId);
        log(`[teardown] utente eval ${userId} eliminato (brand e storage cascata)`);
      } catch (e) {
        console.error(`[teardown] FALLITO per ${userId}: eliminare a mano. Motivo:`, e);
      }
    }
    await stopServer();
    writeFileSync(join(runDir, 'transcript.log'), transcriptLines.join('\n'));
  }
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
