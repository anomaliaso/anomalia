import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchesCron, defaultManifest } from './sidecar.mjs';

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi);

test('wildcard matches any date', () => {
  assert.equal(matchesCron('* * * * *', at(2026, 8, 25, 13, 7)), true);
  assert.equal(matchesCron('* * 1 1 *', at(2026, 8, 25, 13, 7)), false);
});

test('steps match only multiples of the step', () => {
  assert.equal(matchesCron('*/10 * * * *', at(2026, 8, 25, 9, 0)), true);
  assert.equal(matchesCron('*/10 * * * *', at(2026, 8, 25, 9, 30)), true);
  assert.equal(matchesCron('*/10 * * * *', at(2026, 8, 25, 9, 31)), false);
  assert.equal(matchesCron('*/1 * * * *', at(2026, 8, 25, 9, 44)), true);
});

test('range with step stays inside the range', () => {
  const expr = '0 9-17/3 * * *';
  assert.equal(matchesCron(expr, at(2026, 8, 25, 9, 0)), true);
  assert.equal(matchesCron(expr, at(2026, 8, 25, 12, 0)), true);
  assert.equal(matchesCron(expr, at(2026, 8, 25, 15, 0)), true);
  assert.equal(matchesCron(expr, at(2026, 8, 25, 18, 0)), false);
  assert.equal(matchesCron(expr, at(2026, 8, 25, 13, 0)), false);
});

test('lists match any listed value', () => {
  const expr = '0 8,12,16,20 * * *';
  assert.equal(matchesCron(expr, at(2026, 8, 25, 16, 0)), true);
  assert.equal(matchesCron(expr, at(2026, 8, 25, 14, 0)), false);
  assert.equal(matchesCron('30 5,17 * * *', at(2026, 8, 25, 5, 30)), true);
  assert.equal(matchesCron('30 5,17 * * *', at(2026, 8, 25, 6, 30)), false);
});

test('day-of-week restricts to the given weekday', () => {
  assert.equal(matchesCron('0 8 * * 1', at(2026, 8, 3, 8, 0)), true);
  assert.equal(matchesCron('0 8 * * 1', at(2026, 8, 4, 8, 0)), false);
  assert.equal(matchesCron('0 6 * * 0', at(2026, 8, 23, 6, 0)), true);
  assert.equal(matchesCron('0 6 * * 0', at(2026, 8, 24, 6, 0)), false);
});

test('restricted dom and dow fire on either match (vixie rule)', () => {
  const expr = '0 0 1 * 1';
  assert.equal(matchesCron(expr, at(2026, 8, 1, 0, 0)), true);
  assert.equal(matchesCron(expr, at(2026, 8, 3, 0, 0)), true);
  assert.equal(matchesCron(expr, at(2026, 8, 4, 0, 0)), false);
});

test('invalid expressions throw', () => {
  assert.throws(() => matchesCron('* * * *', new Date()), SyntaxError);
  assert.throws(() => matchesCron('61 * * * *', new Date()), RangeError);
  assert.throws(() => matchesCron('5/2 * * * *', new Date()), SyntaxError);
});

const DIVERGENZE_MOTIVATE = [
  {
    path: '/api/v1/chat/models/sync',
    solo: 'vercel',
    perche: 'popola il catalogo modelli della chat hosted; la chat sta venendo smantellata e nessuno ha ancora deciso se al self-hosted serva'
  }
];

test('i due pianificatori schedulano gli stessi cron, salvo le divergenze motivate', () => {
  const crons = JSON.parse(readFileSync('vercel.json', 'utf8')).crons ?? [];
  const soloSu = (piattaforma) =>
    DIVERGENZE_MOTIVATE.filter((d) => d.solo === piattaforma).map((d) => d.path);

  const vercelPaths = crons.map((job) => job.path);
  const sidecarPaths = defaultManifest.map((job) => job.path);

  assert.deepEqual(
    sidecarPaths.filter((path) => !vercelPaths.includes(path)).sort(),
    soloSu('sidecar').sort(),
    'cron nel sidecar e non in vercel.json: spegnili anche qui, o dichiarali in DIVERGENZE_MOTIVATE'
  );
  assert.deepEqual(
    vercelPaths.filter((path) => !sidecarPaths.includes(path)).sort(),
    soloSu('vercel').sort(),
    'cron in vercel.json e non nel sidecar: aggiungili qui, o dichiarali in DIVERGENZE_MOTIVATE'
  );

  const sidecarSchedule = Object.fromEntries(defaultManifest.map((job) => [job.path, job.schedule]));
  for (const job of crons) {
    if (soloSu('vercel').includes(job.path)) continue;
    assert.equal(sidecarSchedule[job.path], job.schedule, `cadenza divergente per ${job.path}`);
  }
});

test('embedded manifest mirrors vercel.json schedules on known dates', () => {
  const scheduleOf = Object.fromEntries(defaultManifest.map((job) => [job.path, job.schedule]));
  assert.equal(scheduleOf['/api/v1/market-references/tick'], '30 10 * * 1');
  assert.equal(scheduleOf['/api/v1/backlinks/external/tick'], '0 */6 * * *');
  assert.equal(scheduleOf['/api/v1/radar/tick'], '0 8,12,16,20 * * *');

  assert.equal(matchesCron(scheduleOf['/api/v1/market-references/tick'], at(2026, 8, 3, 10, 30)), true);
  assert.equal(matchesCron(scheduleOf['/api/v1/market-references/tick'], at(2026, 8, 4, 10, 30)), false);
  assert.equal(matchesCron(scheduleOf['/api/v1/backlinks/external/tick'], at(2026, 8, 25, 12, 0)), true);
  assert.equal(matchesCron(scheduleOf['/api/v1/backlinks/external/tick'], at(2026, 8, 25, 11, 0)), false);
  assert.equal(matchesCron(scheduleOf['/api/v1/radar/tick'], at(2026, 8, 25, 20, 0)), true);
  assert.equal(matchesCron(scheduleOf['/api/v1/radar/tick'], at(2026, 8, 25, 21, 0)), false);

  for (const job of defaultManifest) {
    assert.doesNotThrow(() => matchesCron(job.schedule, new Date()));
    assert.match(job.path, /^\//);
  }
});
