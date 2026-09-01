/**
 * I digest del wall: il materiale raccolto per /design e /trending, distillato in due testi
 * compatti che i produttori (immagini, UGC/video, motion) iniettano nei loro prompt.
 *
 * PERCHÉ NESSUNA CHIAMATA VISION QUI. Ogni item del wall è GIÀ stato guardato da un modello,
 * una volta, quando è entrato: il design judge ha guardato il poster (design_note, design_tags,
 * punteggi per asse — design-judge.ts) e il reviewer video ha guardato il clip (hook_type,
 * hook_at_s, reveal, cta, dead_seconds, summary — market-video-analysis.ts). Il distillatore
 * rilegge QUEL testo e lo sintetizza: due chiamate Gemini solo-testo a settimana in totale,
 * zero pixel. È lo stesso pattern di motion-references.ts (studia una volta con vision → cache
 * di uno spec testuale → la generazione legge lo spec gratis), applicato un livello più su.
 *
 * PAVIMENTO, NON SOFFITTO — NON CANCELLARE PENSANDO CHE DUPLICHI LO STUDIO DEI REFERENCE.
 * L'agente Motion studia ancora i singoli reference di posts.design per OGNI brief
 * (studyMotionReference): quello è il soffitto, su misura del brief. Questo digest è il
 * pavimento ambientale: il gusto corrente del campo, uguale per tutti i brand, che vale anche
 * quando nessun reference viene studiato. I due non si sovrappongono: uno è "questo pezzo,
 * smontato", l'altro è "cosa fa il lavoro forte in questo momento".
 *
 * DOVE VIVE. Nel bucket privato 'brand-knowledge' (lo stesso che archivia i media di mercato,
 * service-role only) come JSON, così NIENTE migration: i deploy non applicano le migration
 * (vedi MEMORY), e una tabella nuova sarebbe una colonna fantasma in produzione. Un digest
 * assente o stantio (>30 giorni) degrada a sezione vuota — mai bloccare una generazione.
 *
 * QUANDO SI RIGENERAVA. In coda al wall/sweep, con un gate di freschezza a 6 giorni. Da quando
 * il muro pubblico è spento non si rigenera più: i digest sul bucket restano dove sono. Il wall è GLOBALE
 * (nessuna colonna brand), quindi il digest è globale: la sfumatura per-brand avviene a prompt
 * time, dove il chiamante ha già la categoria del brand nel resto del prompt.
 *
 * CONTESTO BRAND. Come wall.design_judge e i clip di mercato: nessun brand dietro il wall,
 * la chiamata è loggata su ai_calls con brand null. È il costo di piattaforma del wall, non
 * di un cliente.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { llmConfigured, llmText } from '$lib/server/llm';
import { createAdminClient } from '$lib/server/supabase-admin';
import { minDesignScore } from '$lib/server/design-judge';
import { TRENDING_MIN_OUTPERFORMANCE, TRENDING_WINDOW_DAYS } from '$lib/server/wall';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** Bump quando cambia il prompt o la forma: i digest vecchi smettono di essere serviti. */
export const WALL_DIGEST_VERSION = 1;
/** Oltre questa età il digest è una fotografia di un altro momento: degrada ad assente. */
export const DIGEST_MAX_AGE_DAYS = 30;
/** Sotto questa età il distillatore non rigenera: col sweep 3×/settimana ⇒ di fatto settimanale. */
export const DIGEST_REFRESH_AFTER_DAYS = 6;
/**
 * Item per digest. 60 = circa due pagine del wall pubblico (PAGE_SIZE 36), cioè il top che un
 * visitatore vede davvero; in prompt sono pochi kB di righe compatte. Di più diluisce il segnale
 * con la coda, di meno fa parlare tre account per tutto il campo.
 */
export const DIGEST_ITEMS = 60;

/** Stesso bucket privato dei media di mercato: già esiste, già service-role, zero migration. */
const BUCKET = 'brand-knowledge';
const digestPath = (kind: WallDigestKind) => `market-digests/${kind}.json`;

export type WallDigestKind = 'design' | 'trending';

export type WallDigest = {
  kind: WallDigestKind;
  version: number;
  generatedAt: string;
  itemCount: number;
  /** Il distillato vero e proprio — pattern concreti, pochi kB. */
  text: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function isDigestFresh(d: Pick<WallDigest, 'generatedAt'> | null, now = Date.now()): boolean {
  if (!d) return false;
  const t = Date.parse(d.generatedAt);
  return Number.isFinite(t) && now - t <= DIGEST_MAX_AGE_DAYS * DAY_MS;
}

/** Riga compatta per un item di design — il testo che il judge ha già scritto, più i numeri. */
export function designItemLine(row: AnyRec): string {
  const scores = row.design_scores && typeof row.design_scores === 'object' ? (row.design_scores as AnyRec) : {};
  const axes = ['typography', 'composition', 'colour', 'craft', 'originality']
    .map((a) => `${a.slice(0, 3)}:${Number(scores[a] ?? 0) || '?'}`)
    .join(' ');
  const note =
    row.design_note && typeof row.design_note === 'object'
      ? String((row.design_note as AnyRec).en ?? '').trim()
      : '';
  const tags = Array.isArray(row.design_tags) ? row.design_tags.join(',') : '';
  return [
    `[${row.category ?? 'other'}/${row.content_form ?? '?'}]`,
    `score ${row.design_score ?? '?'}`,
    axes,
    tags ? `tags=${tags}` : '',
    note ? `"${note}"` : ''
  ]
    .filter(Boolean)
    .join(' ');
}

/** Riga compatta per un item trending — l'analisi video già pagata, più l'evidenza metrica. */
export function trendingItemLine(post: AnyRec, analysis: AnyRec | null): string {
  const evidence = [
    `×${Number(post.outperformance ?? 0).toFixed(1)} vs own median`,
    post.views ? `${post.views} views` : ''
  ]
    .filter(Boolean)
    .join(', ');
  if (!analysis) {
    return `[${post.platform}/${post.category ?? 'other'}] ${evidence} — no clip analysis`;
  }
  const bits = [
    analysis.hook_type ? `hook=${analysis.hook_type}@${analysis.hook_at_s ?? '?'}s` : '',
    analysis.hook_line ? `"${String(analysis.hook_line).slice(0, 90)}"` : '',
    analysis.hook_open_loop ? 'open-loop' : '',
    analysis.reveal_at_s != null ? `reveal@${analysis.reveal_at_s}s` : '',
    analysis.cta_at_s != null ? `cta@${analysis.cta_at_s}s` : '',
    Array.isArray(analysis.dead_seconds) && analysis.dead_seconds.length
      ? `dead=${analysis.dead_seconds.join(',')}`
      : '',
    analysis.duration_s ? `${analysis.duration_s}s` : '',
    analysis.summary ? `— ${String(analysis.summary).slice(0, 160)}` : ''
  ].filter(Boolean);
  return `[${post.platform}/${post.category ?? 'other'}] ${evidence} ${bits.join(' ')}`;
}

/**
 * Prompt del distillatore design. Puro (testabile senza rete). Chiede pattern OSSERVABILI —
 * layout, densità tipografica, ruoli della palette, mosse compositive — mai aggettivi vuoti:
 * lo stesso registro di MOTION_CRAFT_SPECS, che è il consumatore-tipo di questo testo.
 */
export function buildDesignDigestPrompt(lines: string[]): string {
  return `You are distilling a curated wall of the strongest social-feed DESIGN right now (${lines.length} pieces, each already graded by a vision judge: per-axis 1-10 scores, style tags, one concrete note).

ITEMS:
${lines.join('\n')}

Write a compact craft digest (max ~500 words) an image producer can obey directly:
- Group by vertical/category where the items support it; a "general" group for the rest.
- Only OBSERVABLE, reproducible moves: layout structure, type density and hierarchy, palette roles (ground / ink / one accent), composition moves, use of empty space, photo vs graphic balance.
- Each bullet = one concrete instruction ("one oversized headline, 3-5 words, 60% of canvas height"), never taste words ("clean", "modern", "make it pop").
- Note what the strongest pieces AVOID doing, in one short block.
Plain text with short headers, no markdown tables, no preamble.`;
}

/**
 * Prompt del distillatore trending. Puro. Chiede le meccaniche dell'hook del raccolto virale
 * CORRENTE, con l'evidenza metrica che il wall porta (outperformance vs mediana dell'account).
 */
export function buildTrendingDigestPrompt(lines: string[]): string {
  return `You are distilling the current crop of OUTPERFORMING short-form videos (${lines.length} clips, each beat its own account's median by the factor shown; a vision reviewer already watched each clip).

ITEMS:
${lines.join('\n')}

Write a compact viral-mechanics digest (max ~500 words) a video/UGC producer can obey directly:
- FIRST SECOND: what physically happens on screen at 0-1s in the winners (action, not topic), and how fast the hook lands.
- HOOK PATTERNS: the hook types that recur, with the evidence (how many clips, at what outperformance).
- PACING: reveal timing, CTA timing, where dead seconds kill clips.
- ON-SCREEN TEXT: overlay patterns that recur.
- FORMATS: which recognizable formats dominate this crop, per vertical where the data supports it.
Each claim cites its evidence inline ("7 of 18 winners, ×2+"). Plain text with short headers, no preamble.`;
}

/** Costruzione pura del record datato/versionato — esportata per il test del distillatore. */
export function finalizeDigest(
  kind: WallDigestKind,
  text: string,
  itemCount: number,
  now = Date.now()
): WallDigest | null {
  const clean = String(text ?? '').trim().slice(0, 8000);
  if (!clean) return null;
  return { kind, version: WALL_DIGEST_VERSION, generatedAt: new Date(now).toISOString(), itemCount, text: clean };
}

export async function readWallDigest(admin: SupabaseClient, kind: WallDigestKind): Promise<WallDigest | null> {
  try {
    const { data, error } = await admin.storage.from(BUCKET).download(digestPath(kind));
    if (error || !data) return null;
    const parsed = JSON.parse(await data.text()) as WallDigest;
    if (!parsed || parsed.version !== WALL_DIGEST_VERSION || !parsed.text) return null;
    return parsed;
  } catch {
    // Bucket assente, JSON rotto, rete giù: il digest è un lusso, mai un gate.
    return null;
  }
}

async function writeWallDigest(admin: SupabaseClient, digest: WallDigest): Promise<void> {
  const buf = Buffer.from(JSON.stringify(digest));
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(digestPath(digest.kind), buf, { contentType: 'application/json', upsert: true });
  if (error) console.warn(`[wall-digest] write ${digest.kind} failed: ${error.message}`);
}

async function distillText(label: string, prompt: string): Promise<string | null> {
  if (!llmConfigured()) return null;
  try {
    const { text } = await llmText({ prompt, label });
    return text.trim() || null;
  } catch {
    return null;
  }
}

export type DistillResult = {
  design: 'refreshed' | 'fresh_skip' | 'no_items' | 'failed';
  trending: 'refreshed' | 'fresh_skip' | 'no_items' | 'failed';
};

/**
 * Rigenera i due digest se hanno più di DIGEST_REFRESH_AFTER_DAYS. Senza chiamante da quando il
 * muro pubblico è stato spento: i digest restano leggibili e, superati i 30 giorni, degradano a
 * sezione vuota come hanno sempre fatto. Resta esportata perché la si possa lanciare a mano.
 */
export async function distillWallDigests(
  admin: SupabaseClient,
  opts: { force?: boolean; now?: number } = {}
): Promise<DistillResult> {
  const now = opts.now ?? Date.now();
  const out: DistillResult = { design: 'failed', trending: 'failed' };

  const due = async (kind: WallDigestKind): Promise<boolean> => {
    if (opts.force) return true;
    const existing = await readWallDigest(admin, kind);
    if (!existing) return true;
    const t = Date.parse(existing.generatedAt);
    return !Number.isFinite(t) || now - t > DIGEST_REFRESH_AFTER_DAYS * DAY_MS;
  };

  // — Design: il top del wall secondo il suo stesso bar (stesso filtro della pagina pubblica).
  try {
    if (!(await due('design'))) {
      out.design = 'fresh_skip';
    } else {
      const { data } = await admin
        .from('market_posts')
        .select('design_note, design_tags, design_scores, design_score, category, content_form')
        .eq('is_design', true)
        .eq('design_publishable', true)
        .neq('wall_state', 'hidden')
        .gte('design_score', minDesignScore())
        .order('design_score', { ascending: false })
        .limit(DIGEST_ITEMS);
      const rows = (data ?? []) as AnyRec[];
      if (!rows.length) {
        out.design = 'no_items';
      } else {
        const text = await distillText('wall.digest_design', buildDesignDigestPrompt(rows.map(designItemLine)));
        const digest = text ? finalizeDigest('design', text, rows.length, now) : null;
        if (digest) {
          await writeWallDigest(admin, digest);
          out.design = 'refreshed';
        }
      }
    }
  } catch (e) {
    console.error('[wall-digest] design distill failed:', e instanceof Error ? e.message : e);
  }

  // — Trending: i clip che hanno battuto il proprio account, con l'analisi già pagata.
  try {
    if (!(await due('trending'))) {
      out.trending = 'fresh_skip';
    } else {
      const since = new Date(now - TRENDING_WINDOW_DAYS * DAY_MS).toISOString();
      const { data } = await admin
        .from('market_posts')
        .select('id, platform, category, outperformance, views')
        .gte('outperformance', TRENDING_MIN_OUTPERFORMANCE)
        .gte('published_at', since)
        .order('outperformance', { ascending: false })
        .limit(DIGEST_ITEMS);
      const posts = (data ?? []) as AnyRec[];
      if (!posts.length) {
        out.trending = 'no_items';
      } else {
        const { data: analyses } = await admin
          .from('market_video_analyses')
          .select(
            'market_post_id, hook_type, hook_at_s, hook_line, hook_open_loop, reveal_at_s, cta_at_s, dead_seconds, duration_s, summary'
          )
          .in('market_post_id', posts.map((p) => p.id));
        const byPost = new Map((analyses ?? []).map((a: AnyRec) => [a.market_post_id, a]));
        const lines = posts.map((p) => trendingItemLine(p, byPost.get(p.id) ?? null));
        const text = await distillText('wall.digest_trending', buildTrendingDigestPrompt(lines));
        const digest = text ? finalizeDigest('trending', text, posts.length, now) : null;
        if (digest) {
          await writeWallDigest(admin, digest);
          out.trending = 'refreshed';
        }
      }
    }
  } catch (e) {
    console.error('[wall-digest] trending distill failed:', e instanceof Error ? e.message : e);
  }

  return out;
}

// ————————————————————————— Sezioni prompt per i produttori —————————————————————————

/**
 * Sezione pura: digest → blocco prompt. Vuota quando il digest manca o è stantio — il chiamante
 * concatena e basta, senza condizioni. Il framing dice esplicitamente che è un pavimento: brand
 * kit e reference per-brief vincono sempre.
 */
export function wallDigestSection(digest: WallDigest | null, now = Date.now()): string {
  if (!digest || !isDigestFresh(digest, now)) return '';
  const dated = digest.generatedAt.slice(0, 10);
  if (digest.kind === 'design') {
    return `\n\nAMBIENT DESIGN FLOOR (distilled ${dated} from the strongest current feed design — defaults where the brief is silent; brand kit and per-brief references always win):\n${digest.text}\n`;
  }
  return `\n\nCURRENT VIRAL MECHANICS (distilled ${dated} from clips that beat their own account's median — ambient floor; the brief and any studied reference stay the ceiling):\n${digest.text}\n`;
}

const digestReadOncePerProcess = new Map<WallDigestKind, Promise<WallDigest | null>>();

async function digestSection(kind: WallDigestKind): Promise<string> {
  try {
    let read = digestReadOncePerProcess.get(kind);
    if (!read) {
      read = readWallDigest(createAdminClient(), kind);
      digestReadOncePerProcess.set(kind, read);
    }
    return wallDigestSection(await read);
  } catch {
    return '';
  }
}

/** Per il percorso immagini (content-preview): una riga da concatenare al prompt. */
export const designWallDigestSection = (): Promise<string> => digestSection('design');
/** Per i percorsi UGC/video/motion: una riga da concatenare al system prompt. */
export const trendingWallDigestSection = (): Promise<string> => digestSection('trending');
