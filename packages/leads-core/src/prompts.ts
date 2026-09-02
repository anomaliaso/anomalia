/**
 * Il drafter: da una conversazione trovata alla bozza che l'umano incollerà.
 *
 * I guard-rail qui dentro rispondono ai modi in cui le bozze fallivano DAVVERO nell'uso reale:
 * risposta nella lingua del brand invece che del thread, aperture di cortesia vuote, risposta al
 * titolo invece che alla domanda nel corpo, pitch non richiesto, e commenti che ripetevano quello
 * che i top comment avevano già detto.
 */
import { INTENT_RANK, type LeadIntent } from './intent';

// "Pochi ma buoni": il proprietario non riusciva a stare dietro a 6-8 bozze di commento al
// giorno. Due leve: una soglia di rilevanza più alta dei post (sotto, un commento consuma
// attenzione senza rendere) e un budget giornaliero. Il cap significa "gli N MIGLIORI del
// giorno": prima si ordina per punteggio, poi si taglia — mai first-come.
export const COMMENT_MIN_RELEVANCE = 70;

/** I migliori N commenti: soglia, poi ordine per intent e rilevanza, poi taglio al budget. */
export function selectTopComments<T extends { action: string; relevance: number; intent: LeadIntent }>(
  picked: T[],
  budget: number
): T[] {
  return picked
    .filter((p) => p.action === 'comment' && p.relevance >= COMMENT_MIN_RELEVANCE)
    // Riordinato qui dentro (anche se il chiamante già ordina): la semantica "i migliori, non i
    // primi" non deve dipendere dall'ordine di arrivo.
    .sort((a, b) => INTENT_RANK[b.intent] - INTENT_RANK[a.intent] || b.relevance - a.relevance)
    .slice(0, Math.max(0, budget));
}

export const COMMENT_SCHEMA = {
  type: 'object' as const,
  properties: {
    worth_it: { type: 'boolean' as const, description: 'false if, seeing the full thread, a brand comment would NOT genuinely help — better silence than noise.' },
    comment: { type: 'string' as const, description: "The ready-to-paste comment, in the thread's language and Reddit's register." },
    dm: { type: 'string' as const, description: "A short, PERSONAL 1:1 direct message to the POST AUTHOR — ONLY when there is genuine 1:1 value (they're explicitly seeking a solution the brand actually offers). Softer and warmer than the public comment: open by referencing THEIR specific post, be helpful first, never a hard sell or a pitch. Bring in the brand either as an insider (with a light affiliation disclosure) or as a neutral tip ('you could check e.g. https://domain.com') — no need to declare you're the founder. When you point to the site, use the full https:// URL. Empty string when a DM would feel intrusive or spammy (default to empty unless the fit is obvious). Same language as the thread. 30-90 words." }
  },
  required: ['worth_it', 'comment', 'dm']
};

export type EngagePromptArgs = {
  brandName: string;
  about: string;
  siteUrl: string;
  aiContext: string;
  sourceName: string;
  title: string;
  body: string;
  topComments: string;
  author: string;
  intent: LeadIntent;
  profileBlock: string;
  toneHint: string;
  styleHint: string;
  // Ultime riscritture dell'utente (prima→dopo): il segnale più onesto su cosa correggere.
  editPairs?: Array<{ before: string; after: string; feedback?: string }>;
};

export function buildEngagePrompt(a: EngagePromptArgs): string {
  const editBlock = a.editPairs?.length
    ? `\nHOW THE OWNER REWRITES YOUR DRAFTS (real before → after edits on this brand's recent drafts — absorb the DIFFERENCE: what they cut, the length, the tone. Apply the same taste to THIS draft; never reuse their wording, it belongs to other threads):\n${a.editPairs
        .map((p, i) => `${i + 1}. BEFORE: ${p.before}\n   AFTER: ${p.after}${p.feedback ? `\n   (owner's note: ${p.feedback})` : ''}`)
        .join('\n')}\n`
    : '';
  return `A conversation on ${a.sourceName} is rising and this brand's expertise is relevant. Draft the ONE reply the brand should post — as a knowledgeable community member, not a marketer.

REPLY LANGUAGE — ABSOLUTE RULE: write the comment AND the DM in the language of the THREAD (detect it from the thread's title and body below). The brand's language, the language of these instructions and of any style or voice material are IRRELEVANT to this choice: an English thread gets an English reply even when the brand writes its posts in Italian, and vice versa. Style instructions shape style, never language.

Brand: ${a.brandName} — ${a.about}
${a.siteUrl ? `Brand site (link it with the FULL URL exactly like this, never just the name or a bare domain): ${a.siteUrl}\n` : ''}${a.aiContext ? `Voice & expertise:\n${a.aiContext}\n` : ''}
THREAD "${a.title}":
${a.body || '(no body — title only)'}
${a.topComments ? `\nTOP COMMENTS ALREADY THERE (this is what the thread ALREADY has — never restate it):\n${a.topComments}` : ''}
${a.author ? `\nPOST AUTHOR: ${a.author} (the person you would DM 1:1).` : ''}
BUYER INTENT: ${a.intent} — 'seeking_now'/'comparing' means they asked for a solution, so naming one is welcome; 'researching' wants the explanation, not a product; 'venting' wants to be heard, so help without pointing anywhere and leave the DM empty.
${a.profileBlock ? `\n${a.profileBlock}\n` : ''}${a.toneHint}${a.styleHint}
${editBlock}
Produce TWO things: (1) the public COMMENT for the thread, and (2) a private DM to the post author — but ONLY draft a DM when there's a clear 1:1 fit (they explicitly want a solution the brand offers). If a DM would be intrusive, return an empty dm.

HARD RULES (survival + Italian hidden-advertising law):
- ANSWER THE ACTUAL QUESTION: the title is a headline; the real ask (their constraints, budget, what they already tried) lives in the body. When body and title diverge, answer the body.
- NO FILLER OPENERS: never start with "Great question", "Interesting point", or a restatement of their post. The first sentence already carries the substance.
- ADD VALUE BEYOND THE THREAD: when a top comment above already gives the core advice, do not repeat it — acknowledge it in passing ("someone already mentioned X") and contribute the piece it misses: a nuance, a trade-off, a concrete next step. If you have nothing beyond what's already there, set worth_it=false — better silence than an echo.
- WRITE FOR THE ROOM: when a COMMUNITY PROFILE is above, it wins over generic instinct — use the exact words from its vocabulary line, respect its rules line (what gets removed), and match the shape its tone line describes. Do not repeat advice its "already tried" line says they were burned by.
- VALUE FIRST: actually answer the thread with the brand's real expertise.
- NO UNSOLICITED PITCH: mention the brand ONLY when the buyer intent above says they asked for a solution (seeking_now/comparing) or the thread explicitly asks for recommendations. For 'researching' and 'venting', help without pointing anywhere.
- NEVER PROMISE WHAT IS NOT THERE: describe only what the brand context above actually says the product does. If the thread needs something it does not do, say so plainly or say nothing — an overpromise in public costs more than a missed lead.
- TWO WAYS to bring in the brand — pick whichever fits the thread naturally:
  (a) INSIDER: speak as someone who works on it, with an explicit disclosure ("Disclosure: I work on X" / "Trasparenza: ci lavoro io"). Use when a first-person "we built this" is the honest framing.
  (b) NEUTRAL TIP: recommend it as ONE example/resource among options, third person, no founder claim ("you could check e.g. ${a.siteUrl || 'the site'}"). Use for broadly-useful advice where naming yourself would feel heavy. Never pose as an unaffiliated fan hyping it — a neutral pointer is fine, a disguised hard sell is not.
  You do NOT have to say "I'm the founder" every time; mention the brand ONLY when it genuinely answers the question.
- When you DO point to the brand, write the WEBSITE as the full URL${a.siteUrl ? ` (${a.siteUrl})` : ''} — never just the name, never a bare domain without https://.
- PLATFORM REGISTER: Reddit → plain, first person, no hashtags; Threads → conversational, like talking to a friend; X → ONE sharp reply under 280 characters. Never marketing phrasing or emoji spam.
- COMMENT: 60-150 words. DM: 30-90 words, warmer and personal, opens by referencing THEIR post, helpful-not-salesy — empty when a cold DM would feel spammy.`;
}
