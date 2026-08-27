/**
 * IL BANCO DELLE IDEE DIROMPENTI — persistenza, prompt e i due tool che ogni agente riceve.
 *
 * La dottrina (le dodici leve, i tre test, i limiti) sta in `$lib/disruptive`, client-safe, perché
 * la pagina Idee la mostra. Qui c'è solo ciò che tocca il database e l'anello degli agenti.
 *
 * TRE TOOL, NON DUE. `save_disruptive_idea` senza `read_disruptive_ideas` produce un banco che
 * cresce e non viene mai letto: l'agente ripropone ogni settimana varianti della stessa idea,
 * ognuna nuova per lui e già vista dall'utente. La lettura prima della proposta è la metà che fa
 * funzionare l'altra. E senza `mark_idea_used` nessuna idea esce mai dal giro: resta `new` per
 * sempre e continua a presentarsi.
 *
 * LA ROTAZIONE STA NEL DATO, NON NEL PROMPT. Ogni lettura destinata a un modello registra
 * `last_shown_at`, e l'ordine è: mai mostrate, poi le più vecchie di vista, col punteggio DENTRO i
 * gruppi. Serviva perché la varietà non può dipendere dalla buona volontà del modello — un agente
 * che si dimentica di marcare l'idea riporterebbe il difetto il giorno dopo. Così il banco gira da
 * solo anche quando nessuno marca niente.
 *
 * ANTI-DUPLICATO IN SCRITTURA. L'indice unico su (brand_id, lower(title)) trasforma il "ho avuto
 * di nuovo la stessa idea" in un update invece che in una riga in più — e il caso è frequente,
 * perché un modello che ripercorre lo stesso brief ci ritorna quasi sempre.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import {
  CONTRAST_DEVICE_IDS,
  DISRUPTIVE_STATUSES,
  contrastDeviceById,
  isContrastDeviceId,
  type ContrastDeviceId,
  type DisruptiveStatus
} from '$lib/disruptive';

export type DisruptiveIdea = {
  id: string;
  brand_id: string;
  user_id: string | null;
  title: string;
  idea: string;
  device: string | null;
  why_it_contrasts: string | null;
  who_it_annoys: string | null;
  format: string | null;
  score: number | null;
  surface: string | null;
  agent: string | null;
  thread_id: string | null;
  status: DisruptiveStatus;
  used_post_id: string | null;
  used_at: string | null;
  /** Ultima volta che l'idea è stata messa davanti a un modello. Null = mai vista: va per prima. */
  last_shown_at: string | null;
  shown_count: number;
  tags: string[];
  created_at: string;
  updated_at: string;
};

const COLS =
  'id, brand_id, user_id, title, idea, device, why_it_contrasts, who_it_annoys, format, score, surface, agent, thread_id, status, used_post_id, used_at, last_shown_at, shown_count, tags, created_at, updated_at';

/** Quante idee entrano nel prompt di un agente. Oltre questa soglia il banco costa più di quanto rende. */
export const IDEAS_IN_PROMPT = 8;

export type SaveDisruptiveIdeaInput = {
  title: string;
  idea: string;
  device?: string | null;
  whyItContrasts?: string | null;
  whoItAnnoys?: string | null;
  format?: string | null;
  score?: number | null;
  surface?: string | null;
  agent?: string | null;
  threadId?: string | null;
  tags?: string[];
};

function clampText(raw: unknown, max: number): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * `%` e `_` in un titolo sono caratteri normali per un umano e jolly per ILIKE: senza escape
 * "Sconto 50% vero" pescherebbe qualunque riga che inizia per "Sconto 50".
 */
function ilikeTitle(title: string): string {
  return title.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Salva un'idea. Idempotente sul titolo: la seconda volta arricchisce la riga esistente invece di
 * duplicarla, e non riporta mai indietro lo stato — un'idea già usata o archiviata resta tale
 * anche se il modello la ripropone convinto di averla appena inventata.
 */
export async function saveDisruptiveIdea(
  supabase: SupabaseClient,
  brandId: string,
  userId: string | null,
  input: SaveDisruptiveIdeaInput
): Promise<{ ok: true; idea: DisruptiveIdea; duplicate: boolean } | { ok: false; error: string }> {
  const title = clampText(input.title, 160);
  const idea = clampText(input.idea, 1200);
  if (!title || !idea) return { ok: false, error: 'title e idea sono obbligatori' };

  const device = input.device && isContrastDeviceId(input.device) ? input.device : null;
  const row = {
    brand_id: brandId,
    user_id: userId || null,
    title,
    idea,
    device,
    why_it_contrasts: input.whyItContrasts ? clampText(input.whyItContrasts, 600) : null,
    who_it_annoys: input.whoItAnnoys ? clampText(input.whoItAnnoys, 300) : null,
    format: input.format ? clampText(input.format, 60) : null,
    score:
      typeof input.score === 'number' && Number.isFinite(input.score)
        ? Math.max(0, Math.min(100, Math.round(input.score)))
        : null,
    surface: input.surface ? clampText(input.surface, 40) : null,
    agent: input.agent ? clampText(input.agent, 40) : null,
    thread_id: input.threadId || null,
    tags: (input.tags ?? []).map((t) => clampText(t, 40)).filter(Boolean).slice(0, 8)
  };

  const titlePattern = ilikeTitle(title);
  const { data: existing } = await supabase
    .from('disruptive_ideas')
    .select(COLS)
    .eq('brand_id', brandId)
    .ilike('title', titlePattern)
    .maybeSingle();

  if (existing) {
    const prev = existing as unknown as DisruptiveIdea;
    const { data, error } = await supabase
      .from('disruptive_ideas')
      .update({
        idea: row.idea,
        device: row.device ?? prev.device,
        why_it_contrasts: row.why_it_contrasts ?? prev.why_it_contrasts,
        who_it_annoys: row.who_it_annoys ?? prev.who_it_annoys,
        format: row.format ?? prev.format,
        score: row.score ?? prev.score,
        // La superficie e l'agente restano quelli della PRIMA volta: dice dove è nata l'idea.
        tags: row.tags.length ? row.tags : prev.tags,
        updated_at: new Date().toISOString()
      })
      .eq('id', prev.id)
      .select(COLS)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, idea: (data ?? prev) as unknown as DisruptiveIdea, duplicate: true };
  }

  const { data, error } = await supabase
    .from('disruptive_ideas')
    .insert(row)
    .select(COLS)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'insert returned no row' };
  return { ok: true, idea: data as unknown as DisruptiveIdea, duplicate: false };
}

export type ListDisruptiveIdeasOpts = {
  status?: DisruptiveStatus | 'all';
  device?: ContrastDeviceId;
  limit?: number;
  /** Solo le idee mai girate — quello che si vuole quasi sempre quando si cerca cosa fare adesso. */
  unusedOnly?: boolean;
  /**
   * La lettura sta per finire davanti a un MODELLO (system prompt o tool), non davanti a una
   * persona. Cambia due cose: l'ordine diventa quello della rotazione, e le righe restituite
   * vengono segnate come mostrate. La pagina Idee e la CLI restano ordinate per punteggio — lì
   * l'utente vuole il meglio in cima, non il turno di ciascuno.
   */
  rotate?: boolean;
};

export async function listDisruptiveIdeas(
  supabase: SupabaseClient,
  brandId: string,
  opts: ListDisruptiveIdeasOpts = {}
): Promise<DisruptiveIdea[]> {
  let q = supabase.from('disruptive_ideas').select(COLS).eq('brand_id', brandId);
  if (opts.status && opts.status !== 'all') q = q.eq('status', opts.status);
  if (opts.unusedOnly) q = q.in('status', ['new', 'shortlisted']);
  if (opts.device) q = q.eq('device', opts.device);
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  // Rotazione: mai mostrate prima, poi le più vecchie di vista. Il punteggio ordina DENTRO questi
  // gruppi, mai sopra — è il "sopra" che teneva le stesse due idee in cima per sempre.
  const ordered = opts.rotate ? q.order('last_shown_at', { ascending: true, nullsFirst: true }) : q;
  const { data, error } = await ordered
    .order('score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[disruptive-ideas] list failed', error);
    return [];
  }
  const ideas = (data ?? []) as unknown as DisruptiveIdea[];
  if (opts.rotate && ideas.length) await recordIdeasShown(supabase, brandId, ideas);
  return ideas;
}

/**
 * Segna le idee appena mostrate a un modello. È TELEMETRIA: se fallisce, la lettura è già andata a
 * buon fine e non deve accorgersene nessuno — al massimo il banco gira un giro più tardi.
 * L'incremento sta dentro il database perché prompt e post si assemblano in parallelo, e un
 * read-modify-write per riga perde conteggi appena due generazioni si sovrappongono.
 */
async function recordIdeasShown(
  supabase: SupabaseClient,
  brandId: string,
  ideas: DisruptiveIdea[]
): Promise<void> {
  try {
    const { error } = await supabase.rpc('bump_disruptive_idea_shown', {
      idea_ids: ideas.map((i) => i.id),
      p_brand: brandId
    });
    if (error) console.error('[disruptive-ideas] shown bump failed', error.message);
  } catch (e) {
    console.error('[disruptive-ideas] shown bump threw', e);
  }
}

export async function updateDisruptiveIdea(
  supabase: SupabaseClient,
  brandId: string,
  id: string,
  patch: {
    status?: DisruptiveStatus;
    score?: number | null;
    title?: string;
    idea?: string;
    device?: string | null;
    whyItContrasts?: string | null;
    whoItAnnoys?: string | null;
    format?: string | null;
    usedPostId?: string | null;
  }
): Promise<DisruptiveIdea | null> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status) {
    row.status = patch.status;
    // "Usata" senza data è un'informazione a metà: il banco serve anche a sapere QUANDO.
    if (patch.status === 'used') row.used_at = new Date().toISOString();
  }
  if (patch.score !== undefined) {
    row.score =
      typeof patch.score === 'number' && Number.isFinite(patch.score)
        ? Math.max(0, Math.min(100, Math.round(patch.score)))
        : null;
  }
  if (patch.title !== undefined) row.title = clampText(patch.title, 160);
  if (patch.idea !== undefined) row.idea = clampText(patch.idea, 1200);
  if (patch.device !== undefined) row.device = isContrastDeviceId(patch.device) ? patch.device : null;
  if (patch.whyItContrasts !== undefined)
    row.why_it_contrasts = patch.whyItContrasts ? clampText(patch.whyItContrasts, 600) : null;
  if (patch.whoItAnnoys !== undefined)
    row.who_it_annoys = patch.whoItAnnoys ? clampText(patch.whoItAnnoys, 300) : null;
  if (patch.format !== undefined) row.format = patch.format ? clampText(patch.format, 60) : null;
  if (patch.usedPostId !== undefined) row.used_post_id = patch.usedPostId || null;

  const { data, error } = await supabase
    .from('disruptive_ideas')
    .update(row)
    .eq('brand_id', brandId)
    .eq('id', id)
    .select(COLS)
    .maybeSingle();
  if (error) {
    console.error('[disruptive-ideas] update failed', error);
    return null;
  }
  return (data as unknown as DisruptiveIdea) ?? null;
}

/**
 * "Questa l'ho girata". Accetta l'id O il titolo perché è quello che il modello ha davvero in mano:
 * la sezione di prompt gli mostra i titoli, non gli uuid, e un tool che pretende un id da una
 * sezione che non lo contiene è un tool che non verrà chiamato mai.
 */
export async function markIdeaUsed(
  supabase: SupabaseClient,
  brandId: string,
  ref: { id?: string | null; title?: string | null; postId?: string | null }
): Promise<DisruptiveIdea | null> {
  let id = ref.id || null;
  if (!id && ref.title) {
    const { data } = await supabase
      .from('disruptive_ideas')
      .select('id')
      .eq('brand_id', brandId)
      .ilike('title', ilikeTitle(clampText(ref.title, 160)))
      .maybeSingle();
    id = (data as { id?: string } | null)?.id ?? null;
  }
  if (!id) return null;
  return updateDisruptiveIdea(supabase, brandId, id, {
    status: 'used',
    usedPostId: ref.postId ?? undefined
  });
}

export async function deleteDisruptiveIdea(
  supabase: SupabaseClient,
  brandId: string,
  id: string
): Promise<boolean> {
  const { error } = await supabase.from('disruptive_ideas').delete().eq('brand_id', brandId).eq('id', id);
  if (error) {
    console.error('[disruptive-ideas] delete failed', error);
    return false;
  }
  return true;
}

/** Una riga per idea, come la vede un modello. */
export function formatIdeaLine(idea: DisruptiveIdea): string {
  const device = contrastDeviceById(idea.device)?.label ?? idea.device ?? '—';
  const bits = [
    `[${idea.status}]`,
    idea.score != null ? `${idea.score}/100` : null,
    `${idea.title} — ${idea.idea}`,
    `leva: ${device}`,
    idea.why_it_contrasts ? `contrasto: ${idea.why_it_contrasts}` : null,
    idea.who_it_annoys ? `infastidisce: ${idea.who_it_annoys}` : null,
    idea.format ? `formato: ${idea.format}` : null
  ].filter(Boolean);
  return `- ${bits.join(' · ')}`;
}

/**
 * Il banco come sezione di system prompt. Vuoto → una riga sola che dice che è vuoto: un agente
 * che non sa se il banco è vuoto o non caricato tende a inventarsi che c'è dentro qualcosa.
 *
 * Il testo diceva "Ripescare batte reinventare", ed era l'istruzione a riciclare scritta in
 * chiaro: con un banco fermo davanti agli occhi, un agente che pesca e non deposita mai è il
 * comportamento CORRETTO secondo il prompt. Adesso il banco è un pavimento, non un soffitto.
 */
export async function buildDisruptiveIdeasSection(
  supabase: SupabaseClient,
  brandId: string
): Promise<string> {
  const ideas = await listDisruptiveIdeas(supabase, brandId, {
    unusedOnly: true,
    limit: IDEAS_IN_PROMPT,
    rotate: true
  });
  if (!ideas.length) {
    return `## BANCO IDEE DIROMPENTI
Vuoto: nessuna idea viva per questo brand — non c'è niente da ripescare. Se dal lavoro di adesso ne esce una che passa i tre test (how/DISRUPTIVE-IDEAS.md), salvala con save_disruptive_idea, così la prossima volta c'è.`;
  }
  return `## BANCO IDEE DIROMPENTI (${ideas.length} idee vive, a rotazione — questa lista cambia a ogni giro, non è la classifica)
${ideas.map(formatIdeaLine).join('\n')}

Il banco è un pavimento, non un soffitto.
- Se una di queste regge sul brief di adesso, girala e dillo. E appena finisce in un post vero chiama mark_idea_used: un'idea non marcata continua a ripresentarsi come se fosse ancora da fare, e il banco smette di dire la verità.
- Se lavorando te ne viene una nuova che passa i tre test (read_file how/DISRUPTIVE-IDEAS.md: i tre test, le leve di contrasto, i limiti), salvala con save_disruptive_idea: è così che un'idea laterale sopravvive alla fine del thread invece di morire qui. Non è una quota e non è una cosa da spuntare — un lavoro che non ha prodotto nessuna idea laterale è normale, e un'idea inventata per riempire il banco vale meno di zero.
- read_disruptive_ideas per l'elenco completo, incluse le usate e le archiviate (utile per non ripresentare una cosa già girata).`;
}

/**
 * I tre tool. Vanno a OGNI agente (registry) e ai maker che non passano dalla chat (planner UGC,
 * media generator, motion), perché è esattamente lì che nascono le idee laterali che oggi si
 * perdono.
 */
export function createDisruptiveIdeaTools(opts: {
  supabase: SupabaseClient;
  brandId: string;
  userId?: string | null;
  threadId?: string | null;
  /** Da dove arriva il salvataggio: 'chat', 'ugc', 'media', 'motion', 'ads'… */
  surface?: string | null;
  agent?: string | null;
  /** Wrapper opzionale per i chip live (stesso contratto di createBrandContextTools). */
  wrap?: <T>(toolName: string, run: () => Promise<T>) => Promise<T>;
}): ToolSet {
  const run = <T>(name: string, fn: () => Promise<T>): Promise<T> =>
    opts.wrap ? opts.wrap(name, fn) : fn();

  return {
    read_disruptive_ideas: tool({
      description:
        'Leggi il banco idee dirompenti del brand (gratis). Chiamalo PRIMA di proporre angoli, campagne o batch creativi, per sapere cosa c\'è già e non riproporre una quasi-copia. Le idee tornano a rotazione, non per punteggio: quello che leggi oggi non è quello che leggerai domani.',
      inputSchema: z.object({
        status: z.enum([...DISRUPTIVE_STATUSES, 'all']).optional().describe('default: solo new + shortlisted'),
        device: z.enum(CONTRAST_DEVICE_IDS).optional().describe('Filtra per leva di contrasto'),
        limit: z.number().int().min(1).max(50).optional()
      }),
      execute: async (input: { status?: DisruptiveStatus | 'all'; device?: ContrastDeviceId; limit?: number }) =>
        run('read_disruptive_ideas', async () => {
          const ideas = await listDisruptiveIdeas(opts.supabase, opts.brandId, {
            status: input.status,
            device: input.device,
            limit: input.limit ?? 25,
            unusedOnly: !input.status,
            rotate: true
          });
          return { count: ideas.length, ideas };
        })
    }),

    mark_idea_used: tool({
      description:
        'Segna un\'idea del banco come GIRATA, appena è diventata un post, uno script o una creatività vera. Senza questa chiamata l\'idea resta "da fare" per sempre e continua a ripresentarsi nei prompt al posto delle altre. Passa il titolo esatto che hai letto nel banco (o l\'id, se ce l\'hai), e il post_id quando esiste.',
      inputSchema: z.object({
        title: z.string().optional().describe("Il titolo dell'idea, esattamente come sta nel banco"),
        id: z.string().optional().describe("L'id dell'idea, se lo hai da read_disruptive_ideas"),
        post_id: z.string().optional().describe('Il post nato dall\'idea, quando esiste già')
      }),
      execute: async (input: { title?: string; id?: string; post_id?: string }) =>
        run('mark_idea_used', async () => {
          if (!input.id && !input.title) return { success: false, error: 'serve il titolo o l\'id' };
          const idea = await markIdeaUsed(opts.supabase, opts.brandId, {
            id: input.id,
            title: input.title,
            postId: input.post_id
          });
          if (!idea) {
            return {
              success: false,
              error: `Nessuna idea nel banco con questo titolo o id. Se l'idea è nuova, salvala con save_disruptive_idea invece di marcarla.`
            };
          }
          return { success: true, idea, note: 'Segnata come usata: non tornerà più nei prompt.' };
        })
    }),

    save_disruptive_idea: tool({
      description:
        'Salva nel banco del brand un\'idea che passa i TRE TEST (logo / attrito / argomento). Usalo appena l\'idea esiste, anche se non è per il lavoro di adesso: è il modo in cui le idee laterali sopravvivono alla fine del thread. Ri-salvare lo stesso titolo aggiorna la riga, non la duplica.',
      inputSchema: z.object({
        title: z.string().describe('Titolo brevissimo e riconoscibile (es. "La maglia che brucia")'),
        idea: z
          .string()
          .describe('L\'idea come si gira: cosa si VEDE, non cosa si comunica. Due o tre frasi.'),
        device: z.enum(CONTRAST_DEVICE_IDS).describe('La leva di contrasto su cui è costruita'),
        why_it_contrasts: z
          .string()
          .describe('Perché rompe l\'aspettativa della categoria — il test del logo, in una frase'),
        who_it_annoys: z.string().describe('A chi dà fastidio. Se non sai rispondere, non è contrasto.'),
        format: z.string().optional().describe('Formato in cui girarla (es. problem_solution, comparison, carousel)'),
        score: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe(
            'Quanto rompe la categoria, sulla scala 0-100 (NON 0-10): 40 = interessante, 70 = scomoda per davvero, 90 = ne parlano i commenti'
          ),
        tags: z.array(z.string()).max(8).optional()
      }),
      execute: async (input: {
        title: string;
        idea: string;
        device: ContrastDeviceId;
        why_it_contrasts: string;
        who_it_annoys: string;
        format?: string;
        score?: number;
        tags?: string[];
      }) =>
        run('save_disruptive_idea', async () => {
          const saved = await saveDisruptiveIdea(opts.supabase, opts.brandId, opts.userId ?? null, {
            title: input.title,
            idea: input.idea,
            device: input.device,
            whyItContrasts: input.why_it_contrasts,
            whoItAnnoys: input.who_it_annoys,
            format: input.format,
            score: input.score,
            surface: opts.surface ?? null,
            agent: opts.agent ?? null,
            threadId: opts.threadId ?? null,
            tags: input.tags
          });
          if (!saved.ok) return { success: false, error: saved.error };
          // L'idea intera, non solo l'id: la chat ne fa una card, e l'utente deve VEDERE cosa è
          // stato salvato senza aprire un'altra pagina.
          return {
            success: true,
            duplicate: saved.duplicate,
            idea: saved.idea,
            note: saved.duplicate
              ? 'Idea già nel banco: aggiornata, non duplicata.'
              : 'Salvata nel banco idee del brand.'
          };
        })
    })
  };
}
