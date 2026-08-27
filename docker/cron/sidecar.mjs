import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MINUTE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

const FIELD_SPECS = [
  { key: 'minute', min: 0, max: 59 },
  { key: 'hour', min: 0, max: 23 },
  { key: 'dayOfMonth', min: 1, max: 31 },
  { key: 'month', min: 1, max: 12 },
  { key: 'dayOfWeek', min: 0, max: 6, sundaySeven: true },
];

export const defaultManifest = [
  { path: '/api/v1/agent-files', schedule: '0 3 * * *' },
  { path: '/api/v1/autopilot/tick', schedule: '0 6 * * *' },
  { path: '/api/v1/autopilot/digest/tick', schedule: '0 8 * * *' },
  { path: '/api/v1/weekly-recap/tick', schedule: '0 8 * * 1' },
  { path: '/api/v1/analytics/review/tick', schedule: '0 8 * * *' },
  { path: '/api/v1/ads/tick', schedule: '0 5 * * *' },
  { path: '/api/v1/radar/tick', schedule: '0 8,12,16,20 * * *' },
  { path: '/api/v1/radar/work', schedule: '*/2 * * * *' },
  { path: '/api/v1/radar/recap', schedule: '0 9 * * *' },
  { path: '/api/v1/geo/tick', schedule: '0 7 * * 1' },
  { path: '/api/v1/geo/reprobe/tick', schedule: '0 8 * * *' },
  { path: '/api/v1/gsc/tick', schedule: '0 6 * * *' },
  { path: '/api/v1/seo/ranks/tick', schedule: '0 6 * * 0' },
  { path: '/api/v1/seo/crawl/tick', schedule: '0 12 * * *' },
  { path: '/api/v1/backlinks/external/tick', schedule: '0 */6 * * *' },
  { path: '/api/v1/seo/keywords/tick', schedule: '0 9 * * 1' },
  { path: '/api/v1/seo/review/tick', schedule: '0 10 * * 1' },
  { path: '/api/v1/seo/links/tick', schedule: '0 11 * * 2' },
  { path: '/api/v1/market-references/tick', schedule: '30 10 * * 1' },
  { path: '/api/v1/library/tick', schedule: '0 11 * * *' },
  { path: '/api/v1/blog/publish-due', schedule: '*/5 * * * *' },
  { path: '/api/v1/posts/prepublish/tick', schedule: '*/5 * * * *' },
  { path: '/api/v1/blog/month/work', schedule: '*/2 * * * *' },
  { path: '/api/v1/lifecycle/tick', schedule: '*/10 * * * *' },
  { path: '/api/v1/knowledge/work', schedule: '*/2 * * * *' },
  { path: '/api/v1/knowledge/sources/work', schedule: '0 */6 * * *' },
  { path: '/api/v1/onboarding/steps/work', schedule: '*/2 * * * *' },
  { path: '/api/v1/chat/queue/work', schedule: '*/2 * * * *' },
  { path: '/api/v1/custom-agents/tick', schedule: '*/5 * * * *' },
  { path: '/api/v1/health/costs/tick', schedule: '0 4 * * *' },
  { path: '/api/v1/health/accounts/tick', schedule: '30 5 * * *' },
  { path: '/api/v1/analytics/visual/tick', schedule: '0 7 * * 2' },
  { path: '/api/v1/videos/render/work', schedule: '*/1 * * * *' },
  { path: '/api/v1/designer/work', schedule: '*/2 * * * *' },
  { path: '/api/v1/benchmark/tick', schedule: '15 * * * *' },
  { path: '/api/v1/market/harvest', schedule: '40 6 * * *' },
  { path: '/api/v1/market/field', schedule: '50 6 * * *' },
  { path: '/api/v1/leads/outcomes', schedule: '20 7 * * *' },
  { path: '/api/v1/market/trends', schedule: '20 */4 * * *' },
  { path: '/api/v1/webhooks/work', schedule: '*/10 * * * *' },
  { path: '/api/v1/billing/reconcile/tick', schedule: '0 3 * * *' },
  { path: '/api/v1/memory/dream', schedule: '30 4 * * *' },
  { path: '/api/v1/agents/computers/sweep', schedule: '*/5 * * * *' },
];

function parseNumber(token, spec) {
  if (!/^\d+$/.test(token)) throw new RangeError(`invalid ${spec.key} value "${token}"`);
  const value = Number(token);
  const normalized = spec.sundaySeven && value === 7 ? 0 : value;
  if (normalized < spec.min || normalized > spec.max) {
    throw new RangeError(`${spec.key} ${value} outside ${spec.min}-${spec.max}`);
  }
  return normalized;
}

function parseRange(raw, spec) {
  if (raw === '*') return { lo: spec.min, hi: spec.max };
  if (raw.includes('-')) {
    const [loRaw, hiRaw] = raw.split('-');
    const lo = parseNumber(loRaw, spec);
    const hi = parseNumber(hiRaw, spec);
    if (lo > hi) throw new RangeError(`invalid ${spec.key} range "${raw}"`);
    return { lo, hi };
  }
  const value = parseNumber(raw, spec);
  return { lo: value, hi: value };
}

function parseField(raw, spec) {
  const values = new Set();
  for (const part of raw.split(',')) {
    const pieces = part.split('/');
    if (pieces.length > 2) throw new SyntaxError(`too many "/" in ${spec.key} "${part}"`);
    const [rangeRaw, stepRaw] = pieces;
    if (stepRaw !== undefined && rangeRaw !== '*' && !rangeRaw.includes('-')) {
      throw new SyntaxError(`step needs "*" or "a-b" in ${spec.key} "${part}"`);
    }
    const step = stepRaw === undefined ? 1 : parseNumber(stepRaw, spec);
    if (step < 1) throw new RangeError(`step must be >= 1 in ${spec.key} "${part}"`);
    const { lo, hi } = parseRange(rangeRaw, spec);
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

function parseCron(expression) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== FIELD_SPECS.length) {
    throw new SyntaxError(`expected ${FIELD_SPECS.length} fields in "${expression}", got ${fields.length}`);
  }
  const parsed = FIELD_SPECS.map((spec, i) => ({
    values: parseField(fields[i], spec),
    fullRange: fields[i] === '*',
  }));
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parsed;
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function dayMatches({ dayOfMonth, dayOfWeek }, date) {
  const domOk = dayOfMonth.values.has(date.getDate());
  const dowOk = dayOfWeek.values.has(date.getDay());
  if (dayOfMonth.fullRange && dayOfWeek.fullRange) return true;
  if (dayOfMonth.fullRange) return dowOk;
  if (dayOfWeek.fullRange) return domOk;
  return domOk || dowOk;
}

export function matchesCron(expression, date) {
  const cron = parseCron(expression);
  return (
    cron.minute.values.has(date.getMinutes()) &&
    cron.hour.values.has(date.getHours()) &&
    cron.month.values.has(date.getMonth() + 1) &&
    dayMatches(cron, date)
  );
}

function readConfig() {
  const appUrl = (process.env.APP_URL ?? '').replace(/\/+$/, '');
  if (!appUrl) {
    console.error('APP_URL is required, e.g. APP_URL=https://021.app');
    process.exit(1);
  }
  const insecure = process.env.ALLOW_INSECURE_CRON === '1';
  const secret = process.env.CRON_SECRET;
  if (!insecure && !secret) {
    console.error('CRON_SECRET is required unless ALLOW_INSECURE_CRON=1');
    process.exit(1);
  }
  return { appUrl, headers: secret ? { authorization: `Bearer ${secret}` } : {} };
}

function loadJobs() {
  const manifestPath = process.env.CRON_MANIFEST_PATH;
  let manifest = defaultManifest;
  if (manifestPath) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  }
  if (!Array.isArray(manifest)) throw new TypeError('manifest must be a JSON array');
  for (const job of manifest) {
    if (typeof job.path !== 'string' || !job.path.startsWith('/')) {
      throw new TypeError(`manifest entry needs a relative path starting with "/": ${JSON.stringify(job)}`);
    }
    parseCron(job.schedule);
  }
  return manifest;
}

async function fire(job, appUrl, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(appUrl + job.path, { headers, signal: controller.signal });
    console.log(`${new Date().toISOString()} ${job.path} ${response.status} ${Date.now() - startedAt}ms`);
  } catch (error) {
    const reason = error.cause?.code ?? error.name ?? 'ERROR';
    console.log(`${new Date().toISOString()} ${job.path} ERROR ${reason} ${Date.now() - startedAt}ms`);
  } finally {
    clearTimeout(timer);
  }
}

function sleepUntilNextMinute() {
  return new Promise((resolve) => {
    setTimeout(resolve, MINUTE_MS - (Date.now() % MINUTE_MS));
  });
}

async function runLoop(config, jobs) {
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  console.log(`cron sidecar: ${jobs.length} jobs -> ${config.appUrl}`);
  for (;;) {
    await sleepUntilNextMinute();
    const now = new Date();
    const due = jobs.filter((job) => matchesCron(job.schedule, now));
    await Promise.all(due.map((job) => fire(job, config.appUrl, config.headers)));
  }
}

function selftest() {
  const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi);
  const cases = [
    ['* * * * *', at(2026, 8, 25, 13, 7), true],
    ['*/15 * * * *', at(2026, 8, 25, 13, 7), false],
    ['*/15 * * * *', at(2026, 8, 25, 13, 15), true],
    ['*/15 * * * *', at(2026, 8, 25, 13, 0), true],
    ['0 9-17/3 * * *', at(2026, 8, 25, 12, 0), true],
    ['0 9-17/3 * * *', at(2026, 8, 25, 13, 0), false],
    ['0 9-17/3 * * *', at(2026, 8, 25, 18, 0), false],
    ['30 10 * * 1', at(2026, 8, 3, 10, 30), true],
    ['30 10 * * 1', at(2026, 8, 3, 10, 31), false],
    ['30 10 * * 1', at(2026, 8, 4, 10, 30), false],
    ['0 8,12,16,20 * * *', at(2026, 8, 25, 12, 0), true],
    ['0 8,12,16,20 * * *', at(2026, 8, 25, 14, 0), false],
    ['0 */6 * * *', at(2026, 8, 25, 18, 0), true],
    ['0 */6 * * *', at(2026, 8, 25, 5, 0), false],
    ['0 8 * * 1', at(2026, 8, 3, 8, 0), true],
    ['0 8 * * 1', at(2026, 8, 4, 8, 0), false],
    ['0 6 * * 0', at(2026, 8, 23, 6, 0), true],
    ['0 6 * * 0', at(2026, 8, 24, 6, 0), false],
    ['0 0 1 * 1', at(2026, 8, 1, 0, 0), true],
    ['0 0 1 * 1', at(2026, 8, 3, 0, 0), true],
    ['0 0 1 * 1', at(2026, 8, 4, 0, 0), false],
    ['15 * * * *', at(2026, 8, 25, 9, 15), true],
    ['15 * * * *', at(2026, 8, 25, 9, 16), false],
    ['*/1 * * * *', at(2026, 8, 25, 9, 44), true],
    ['20 */4 * * *', at(2026, 8, 25, 4, 20), true],
    ['20 */4 * * *', at(2026, 8, 25, 4, 21), false],
    ['20 */4 * * *', at(2026, 8, 25, 5, 20), false],
    ['0 0 * * 7', at(2026, 8, 23, 0, 0), true],
  ];
  let failures = 0;
  for (const [expr, date, expected] of cases) {
    const actual = matchesCron(expr, date);
    const ok = actual === expected;
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'} matchesCron(${expr}, ${date.toISOString()}) = ${actual}, expected ${expected}`);
  }
  process.exit(failures ? 1 : 0);
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  if (process.argv.includes('--selftest')) {
    selftest();
  } else {
    runLoop(readConfig(), loadJobs()).catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
  }
}
