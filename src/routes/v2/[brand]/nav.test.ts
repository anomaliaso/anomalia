import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { NAV_PATHS, navFor } from './nav';

const nav = (pathname: string, pending = 0) => navFor('demo', pathname, pending);
const labels = (pathname: string) => nav(pathname).map((item) => item.label);
const current = (pathname: string) => nav(pathname).filter((i) => i.current).map((i) => i.label);

describe('la barra laterale', () => {
  it('ha le cinque voci del mockup, e una sola per il calendario', () => {
    expect(labels('/v2/demo')).toEqual(['Home', 'Materials', 'Strategy', 'Calendar', 'Results']);
  });

  it('non porta a una pagina che non esiste', () => {
    expect(NAV_PATHS.length).toBe(5);

    for (const path of NAV_PATHS) {
      expect(`${path} → +page.svelte`).toBe(
        existsSync(`src/routes/v2/[brand]${path}/+page.svelte`)
          ? `${path} → +page.svelte`
          : `${path} → 404`
      );
    }
  });

  it('accende la voce della pagina aperta', () => {
    expect(current('/v2/demo/calendar')).toEqual(['Calendar']);
    expect(current('/v2/demo/materials')).toEqual(['Materials']);
  });

  it('accende Home solo sulla home', () => {
    expect(current('/v2/demo')).toEqual(['Home']);
    expect(current('/v2/demo/results')).toEqual(['Results']);
  });

  it('non confonde una rotta che comincia allo stesso modo', () => {
    expect(current('/v2/demo/calendar-archive')).toEqual([]);
  });

  it('mette il conteggio da approvare solo sul calendario', () => {
    const badges = nav('/v2/demo', 4).map((item) => [item.label, item.badge]);

    expect(badges).toEqual([
      ['Home', 0],
      ['Materials', 0],
      ['Strategy', 0],
      ['Calendar', 4],
      ['Results', 0]
    ]);
  });
});
