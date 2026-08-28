import { describe, expect, it } from 'vitest';
import { grade, parseJudgment, RUBRIC } from './grader';
import { renderMarkdown, type RunReport } from './report';

const report: RunReport = {
  meta: {
    runId: 'ux-test',
    appUrl: 'http://localhost:4180',
    judgeModel: 'gemini-flash',
    agentKit: 'off',
    startedAt: '2026-08-28T09:00:00.000Z',
    finishedAt: '2026-08-28T09:04:00.000Z',
    durationMs: 240_000
  },
  flowFacts: [
    { id: 'brand-created', ok: true, gate: true, detail: 'brand eval-ux creato' },
    { id: 'setup-chat-reply', ok: false, gate: true, detail: 'nessuna risposta entro 240s' },
    { id: 'editorial-plan', ok: false, gate: false, detail: '0 piani (percorso chat-prima)' }
  ],
  grade: grade(
    parseJudgment(
      '{"criteria":[{"id":"guided-setup","verdict":"pass","evidence":"l\'agente guida"},{"id":"team-of-agents","verdict":"fail","evidence":"un solo agente"},{"id":"custom-agents-fit","verdict":"partial","evidence":"pick mostrato"},{"id":"strategy-advice","verdict":"pass","evidence":"consigli concreti"}],"summary":"metà strada"}'
    )!
  ),
  judgeUsage: { inputTokens: 1234, outputTokens: 567 },
  evidenceFiles: ['evidence/01-pick.png']
};

describe('renderMarkdown', () => {
  it('declares the pass/fail outcome', () => {
    const md = renderMarkdown(report);
    expect(md).toContain('# Eval UX — ux-test');
    expect(md).toContain('**FAIL**');
    expect(md).toContain('2/4 criteri');
    expect(md).toContain('kit off');
  });

  it('distinguishes gate facts from info facts', () => {
    const md = renderMarkdown(report);
    expect(md).toContain('| brand-created | ✅ |');
    expect(md).toContain('| setup-chat-reply | ❌ |');
    expect(md).toContain('| editorial-plan | ℹ️ |');
  });

  it('shows per-criterion verdicts and evidence', () => {
    const md = renderMarkdown(report);
    expect(md).toContain('| guided-setup | ✅ |');
    expect(md).toContain('| team-of-agents | ❌ |');
    expect(md).toContain('| custom-agents-fit | 🟡 |');
    expect(md).toContain('un solo agente');
  });

  it('reports judge token usage', () => {
    const md = renderMarkdown(report);
    expect(md).toContain('in 1234 / out 567');
  });
});
