import type { JobSnapshot } from './step-jobs';

export type ContinueBrand = {
  slug: string;
  id?: string;
  name?: string;
  website?: string;
  profile?: unknown;
  targetPlatforms?: unknown;
  handles?: unknown;
  research?: { id?: string; status?: string; result?: Record<string, unknown> | null } | null;
};

export const asContinueBrand = (v: unknown): ContinueBrand | null =>
  v && typeof v === 'object' ? (v as ContinueBrand) : null;

// done+plan → si salta dritti al piano; job in volo → ci si riattacca in strategy; altrimenti people.
export function decideResumePhase(research: ContinueBrand['research'], hasPlan: boolean): 'plan' | 'strategy' | 'people' {
  if (research?.id) {
    if (research.status === 'done' && hasPlan) return 'plan';
    if (research.status === 'pending' || research.status === 'running') return 'strategy';
  }
  return 'people';
}
