import { describe, it, expect } from 'vitest';
import { buildClockSection, resolveScheduleInput } from './clock';

const TZ = 'Europe/Rome';
/** The reported incident: the user asks at 17:00 Rome to publish "oggi alle 18". */
const AT_17 = new Date('2026-08-08T15:00:00Z');

describe('buildClockSection', () => {
  it('states the brand local time, the zone offset and the UTC instant', () => {
    const s = buildClockSection(TZ, AT_17);
    expect(s).toContain('Brand timezone: Europe/Rome (UTC+02:00)');
    expect(s).toContain('Local time: Saturday 2026-08-08 17:00 (2026-08-08T17:00:00+02:00)');
    expect(s).toContain('Same instant in UTC: 2026-08-08T15:00:00.000Z');
  });

  it('spells out that a later hour today is still ahead', () => {
    const s = buildClockSection(TZ, AT_17);
    expect(s).toContain('Right now it is 17:00, so any time later than 17:00 today is still ahead');
    expect(s).toContain('Never move a request to another day on your own');
  });

  it('names the current date in the local-time example, so "oggi" is unambiguous', () => {
    expect(buildClockSection(TZ, AT_17)).toContain('"oggi alle 18" is 2026-08-08T18:00 local');
  });
});

describe('resolveScheduleInput', () => {
  it('accepts today at 18:00 when it is 17:00 — the case that used to slip to tomorrow', () => {
    const r = resolveScheduleInput('2026-08-08T18:00', TZ, AT_17);
    expect(r).toEqual({ utc: '2026-08-08T16:00:00.000Z', local: '2026-08-08 18:00 (Europe/Rome)' });
  });

  it('rejects a past time with both clocks, so the model can correct itself', () => {
    const r = resolveScheduleInput('2026-08-08T16:00', TZ, AT_17);
    expect(r).toMatchObject({
      error: 'requested time is in the past',
      requested_local: '2026-08-08 16:00 (Europe/Rome)',
      now_local: '2026-08-08 17:00 (Europe/Rome)'
    });
  });

  it('treats a bare wall clock as brand local, not as the server UTC clock', () => {
    // Read as UTC this would be 20:00 in Rome — a silent two-hour drift.
    const r = resolveScheduleInput('2026-08-09T18:00', TZ, AT_17);
    expect(r).toMatchObject({ utc: '2026-08-09T16:00:00.000Z' });
  });

  it('still honors an explicit UTC instant', () => {
    const r = resolveScheduleInput('2026-08-09T18:00:00Z', TZ, AT_17);
    expect(r).toMatchObject({ utc: '2026-08-09T18:00:00.000Z', local: '2026-08-09 20:00 (Europe/Rome)' });
  });

  it('explains an unparseable datetime instead of scheduling something arbitrary', () => {
    const r = resolveScheduleInput('domani alle 18', TZ, AT_17);
    expect(r).toMatchObject({ error: 'Invalid datetime: "domani alle 18"' });
  });
});
