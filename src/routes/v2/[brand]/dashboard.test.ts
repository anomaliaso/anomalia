import { describe, it, expect } from 'vitest';
import { attentionLine, todos, upcoming, type DashboardFacts } from './dashboard';
import type { PostRow } from './post-state';

const NOTHING_WRONG: DashboardFacts = {
  pending: 0,
  scheduled: 4,
  published: 12,
  accounts: 2,
  hasEditorialPlan: true,
  lastRunError: null
};

function post(partial: Partial<PostRow>): PostRow {
  return {
    id: 'post-1',
    platform: 'instagram',
    platforms: null,
    caption: 'Carosello — 3 piatti dell autunno',
    media_url: null,
    slot: null,
    scheduled_for: null,
    status: 'approved',
    published_url: null,
    created_at: '2026-09-01T00:00:00.000Z',
    ...partial
  };
}

const NOW = Date.parse('2026-09-04T12:00:00.000Z');

describe('cosa richiede attenzione', () => {
  it('con tutto a posto non chiede niente', () => {
    expect(todos(NOTHING_WRONG, 'demo')).toEqual([]);
    expect(attentionLine(0)).toBe('Nothing needs you right now.');
  });

  it('conta i post da approvare e manda dove si approvano', () => {
    const [first] = todos({ ...NOTHING_WRONG, pending: 4 }, 'demo');

    expect(first.title).toBe('4 posts to approve');
    expect(first.action).toEqual({ label: 'Review', href: '/v2/demo/posts?status=pending_user' });
    expect(attentionLine(1)).toBe('1 thing needs your attention');
  });

  it('al singolare non dice "1 posts"', () => {
    expect(todos({ ...NOTHING_WRONG, pending: 1 }, 'demo')[0].title).toBe('1 post to approve');
  });

  it('non inventa un bottone per un problema che il nuovo frontend non sa ancora risolvere', () => {
    const ids = todos(
      { ...NOTHING_WRONG, accounts: 0, hasEditorialPlan: false, lastRunError: 'boom' },
      'demo'
    );

    expect(ids.map((t) => t.id)).toEqual(['channels', 'plan', 'last-run']);
    expect(ids.every((t) => t.action === null)).toBe(true);
  });

  it('riporta l errore dell ultimo giro invece di dire solo che è andato male', () => {
    const [only] = todos({ ...NOTHING_WRONG, lastRunError: 'quota exceeded' }, 'demo');

    expect(only.detail).toBe('quota exceeded');
  });
});

describe('le prossime uscite', () => {
  it('tiene solo le date future, dalla più vicina', () => {
    const rows = upcoming(
      [
        post({ id: 'later', scheduled_for: '2026-09-11T07:00:00.000Z' }),
        post({ id: 'past', scheduled_for: '2026-09-01T07:00:00.000Z' }),
        post({ id: 'sooner', scheduled_for: '2026-09-08T07:00:00.000Z' })
      ],
      'Europe/Rome',
      NOW
    );

    expect(rows.map((r) => r.id)).toEqual(['sooner', 'later']);
  });

  it('non mostra come prossima uscita un post già pubblicato', () => {
    const rows = upcoming(
      [post({ id: 'gone', status: 'published', scheduled_for: '2026-09-10T07:00:00.000Z' })],
      'Europe/Rome',
      NOW
    );

    expect(rows).toEqual([]);
  });

  it('accetta uno slot senza orario, perché una bozza datata è comunque una uscita', () => {
    const rows = upcoming([post({ id: 'slotted', slot: '2026-09-09' })], 'Europe/Rome', NOW);

    expect(rows.map((r) => r.id)).toEqual(['slotted']);
  });

  it('lascia fuori le bozze senza nessuna data', () => {
    expect(upcoming([post({ id: 'undated' })], 'Europe/Rome', NOW)).toEqual([]);
  });

  it('si ferma a cinque righe: è un riepilogo, non il calendario', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      post({ id: `p${i}`, scheduled_for: `2026-09-${10 + i}T07:00:00.000Z` })
    );

    expect(upcoming(many, 'Europe/Rome', NOW).length).toBe(5);
  });

  it('dà a ogni riga giorno, piattaforma, titolo e stato leggibile', () => {
    const [row] = upcoming(
      [post({ platforms: ['instagram', 'linkedin'], scheduled_for: '2026-09-08T07:00:00.000Z' })],
      'Europe/Rome',
      NOW
    );

    expect(row.day).toBe('Tue 08');
    expect(row.platform).toBe('instagram · linkedin');
    expect(row.title).toBe('Carosello — 3 piatti dell autunno');
    expect(row.state.label).toBe('Approved');
  });
});
