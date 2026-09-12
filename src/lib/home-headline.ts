/**
 * La prima riga della home: UNA domanda, e quale sia dipende da com'è messo il brand.
 *
 * Prima la home apriva su cinque blocchi che dicevano tutto insieme — setup, dati, cose da fare,
 * pipeline — e chi entrava doveva decidere da solo cosa guardare. Qui c'è una regola sola: se
 * qualcosa aspetta te, quella è la domanda; se non aspetta niente ma qualcosa è uscito, la domanda
 * diventa il risultato; se non c'è né l'uno né l'altro non si finge nessuno dei due.
 *
 * I tre stati stanno in un posto solo, e l'ordine è la regola: **azione prima di risultato,
 * risultato prima di vuoto**. Sparpagliarli nel componente vorrebbe dire tre `if` che al prossimo
 * stato diventano quattro, in file diversi.
 *
 * Puro, perché è l'unica parte che si può mettere sotto test senza un browser — come `home-todos`
 * e `home-gauges` accanto.
 */
export type HeadlinePost = {
  id: string;
  platform: string | null;
  caption: string | null;
  media_url: string | null;
};

export type HomeHeadline = {
  /** `approve` = c'è una coda; `published` = è uscito qualcosa; `empty` = né l'uno né l'altro. */
  kind: 'approve' | 'published' | 'empty';
  /** Il post da mostrare accanto alla domanda. Null quando la coda è di soli articoli, o è vuota. */
  post: HeadlinePost | null;
  /** Quanti aspettano una risposta, post e articoli insieme. */
  waiting: number;
  /** Quanti sono usciti di recente. */
  recent: number;
};

type Input = {
  queue: {
    pending: number;
    posts: HeadlinePost[];
    published: Array<HeadlinePost & { published_at: string | null }>;
  };
  blog: { pending: number };
};

export function homeHeadline(overview: Input): HomeHeadline {
  const waiting = overview.queue.pending + overview.blog.pending;
  const published = overview.queue.published;

  if (waiting > 0) {
    // Il primo della coda, immagine o no: una coda di post senza foto è comunque una coda, e
    // saltarla mostrerebbe un risultato a chi ha del lavoro fermo in attesa.
    return { kind: 'approve', post: overview.queue.posts[0] ?? null, waiting, recent: published.length };
  }

  if (published.length > 0) {
    return { kind: 'published', post: published[0], waiting: 0, recent: published.length };
  }

  return { kind: 'empty', post: null, waiting: 0, recent: 0 };
}
