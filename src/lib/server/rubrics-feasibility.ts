import type { Rubric } from '$lib/server/rubrics';
import type { EditorialPlan, PlanWeek } from '$lib/server/editorial-plan';
import { weekMixForSpan } from '$lib/server/editorial-plan';
import type { PostSeed } from '$lib/server/content-preview';
import { normalizeBeats } from '$lib/server/content-preview/seed-model';
import { creditsForBatch } from '$lib/server/content-cost';
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
  /**
   * Gli URL che il tool di ricerca ha restituito in QUESTO giro. Presente solo sul percorso
   * dell'agente: dove non c'è, la fonte di un episodio si pretende comunque ma non se ne verifica
   * la provenienza — un percorso senza ricerca non può dimostrare niente, e fingere che possa
   * sarebbe un gate che mente.
   */
  researchedUrls?: Set<string>;
  /**
   * I crediti che il brand ha davvero per produrre questo batch. Presente → il mix di formati è una
   * SCELTA con un prezzo, e questo la fa rispettare; assente → nessun vincolo inventato, che è il
   * caso dei percorsi che il budget non lo conoscono.
   */
  creditBudget?: number;
  /**
   * Il mix atteso. Una voce con `week` vale per QUELLA settimana del batch, una senza vale per
   * tutto il batch — che è il comportamento di prima, e resta quello dei batch di una settimana.
   * Su due settimane un mix unico non dice niente: due episodi possono stare entrambi nella prima
   * e lasciare la seconda vuota, e il conto tornerebbe lo stesso.
   */
  weekMix?: Array<{ week?: number; type: string; count: number }>;
};

/** Validate weekly batch seeds against assets, platforms, and approved rubrics. */
// Una fonte vale se punta a una pagina che la ricerca ha DAVVERO restituito in questo giro.
// Confronto sull'URL: il titolo lo si può parafrasare, l'indirizzo no.
function citesResearchedPage(sourcedFrom: string | undefined, researched: Set<string>): boolean {
  const text = String(sourcedFrom ?? '');
  for (const url of researched) {
    if (url && text.includes(url)) return true;
  }
  return false;
}

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
  const rubricCountsByWeek = new Map<number, Map<string, number>>();
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
      // I seed arrivano qui grezzi dal modello (l'agente passa il suo array così com'è), quindi la
      // forma va normalizzata prima di giudicarla: una battuta vecchia in forma di stringa resta
      // valida come riquadro, e senza voce di dentro la regola qui sotto la coglie.
      const beats = normalizeBeats(seed.beats) ?? [];
      const slides = Number(seed.slide_count) || 0;
      // Un carosello o è una STORIA (qualcuno la vive) o è una GUIDA (dei passi): la voce di dentro
      // si pretende solo dentro una storia.
      const voiced = beats.filter((b) => b.thinks?.trim());
      const source = String(seed.sourced_from ?? '').trim();

      if (!beats.length) {
        violations.push(`Carousel seed "${seed.angle}" has no beats — write one concrete beat per slide, in order.`);
      } else if (slides && beats.length !== slides) {
        violations.push(`Carousel seed "${seed.angle}" has ${beats.length} beats for ${slides} slides — one beat per slide.`);
      }

      if (voiced.length && voiced.length !== beats.length) {
        violations.push(`Carousel seed "${seed.angle}" has ${beats.length - voiced.length} beat(s) with no inner line — a story cannot have mute panels, and the rest of this post has an inner line.`);
      }
      if (voiced.length && !source) {
        // Una storia è la vita di qualcuno: senza fonte è scritta su ciò che sembra plausibile.
        violations.push(`Carousel seed "${seed.angle}" tells a story with no source — search for how people describe this situation in their own words, pick one, and put it in sourced_from.`);
      }
      if (voiced.length && source && ctx.researchedUrls && !citesResearchedPage(source, ctx.researchedUrls)) {
        // Il gate che una regola di prompt non può essere: l'agente ha già riempito questo campo
        // con «Linee guida CNOPD» senza aver cercato niente, e suonava autorevole.
        violations.push(`Carousel seed "${seed.angle}" has a source that is not grounded in anything you actually read this run — cite a page the research tool returned, with its URL, or search first.`);
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
          continue;
        }
        if (seed.format && hit.format && seed.format !== hit.format) {
          violations.push(
            `Seed rubric "${hit.name}" requires format ${hit.format} but seed has ${seed.format}.`
          );
        }
        const key = hit.name.toLowerCase();
        rubricCounts.set(key, (rubricCounts.get(key) ?? 0) + 1);
        if (Number.isFinite(Number(seed.week))) {
          const w = Math.floor(Number(seed.week));
          const perWeek = rubricCountsByWeek.get(w) ?? new Map<string, number>();
          perWeek.set(key, (perWeek.get(key) ?? 0) + 1);
          rubricCountsByWeek.set(w, perWeek);
        }
      }
    }
  }

  // Un batch che non si può produrre è peggio di uno più piccolo che si può: qui si scopre PRIMA
  // di spendere il primo render, non a metà con nove post fatti e sei vuoti.
  if (ctx.creditBudget != null && Number.isFinite(ctx.creditBudget)) {
    const cost = creditsForBatch(
      seeds.map((s) => ({ format: s.format, slideCount: s.slide_count }))
    );
    if (cost > ctx.creditBudget) {
      violations.push(
        `This batch costs ${cost} credits and the brand has ${Math.round(ctx.creditBudget)} — drop a video, shorten a carousel, or plan fewer posts. The prices are in the budget brief; do not assume which format is the expensive one.`
      );
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
        const scoped = entry.week != null && Number.isFinite(Number(entry.week));
        const counts = scoped
          ? (rubricCountsByWeek.get(Math.floor(Number(entry.week))) ?? new Map<string, number>())
          : rubricCounts;
        const got = counts.get(type) ?? 0;
        if (want > 0 && got !== want) {
          const display = ctx.rubrics.find((r) => r.name.toLowerCase() === type)?.name ?? entry.type;
          const where = scoped ? ` in week ${Math.floor(Number(entry.week)) + 1}` : '';
          violations.push(`Week mix wants ${want}× "${display}"${where} but seeds have ${got}.`);
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
    /** Quante settimane copre il batch. Assente o 1 → comportamento di sempre. */
    weeks?: number;
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
      ? weekMixForSpan(opts.editorialPlan, opts.weekIndex, opts.weeks ?? 1)
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
