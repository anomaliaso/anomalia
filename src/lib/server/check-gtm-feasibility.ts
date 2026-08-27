import { horizonWeeks, phaseBounds, type GtmPlan, type GtmPhase } from '$lib/server/gtm';

export type GtmFeasibilityContext = {
  selectedPlatforms: string[];
};

function checkPhasesForHorizon(
  phases: GtmPhase[],
  horizon: '90d' | '6m',
  ctx: GtmFeasibilityContext
): string[] {
  const violations: string[] = [];
  const label = horizon === '90d' ? '90-day' : '6-month';
  const bounds = phaseBounds(horizon);
  const platforms = new Set(ctx.selectedPlatforms.map((p) => p.toLowerCase()).filter(Boolean));

  if (!phases.length) {
    violations.push(`${label} plan has no phases.`);
    return violations;
  }
  if (phases.length < bounds.min || phases.length > bounds.max) {
    violations.push(`${label} plan has ${phases.length} phases (expected ${bounds.min}–${bounds.max}).`);
  }

  const totalWeeks = phases.reduce((a, p) => a + p.duration_weeks, 0);
  const target = horizonWeeks(horizon);
  if (Math.abs(totalWeeks - target) > 1) {
    violations.push(`${label} phases sum to ${totalWeeks} weeks (expected ~${target}).`);
  }

  for (const phase of phases) {
    const n = phase.index + 1;
    if (!String(phase.name ?? '').trim()) violations.push(`${label} phase ${n}: name is empty.`);
    if (!String(phase.objective ?? '').trim()) violations.push(`${label} phase ${n}: objective is empty.`);
    if (!phase.platform_weights?.length) {
      violations.push(`${label} phase "${phase.name || n}": missing platform_weights.`);
    }
    const weightSum = (phase.platform_weights ?? []).reduce((a, w) => a + w.percent, 0);
    if (weightSum > 0 && (weightSum < 85 || weightSum > 115)) {
      violations.push(`${label} phase "${phase.name || n}": platform weights sum to ${weightSum}% (expected ~100).`);
    }
    for (const w of phase.platform_weights ?? []) {
      const plat = String(w.platform ?? '').toLowerCase();
      if (plat && platforms.size > 0 && !platforms.has(plat)) {
        violations.push(
          `${label} phase "${phase.name || n}": platform "${w.platform}" is not in selected platforms (${[...platforms].join(', ')}).`
        );
      }
    }
    if (!phase.goals?.length) {
      violations.push(`${label} phase "${phase.name || n}": at least one goal is required.`);
    }
  }
  return violations;
}

/** Deterministic GTM feasibility — dual-horizon plans must pass for both 90d and 6m. */
export function checkGtmFeasibility(plan: GtmPlan, ctx: GtmFeasibilityContext): string[] {
  const violations: string[] = [];
  if (!String(plan.objective ?? '').trim()) {
    violations.push('GTM objective is empty.');
  }
  const phases90d = plan.phases_90d ?? [];
  const phases6m = plan.phases_6m?.length ? plan.phases_6m : plan.phases;
  violations.push(...checkPhasesForHorizon(phases90d, '90d', ctx));
  violations.push(...checkPhasesForHorizon(phases6m, '6m', ctx));
  return violations;
}
