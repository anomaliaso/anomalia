import { describe, it, expect } from 'vitest';
import { seenAfterOpening, unseenWarnings, type AppWarning } from './warnings';

const w = (id: string): AppWarning => ({
  id,
  severity: 'warning',
  title: 't',
  message: 'm'
});

describe('il badge conta solo quello che non hai visto', () => {
  it('senza segnalibro, tutto è nuovo', () => {
    expect(unseenWarnings([w('a'), w('b')], []).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('aprire il pannello azzera il badge', () => {
    const list = [w('a'), w('b')];
    const seen = seenAfterOpening(list);
    expect(unseenWarnings(list, seen)).toEqual([]);
  });

  // I tre casi che il proprietario ha nominato, uno per uno.
  it('una segnalazione ancora aperta ma già vista NON torna a ogni ricarica', () => {
    const seen = seenAfterOpening([w('no-strategy')]);
    // ricarica: la stessa lista arriva di nuovo dal server
    expect(unseenWarnings([w('no-strategy')], seen)).toEqual([]);
  });

  it('una che si risolve da sola non lascia il badge acceso a vuoto', () => {
    const seen = seenAfterOpening([w('failed-posts')]);
    expect(unseenWarnings([], seen)).toEqual([]);
  });

  it('una NUOVA riaccende il badge, e solo lei', () => {
    const seen = seenAfterOpening([w('no-strategy')]);
    const now = [w('no-strategy'), w('agent:123')];
    expect(unseenWarnings(now, seen).map((x) => x.id)).toEqual(['agent:123']);
  });

  it('il segnalibro non cresce all’infinito: tiene solo quelle presenti', () => {
    const seen = seenAfterOpening([w('a'), w('b')]);
    const later = seenAfterOpening([w('b')]);
    expect(seen).toEqual(['a', 'b']);
    expect(later).toEqual(['b']);
    // 'a' sparita e poi tornata è di nuovo nuova: è esattamente ciò che è.
    expect(unseenWarnings([w('a'), w('b')], later).map((x) => x.id)).toEqual(['a']);
  });
});
