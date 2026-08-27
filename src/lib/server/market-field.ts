import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { genaiClient } from '$lib/server/brand-context';
import { aiStructured } from '$lib/server/xiaomi';
import { guardrailsBlock } from '$lib/server/brand-guardrails';
import { discoverLinkedIn, discoverReddit, discoverThreads, type DiscoveredPost } from '$lib/server/market-discovery';
import { instagramHashtag, tiktokKeyword, type TrendingVideo } from '$lib/server/market-trends';
import { marketPostRow, trendPostRow } from '$lib/server/market-harvest';

// ── Field watch: cosa gira NEL CAMPO di questo brand, e perché ───────────────────────────────────
//
// Il Radar risponde a "a cosa deve reagire il brand oggi". Questo risponde a una domanda diversa e
// più lenta: **come comunica chi, nel campo di questo brand, sta ottenendo attenzione** — che
// formati usa, con che tono, cosa ha fatto perché il post girasse, e quanto di quella spinta è
// ragebait invece che valore.
//
// Tre pezzi esistevano già e nessuno rispondeva a questa domanda:
//   - `market-harvest` scopre su 12 verticali FISSE e serve a tarare il rubric, non a insegnare a
//     un brand;
//   - `market-references` parte dagli handle dei competitor GIÀ NOTI, quindi non vede mai chi sta
//     sfondando adesso e che nessuno ha ancora schedato;
//   - `market-trends` guarda i feed trending, che sono per definizione senza campo.
//
// Qui la scoperta parte dal brand, i post finiscono nel catalogo GLOBALE (`market_posts`, dedupe su
// platform+external_id) e il teardown è globale anche lui: due brand nello stesso campo trovano lo
// stesso post e lo paghiamo una volta sola. Quello che resta per-brand è il legame
// (`brand_field_posts`) e il playbook distillato.
//
// SUL DENOMINATORE. L'harvest etichetta `outperformance` = engagement ÷ mediana dell'account, e
// quella è la misura onesta di "virale". Qui non possiamo permettercelo: richiede una baseline per
// ogni account scoperto, cioè una chiamata a profilo. Quindi ordiniamo per **engagement grezzo
// dentro il pull della settimana** e lo diciamo: è "i post più visti che il campo ha restituito
// questa settimana", non "i post che hanno battuto il loro autore". Quando un account entra
// comunque nelle baseline dell'harvest globale, l'etichetta arriva gratis e il post — che è la
// stessa riga — se la ritrova.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** Il playbook si rigenera settimanalmente, come le market references. */
export const FIELD_FRESH_DAYS = 7;
/** I topic del campo cambiano lentamente: si riscrivono solo se più vecchi di così. */
const TOPICS_FRESH_DAYS = 30;

/** Tetti di costo per run. Ogni query è ~1 credito ScrapeCreators per piattaforma. */
const MAX_QUERIES = 3;
const MAX_HASHTAGS = 2;
/** Quanti post restano legati al brand per run. */
const KEEP_PER_RUN = 10;
/** Teardown nuovi per run (1 chiamata AI ciascuno, e sono globali: il secondo brand non li ripaga). */
const MAX_TEARDOWNS_PER_RUN = 8;
/** Finestra del playbook. */
const PLAYBOOK_WINDOW_DAYS = 45;

export type FieldTopics = {
  /** Query testuali per Threads / Reddit / LinkedIn / TikTok. */
  queries: string[];
  /** Hashtag per Instagram e TikTok: lì l'hashtag È il verticale, una frase no. */
  hashtags: string[];
};

export type FieldMove = { move: string; why: string; howToAdapt: string; ragebait: number };

export type FieldPlaybook = {
  summary: string;
  hooks: Array<{ pattern: string; example: string }>;
  tones: string[];
  /** Quanto ragebait usa il campo, 0-10. È il contesto in cui il brand deve decidere quanto usarne. */
  fieldRagebait: number;
  moves: FieldMove[];
  avoid: string[];
  postsSeen: number;
  updatedAt: string;
};

export function isFieldFresh(updatedAt: string | null | undefined, days = FIELD_FRESH_DAYS): boolean {
  if (!updatedAt) return false;
  const age = Date.now() - new Date(updatedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < days * 24 * 3600 * 1000;
}

// ── 1. I topic del campo ────────────────────────────────────────────────────────────────────────

const TOPICS_SCHEMA = {
  type: 'object' as const,
  properties: {
    queries: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Da 2 a 3 query di ricerca che trovano i post che GIRANO nel campo di questo brand. Il campo, non il prodotto: chi parla a questo pubblico di questi problemi, anche se vende altro. Parole chiave semplici, niente operatori booleani, nella lingua in cui quel campo parla davvero.'
    },
    hashtags: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: "Da 1 a 2 hashtag (senza #) che su Instagram e TikTok identificano questo campo. Su quelle piattaforme l'hashtag è il verticale: scegli quelli che gli operatori del campo usano davvero, non quelli generici da milioni di post."
    }
  },
  required: ['queries', 'hashtags']
};

/** I topic del campo, dedotti dal brand e riusati per settimane. Mai più di una scrittura al mese. */
export async function ensureFieldTopics(
  admin: SupabaseClient,
  brand: { id: string; name?: string | null }
): Promise<FieldTopics> {
  const { data: row } = await admin
    .from('brand_market_references')
    .select('field_topics, field_updated_at')
    .eq('brand_id', brand.id)
    .maybeSingle();

  const stored = row?.field_topics as FieldTopics | null;
  if (stored?.queries?.length && isFieldFresh(row?.field_updated_at as string, TOPICS_FRESH_DAYS)) {
    return stored;
  }

  const { data: kit } = await admin
    .from('brand_kit')
    .select('about, category, target_audience, content_pillars')
    .eq('brand_id', brand.id)
    .maybeSingle();

  const ctx = [
    brand.name ? `Brand: ${brand.name}` : '',
    kit?.category ? `Categoria: ${kit.category}` : '',
    kit?.about ? `Cosa fa: ${String(kit.about).slice(0, 500)}` : '',
    kit?.target_audience ? `A chi parla: ${kit.target_audience}` : '',
    Array.isArray(kit?.content_pillars) && kit.content_pillars.length ? `Pilastri: ${kit.content_pillars.join('; ')}` : ''
  ].filter(Boolean).join('\n');
  if (ctx.length < 20) return { queries: [], hashtags: [] };

  const out = await aiStructured<FieldTopics>(
    genaiClient(),
    `${ctx}\n\nDammi le query e gli hashtag per andare a vedere COME COMUNICA chi ottiene attenzione in questo campo. Non cerco i concorrenti per nome: cerco i post che il pubblico di questo brand vede passare.`,
    TOPICS_SCHEMA,
    'Sai dove guarda un pubblico. Scegli termini che restituiscono post reali di un campo, non slogan da brochure.',
    'return_field_topics'
  );

  const topics: FieldTopics = {
    queries: (out?.queries ?? []).map((q) => String(q).trim()).filter(Boolean).slice(0, MAX_QUERIES),
    hashtags: (out?.hashtags ?? []).map((h) => String(h).replace(/^#/, '').trim()).filter(Boolean).slice(0, MAX_HASHTAGS)
  };
  if (!topics.queries.length) return { queries: [], hashtags: [] };

  await admin.from('brand_market_references').upsert(
    { brand_id: brand.id, field_topics: topics, field_updated_at: new Date().toISOString() },
    { onConflict: 'brand_id' }
  );
  return topics;
}

// ── 2. La raccolta ──────────────────────────────────────────────────────────────────────────────

export type FieldHarvest = {
  found: number;
  stored: number;
  linked: number;
  errors: Array<{ source: string; message: string }>;
};

const engagementOf = (m: { likes: number; comments: number; shares: number }): number =>
  (m.likes || 0) + (m.comments || 0) + (m.shares || 0);

const RELEVANCE_SCHEMA = {
  type: 'object' as const,
  properties: {
    keep: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          index: { type: 'integer' as const },
          relevance: { type: 'integer' as const, description: '0-100: quanto questo post appartiene DAVVERO al campo del brand e ha qualcosa da insegnargli su come si comunica lì. Sotto 50 non tenerlo.' }
        },
        required: ['index', 'relevance']
      }
    }
  },
  required: ['keep']
};

/**
 * Una passata di campo: scopre, tiene i più visti, li mette nel catalogo globale e li lega al brand.
 * Non lancia mai: una piattaforma giù è un errore registrato, non un run perso.
 */
export async function harvestBrandField(
  admin: SupabaseClient,
  brand: { id: string; name?: string | null }
): Promise<FieldHarvest> {
  const errors: FieldHarvest['errors'] = [];
  const topics = await ensureFieldTopics(admin, brand).catch((e) => {
    errors.push({ source: 'topics', message: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    return { queries: [], hashtags: [] } as FieldTopics;
  });
  if (!topics.queries.length) return { found: 0, stored: 0, linked: 0, errors };

  // Superfici di testo (conversazioni + LinkedIn) e superfici video (dove il mestiere si vede).
  const jobs: Array<{ source: string; run: () => Promise<{ posts?: DiscoveredPost[]; videos?: TrendingVideo[]; error?: string }> }> = [];
  for (const q of topics.queries) {
    jobs.push({ source: `threads:${q}`, run: () => discoverThreads(q) });
    jobs.push({ source: `reddit:${q}`, run: () => discoverReddit(q) });
    jobs.push({ source: `linkedin:${q}`, run: () => discoverLinkedIn(q) });
    jobs.push({ source: `tiktok:${q}`, run: () => tiktokKeyword(q) });
  }
  for (const h of topics.hashtags) {
    jobs.push({ source: `instagram:#${h}`, run: () => instagramHashtag(h) });
  }

  const results = await Promise.all(jobs.map(async (j) => {
    try {
      const r = await j.run();
      if (r.error) errors.push({ source: j.source, message: r.error });
      return { source: j.source, posts: r.posts ?? [], videos: r.videos ?? [] };
    } catch (e) {
      errors.push({ source: j.source, message: e instanceof Error ? e.message.slice(0, 200) : String(e) });
      return { source: j.source, posts: [] as DiscoveredPost[], videos: [] as TrendingVideo[] };
    }
  }));

  const posts = results.flatMap((r) => r.posts);
  const videos = results.flatMap((r) => r.videos);
  const found = posts.length + videos.length;
  if (!found) return { found: 0, stored: 0, linked: 0, errors };

  // I più VISTI del pull, non i più recenti. Il denominatore vero (outperformance) non è
  // disponibile qui — vedi la nota in testa al file.
  type Candidate = { key: string; row: AnyRec; query: string; text: string; platform: string };
  const candidates: Candidate[] = [
    ...posts.map((p) => ({
      key: `${p.platform}:${p.externalId}`,
      row: marketPostRow(p),
      query: p.query,
      text: String(p.content ?? '').replace(/\s+/g, ' ').slice(0, 300),
      platform: p.platform,
      engagement: engagementOf(p.metrics)
    })),
    ...videos.map((v) => ({
      key: `${v.platform}:${v.externalId}`,
      row: trendPostRow(v),
      query: v.source,
      text: String(v.caption ?? '').replace(/\s+/g, ' ').slice(0, 300),
      platform: v.platform,
      engagement: engagementOf(v.metrics)
    }))
  ]
    .sort((a, b) => b.engagement - a.engagement);

  // Dedup per (platform, external_id): la stessa query su due superfici può restituirlo due volte.
  const unique: Candidate[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    unique.push(c);
    if (unique.length >= KEEP_PER_RUN * 2) break; // il doppio: il giudice di rilevanza ne scarta
  }

  // Un post molto visto può essere del campo sbagliato: la query prende quello che prende. Una sola
  // chiamata strutturata decide chi resta, così il playbook non impara da rumore.
  let kept = unique.map((c, i) => ({ c, relevance: 60, i }));
  try {
    const verdict = await aiStructured<{ keep?: Array<{ index: number; relevance: number }> }>(
      genaiClient(),
      `Brand: ${brand.name ?? ''}. Campo osservato con le query: ${topics.queries.join(' | ')}.\n\nPOST TROVATI:\n${unique.map((c, i) => `${i}. [${c.platform}] ${c.text || '(nessun testo)'}`).join('\n')}\n\nQuali di questi appartengono davvero a questo campo e possono insegnare qualcosa su COME ci si comunica dentro? Scarta il fuori tema, la pubblicità pura e i post senza contenuto.`,
      RELEVANCE_SCHEMA,
      'Sei severo: un post fuori campo che entra nel playbook insegna la cosa sbagliata a tutti i post futuri del brand.',
      'return_field_relevance'
    );
    const byIndex = new Map((verdict?.keep ?? []).map((k) => [Number(k.index), Number(k.relevance) || 0]));
    kept = unique
      .map((c, i) => ({ c, relevance: byIndex.get(i) ?? 0, i }))
      .filter((k) => k.relevance >= 50);
  } catch (e) {
    errors.push({ source: 'relevance', message: e instanceof Error ? e.message.slice(0, 200) : String(e) });
  }
  kept = kept.slice(0, KEEP_PER_RUN);
  if (!kept.length) return { found, stored: 0, linked: 0, errors };

  const { data: saved, error } = await admin
    .from('market_posts')
    .upsert(kept.map((k) => k.c.row), { onConflict: 'platform,external_id' })
    .select('id, platform, external_id');
  if (error) {
    errors.push({ source: 'store', message: error.message.slice(0, 200) });
    return { found, stored: 0, linked: 0, errors };
  }

  const idByKey = new Map((saved ?? []).map((r: AnyRec) => [`${r.platform}:${r.external_id}`, r.id as string]));
  const links = kept
    .map((k) => {
      const id = idByKey.get(k.c.key);
      return id ? { brand_id: brand.id, market_post_id: id, query: k.c.query, relevance: k.relevance } : null;
    })
    .filter(Boolean) as AnyRec[];
  if (links.length) {
    const { error: linkErr } = await admin
      .from('brand_field_posts')
      .upsert(links, { onConflict: 'brand_id,market_post_id', ignoreDuplicates: true });
    if (linkErr) errors.push({ source: 'link', message: linkErr.message.slice(0, 200) });
  }

  return { found, stored: saved?.length ?? 0, linked: links.length, errors };
}

// ── 3. Il teardown ──────────────────────────────────────────────────────────────────────────────

const TEARDOWN_SCHEMA = {
  type: 'object' as const,
  properties: {
    tone_of_voice: { type: 'string' as const, description: "L'etichetta breve del tono, in 2-5 parole: \"amico che ti avverte\", \"esperto seccato\", \"uno che ce l'ha fatta e lo racconta\"." },
    communication: { type: 'string' as const, description: 'COME parla: persona, registro, ritmo, lunghezza delle frasi, quanto si espone in prima persona. Non riassumere il contenuto.' },
    format: { type: 'string' as const, description: 'Il formato strutturale (lista numerata, screenshot + commento, prima/dopo, thread, storia in prima persona, dato + reazione…).' },
    hook_type: { type: 'string' as const, description: 'Che tipo di apertura usa e cosa promette nelle prime righe.' },
    spread_strategy: { type: 'array' as const, items: { type: 'string' as const }, description: 'Cosa ha FATTO perché girasse: le leve, non il contenuto. Es. "chiama in causa una categoria per nome", "chiude invitando a dissentire", "screenshot che si salva", "promette un seguito", "risponde a tutti nei commenti". Da 2 a 5.' },
    ragebait: { type: 'integer' as const, description: "Da 0 a 10: quanto il post si regge sull'indignazione invece che sul valore. 0 = utile e basta; 5 = opinione volutamente divisiva; 10 = provocazione costruita per far litigare la gente nei commenti. Giudica la costruzione, non l'argomento." },
    ragebait_levers: { type: 'array' as const, items: { type: 'string' as const }, description: 'Se ragebait > 3, quali leve usa: noi-contro-loro, callout con nome, hot take contro il consenso, allarme, umiliazione di una categoria. Vuoto se non ne usa.' },
    why_it_spread: { type: 'string' as const, description: 'Perché questo ha girato, legato a ciò che si vede (rapporto commenti/like, cosa fa discutere, cosa si salva). Se non è chiaro, dillo invece di inventare una teoria.' },
    transferable: { type: 'array' as const, items: { type: 'string' as const }, description: 'Da 1 a 4 mosse concrete che un altro brand potrebbe rifare nel proprio campo. Mosse, non temi.' },
    avoid: { type: 'string' as const, description: "Cosa NON copiare da qui e perché: dipende dalla persona che l'ha scritto, è a rischio legale, o funziona solo su quella piattaforma. Vuoto se non c'è niente." }
  },
  required: ['tone_of_voice', 'communication', 'format', 'hook_type', 'spread_strategy', 'ragebait', 'ragebait_levers', 'why_it_spread', 'transferable', 'avoid']
};

/**
 * Smonta i post del campo che non hanno ancora un teardown. Globale: un post smontato una volta
 * vale per ogni brand che lo guarda.
 */
export async function teardownFieldPosts(
  admin: SupabaseClient,
  brandId: string,
  limit = MAX_TEARDOWNS_PER_RUN
): Promise<number> {
  const { data: links } = await admin
    .from('brand_field_posts')
    .select('market_post_id')
    .eq('brand_id', brandId)
    .order('discovered_at', { ascending: false })
    .limit(40);
  const ids = (links ?? []).map((l) => l.market_post_id as string);
  if (!ids.length) return 0;

  const { data: done } = await admin
    .from('market_teardowns')
    .select('market_post_id')
    .in('market_post_id', ids);
  const already = new Set((done ?? []).map((d) => d.market_post_id as string));
  const todo = ids.filter((id) => !already.has(id)).slice(0, limit);
  if (!todo.length) return 0;

  const { data: posts } = await admin
    .from('market_posts')
    .select('id, platform, content, media_type, metrics, engagement, transcript, published_at')
    .in('id', todo);
  if (!posts?.length) return 0;

  const ai = genaiClient();
  let written = 0;
  for (const p of posts) {
    try {
      const metrics = (p.metrics ?? {}) as AnyRec;
      const body = String(p.content ?? '').replace(/\s+/g, ' ').slice(0, 2000);
      const spoken = p.transcript ? `\nPARLATO (trascrizione): ${String(p.transcript).replace(/\s+/g, ' ').slice(0, 1500)}` : '';
      if (!body && !spoken) continue; // niente testo, niente teardown: non si inventa

      const out = await aiStructured<AnyRec>(
        ai,
        `Un post su ${p.platform} che ha ottenuto attenzione. Smontalo.

TESTO: ${body || '(nessuna caption)'}${spoken}
NUMERI: ${JSON.stringify(metrics).slice(0, 300)} (engagement totale ${p.engagement ?? 0})
FORMATO: ${p.media_type ?? 'n/d'}

Voglio sapere come comunica e cosa ha fatto perché girasse — non di cosa parla.`,
        TEARDOWN_SCHEMA,
        'Smonti post come farebbe qualcuno che deve rifarne uno domani. Descrivi le leve, non moralizzarle, e non inventare intenzioni che il testo non mostra.',
        'return_field_teardown'
      );

      await admin.from('market_teardowns').upsert(
        {
          market_post_id: p.id,
          tone_of_voice: String(out?.tone_of_voice ?? '').slice(0, 200) || null,
          communication: String(out?.communication ?? '').slice(0, 1200) || null,
          format: String(out?.format ?? '').slice(0, 300) || null,
          hook_type: String(out?.hook_type ?? '').slice(0, 300) || null,
          spread_strategy: (Array.isArray(out?.spread_strategy) ? out.spread_strategy : []).map((s: unknown) => String(s).slice(0, 200)).slice(0, 6),
          ragebait: Math.max(0, Math.min(10, Number(out?.ragebait) || 0)),
          ragebait_levers: (Array.isArray(out?.ragebait_levers) ? out.ragebait_levers : []).map((s: unknown) => String(s).slice(0, 120)).slice(0, 6),
          why_it_spread: String(out?.why_it_spread ?? '').slice(0, 1200) || null,
          transferable: (Array.isArray(out?.transferable) ? out.transferable : []).map((s: unknown) => String(s).slice(0, 240)).slice(0, 5),
          avoid: String(out?.avoid ?? '').slice(0, 600) || null,
          model: 'structured'
        },
        { onConflict: 'market_post_id' }
      );
      written++;
    } catch (e) {
      console.warn('[market-field] teardown failed:', e instanceof Error ? e.message.slice(0, 120) : e);
    }
  }
  return written;
}

// ── 4. Il playbook di campo ─────────────────────────────────────────────────────────────────────

const PLAYBOOK_SCHEMA = {
  type: 'object' as const,
  properties: {
    summary: { type: 'string' as const, description: 'In 3-5 righe: cosa sta funzionando adesso in questo campo e cosa no. Concreto, basato sui teardown, senza frasi da report.' },
    hooks: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: { pattern: { type: 'string' as const }, example: { type: 'string' as const, description: 'Una riga vera presa dai post, accorciata.' } },
        required: ['pattern', 'example']
      },
      description: 'Da 3 a 6 pattern di apertura ricorrenti nel campo.'
    },
    tones: { type: 'array' as const, items: { type: 'string' as const }, description: 'I toni di voce che ottengono attenzione qui, 2-5.' },
    field_ragebait: { type: 'integer' as const, description: "0-10: quanto ragebait usa MEDIAMENTE questo campo, dai punteggi dei teardown. È il contesto in cui il brand decide quanto usarne." },
    moves: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          move: { type: 'string' as const, description: 'La mossa, in imperativo e concreta.' },
          why: { type: 'string' as const, description: 'Perché funziona in questo campo, legato ai post visti.' },
          howToAdapt: { type: 'string' as const, description: 'Come la fa QUESTO brand, con la sua materia. Mai copiare il testo.' },
          ragebait: { type: 'integer' as const, description: '0-10 quanto quella mossa si regge sullo scontro. Onesto: serve al brand per sapere cosa sta prendendo in mano.' }
        },
        required: ['move', 'why', 'howToAdapt', 'ragebait']
      },
      description: 'Da 3 a 6 mosse che questo brand può rifare la settimana prossima.'
    },
    avoid: { type: 'array' as const, items: { type: 'string' as const }, description: 'Cosa NON prendere da questo campo: mosse legate alla persona che le ha fatte, a rischio legale, o che i GUARDRAIL del brand escludono. Cita il guardrail quando è quello il motivo.' }
  },
  required: ['summary', 'hooks', 'tones', 'field_ragebait', 'moves', 'avoid']
};

/** Distilla i post di campo + i teardown in un playbook che il writer può usare. */
export async function buildFieldPlaybook(
  admin: SupabaseClient,
  brand: { id: string; name?: string | null }
): Promise<FieldPlaybook | null> {
  const since = new Date(Date.now() - PLAYBOOK_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const { data: links } = await admin
    .from('brand_field_posts')
    .select('market_post_id, relevance')
    .eq('brand_id', brand.id)
    .gte('discovered_at', since)
    .order('relevance', { ascending: false })
    .limit(30);
  const ids = (links ?? []).map((l) => l.market_post_id as string);
  if (ids.length < 3) return null; // sotto tre post non è un campo, è aneddotica

  const [{ data: posts }, { data: teardowns }, { data: kit }] = await Promise.all([
    admin.from('market_posts').select('id, platform, content, media_type, engagement').in('id', ids),
    admin.from('market_teardowns').select('market_post_id, tone_of_voice, communication, format, hook_type, spread_strategy, ragebait, ragebait_levers, why_it_spread, transferable, avoid').in('market_post_id', ids),
    admin.from('brand_kit').select('about, category, ai_context').eq('brand_id', brand.id).maybeSingle()
  ]);
  const tdById = new Map((teardowns ?? []).map((t) => [t.market_post_id as string, t]));
  const withTeardown = (posts ?? []).filter((p) => tdById.has(p.id as string));
  if (withTeardown.length < 3) return null;

  const evidence = withTeardown.map((p, i) => {
    const t = tdById.get(p.id as string) as AnyRec;
    return [
      `${i + 1}. [${p.platform} · engagement ${p.engagement ?? 0}] ${String(p.content ?? '').replace(/\s+/g, ' ').slice(0, 220)}`,
      `   tono: ${t.tone_of_voice ?? '?'} · formato: ${t.format ?? '?'} · hook: ${t.hook_type ?? '?'} · ragebait ${t.ragebait ?? 0}/10`,
      `   leve: ${(t.spread_strategy ?? []).join('; ') || '—'}`,
      t.why_it_spread ? `   perché ha girato: ${String(t.why_it_spread).slice(0, 220)}` : '',
      (t.transferable ?? []).length ? `   riutilizzabile: ${(t.transferable ?? []).join('; ')}` : ''
    ].filter(Boolean).join('\n');
  }).join('\n');

  const guardrails = guardrailsBlock(kit?.ai_context);

  const out = await aiStructured<AnyRec>(
    genaiClient(),
    `Brand: ${brand.name ?? ''} — ${String(kit?.about ?? '').slice(0, 400)}${kit?.category ? ` (${kit.category})` : ''}

POST CHE HANNO GIRATO NEL SUO CAMPO, GIÀ SMONTATI:
${evidence}

${guardrails ? `${guardrails}\n` : ''}
Scrivi il playbook di campo per questo brand: cosa funziona qui adesso e cosa può rifare la settimana prossima.

REGOLE:
- Le mosse sono mosse, non temi. "Apri con il numero che li spaventa" è una mossa; "parlare di costi" no.
- Sul ragebait sii concreto, non prudente: se in questo campo lo scontro funziona, dillo e spiega come si usa senza mentire e senza attaccare persone. Segna per ogni mossa quanto ne contiene, così il brand sa cosa sta prendendo in mano.
- I GUARDRAIL del brand vincono sempre: se una mossa collide con "MAI USARE" o con quello che il brand non fa, va in "avoid" citando il guardrail — non nelle mosse.
- Niente invenzioni: se i post non mostrano una cosa, non c'è.`,
    PLAYBOOK_SCHEMA,
    "Scrivi playbook che qualcuno esegue lunedì mattina. Concreto, onesto sulle leve, mai un report che descrive l'ovvio.",
    'return_field_playbook'
  );

  const playbook: FieldPlaybook = {
    summary: String(out?.summary ?? '').slice(0, 2000),
    hooks: (Array.isArray(out?.hooks) ? out.hooks : []).slice(0, 6).map((h: AnyRec) => ({
      pattern: String(h?.pattern ?? '').slice(0, 200),
      example: String(h?.example ?? '').slice(0, 200)
    })).filter((h: { pattern: string }) => h.pattern),
    tones: (Array.isArray(out?.tones) ? out.tones : []).map((t: unknown) => String(t).slice(0, 120)).slice(0, 5),
    fieldRagebait: Math.max(0, Math.min(10, Number(out?.field_ragebait) || 0)),
    moves: (Array.isArray(out?.moves) ? out.moves : []).slice(0, 6).map((m: AnyRec) => ({
      move: String(m?.move ?? '').slice(0, 240),
      why: String(m?.why ?? '').slice(0, 300),
      howToAdapt: String(m?.howToAdapt ?? '').slice(0, 300),
      ragebait: Math.max(0, Math.min(10, Number(m?.ragebait) || 0))
    })).filter((m: { move: string }) => m.move),
    avoid: (Array.isArray(out?.avoid) ? out.avoid : []).map((a: unknown) => String(a).slice(0, 240)).slice(0, 6),
    postsSeen: withTeardown.length,
    updatedAt: new Date().toISOString()
  };
  if (!playbook.summary && !playbook.moves.length) return null;

  await admin.from('brand_market_references').upsert(
    { brand_id: brand.id, field_playbook: playbook, field_updated_at: playbook.updatedAt },
    { onConflict: 'brand_id' }
  );
  return playbook;
}

// ── 5. Il blocco che entra nel prompt ───────────────────────────────────────────────────────────

/**
 * Il playbook come lo legge chi scrive. Va dentro il market brief, quindi lo ricevono già sia il
 * planner (`content-preview`) sia l'agente di produzione — senza nuovi canali di iniezione.
 */
export function formatFieldPlaybook(playbook: FieldPlaybook | null | undefined): string {
  if (!playbook) return '';
  const lines: string[] = [];
  if (playbook.summary?.trim()) lines.push(playbook.summary.trim());

  if (playbook.moves.length) {
    lines.push('MOSSE CHE FUNZIONANO IN QUESTO CAMPO (rifalle con la materia del brand, mai copiando il testo):');
    for (const m of playbook.moves) {
      lines.push(`- ${m.move} → come la fa questo brand: ${m.howToAdapt}${m.why ? ` (perché: ${m.why})` : ''} [ragebait ${m.ragebait}/10]`);
    }
  }
  if (playbook.hooks.length) {
    lines.push('APERTURE RICORRENTI NEL CAMPO:');
    for (const h of playbook.hooks) lines.push(`- ${h.pattern}${h.example ? ` — es. "${h.example}"` : ''}`);
  }
  if (playbook.tones.length) lines.push(`TONI CHE OTTENGONO ATTENZIONE QUI: ${playbook.tones.join('; ')}`);

  // Senza niente sopra, la sola temperatura sarebbe un numero senza prove: meglio nessun blocco.
  if (!lines.length) return '';

  // Il livello di ragebait del campo è un dato di contesto, non un obiettivo: il brand può salirci
  // quando lì funziona, ma deve sapere dove si sta mettendo — e i guardrail restano sopra.
  lines.push(
    `TEMPERATURA DEL CAMPO: ragebait medio ${playbook.fieldRagebait}/10. ` +
      (playbook.fieldRagebait >= 6
        ? 'Qui lo scontro funziona: puoi prendere posizione ed esporti, senza mentire e senza attaccare persone o concorrenti per nome.'
        : 'Qui lo scontro NON è la leva: alzare i toni suona fuori posto, la spinta arriva da utilità e specificità.')
  );
  if (playbook.avoid.length) lines.push(`DA NON PRENDERE: ${playbook.avoid.join('; ')}`);

  return `CAMPO DEL BRAND — cosa gira e perché (${playbook.postsSeen} post smontati):\n${lines.join('\n')}`;
}

/** Una passata completa per un brand: scopri → smonta → distilla. Non lancia mai. */
export async function runFieldWatch(
  admin: SupabaseClient,
  brand: { id: string; name?: string | null }
): Promise<{ harvest: FieldHarvest; teardowns: number; playbook: boolean }> {
  const harvest = await harvestBrandField(admin, brand).catch((e) => ({
    found: 0, stored: 0, linked: 0,
    errors: [{ source: 'harvest', message: e instanceof Error ? e.message.slice(0, 200) : String(e) }]
  }));
  const teardowns = await teardownFieldPosts(admin, brand.id).catch((error) => { swallow('teardown field posts', error); return 0; });
  const playbook = await buildFieldPlaybook(admin, brand).catch((e) => {
    console.warn('[market-field] playbook failed:', e instanceof Error ? e.message.slice(0, 120) : e);
    return null;
  });
  return { harvest, teardowns, playbook: Boolean(playbook) };
}
