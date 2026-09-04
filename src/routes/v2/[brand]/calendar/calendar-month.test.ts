import { describe, it, expect } from 'vitest';
import {
  buildMonthGrid,
  distributionNote,
  momentInZone,
  stateOf,
  timeInZone
} from './calendar-month';
import type { CalendarPost } from './calendar-month';

const ROME = 'Europe/Rome';

function post(overrides: Partial<CalendarPost> & { id: string }): CalendarPost {
  return {
    platform: 'instagram',
    caption: 'copy',
    media_url: null,
    scheduled_for: null,
    status: 'pending_user',
    slot: null,
    ...overrides
  };
}

describe('buildMonthGrid', () => {
  it('parte di lunedì e chiude di domenica, coprendo tutto il mese', () => {
    const { weeks } = buildMonthGrid(2026, 8, [], ROME);

    expect(weeks[0][0].date).toBe('2026-07-27');
    expect(weeks.at(-1)?.at(-1)?.date).toBe('2026-09-06');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('marca fuori mese i giorni di riporto', () => {
    const { weeks } = buildMonthGrid(2026, 8, [], ROME);
    const days = weeks.flat();

    expect(days.find((d) => d.date === '2026-07-31')?.inMonth).toBe(false);
    expect(days.find((d) => d.date === '2026-08-01')?.inMonth).toBe(true);
    expect(days.filter((d) => d.inMonth)).toHaveLength(31);
  });

  it('un post di fine mese cade sul giorno del brand, non su quello UTC', () => {
    const late = post({ id: 'a', scheduled_for: '2026-08-31T23:30:00Z', status: 'scheduled' });

    const { weeks, undated } = buildMonthGrid(2026, 8, [late], ROME);
    const days = weeks.flat();

    expect(days.find((d) => d.date === '2026-09-01')?.posts).toEqual([late]);
    expect(days.find((d) => d.date === '2026-08-31')?.posts).toEqual([]);
    expect(undated).toEqual([]);
  });

  it('un mese che chiude di domenica mostra comunque il giorno oltre il bordo', () => {
    const midnight = post({ id: 'x', scheduled_for: '2026-05-31T23:30:00Z', status: 'scheduled' });

    const { weeks, undated } = buildMonthGrid(2026, 5, [midnight], ROME);

    expect(weeks.flat().find((d) => d.date === '2026-06-01')?.posts).toEqual([midnight]);
    expect(undated).toEqual([]);
  });

  it('una bozza senza data resta fuori dalla griglia invece di finire su oggi', () => {
    const draft = post({ id: 'b', isDraft: true });

    const { weeks, undated } = buildMonthGrid(2026, 8, [draft], ROME);

    expect(undated).toEqual([draft]);
    expect(weeks.flat().every((d) => d.posts.length === 0)).toBe(true);
  });

  it('uno slot datato piazza un post che non ha scheduled_for', () => {
    const slotted = post({ id: 'c', scheduled_for: null, slot: '2026-08-14', status: 'approved' });

    const { weeks, undated } = buildMonthGrid(2026, 8, [slotted], ROME);

    expect(weeks.flat().find((d) => d.date === '2026-08-14')?.posts).toEqual([slotted]);
    expect(undated).toEqual([]);
  });

  it('uno slot ricorrente non è una data e non inventa un giorno', () => {
    const recurring = post({ id: 'd', slot: 'Mon 09:00', isDraft: true });

    const { undated } = buildMonthGrid(2026, 8, [recurring], ROME);

    expect(undated).toEqual([recurring]);
  });

  it('ordina i post dello stesso giorno per orario', () => {
    const late = post({ id: 'late', scheduled_for: '2026-08-14T16:00:00Z' });
    const early = post({ id: 'early', scheduled_for: '2026-08-14T07:00:00Z' });

    const { weeks } = buildMonthGrid(2026, 8, [late, early], ROME);

    expect(weeks.flat().find((d) => d.date === '2026-08-14')?.posts.map((p) => p.id)).toEqual([
      'early',
      'late'
    ]);
  });
});

describe('stateOf', () => {
  it('solo un post pending_user si può approvare', () => {
    expect(stateOf('pending_user').canApprove).toBe(true);
    expect(stateOf('approved').canApprove).toBe(false);
    expect(stateOf('scheduled').canApprove).toBe(false);
    expect(stateOf('published').canApprove).toBe(false);
  });

  it('un post pubblicato non si modifica', () => {
    expect(stateOf('published').canEdit).toBe(false);
    expect(stateOf('pending_user').canEdit).toBe(true);
  });

  it('uno status sconosciuto non concede niente', () => {
    const unknown = stateOf('teleported');

    expect(unknown.canEdit).toBe(false);
    expect(unknown.canApprove).toBe(false);
    expect(unknown.label).toBe('teleported');
  });
});

describe('orari nel fuso del brand', () => {
  it('legge l istante sull orologio del brand', () => {
    expect(timeInZone('2026-08-14T07:00:00Z', ROME)).toBe('09:00');
    expect(timeInZone('2026-08-14T07:00:00Z', 'UTC')).toBe('07:00');
  });

  it('il momento esteso nomina il fuso, così la conseguenza non è ambigua', () => {
    expect(momentInZone('2026-08-14T07:00:00Z', ROME)).toContain('09:00');
    expect(momentInZone('2026-08-14T07:00:00Z', ROME)).toContain('Europe/Rome');
  });
});

describe('distributionNote', () => {
  const now = Date.parse('2026-08-01T00:00:00Z');

  it('nomina l istante quando la data è ancora davanti', () => {
    const note = distributionNote(
      post({ id: 'a', scheduled_for: '2026-08-14T07:00:00Z' }),
      ROME,
      now
    );

    expect(note).toContain('09:00');
    expect(note).toContain('Europe/Rome');
  });

  it('non promette una data che è già passata', () => {
    const note = distributionNote(
      post({ id: 'b', scheduled_for: '2026-07-01T07:00:00Z' }),
      ROME,
      now
    );

    expect(note).not.toContain('09:00');
    expect(note).toContain('possibly right away');
  });

  it('una bozza senza data dice che può uscire subito', () => {
    expect(distributionNote(post({ id: 'c', isDraft: true }), ROME, now)).toContain(
      'possibly right away'
    );
  });
});
