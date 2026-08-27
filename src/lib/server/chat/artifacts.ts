/**
 * ARTEFATTI: quello che l'agente produce e che deve restare nella conversazione.
 *
 * Un turno di chat sa mostrare due cose: testo, e le anteprime dei post. Tutto il resto di ciò che
 * un agente produce non aveva un posto:
 *
 * - incollarlo nel testo lo fa sparire dentro un muro di caratteri (e un CSV di 300 righe incollato
 *   in chat non è un CSV, è rumore che costa contesto a ogni turno successivo);
 * - metterlo in libreria media o nella conoscenza del brand è giusto per un **asset del brand** e
 *   sbagliato per *il risultato di questa conversazione* — finisce in un archivio che non c'entra,
 *   e nella chat resta una frase che dice "l'ho salvato", da qualche parte.
 *
 * Un artefatto è la terza cosa: un file attaccato al thread, con un nome e una ragione, che
 * riaprendo la chat fra un mese è ancora lì e si scarica.
 *
 * Due proprietà che non sono negoziabili:
 *
 * 1. **Permanente davvero.** I byte stanno nel bucket privato del brand, la riga nel database vive
 *    quanto il thread. Non è una preview in memoria che muore col turno.
 * 2. **Tracciabile.** `created_by` e `tool_call_id` dicono chi l'ha fatto e con quale chiamata. Un
 *    file che compare senza sapere da dove viene è la cosa che rende un prodotto AI difficile da
 *    fidarsi, e costa niente evitarla.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'brand-knowledge';

/** Un artefatto è un risultato, non un dataset: oltre questo il posto giusto è la libreria. */
export const MAX_ARTIFACT_BYTES = 12_000_000;

/** Anteprima testuale mostrata nella card. Abbastanza da capire cos'è, non da leggerlo tutto. */
export const ARTIFACT_PREVIEW_CHARS = 1_200;

export type ArtifactKind = 'image' | 'document' | 'data' | 'code' | 'archive';

export type ChatArtifact = {
  id: string;
  thread_id: string;
  message_id: string | null;
  tool_call_id: string | null;
  title: string;
  description: string | null;
  kind: ArtifactKind;
  mime: string | null;
  file_name: string;
  storage_path: string;
  bytes: number | null;
  preview: string | null;
  created_by: string;
  source: string;
  created_at: string;
};

const EXT_KIND: Array<[RegExp, ArtifactKind]> = [
  [/\.(png|jpe?g|webp|gif|avif)$/i, 'image'],
  [/\.(csv|tsv|json|ndjson|parquet|xlsx?)$/i, 'data'],
  [/\.(py|js|mjs|ts|tsx|jsx|sh|sql|html|css|ipynb)$/i, 'code'],
  [/\.(zip|tar|gz|tgz)$/i, 'archive']
];

/** Come va MOSTRATO, non cosa contiene: la card sceglie l'icona e l'anteprima da qui. */
export function inferArtifactKind(fileName: string, mime?: string | null): ArtifactKind {
  const m = (mime ?? '').toLowerCase();
  // SVG e HTML sono markup eseguibile travestito da contenuto. Un artefatto lo scrive un modello,
  // che può averlo copiato da una pagina appena letta: `kind: 'image'` lo renderebbe inline e gli
  // darebbe un tab sul dominio dello storage. Restano file, si scaricano, non si aprono da soli.
  if (m === 'image/svg+xml' || m === 'text/html' || /\.(svg|html?)$/i.test(fileName)) return 'code';
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/zip' || m === 'application/gzip') return 'archive';
  for (const [re, kind] of EXT_KIND) if (re.test(fileName)) return kind;
  return 'document';
}

/** I formati che ha senso far vedere in chiaro sotto il titolo. Un PNG non è uno di questi. */
export function isTextualKind(kind: ArtifactKind): boolean {
  return kind === 'document' || kind === 'data' || kind === 'code';
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  md: 'text/markdown',
  txt: 'text/plain',
  html: 'text/html',
  py: 'text/x-python',
  js: 'text/javascript',
  ts: 'text/typescript',
  sql: 'application/sql',
  zip: 'application/zip',
  pdf: 'application/pdf'
};

export function mimeForFile(fileName: string, fallback = 'application/octet-stream'): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? fallback;
}

/** Nome file pulito: niente path, niente caratteri che rompono uno storage key. */
export function safeFileName(name: string, fallback = 'artifact.txt'): string {
  const base = (name ?? '').split(/[\\/]/).pop()?.trim() ?? '';
  const clean = base.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '-').slice(0, 120);
  return clean && /[\w]/.test(clean) ? clean : fallback;
}

export type PublishArtifactInput = {
  brandId: string;
  userId: string;
  threadId: string;
  title: string;
  description?: string | null;
  fileName: string;
  /** Uno dei due. `text` prende anche l'anteprima; `bytes` no (è binario). */
  text?: string;
  bytes?: Buffer;
  mime?: string | null;
  messageId?: string | null;
  toolCallId?: string | null;
  createdBy?: 'agent' | 'user';
  source?: 'chat' | 'sandbox' | 'tool';
};

export type PublishedArtifact = {
  id: string;
  title: string;
  file_name: string;
  kind: ArtifactKind;
  bytes: number;
  url: string | null;
};

/**
 * Scrive l'artefatto e restituisce come mostrarlo. Non lancia: un artefatto che non si salva è una
 * cosa da dire all'agente nel risultato del tool, non un turno da far morire.
 */
export async function publishArtifact(
  supabase: SupabaseClient,
  input: PublishArtifactInput
): Promise<{ artifact?: PublishedArtifact; error?: string }> {
  const fileName = safeFileName(input.fileName);
  const title = (input.title ?? '').trim().slice(0, 200) || fileName;
  const body = input.bytes ?? (input.text != null ? Buffer.from(input.text, 'utf8') : null);
  if (!body || !body.length) return { error: 'Empty artifact — nothing to publish.' };
  if (body.length > MAX_ARTIFACT_BYTES) {
    return { error: `Artifact is ${Math.round(body.length / 1_000_000)} MB — the ceiling is ${MAX_ARTIFACT_BYTES / 1_000_000} MB.` };
  }

  const mime = input.mime ?? mimeForFile(fileName);
  const kind = inferArtifactKind(fileName, mime);
  const storagePath = `${input.userId}/${input.brandId}/artifacts/${Date.now()}-${fileName}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, body, {
    contentType: mime,
    upsert: false
  });
  if (upErr) return { error: upErr.message };

  const preview = input.text && isTextualKind(kind) ? input.text.slice(0, ARTIFACT_PREVIEW_CHARS) : null;

  const { data, error } = await supabase
    .from('chat_artifacts')
    .insert({
      brand_id: input.brandId,
      user_id: input.userId,
      thread_id: input.threadId,
      message_id: input.messageId ?? null,
      tool_call_id: input.toolCallId ?? null,
      title,
      description: input.description?.slice(0, 1000) ?? null,
      kind,
      mime,
      file_name: fileName,
      storage_path: storagePath,
      bytes: body.length,
      preview,
      created_by: input.createdBy ?? 'agent',
      source: input.source ?? 'chat'
    })
    .select('id')
    .maybeSingle();

  if (error || !data) {
    // La riga non c'è: il file da solo è spazzatura, non un artefatto.
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    return { error: error?.message ?? 'Could not register the artifact' };
  }

  const { signKnowledgePaths } = await import('$lib/server/media-archive');
  const signed = await signKnowledgePaths(supabase, [storagePath]).catch(() => new Map<string, string>());

  return {
    artifact: {
      id: data.id as string,
      title,
      file_name: fileName,
      kind,
      bytes: body.length,
      url: signed.get(storagePath) ?? null
    }
  };
}

/** Gli artefatti di un thread, già firmati: è quello che la pagina della chat mostra. */
export async function listThreadArtifacts(
  supabase: SupabaseClient,
  threadId: string,
  /**
   * Ridondante sotto RLS con il client dell'utente, NON ridondante con quello admin: la coda gira
   * come service role, e una funzione che si fida solo di RLS diventa una fuga il giorno in cui
   * qualcuno la chiama da lì. Il filtro sta nella query, non nelle intenzioni del chiamante.
   */
  brandId: string,
  limit = 60
): Promise<Array<ChatArtifact & { url: string | null }>> {
  const { data } = await supabase
    .from('chat_artifacts')
    .select('*')
    .eq('thread_id', threadId)
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as ChatArtifact[];
  if (!rows.length) return [];

  const { signKnowledgePaths } = await import('$lib/server/media-archive');
  const signed = await signKnowledgePaths(
    supabase,
    rows.map((r) => r.storage_path)
  ).catch(() => new Map<string, string>());

  return rows.map((r) => ({ ...r, url: signed.get(r.storage_path) ?? null }));
}

/**
 * Riga per il prompt: l'agente deve sapere cosa ha già pubblicato in questo thread, altrimenti al
 * terzo turno ripubblica lo stesso report con un nome diverso.
 */
export function formatArtifactsForPrompt(rows: ChatArtifact[], max = 12): string {
  if (!rows.length) return '';
  const lines = rows.slice(0, max).map((r) => {
    const size = r.bytes ? ` (${Math.max(1, Math.round(r.bytes / 1024))} KB)` : '';
    return `- [${r.id.slice(0, 8)}] ${r.title} — \`${r.file_name}\`${size}${r.description ? ` · ${r.description.slice(0, 120)}` : ''}`;
  });
  return `## ARTEFATTI DI QUESTO THREAD (${rows.length})
Già pubblicati in questa conversazione e visibili all'utente. Non ripubblicare la stessa cosa con un altro nome: cita quello che c'è, o pubblica una versione nuova dicendo cosa cambia.
${lines.join('\n')}`;
}
