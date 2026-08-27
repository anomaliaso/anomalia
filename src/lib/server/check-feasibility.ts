import { countForFrequency } from '$lib/server/plans';
import type { EditorialPlan } from '$lib/server/editorial-plan';
import type { Rubric } from '$lib/server/rubrics';
import { checkRubricsInEditorialPlan } from '$lib/server/rubrics-feasibility';

export type FeasibilityContext = {
  allowedCadences: string[];
  selectedPlatforms: string[];
  productsWithImages: number;
  peopleWithImages: number;
  approvedRubrics?: Rubric[];
};

/** Deterministic feasibility check — returns concrete violation messages (empty = ok). */
export function checkFeasibility(
  plan: Pick<EditorialPlan, 'cadence' | 'platform_mix' | 'weeks'>,
  ctx: FeasibilityContext
): string[] {
  const violations: string[] = [];
  const cadence = String(plan.cadence ?? '').trim();
  if (!ctx.allowedCadences.includes(cadence)) {
    violations.push(
      `Cadence "${cadence}" is not allowed for this plan tier (allowed: ${ctx.allowedCadences.join(', ')}).`
    );
  }
  const weeklyTarget = countForFrequency(cadence);
  for (const week of plan.weeks ?? []) {
    const idx = (week.index ?? 0) + 1;
    if (!String(week.theme ?? '').trim()) {
      violations.push(`Week ${idx}: theme is empty.`);
    }
    if (!String(week.focus ?? '').trim()) {
      violations.push(`Week ${idx}: focus is empty.`);
    }
    const mixSum = (week.content_mix ?? []).reduce((acc, m) => acc + (Number(m.count) || 0), 0);
    if (mixSum !== weeklyTarget) {
      violations.push(
        `Week ${idx}: content_mix sums to ${mixSum} but cadence "${cadence}" requires ${weeklyTarget} posts.`
      );
    }
    let productSlots = 0;
    let personSlots = 0;
    for (const entry of week.content_mix ?? []) {
      const type = String(entry.type ?? '').toLowerCase();
      const count = Number(entry.count) || 0;
      if (mixTypeNeedsProduct(type)) productSlots += count;
      if (mixTypeNeedsPerson(type)) personSlots += count;
    }
    if (productSlots > ctx.productsWithImages) {
      violations.push(
        `Week ${idx}: content_mix requests ${productSlots} product-heavy posts but only ${ctx.productsWithImages} photographed product(s) exist.`
      );
    }
    if (personSlots > 0 && ctx.peopleWithImages < 1) {
      violations.push(`Week ${idx}: content_mix requests person/founder posts but no people with images exist.`);
    }
  }
  const selected = new Set(ctx.selectedPlatforms.map((p) => p.toLowerCase()));
  for (const entry of plan.platform_mix ?? []) {
    const p = String(entry.platform ?? '').toLowerCase();
    if (p && selected.size > 0 && !selected.has(p)) {
      violations.push(
        `Platform "${p}" is in platform_mix but not in the brand's selected platforms (${[...selected].join(', ')}).`
      );
    }
  }
  if (ctx.approvedRubrics?.length) {
    violations.push(...checkRubricsInEditorialPlan(plan, ctx.approvedRubrics));
  }
  return violations;
}

function mixTypeNeedsProduct(type: string): boolean {
  return /carousel|product|launch|showcase|sku|merch/.test(type);
}

function mixTypeNeedsPerson(type: string): boolean {
  return /person|founder|team|behind|face|portrait|ugc/.test(type);
}
