import { aiText } from './ai-text';

// Niche thematic calendar: surface UPCOMING moments (holidays, observances, seasonal/industry
// events) a brand could authentically post around, so the planner can ride timely hooks instead of
// generating in a vacuum. One cheap Gemini call; best-effort ('' when nothing relevant).

// Pure: build the prompt. Exported for testing.
export function buildCalendarPrompt(opts: { category?: string; archetype?: string; language?: string; today: string }): string {
  const bits = [
    opts.category ? `Category: ${opts.category}.` : '',
    opts.archetype ? `Brand type: ${opts.archetype}.` : '',
    opts.language ? `Audience language/region: ${opts.language}.` : ''
  ]
    .filter(Boolean)
    .join(' ');
  return `Today is ${opts.today}. List 3-6 UPCOMING moments in roughly the next 6 weeks that THIS brand could authentically post around — relevant holidays, observances, seasonal moments, or recurring industry events. ${bits}\nFor each: the date (or window) and a one-line angle the brand could take. Only genuinely relevant, REAL, upcoming moments — skip generic filler, and never invent fake holidays. If nothing is clearly relevant, output nothing. Short bullet lines only.`;
}

// One gateway call → a compact "timely moments" block to fold into the planner. '' on failure or
// when nothing relevant. `today` defaults to the current date (override in tests). Il parametro
// client è rimasto indietro con la migrazione al centralino: resta opzionale per non toccare i
// chiamanti che ce l'hanno ancora in mano.
export async function upcomingTimelyHooks(
  opts: { category?: string; archetype?: string; language?: string; today?: string }
): Promise<string> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  try {
    const txt = (await aiText(
      buildCalendarPrompt({ ...opts, today }),
      'You surface only genuinely relevant, real upcoming calendar moments for a brand. Be concrete; never invent holidays; output nothing if nothing fits.',
      { label: 'timelyHooks' }
    )).trim();
    return txt
      ? `TIMELY MOMENTS (upcoming, relevant to this brand's niche — use where one genuinely fits; don't force them):\n${txt}`
      : '';
  } catch {
    return '';
  }
}
