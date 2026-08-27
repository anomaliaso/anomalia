import test from 'node:test';
import assert from 'node:assert/strict';
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

test('embedded manifest mirrors vercel.json schedules on known dates', () => {
  const scheduleOf = Object.fromEntries(defaultManifest.map((job) => [job.path, job.schedule]));
  assert.equal(defaultManifest.length, 43);
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
