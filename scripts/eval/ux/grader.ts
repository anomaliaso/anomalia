export type Verdict = 'pass' | 'fail' | 'partial';

export type CriterionVerdict = {
  id: string;
  verdict: Verdict;
  evidence: string;
};

export type Judgment = {
  criteria: CriterionVerdict[];
  summary: string;
};

export type GradedCriterion = CriterionVerdict & { expected: string };

export type Grade = {
  criteria: GradedCriterion[];
  summary: string;
  allPass: boolean;
  passCount: number;
  failCount: number;
};

export const RUBRIC: ReadonlyArray<{ id: string; expected: string }> = [
  {
    id: 'guided-setup',
    expected:
      "L'utente è guidato nel setup anche dal primo agente con cui viene indirizzato all'inizio."
  },
  {
    id: 'team-of-agents',
    expected:
      'Si avverte di parlare con un intero team: più agenti contattano l\'utente via chat per iniziare il proprio lavoro.'
  },
  {
    id: 'custom-agents-fit',
    expected:
      'Il team si adatta alle necessità dell\'utente (custom agents) per automatizzarne i workflow aziendali.'
  },
  {
    id: 'strategy-advice',
    expected:
      'Il primo contatto dà consigli e strategie utili e concreti per marketing, distribution e sales.'
  }
];

const VERDICTS: ReadonlySet<string> = new Set(['pass', 'fail', 'partial']);

function extractJsonObject(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseJudgment(raw: string): Judgment | null {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as { criteria?: unknown; summary?: unknown };
  if (!Array.isArray(obj.criteria)) return null;
  const criteria: CriterionVerdict[] = [];
  for (const entry of obj.criteria) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, verdict, evidence } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || typeof verdict !== 'string') continue;
    if (!VERDICTS.has(verdict)) continue;
    criteria.push({
      id,
      verdict: verdict as Verdict,
      evidence: typeof evidence === 'string' ? evidence : ''
    });
  }
  if (!criteria.length) return null;
  return { criteria, summary: typeof obj.summary === 'string' ? obj.summary : '' };
}

export function grade(judgment: Judgment): Grade {
  const byId = new Map(judgment.criteria.map((c) => [c.id, c]));
  const criteria: GradedCriterion[] = RUBRIC.map(({ id, expected }) => {
    const verdict = byId.get(id);
    return {
      id,
      expected,
      verdict: verdict?.verdict ?? 'fail',
      evidence: verdict?.evidence ?? 'criterio non valutato dal giudice'
    };
  });
  const passCount = criteria.filter((c) => c.verdict === 'pass').length;
  const failCount = criteria.length - passCount;
  return {
    criteria,
    summary: judgment.summary,
    allPass: passCount === criteria.length,
    passCount,
    failCount
  };
}
