/**
 * Buying intent of a lead, kept SEPARATE from relevance.
 *
 * Relevance answers "can this brand say something useful here"; intent answers "is this person
 * shopping". They diverge constantly: a thread asking *which tool do you use for X* and one ranting
 * about X earn the same relevance and are not the same lead.
 *
 * Zero dependencies on purpose: it ranks the queue in the browser and scores the verdict on the
 * server, so it may never reach for a client, an env var or a plan.
 */
export const LEAD_INTENTS = ['seeking_now', 'comparing', 'researching', 'venting', 'none'] as const;
export type LeadIntent = (typeof LEAD_INTENTS)[number];

/** Queue weight: what goes to the top of /leads. */
export const INTENT_RANK: Record<LeadIntent, number> = {
  seeking_now: 4,
  comparing: 3,
  researching: 2,
  venting: 1,
  none: 0
};

export function normalizeIntent(v: unknown): LeadIntent {
  const raw = String(v ?? '').trim().toLowerCase();
  return (LEAD_INTENTS as readonly string[]).includes(raw) ? (raw as LeadIntent) : 'none';
}
