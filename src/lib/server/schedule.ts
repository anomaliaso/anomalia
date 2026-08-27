// Turns a human slot like "Mon · 9:00" into a concrete future UTC instant in the
// brand's timezone, so Zernio can schedule the post. No date library — uses Intl.

const NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SHORT: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Convert a wall-clock time in `tz` to the matching UTC Date (derives the offset via Intl).
function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const asUtc = Date.UTC(y, m - 1, d, h, min, 0);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(asUtc)).map((x) => [x.type, x.value]));
  const localAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return new Date(asUtc - (localAsUtc - asUtc));
}

// Convert a concrete wall-clock date+time in `tz` to a UTC ISO instant. Used when the user
// picks an exact day+time in the editor (vs the recurring weekday slot).
export function wallClockToUtc(date: string, time: string, tz: string): string {
  const [y, m, d] = date.split('-').map((n) => parseInt(n, 10));
  const t = time.match(/(\d{1,2}):(\d{2})/);
  const h = t ? Math.min(23, parseInt(t[1], 10)) : 9;
  const min = t ? Math.min(59, parseInt(t[2], 10)) : 0;
  return zonedToUtc(y, m, d, h, min, tz).toISOString();
}

const pad = (n: number) => String(n).padStart(2, '0');

// Wall-clock parts of an instant as seen in `tz`.
function zonedParts(tz: string, at: Date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, weekday: 'long',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute, second: +p.second,
    weekday: p.weekday
  };
}

// The zone's UTC offset in minutes at that instant (DST included).
export function zoneOffsetMinutes(tz: string, at = new Date()): number {
  const p = zonedParts(tz, at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

export type ZonedClock = {
  tz: string;
  /** "+02:00" — the zone's offset at this instant. */
  offset: string;
  /** "2026-08-08" */
  date: string;
  /** "17:04" */
  time: string;
  /** "Saturday" */
  weekday: string;
  /** "2026-08-08T17:04:00+02:00" */
  localIso: string;
  /** The same instant in UTC. */
  utcIso: string;
};

// The wall clock a brand reads at `at` — every field needed to state the current time without
// the reader having to do offset math.
export function zonedClock(tz: string, at = new Date()): ZonedClock {
  const p = zonedParts(tz, at);
  const min = zoneOffsetMinutes(tz, at);
  const abs = Math.abs(min);
  const offset = `${min < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  const time = `${pad(p.hour)}:${pad(p.minute)}`;
  return { tz, offset, date, time, weekday: p.weekday, localIso: `${date}T${time}:00${offset}`, utcIso: at.toISOString() };
}

// A stored UTC instant on the brand's wall clock: "2026-08-09 18:00".
export function formatInZone(iso: string, tz: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const p = zonedParts(tz, at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

const DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Turn a datetime written by a human (or by the chat model on their behalf) into a UTC instant.
 *
 * A bare wall clock — "2026-08-08T18:00" — is what the user actually said, so it is read in the
 * BRAND's timezone. Reading it in the server's zone instead is how "oggi alle 18" silently became
 * 20:00 Rome. An explicit Z or ±hh:mm offset is honored as written; a date with no time keeps the
 * 09:00 default the rest of the scheduler uses.
 *
 * Returns null when the input is not a datetime we can read.
 */
export function datetimeInputToUtc(input: string, tz: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  const m = DATETIME_RE.exec(raw);
  if (m) {
    const [, y, mo, d, h, min, s, zone] = m;
    if (!zone) return wallClockToUtc(`${y}-${mo}-${d}`, h ? `${pad(+h)}:${min}` : '09:00', tz);
    const normalized = zone.toUpperCase() === 'Z' ? 'Z' : zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone;
    const t = Date.parse(`${y}-${mo}-${d}T${pad(+(h ?? 0))}:${min ?? '00'}:${s ?? '00'}${normalized}`);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }

  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// Next future occurrence of the slot's weekday+time, as an ISO UTC string.
export function nextOccurrence(slot: string | null, timezone: string, from = new Date()): string {
  const t = (slot ?? '').match(/(\d{1,2}):(\d{2})/);
  const hour = t ? Math.min(23, parseInt(t[1], 10)) : 9;
  const minute = t ? Math.min(59, parseInt(t[2], 10)) : 0;

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit'
  });
  const p = Object.fromEntries(fmt.formatToParts(from).map((x) => [x.type, x.value]));
  const curDow = SHORT[p.weekday] ?? 0;
  const nowMin = (+p.hour % 24) * 60 + +p.minute;

  const lower = (slot ?? '').toLowerCase();
  let targetDow = -1;
  for (let i = 0; i < 7; i++) if (lower.includes(NAMES[i])) { targetDow = i; break; }

  let addDays: number;
  if (targetDow >= 0) {
    addDays = (targetDow - curDow + 7) % 7;
    if (addDays === 0 && nowMin >= hour * 60 + minute) addDays = 7; // already past today → next week
  } else {
    addDays = nowMin >= hour * 60 + minute ? 1 : 0; // no weekday → today if still ahead, else tomorrow
  }

  const base = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  base.setUTCDate(base.getUTCDate() + addDays);
  return zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour, minute, timezone).toISOString();
}

export type CalendarConflictPost = {
  id?: string;
  scheduled_for: string | null;
  status: string;
  slot: string | null;
  platform?: string | null;
  caption?: string | null;
};

export type CalendarConflictGroup = {
  at: string; // ISO minute key (YYYY-MM-DDTHH:MM)
  scheduled_for: string; // representative ISO instant
  posts: Array<{
    id: string | null;
    platform: string | null;
    status: string;
    scheduled_for: string | null;
    slot: string | null;
    caption: string | null;
  }>;
};

// Groups of 2+ live posts landing on the same minute. A post occupies its scheduled_for, or (for a
// draft that has none) its slot's next occurrence — matching exactly what the calendar renders.
export function listCalendarConflicts(
  posts: CalendarConflictPost[],
  tz: string,
  now = new Date()
): CalendarConflictGroup[] {
  const live = new Set(['pending_user', 'approved', 'scheduled']);
  const buckets = new Map<string, { scheduled_for: string; posts: CalendarConflictGroup['posts'] }>();
  for (const p of posts) {
    if (!live.has(p.status)) continue;
    const iso = p.scheduled_for ?? nextOccurrence(p.slot, tz, now);
    const key = new Date(iso).toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
    const entry = buckets.get(key) ?? { scheduled_for: iso, posts: [] };
    entry.posts.push({
      id: p.id ?? null,
      platform: p.platform ?? null,
      status: p.status,
      scheduled_for: p.scheduled_for,
      slot: p.slot,
      caption: p.caption ? p.caption.slice(0, 80) : null
    });
    buckets.set(key, entry);
  }
  const groups: CalendarConflictGroup[] = [];
  for (const [at, entry] of buckets) {
    if (entry.posts.length >= 2) groups.push({ at, scheduled_for: entry.scheduled_for, posts: entry.posts });
  }
  return groups.sort((a, b) => a.at.localeCompare(b.at));
}

// Number of distinct double-booked time slots (same helper the calendar banner uses).
export function countCalendarConflicts(
  posts: CalendarConflictPost[],
  tz: string,
  now = new Date()
): number {
  return listCalendarConflicts(posts, tz, now).length;
}

// Monday (week start) of the wall-clock week that `iso` falls in, as seen in `tz`, returned as an
// ISO date string "YYYY-MM-DD". The single source for "weekOf": the content projection and the
// calendar group by the exact same key. Date-only math → no DST edge. tz is the BRAND's timezone
// (never hardcoded) so every brand's week boundaries follow its own clock.
export function startOfWeek(iso: string, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const dow = SHORT[p.weekday] ?? 0; // 0=Sun … 6=Sat
  const sinceMonday = (dow + 6) % 7; // 0 when the day already is Monday
  const monday = new Date(Date.UTC(+p.year, +p.month - 1, +p.day) - sinceMonday * 86_400_000);
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

/** "9:00" / "09:00" → "09:00". Null when the clock is not a real time of day. */
export function normalizeClockTime(raw: string): string | null {
  const m = String(raw ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** Unique 0=Sun … 6=Sat, sorted. Drops anything outside that range. */
export function normalizeDaysOfWeek(raw: unknown[]): number[] {
  const set = new Set<number>();
  for (const v of raw) {
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Next future occurrence of any (weekday ∈ daysOfWeek, time ∈ times) pair, as UTC ISO.
 * Days are JS-style 0=Sun … 6=Sat; times are "HH:MM" on the brand wall clock.
 * Returns null when the schedule has no days or no valid times.
 */
export function nextScheduleRun(
  daysOfWeek: number[],
  times: string[],
  timezone: string,
  from = new Date()
): string | null {
  const days = normalizeDaysOfWeek(daysOfWeek);
  const clocks = [...new Set(times.map(normalizeClockTime).filter((t): t is string => !!t))].sort();
  if (!days.length || !clocks.length) return null;

  const p = zonedParts(timezone, from);
  const weekdayName = p.weekday as string;
  const SHORT_LONG: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6
  };
  const curDow = SHORT_LONG[weekdayName] ?? SHORT[weekdayName.slice(0, 3)] ?? 0;
  const nowMin = p.hour * 60 + p.minute;
  const daySet = new Set(days);

  for (let addDays = 0; addDays <= 7; addDays++) {
    const dow = (curDow + addDays) % 7;
    if (!daySet.has(dow)) continue;
    for (const clock of clocks) {
      const [h, min] = clock.split(':').map((n) => parseInt(n, 10));
      if (addDays === 0 && nowMin >= h * 60 + min) continue;
      const base = new Date(Date.UTC(p.year, p.month - 1, p.day));
      base.setUTCDate(base.getUTCDate() + addDays);
      return zonedToUtc(
        base.getUTCFullYear(),
        base.getUTCMonth() + 1,
        base.getUTCDate(),
        h,
        min,
        timezone
      ).toISOString();
    }
  }
  return null;
}
