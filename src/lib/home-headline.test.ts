import { describe, expect, it } from 'vitest';
import { homeHeadline } from './home-headline';

/**
 * La prima riga della home è UNA domanda, e quale sia dipende dallo stato del brand. Erano cinque
 * blocchi che dicevano tutto insieme; qui c'è una regola sola, in un posto solo, e i tre stati in
 * cui un brand può trovarsi sono righe di una tabella invece di `if` sparsi per il componente.
 *
 * L'ordine è il punto: quello che aspetta te viene prima di quello che è uscito, e quello che è
 * uscito prima del vuoto — perché la home deve chiedere un'azione se ce n'è una, e mostrare un
 * risultato se non c'è.
 */
const post = (id: string) => ({ id, platform: 'instagram', caption: 'c', media_url: 'u', format: null });
const pub = (id: string, at: string) => ({ id, platform: 'instagram', caption: 'c', media_url: 'u', published_at: at });

const base = {
  queue: { pending: 0, scheduled: 0, posts: [], upcoming: [], published: [] },
  blog: { pending: 0 }
};

describe('homeHeadline', () => {
  it('se qualcosa aspetta te, la domanda è quella — e porta il post con sé', () => {
    const h = homeHeadline({ ...base, queue: { ...base.queue, pending: 3, posts: [post('a'), post('b')] } });
    expect(h.kind).toBe('approve');
    expect(h.post?.id).toBe('a');
    expect(h.waiting).toBe(3);
  });

  it('un post in attesa SENZA immagine non manda la home in bianco: vale lo stesso', () => {
    const h = homeHeadline({
      ...base,
      queue: { ...base.queue, pending: 1, posts: [{ ...post('a'), media_url: null }] }
    });
    expect(h.kind).toBe('approve');
    expect(h.post?.id).toBe('a');
  });

  it('niente da approvare ma qualcosa è uscito: la domanda diventa il risultato', () => {
    const h = homeHeadline({
      ...base,
      queue: { ...base.queue, published: [pub('p1', '2026-09-10T09:00:00Z'), pub('p2', '2026-09-08T09:00:00Z')] }
    });
    expect(h.kind).toBe('published');
    expect(h.post?.id).toBe('p1');
    expect(h.recent).toBe(2);
  });

  it('un articolo da rivedere conta quanto un post: la coda non è solo social', () => {
    const h = homeHeadline({ ...base, blog: { pending: 2 } });
    expect(h.kind).toBe('approve');
    expect(h.waiting).toBe(2);
    expect(h.post).toBeNull();
  });

  it('brand nuovo: non si finge un risultato che non c’è', () => {
    const h = homeHeadline(base);
    expect(h.kind).toBe('empty');
    expect(h.post).toBeNull();
    expect(h.waiting).toBe(0);
  });

  it('quello che aspetta te viene prima di quello che è uscito', () => {
    const h = homeHeadline({
      ...base,
      queue: { ...base.queue, pending: 1, posts: [post('a')], published: [pub('p1', '2026-09-10T09:00:00Z')] }
    });
    expect(h.kind).toBe('approve');
  });
});
