import { datetimeInputToUtc, formatInZone, zonedClock } from '$lib/server/schedule';

/**
 * The clock every agent prompt gets.
 *
 * A model has no wall clock of its own: with nothing in context it dates "today" from whatever
 * timestamps it happens to see, and defends that guess when the user contradicts it. That is how a
 * 17:00 request to publish "oggi alle 18" came back as "18:00 is already past" and ended up a day
 * late. This block is the fix — one live, unambiguous statement of what time it is for this brand,
 * plus the rules for reading everything else against it.
 *
 * It moves every minute, so in the chat prompt it belongs in the volatile tail (see the
 * PROMPT-CACHE LAYOUT note in system-prompt.ts) next to the credit counter that already changes
 * every turn.
 */
export function buildClockSection(tz: string, now = new Date()): string {
  const c = zonedClock(tz, now);
  return `## NOW (live clock — the ONLY source of truth for the current date and time)
Brand timezone: ${c.tz} (UTC${c.offset})
Local time: ${c.weekday} ${c.date} ${c.time} (${c.localIso})
Same instant in UTC: ${c.utcIso}

TIME PLAYBOOK — read this before answering anything about "oggi", "domani", "stasera", or a clock time:
- The user speaks in brand local time. "oggi alle 18" is ${c.date}T18:00 local — never 18:00 UTC, never some other day.
- A moment is past ONLY if it is strictly before the Local time above. Right now it is ${c.time}, so any time later than ${c.time} today is still ahead: schedule it TODAY.
- Never move a request to another day on your own. If you genuinely cannot honor the time the user asked for, say why and let them choose — silently landing it tomorrow is a bug, not a fallback.
- If the user tells you your reading of the clock is wrong, re-read this block and correct yourself. It is live; your own sense of the date is not.
- Every timestamp in the database and everywhere in this prompt (scheduled_for, created_at) is UTC. Convert before reporting one to the user: local = UTC ${c.offset}.
- Scheduling tools read a bare datetime ("${c.date}T18:00") as brand local time, which is normally what you want. Append "Z" ONLY when you actually mean UTC.`;
}

export type ResolvedSchedule =
  | { utc: string; local: string }
  | { error: string; hint: string; requested_local?: string; now_local?: string };

/**
 * Resolve a datetime the model passed on the user's behalf, for any tool that schedules something.
 *
 * Anything without an explicit offset is the user's wall clock, so it is read in the brand's
 * timezone. A past time comes back with BOTH clocks spelled out: a model that believes 18:00 has
 * gone by at 17:00 can only correct itself if it is told what time it actually is — otherwise it
 * argues with the user and quietly parks the work on the next day.
 */
export function resolveScheduleInput(input: string, tz: string, now = new Date()): ResolvedSchedule {
  const utc = datetimeInputToUtc(input, tz);
  if (!utc) {
    return {
      error: `Invalid datetime: "${input}"`,
      hint: `Pass the brand-local wall clock, e.g. "2026-08-08T18:00" (${tz}). Add Z only for a real UTC instant.`
    };
  }
  if (Date.parse(utc) <= now.getTime()) {
    const clock = zonedClock(tz, now);
    return {
      error: 'requested time is in the past',
      requested_local: `${formatInZone(utc, tz)} (${tz})`,
      now_local: `${clock.date} ${clock.time} (${tz})`,
      hint: 'Times are brand local. Pick a moment after now_local — and if what the user asked for is still ahead today, keep it today instead of moving it to another day.'
    };
  }
  return { utc, local: `${formatInZone(utc, tz)} (${tz})` };
}
