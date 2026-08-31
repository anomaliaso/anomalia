import type { Rubric } from '$lib/server/rubrics';
import type { EditorialPlan, PlanWeek } from '$lib/server/editorial-plan';
import type { PostSeed } from '$lib/server/content-preview';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Approved recurring series (rubriche) — named, format-bound content series. */
export function rubricNameSet(rubrics: Rubric[]): Set<string> {
  return new Set(rubrics.map((r) => r.name.trim().toLowerCase()).filter(Boolean));
}

export function rubricByName(rubrics: Rubric[]): Map<string, Rubric> {
  const map = new Map<string, Rubric>();
  for (const r of rubrics) {
    const key = r.name.trim().toLowerCase();
    if (key) map.set(key, r);
  }
  return map;
}

/** When the brand has approved rubrics, editorial plan weeks must express mix as rubric names. */
export function checkRubricsInEditorialPlan(
  plan: Pick<EditorialPlan, 'weeks'>,
  rubrics: Rubric[]
): string[] {
  if (!rubrics.length) return [];
  const names = rubricNameSet(rubrics);
  const label = [...names].map((n) => rubrics.find((r) => r.name.toLowerCase() === n)?.name ?? n).join(', ');
  const violations: string[] = [];
  for (const week of plan.weeks ?? []) {
    const idx = (week.index ?? 0) + 1;
    for (const entry of week.content_mix ?? []) {
      const type = String(entry.type ?? '').trim();
      if (!type) continue;
      if (!names.has(type.toLowerCase())) {
        violations.push(
          `Week ${idx}: content_mix type "${type}" is not an approved rubric (serie ripetibile). Use rubric names only: ${label}.`
        );
      }
    }
  }
  return violations;
}

export type BatchFeasibilityContext = {
  expectedSeedCount: number;
  selectedPlatforms: string[];
  products: Array<{ title?: string; name?: string; images?: unknown }>;
  people: Array<{ name: string; images?: unknown }>;
  mediaIds: Set<string>;
  rubrics: Rubric[];
  weekMix?: Array<{ type: string; count: number }>;
};

/** Validate weekly batch seeds against assets, platforms, and approved rubrics. */
export function checkRubricsAndBatchFeasibility(
  seeds: PostSeed[],
  ctx: BatchFeasibilityContext
): string[] {
  const violations: string[] = [];
  if (seeds.length !== ctx.expectedSeedCount) {
    violations.push(`Expected ${ctx.expectedSeedCount} seeds but got ${seeds.length}.`);
  }

  const productNames = new Set(
    ctx.products
      .map((p) => String(p.title ?? p.name ?? '').trim().toLowerCase())
      .filter(Boolean)
  );
  const peopleNames = new Set(ctx.people.map((p) => p.name.trim().toLowerCase()).filter(Boolean));
  const platforms = new Set(ctx.selectedPlatforms.map((p) => p.toLowerCase()));
  const rubricMap = rubricByName(ctx.rubrics);

  const rubricCounts = new Map<string, number>();
  for (const seed of seeds) {
    const plat = String(seed.platform ?? '').toLowerCase();
    if (plat && platforms.size > 0 && !platforms.has(plat)) {
      violations.push(`Seed on platform "${seed.platform}" is not in selected platforms (${[...platforms].join(', ')}).`);
    }
    const product = String(seed.product ?? '').trim();
    if (product && !productNames.has(product.toLowerCase())) {
      violations.push(`Seed references unknown product "${product}".`);
    }
    const person = String(seed.person ?? '').trim();
    if (person && !peopleNames.has(person.toLowerCase())) {
      violations.push(`Seed references unknown person "${person}".`);
    }
    const personRow = ctx.people.find((p) => p.name.toLowerCase() === person.toLowerCase());
    if (person && personRow && (!Array.isArray(personRow.images) || personRow.images.length === 0)) {
      violations.push(`Seed features person "${person}" but they have no images.`);
    }
    const prodRow = ctx.products.find(
      (p) => String(p.title ?? p.name ?? '').toLowerCase() === product.toLowerCase()
    );
    if (product && prodRow && (!Array.isArray(prodRow.images) || prodRow.images.length === 0)) {
      violations.push(`Seed features product "${product}" but it has no photos.`);
    }
    // Un carosello è una storia o è padding: le battute sono la storia, e senza il produttore
    // improvvisa N immagini da una riga di angle.
    if (seed.format === 'carousel') {
      const beats = (seed.beats ?? []).filter((b) => String(b ?? '').trim());
      const slides = Number(seed.slide_count) || 0;
      if (!beats.length) {
        violations.push(`Carousel seed "${seed.angle}" has no beats — write one concrete beat per slide, in order.`);
      } else if (slides && beats.length !== slides) {
        violations.push(`Carousel seed "${seed.angle}" has ${beats.length} beats for ${slides} slides — one beat per slide.`);
      }
    }
    if (seed.media_id && !ctx.mediaIds.has(seed.media_id)) {
      violations.push(`Seed media_id "${seed.media_id}" is not in the brand media library.`);
    }
    if (plat === 'reddit') {
      if (!String(seed.title ?? '').trim()) violations.push('Reddit seed missing title.');
      if (!String(seed.subreddit ?? '').trim()) violations.push('Reddit seed missing subreddit.');
    }

    const rubricName = String(seed.rubric ?? '').trim();
    if (ctx.rubrics.length) {
      if (!rubricName) {
        violations.push(`Seed on ${seed.platform} has no rubric — assign an approved series name.`);
      } else {
        const hit = rubricMap.get(rubricName.toLowerCase());
        if (!hit) {
          violations.push(`Seed rubric "${rubricName}" is not an approved series.`);
        } else if (seed.format && hit.format && seed.format !== hit.format) {
          violations.push(
            `Seed rubric "${hit.name}" requires format ${hit.format} but seed has ${seed.format}.`
          );
        }
        rubricCounts.set(hit.name.toLowerCase(), (rubricCounts.get(hit.name.toLowerCase()) ?? 0) + 1);
      }
    }
  }

  if (ctx.rubrics.length && ctx.weekMix?.length) {
    const names = rubricNameSet(ctx.rubrics);
    const mixUsesRubrics = ctx.weekMix.every((e) =>
      names.has(String(e.type ?? '').trim().toLowerCase())
    );
    if (mixUsesRubrics) {
      for (const entry of ctx.weekMix) {
        const type = String(entry.type ?? '').trim().toLowerCase();
        const want = Number(entry.count) || 0;
        const got = rubricCounts.get(type) ?? 0;
        if (want > 0 && got !== want) {
          const display = ctx.rubrics.find((r) => r.name.toLowerCase() === type)?.name ?? entry.type;
          violations.push(`Week mix wants ${want}× "${display}" but seeds have ${got}.`);
        }
      }
    }
  }

  return violations;
}

export function weekMixFromPlan(plan: EditorialPlan | null, weekIndex: number): PlanWeek['content_mix'] {
  return plan?.weeks?.[weekIndex]?.content_mix ?? [];
}

export async function loadBatchFeasibilityContext(
  supabase: SupabaseClient,
  brandId: string,
  opts: {
    expectedSeedCount: number;
    selectedPlatforms: string[];
    weekIndex?: number;
    editorialPlan?: EditorialPlan | null;
    rubrics?: Rubric[];
  }
): Promise<BatchFeasibilityContext> {
  const [{ data: products }, { data: people }, { data: mediaRows }, rubrics] = await Promise.all([
    supabase.from('products').select('title, images').eq('brand_id', brandId),
    supabase.from('people').select('name, images').eq('brand_id', brandId),
    supabase.from('brand_media').select('id').eq('brand_id', brandId).eq('catalog_status', 'ready'),
    opts.rubrics?.length
      ? Promise.resolve(opts.rubrics)
      : import('$lib/server/rubrics').then(({ loadApprovedRubrics }) => loadApprovedRubrics(supabase, brandId))
  ]);
  const weekMix =
    opts.editorialPlan && opts.weekIndex != null
      ? weekMixFromPlan(opts.editorialPlan, opts.weekIndex)
      : undefined;
  return {
    expectedSeedCount: opts.expectedSeedCount,
    selectedPlatforms: opts.selectedPlatforms,
    products: products ?? [],
    people: people ?? [],
    mediaIds: new Set((mediaRows ?? []).map((m) => m.id as string)),
    rubrics: rubrics ?? [],
    weekMix
  };
}
