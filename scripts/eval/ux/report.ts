import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Grade } from './grader';

export type FlowFact = {
  id: string;
  ok: boolean;
  gate: boolean;
  detail: string;
};

export type RunMeta = {
  runId: string;
  appUrl: string;
  judgeModel: string;
  agentKit: 'on' | 'off';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export type JudgeUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type RunReport = {
  meta: RunMeta;
  flowFacts: FlowFact[];
  grade: Grade;
  judgeUsage: JudgeUsage;
  evidenceFiles: string[];
};

function verdictIcon(verdict: string): string {
  if (verdict === 'pass') return '✅';
  if (verdict === 'partial') return '🟡';
  return '❌';
}

function factIcon(fact: FlowFact): string {
  if (!fact.gate) return 'ℹ️';
  return fact.ok ? '✅' : '❌';
}

export function renderMarkdown(report: RunReport): string {
  const { meta, flowFacts, grade, judgeUsage } = report;
  const lines: string[] = [];
  lines.push(`# Eval UX — ${meta.runId}`);
  lines.push('');
  lines.push(
    `Esito: **${grade.allPass ? 'PASS' : 'FAIL'}** · ${grade.passCount}/${grade.criteria.length} criteri · app ${meta.appUrl} · giudice ${meta.judgeModel} · kit ${meta.agentKit}`
  );
  lines.push('');
  if (grade.summary) {
    lines.push(`> ${grade.summary}`);
    lines.push('');
  }
  lines.push('## Flusso (fatti dal database)');
  lines.push('');
  lines.push('| Fatto | Esito | Dettaglio |');
  lines.push('|---|---|---|');
  for (const f of flowFacts) {
    lines.push(`| ${f.id} | ${factIcon(f)} | ${f.detail} |`);
  }
  lines.push('');
  lines.push('## Criteri (giudizio LLM)');
  lines.push('');
  lines.push('| Criterio | Esito | Atteso | Evidenza |');
  lines.push('|---|---|---|---|');
  for (const c of grade.criteria) {
    lines.push(`| ${c.id} | ${verdictIcon(c.verdict)} | ${c.expected} | ${c.evidence || '—'} |`);
  }
  lines.push('');
  lines.push('## Evidenze');
  lines.push('');
  for (const file of report.evidenceFiles) {
    lines.push(`- ${file}`);
  }
  lines.push('');
  lines.push(
    `Durata: ${(meta.durationMs / 1000).toFixed(1)}s · token giudice: in ${judgeUsage.inputTokens} / out ${judgeUsage.outputTokens}`
  );
  lines.push('');
  return lines.join('\n');
}

export function writeReport(runDir: string, report: RunReport): string {
  mkdirSync(runDir, { recursive: true });
  const mdPath = join(runDir, 'report.md');
  writeFileSync(mdPath, renderMarkdown(report));
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  return mdPath;
}
