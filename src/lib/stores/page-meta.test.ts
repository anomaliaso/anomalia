/**
 * Il topbar di una CHAT DI GRUPPO: i membri al posto del volto singolo.
 *
 * `setPageMeta` è chiamata da un `$effect` che si rilancia a ogni refresh della lista thread, e la
 * pila di avatar viene ricostruita ogni volta come array nuovo. Senza il confronto per chiavi, il
 * topbar si ridipingerebbe di continuo — con quattro avatar animati dentro, si vede.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { clearPageMeta, pageMeta, setPageMeta } from './page-meta';

const members = (n: number) =>
  ['content', 'motion', 'analyst', 'web'].slice(0, n).map((id) => ({
    id,
    name: id,
    face: 'wide',
    color: '#111111'
  }));

beforeEach(() => clearPageMeta());

describe('setPageMeta — la pila della stanza', () => {
  it('porta i membri nel topbar, con il volto singolo ancora come ripiego', () => {
    setPageMeta({
      title: 'content, motion, analyst',
      avatar: { face: 'wide', color: '#111111' },
      avatars: members(3)
    });
    const m = get(pageMeta);
    expect(m.avatars?.map((a) => a.id)).toEqual(['content', 'motion', 'analyst']);
    expect(m.avatar).toEqual({ face: 'wide', color: '#111111' });
  });

  it('stessa stanza ricostruita = STESSO oggetto: nessun ridisegno', () => {
    setPageMeta({ title: 'x', avatars: members(4) });
    const first = get(pageMeta);
    setPageMeta({ title: 'x', avatars: members(4) });
    expect(get(pageMeta)).toBe(first);
  });

  it('un membro in più (o un volto diverso) invece si vede', () => {
    setPageMeta({ title: 'x', avatars: members(2) });
    const first = get(pageMeta);
    setPageMeta({ title: 'x', avatars: members(3) });
    expect(get(pageMeta)).not.toBe(first);
    expect(get(pageMeta).avatars).toHaveLength(3);
  });

  it('lista vuota = non è una stanza: null, così il topbar torna al volto singolo', () => {
    setPageMeta({ title: 'x', avatar: { face: 'wide', color: '#111' }, avatars: [] });
    expect(get(pageMeta).avatars).toBe(null);
  });

  it('clearPageMeta svuota anche la pila (o resterebbe sulla pagina dopo)', () => {
    setPageMeta({ title: 'x', avatars: members(2) });
    clearPageMeta();
    expect(get(pageMeta).avatars).toBe(null);
    expect(get(pageMeta).title).toBe(null);
  });
});
