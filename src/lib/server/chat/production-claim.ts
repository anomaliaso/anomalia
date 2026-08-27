/**
 * La guardia contro il lavoro dichiarato e mai fatto: se il testo del turno dichiara di AVER
 * prodotto contenuti e nessun tool del turno ha restituito un artefatto, si appende una riga di
 * correzione. Il divieto in prosa nel prompt non regge da solo — un prompt è una preferenza, e su
 * un'affermazione così gratificante da scrivere la preferenza perde.
 *
 * Bastano due prove alternative perché taccia: una tool part con un'anteprima o un id, oppure
 * contenuti creati davvero negli ultimi minuti (il turno che racconta ciò che ha prodotto prima).
 *
 * ponytail: finestra di 30 minuti sul database, non un join sui job del turno. Se la riga uscisse
 * su un recap onesto di lavoro vecchio, la strada è passare l'istante di inizio del turno e
 * confrontare gli id, non allargare la regex.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { leftATrace } from '$lib/server/chat/goal';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Part = Record<string, any>;

/** Ciò che si può PRODURRE, e quindi ciò che si può millantare. Non "piano", non "strategia". */
const EN_CLAIM =
  /\b(?:i(?:'ve| have)? (?:just )?(?:created|made|produced|generated|drafted|wrote|written|built|prepared|scheduled|published))\b([^.!?\n]{0,60}?)\b(posts?|drafts?|carousels?|reels?|videos?|clips?|articles?|images?|captions?)\b/i;
const IT_CLAIM =
  /\b(?:(?:ho|li ho|le ho) (?:appena )?(?:creat[oi]|prodott[oi]|generat[oi]|scritt[oi]|preparat[oi]|programmat[oi]|pubblicat[oi]|realizzat[oi]))\b([^.!?\n]{0,60}?)\b(post|bozz[ae]|carosell[oi]|reel|video|clip|articol[oi]|immagin[ei]|caption)\b/i;

/** Disinnesca il falso positivo: «ho creato il piano editoriale con 5 post a settimana» è vero e
 * non è una produzione. */
const PLANNING_SUBJECT = /\b(plan|planning|piano|calendar|calendario|strategy|strategia|editorial|editoriale|rubric|rubrich[ae])\b/i;

/** Il testo di questo turno dichiara di aver PRODOTTO contenuti? Deterministico, it/en. */
export function claimsProduction(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.slice(0, 8000);
  for (const re of [EN_CLAIM, IT_CLAIM]) {
    const m = re.exec(t);
    if (m && !PLANNING_SUBJECT.test(m[1] ?? '')) return true;
  }
  return false;
}

function outputHasArtifact(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false;
  const o = output as Record<string, unknown>;
  if (o.error) return false;
  for (const k of ['post_id', 'article_id', 'image_url', 'media_url', 'video_url']) {
    if (typeof o[k] === 'string' && o[k]) return true;
  }
  for (const k of ['post_ids', 'posts', 'articles', 'ids', 'created']) {
    const v = o[k];
    if (Array.isArray(v) && v.length) return true;
  }
  return false;
}

/**
 * NON è una prova l'id di un job di background: dice solo che il lavoro è PARTITO. Un turno che
 * avvia produce_week e scrive «ho creato i post» sta mentendo, di qualche minuto ma mentendo.
 */
export function turnHasArtifactProof(content: readonly Part[]): boolean {
  for (const p of content) {
    if (!p || p.type === 'text' || p.type === 'reasoning') continue;
    if (Array.isArray(p.preview) && p.preview.length) return true;
    if (outputHasArtifact(p.output)) return true;
  }
  return false;
}

export function turnText(content: readonly Part[]): string {
  return content
    .filter((p) => p?.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('\n');
}

/**
 * Il segnale duro, che non passa per le parole: un turno che non ha chiamato NESSUN tool non può
 * aver prodotto niente, quindi un file linkato lì viene da prima. Cercare la bugia nel vocabolario
 * non tiene — un agente che impara a non scriverla e continua a non produrre è peggio.
 */
const ARTIFACT_URL = /https?:\/\/[^\s)\]]+\.(?:mp4|mov|webm|png|jpe?g|webp|gif|pdf)\b/i;

/** Tutto ciò che non è testo o ragionamento è un tool. */
export function turnRanNoTool(content: readonly Part[]): boolean {
  return !content.some((p) => p && p.type !== 'text' && p.type !== 'reasoning');
}

export function idleTurnNotice(locale: string): string {
  if (locale === 'en') {
    return '\n\n_Nothing ran in this turn: no tool was called, so nothing new was produced — any file linked above already existed._';
  }
  return '\n\n_In questo turno non è girato niente: nessuno strumento è stato chiamato, quindi non è stato prodotto nulla di nuovo — i file linkati qui sopra esistevano già._';
}

/**
 * Uno strumento che ha chiesto di essere richiamato e non lo è stato: l'ancora non è il
 * vocabolario del testo, è il tool che in QUESTO turno non ha restituito niente di finito.
 */
export function refusedAndNotRetried(content: readonly Part[]): string[] {
  const bad = new Map<string, string>();
  const ok = new Set<string>();
  for (const p of content) {
    if (!p || p.type === 'text' || p.type === 'reasoning' || !p.toolName) continue;
    const out = p.output as Record<string, unknown> | null | undefined;
    const why = out && typeof out === 'object' ? out.retry ?? out.error : null;
    if (why) bad.set(p.toolName, typeof why === 'string' ? why : '');
    else if (p.output !== undefined) ok.add(p.toolName);
  }
  return [...bad]
    .filter(([name]) => !ok.has(name))
    .slice(0, 3)
    .map(([name, why]) => (why ? `${name} (${why})` : name));
}

export function refusedToolsNotice(names: string[], locale: string): string {
  const list = names.join(', ');
  if (locale === 'en') {
    return `\n\n_Did not go through in this turn: ${list}. Nothing they were asked to produce exists yet._`;
  }
  return `\n\n_Non è andato a buon fine in questo turno: ${list}. Niente di ciò che dovevano produrre esiste ancora._`;
}

/**
 * Un giro in cui nessuno strumento di SCRITTURA è riuscito non ha prodotto niente, per quante
 * letture abbia fatto e qualunque cosa dica il testo. Solo con un obiettivo aperto: altrove un
 * turno di sole letture è una risposta a una domanda, non un lavoro mancato.
 */
export function wroteNothing(content: readonly Part[]): boolean {
  const done: string[] = [];
  for (const p of content) {
    if (!p || p.type === 'text' || p.type === 'reasoning' || !p.toolName) continue;
    const out = p.output as Record<string, unknown> | null | undefined;
    if (out && typeof out === 'object' && (out.error || out.retry)) continue;
    if (p.output !== undefined) done.push(p.toolName as string);
  }
  return !leftATrace(done);
}

export function wroteNothingNotice(locale: string): string {
  if (locale === 'en') {
    return '\n\n_Nothing was written in this turn: every tool that ran was a read. Whatever is described above as created or changed does not exist yet._';
  }
  return '\n\n_In questo turno non è stato scritto niente: tutti gli strumenti usati erano letture. Quello che qui sopra risulta creato o modificato non esiste ancora._';
}

export function productionClaimNotice(locale: string): string {
  if (locale === 'en') {
    return "\n\n_Correction: no content was actually produced — nothing above exists as a post, image or article yet. What I described is the plan, not finished work. Ask me to produce it and it will appear right here as preview cards._";
  }
  return '\n\n_Correzione: non è stato prodotto davvero nessun contenuto — niente di quello che ho scritto sopra esiste ancora come post, immagine o articolo. Quello che ho descritto è il piano, non lavoro fatto. Chiedimi di produrlo e comparirà qui come schede di anteprima._';
}

/** La prova di riserva: contenuti creati davvero negli ultimi minuti su questo brand. */
export function recentPostsProbe(
  supabase: SupabaseClient,
  brandId: string,
  windowMs = 30 * 60_000
): () => Promise<boolean> {
  return async () => {
    try {
      const since = new Date(Date.now() - windowMs).toISOString();
      const { count } = await supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .gte('created_at', since);
      return (count ?? 0) > 0;
    } catch {
      // Nel dubbio si tace: una correzione sbagliata costa più di una bugia non intercettata.
      return true;
    }
  };
}

/** La riga da appendere al turno, o null. Chiamata da entrambi i motori accanto a turnLoopNotice. */
export async function unverifiedProductionClaim(opts: {
  content: readonly Part[];
  locale: string;
  /** C'è un obiettivo aperto su questo thread? Solo lì un giro di sole letture è un lavoro mancato. */
  goalOpen?: boolean;
  hasRecentArtifacts?: () => Promise<boolean>;
}): Promise<string | null> {
  const text = turnText(opts.content);
  // L'ordine conta: prima i fatti (nessun tool, tool rifiutato, nessuna scrittura), poi il testo.
  if (turnRanNoTool(opts.content) && ARTIFACT_URL.test(text)) return idleTurnNotice(opts.locale);
  const refused = refusedAndNotRetried(opts.content);
  if (refused.length) return refusedToolsNotice(refused, opts.locale);
  if (opts.goalOpen && wroteNothing(opts.content)) return wroteNothingNotice(opts.locale);
  if (!claimsProduction(text)) return null;
  if (turnHasArtifactProof(opts.content)) return null;
  if (opts.hasRecentArtifacts && (await opts.hasRecentArtifacts())) return null;
  return productionClaimNotice(opts.locale);
}
