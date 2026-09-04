import { describe, it, expect } from 'vitest';
import { compact, failuresOf, reachOf, shown, type ActivityRow, type PlatformRow } from './tally';

function row(over: Partial<PlatformRow> = {}): PlatformRow {
  return {
    platform: 'instagram',
    posts: 1,
    totals: { views: 0, likes: 0, comments: 0, shares: 0 },
    ...over
  };
}

function log(over: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 'l1',
    post_id: null,
    platform: 'instagram',
    status: 'scheduled',
    caption: null,
    error: null,
    created_at: '2026-09-01T08:00:00Z',
    ...over
  };
}

describe('la copertura e la somma delle piattaforme, non di una', () => {
  it('somma ogni metrica e i post', () => {
    const total = reachOf([
      row({ posts: 3, totals: { views: 1000, likes: 40, comments: 5, shares: 2 } }),
      row({ platform: 'linkedin', posts: 2, totals: { views: 500, likes: 10, comments: 1, shares: 0 } })
    ]);

    expect(total).toEqual({ posts: 5, views: 1500, likes: 50, comments: 6, shares: 2 });
  });

  it('nessuna piattaforma non e NaN', () => {
    expect(reachOf([])).toEqual({ posts: 0, views: 0, likes: 0, comments: 0, shares: 0 });
  });

  it('una metrica mancante vale zero, non undefined', () => {
    const total = reachOf([row({ totals: { views: 10 } as PlatformRow['totals'] })]);

    expect(total.likes).toBe(0);
    expect(total.views).toBe(10);
  });
});

describe('un numero grande si legge, non si conta', () => {
  it('sotto il migliaio resta intero', () => {
    expect(compact(0)).toBe('0');
    expect(compact(950)).toBe('950');
  });

  it('sopra il migliaio si accorcia', () => {
    expect(compact(18432)).toBe('18.4K');
    expect(compact(1200000)).toBe('1.2M');
  });
});

describe('cosa conta come consegna fallita', () => {
  it('lo stato failed conta', () => {
    expect(failuresOf([log({ status: 'failed' })])).toHaveLength(1);
  });

  it("un errore registrato conta anche se lo stato non dice failed", () => {
    expect(failuresOf([log({ status: 'retrying', error: 'token expired' })])).toHaveLength(1);
  });

  it('una consegna riuscita non conta', () => {
    expect(failuresOf([log({ status: 'scheduled' }), log({ status: 'canceled' })])).toEqual([]);
  });
});

describe('si mostrano i numeri che ci sono, non quelli che si vorrebbero', () => {
  it('una metrica assente non diventa una tessera vuota', () => {
    expect(shown([{ label: 'Traffic', value: null }, { label: 'Keywords', value: 12 }])).toEqual([
      { label: 'Keywords', value: '12' }
    ]);
  });

  it('uno zero misurato e un numero, e resta', () => {
    expect(shown([{ label: 'Backlinks', value: 0 }])).toEqual([{ label: 'Backlinks', value: '0' }]);
  });

  it('i numeri grandi arrivano gia accorciati', () => {
    expect(shown([{ label: 'Traffic', value: 18432 }])).toEqual([
      { label: 'Traffic', value: '18.4K' }
    ]);
  });

  it('niente da mostrare e una lista vuota, non una sezione vuota', () => {
    expect(shown([{ label: 'Traffic', value: null }])).toEqual([]);
  });
});
