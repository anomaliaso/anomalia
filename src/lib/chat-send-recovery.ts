/**
 * Recupero di un invio che NON è mai arrivato al server.
 *
 * La classe di bug (24/8): wifi giù nel momento del POST → fetch rigetta, la sessione veniva
 * marcata errore E completata insieme, il finalize la dismissava e il messaggio spariva
 * mostrato come inviato. Nessun errore a schermo: solo silenzio.
 */
import type { ChatSessionSnapshot } from '$lib/stores/chat-session';

/**
 * Vero quando l'errore è nato PRIMA che un solo byte arrivasse dal server: niente job id
 * (gli header non sono mai atterrati) e niente buffer streamato. In quel caso non c'è nulla
 * da fetchare né da foldare — la sessione va tenuta viva col suo banner, non finalizzata.
 * Copre sia la rete caduta sul POST sia gli errori HTTP pre-stream (402/429/500).
 */
export function isPreStreamFailure(
  snap:
    | Pick<ChatSessionSnapshot, 'error' | 'jobId' | 'streamBuf' | 'streamToolCalls'>
    | null
    | undefined
): boolean {
  return !!snap?.error && !snap.jobId && !snap.streamBuf && !snap.streamToolCalls?.length;
}

/**
 * Chiave della bozza di un deep-link `?message=` in volo — scritta prima dell'invio, cancellata
 * quando il server ha accettato il messaggio. Un refresh o un crash nella finestra in mezzo la
 * ritrova e la rimette nel composer invece di perderla (il `goto` di ensureThread distrugge
 * l'URL, e con lui il param, prima che il POST atterri). Lo storage è `$lib/chat-draft`.
 */
export const sendDraftKey = (brandSlug: string) => `anomalia:chat-send-draft:${brandSlug}`;
