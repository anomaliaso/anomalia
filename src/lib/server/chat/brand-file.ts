import type { SupabaseClient } from '@supabase/supabase-js';
import { renderDesignDoc } from '$lib/server/brand-design-doc';
import { loadActiveGtm } from '$lib/server/gtm';

/**
 * IL BRAND COME FILE, non come muro nel prompt (direttiva 22, taglio 4).
 *
 * Fino al 23/8 `DESIGN.md` — identità, voce, palette, tipografia, pilastri, prodotti, persone,
 * documenti, concorrenti, i due brief scritti dal modello — veniva composto a ogni turno e
 * incollato nel system prompt di OGNI mestiere: 3.352 token misurati su un brand vero (Anomalia),
 * ricopiati a ogni passo anche quando il turno era «che ore sono». Sono FATTI, e i fatti si vanno
 * a leggere: adesso è `brand/studio.md`, una riga di indice e un `read_file` quando servono.
 *
 * NIENTE SECONDA COPIA. Il testo lo produce la stessa `renderDesignDoc` di sempre — quella che
 * serve anche il planner, il generatore di immagini e la pagina Studio — quindi non esiste una
 * versione «del file» che possa divergere da quella «del prompt»: è la stessa funzione.
 *
 * IL RISCHIO, dichiarato perché è vero: una lettura costa uno step, e uno step vale ~31.000 token
 * fissi. Se l'agente aprisse questo file a OGNI turno avremmo speso 31.000 per risparmiarne 3.352.
 * La condizione perché paghi è che la maggior parte dei turni non ne abbia bisogno, e quella
 * condizione la crea la riga di indice (che dice QUANDO leggere) più le tre righe che restano nel
 * prompt (nome, sito, lingua, preferenze video) — non la buona volontà. Va misurata sui giri veri.
 */
export async function renderBrandStudioFile(
  supabase: SupabaseClient,
  brandId: string
): Promise<string> {
  const [
    { data: brand },
    { data: kit },
    { data: plan },
    { data: products },
    { data: people },
    { data: documents },
    { data: competitors }
  ] = await Promise.all([
    supabase.from('brands').select('name, website, target_platforms, content_prefs').eq('id', brandId).maybeSingle(),
    supabase.from('brand_kit').select('*').eq('brand_id', brandId).maybeSingle(),
    supabase
      .from('editorial_plans')
      .select('voice')
      .eq('brand_id', brandId)
      .eq('status', 'active')
      .maybeSingle(),
    supabase.from('products').select('id, title, description, pricing, kind, featured, url, images').eq('brand_id', brandId),
    // `images` come STORAGE PATH, mai come URL firmato: è ciò che tiene il documento deterministico
    // (vedi brand-design-doc.ts) — un URL a scadenza qui renderebbe il file diverso a ogni lettura.
    supabase.from('people').select('id, name, role, kind, description, images').eq('brand_id', brandId),
    supabase
      .from('brand_documents')
      .select('id, kind, title, summary, status, chunk_count, collection')
      .eq('brand_id', brandId)
      .neq('kind', 'image'),
    supabase.from('competitors').select('name, website, kind, rationale').eq('brand_id', brandId)
  ]);

  if (!brand) return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prefs = (brand.content_prefs as Record<string, any> | null) ?? null;
  return renderDesignDoc(
    {
      brandName: String(brand.name ?? ''),
      kit,
      // Nel prompt la voce era esclusa per il mestiere che riceveva già il piano editoriale. Qui
      // no: un file non ha mestieri, e la voce è un fatto del brand come la palette.
      voice: (plan?.voice as Record<string, unknown> | null) ?? null,
      language: prefs?.language ?? null,
      targetPlatforms: Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : null,
      products,
      people,
      documents,
      competitors
    },
    { toolHints: true }
  );
}

function configLine(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return String(raw ?? '—');
  const parts = Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v}`);
  return parts.join(' · ') || '—';
}

function weekSection(week: Record<string, unknown>, position: number): string {
  const mix = Array.isArray(week.content_mix)
    ? (week.content_mix as Array<{ count?: number; type?: string }>).map((m) => `${m.count}x ${m.type}`).join(', ')
    : '';
  const products = Array.isArray(week.products) ? (week.products as string[]) : [];
  const start = week.week_start ? `, starts ${week.week_start}` : ', no start date yet';
  return [
    `### Week ${Number(week.index ?? position) + 1} — ${week.theme || '(no theme)'} [${week.status ?? 'upcoming'}${start}]`,
    week.focus ? `Focus: ${week.focus}` : '',
    mix ? `Mix: ${mix}` : '',
    week.rationale ? `Why: ${week.rationale}` : '',
    week.brief ? `USER BRIEF (authoritative, overrides the theme): ${week.brief}` : '',
    products.length ? `Products to feature: ${products.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * `brand/studio.md` dice chi è il brand, questo dice cosa ha deciso di fare: posizionamento,
 * piano editoriale attivo settimana per settimana (brief e prodotti scelti compresi) e roadmap
 * GTM. Sono tre tabelle, ed è per questo che esiste un file solo.
 */
export async function renderBrandStrategyFile(
  supabase: SupabaseClient,
  brandId: string
): Promise<string> {
  const [{ data: strategy }, { data: plan }, gtm] = await Promise.all([
    supabase.from('brand_strategy').select('positioning, report').eq('brand_id', brandId).maybeSingle(),
    supabase
      .from('editorial_plans')
      .select('strategy, voice, cadence, platform_mix, weeks, activated_at')
      .eq('brand_id', brandId)
      .eq('status', 'active')
      .maybeSingle(),
    loadActiveGtm(supabase, brandId)
  ]);
  if (!strategy && !plan && !gtm) return '';

  const researchSummary = (strategy?.report as { summary?: string } | null)?.summary ?? null;
  const sections: string[] = ['# Strategy — what this brand has decided to do'];

  if (strategy?.positioning || researchSummary) {
    sections.push('## Positioning');
    if (strategy?.positioning) sections.push(String(strategy.positioning));
    if (researchSummary) sections.push(`### Competitive research\n${researchSummary}`);
  }

  if (plan) {
    sections.push('## Editorial plan (active)');
    if (plan.activated_at) sections.push(`Activated: ${String(plan.activated_at).slice(0, 10)}`);
    if (plan.strategy) sections.push(String(plan.strategy));
    sections.push(
      [
        `- cadence: ${plan.cadence ?? '—'}`,
        `- platform mix: ${configLine(plan.platform_mix)}`,
        `- voice: ${configLine(plan.voice)}`
      ].join('\n')
    );
    const weeks = Array.isArray(plan.weeks) ? (plan.weeks as Array<Record<string, unknown>>) : [];
    for (const [i, w] of weeks.entries()) sections.push(weekSection(w, i));
    if (!weeks.length) sections.push('This plan has no weeks in it.');
  } else {
    sections.push('## Editorial plan\nNone active: this brand has no approved 4-week plan right now.');
  }

  if (gtm) {
    sections.push('## GTM plan (active)');
    sections.push(`Horizon ${gtm.horizon} · objective: ${gtm.objective || '—'}`);
    for (const phase of gtm.phases) {
      sections.push(
        [
          `### Phase ${phase.index + 1} — ${phase.name} (${phase.start_date ?? 'no start date'} to ${phase.end_date ?? 'no end date'}, ${phase.duration_weeks}w)`,
          `Objective: ${phase.objective}`,
          `Rationale: ${phase.rationale}`,
          phase.pillars?.length ? `Pillars: ${phase.pillars.join(', ')}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      );
    }
  }

  return sections.join('\n\n');
}
