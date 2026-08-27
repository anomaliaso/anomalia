import { describe, it, expect } from 'vitest';
import {
  countCalendarConflicts,
  datetimeInputToUtc,
  formatInZone,
  listCalendarConflicts,
  nextScheduleRun,
  normalizeClockTime,
  normalizeDaysOfWeek,
  zonedClock
} from './schedule';

const TZ = 'Europe/Rome';

describe('countCalendarConflicts', () => {
  it('flags two live posts booked on the same instant, once per slot', () => {
    const posts = [
      { id: 'a', scheduled_for: '2026-07-10T09:00:00Z', status: 'scheduled', slot: null },
      { id: 'b', scheduled_for: '2026-07-10T09:00:30Z', status: 'pending_user', slot: null }, // same minute
      { id: 'c', scheduled_for: '2026-07-10T11:00:00Z', status: 'scheduled', slot: null } // alone
    ];
    expect(countCalendarConflicts(posts, TZ)).toBe(1);
    const groups = listCalendarConflicts(posts, TZ);
    expect(groups).toHaveLength(1);
    expect(groups[0].posts.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('ignores published/failed posts', () => {
    const posts = [
      { scheduled_for: '2026-07-10T09:00:00Z', status: 'published', slot: null },
      { scheduled_for: '2026-07-10T09:00:00Z', status: 'failed', slot: null }
    ];
    expect(countCalendarConflicts(posts, TZ)).toBe(0);
  });

  it('collides drafts that share a slot (placed at the same next occurrence)', () => {
    const now = new Date('2026-07-06T00:00:00Z'); // a Monday
    const posts = [
      { scheduled_for: null, status: 'pending_user', slot: 'Tue · 09:00' },
      { scheduled_for: null, status: 'pending_user', slot: 'Tue · 09:00' }
    ];
    expect(countCalendarConflicts(posts, TZ, now)).toBe(1);
  });
});

describe('zonedClock', () => {
  it('reads the brand wall clock, not the server one', () => {
    // 15:00 UTC is 17:00 in Rome — the hour the "18:00 already passed" bug got wrong.
    const c = zonedClock(TZ, new Date('2026-08-08T15:00:00Z'));
    expect(c.date).toBe('2026-08-08');
    expect(c.time).toBe('17:00');
    expect(c.weekday).toBe('Saturday');
    expect(c.offset).toBe('+02:00');
    expect(c.localIso).toBe('2026-08-08T17:00:00+02:00');
    expect(c.utcIso).toBe('2026-08-08T15:00:00.000Z');
  });

  it('follows DST out of summer time', () => {
    expect(zonedClock(TZ, new Date('2026-01-15T15:00:00Z')).offset).toBe('+01:00');
    expect(zonedClock(TZ, new Date('2026-01-15T15:00:00Z')).time).toBe('16:00');
  });

  it('handles zones behind UTC and half-hour offsets', () => {
    expect(zonedClock('America/New_York', new Date('2026-08-08T15:00:00Z')).offset).toBe('-04:00');
    expect(zonedClock('Asia/Kolkata', new Date('2026-08-08T15:00:00Z')).offset).toBe('+05:30');
    expect(zonedClock('Asia/Kolkata', new Date('2026-08-08T15:00:00Z')).time).toBe('20:30');
  });

  it('reports midnight as 00:00, never 24:00', () => {
    expect(zonedClock(TZ, new Date('2026-08-07T22:00:00Z')).time).toBe('00:00');
    expect(zonedClock(TZ, new Date('2026-08-07T22:00:00Z')).date).toBe('2026-08-08');
  });
});

describe('formatInZone', () => {
  it('renders a stored UTC instant on the brand clock', () => {
    expect(formatInZone('2026-08-08T16:00:00Z', TZ)).toBe('2026-08-08 18:00');
    expect(formatInZone('2026-01-08T16:00:00Z', TZ)).toBe('2026-01-08 17:00');
  });
});

describe('datetimeInputToUtc', () => {
  it('reads a bare wall clock in the brand timezone', () => {
    // "oggi alle 18" in Rome is 16:00 UTC — not 18:00 UTC.
    expect(datetimeInputToUtc('2026-08-08T18:00', TZ)).toBe('2026-08-08T16:00:00.000Z');
    expect(datetimeInputToUtc('2026-08-08 18:00', TZ)).toBe('2026-08-08T16:00:00.000Z');
    expect(datetimeInputToUtc('2026-08-08T18:00:00', TZ)).toBe('2026-08-08T16:00:00.000Z');
  });

  it('applies the winter offset for the same wall clock', () => {
    expect(datetimeInputToUtc('2026-01-08T18:00', TZ)).toBe('2026-01-08T17:00:00.000Z');
  });

  it('honors an explicit offset or Z as written', () => {
    expect(datetimeInputToUtc('2026-08-08T18:00:00Z', TZ)).toBe('2026-08-08T18:00:00.000Z');
    expect(datetimeInputToUtc('2026-08-08T18:00:00+02:00', TZ)).toBe('2026-08-08T16:00:00.000Z');
    expect(datetimeInputToUtc('2026-08-08T18:00:00+0200', TZ)).toBe('2026-08-08T16:00:00.000Z');
  });

  it('defaults a date with no time to the 09:00 slot default', () => {
    expect(datetimeInputToUtc('2026-08-09', TZ)).toBe('2026-08-09T07:00:00.000Z');
  });

  it('returns null for input that is not a datetime', () => {
    expect(datetimeInputToUtc('domani alle 18', TZ)).toBeNull();
    expect(datetimeInputToUtc('', TZ)).toBeNull();
  });
});

describe('normalizeClockTime', () => {
  it('pads and rejects invalid clocks', () => {
    expect(normalizeClockTime('9:00')).toBe('09:00');
    expect(normalizeClockTime('18:30:00')).toBe('18:30');
    expect(normalizeClockTime('24:00')).toBeNull();
    expect(normalizeClockTime('9:60')).toBeNull();
    expect(normalizeClockTime('noon')).toBeNull();
  });
});

describe('normalizeDaysOfWeek', () => {
  it('unique sorted 0–6', () => {
    expect(normalizeDaysOfWeek([1, '3', 1, 9, 0])).toEqual([0, 1, 3]);
    expect(normalizeDaysOfWeek([])).toEqual([]);
  });
});

describe('nextScheduleRun', () => {
  it('picks the remaining time today', () => {
    // Saturday 17:00 Rome (15:00 UTC in August).
    const from = new Date('2026-08-08T15:00:00Z');
    const iso = nextScheduleRun([0, 1, 2, 3, 4, 5, 6], ['09:00', '18:00'], TZ, from);
    expect(iso).toBe('2026-08-08T16:00:00.000Z'); // 18:00 Rome
  });

  it('rolls to the next matching weekday when today is past', () => {
    const from = new Date('2026-08-08T17:00:00Z'); // Saturday 19:00 Rome
    const iso = nextScheduleRun([1, 4], ['09:00', '18:00'], TZ, from);
    expect(iso).toBe('2026-08-10T07:00:00.000Z'); // Monday 09:00 Rome
  });

  it('runs twice a week at one time', () => {
    const from = new Date('2026-08-10T07:01:00Z'); // Monday 09:01 Rome — 09:00 already passed
    const iso = nextScheduleRun([1, 4], ['09:00'], TZ, from);
    expect(iso).toBe('2026-08-13T07:00:00.000Z'); // Thursday 09:00 Rome
  });

  it('skips the weekend when only weekdays are selected', () => {
    const from = new Date('2026-08-07T20:00:00Z'); // Friday 22:00 Rome
    const iso = nextScheduleRun([1, 2, 3, 4, 5], ['08:30'], TZ, from);
    expect(iso).toBe('2026-08-10T06:30:00.000Z'); // Monday 08:30 Rome
  });

  it('returns null without days or times', () => {
    expect(nextScheduleRun([], ['09:00'], TZ)).toBeNull();
    expect(nextScheduleRun([1], [], TZ)).toBeNull();
  });
});
