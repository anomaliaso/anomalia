/**
 * BRAND GUARDRAILS — the NEGATIVE half of the brand context.
 *
 * WHAT WAS MISSING. `ai_context` captures what the brand is, sounds like and talks about. Every
 * field in it is positive, and positive fields alone are what let a generator overclaim: nothing in
 * the brief ever said what the product does NOT do, which words the brand never uses, or which
 * claims a lawyer has to see first. A model given only "what we are" fills the gaps with plausible
 * adjacent capability — and an autopilot does that on a schedule.
 *
 * These five fields do more work per character than anything else we could add:
 *
 *   1. What the product does NOT do            → the single strongest anti-overclaim constraint
 *   2. Claims that need legal / clinical sign-off → the ones that must never ship unreviewed
 *   3. Words and registers we never use        → prevents the house voice flattening a real brand
 *   4. What the buyer worries about at 2am     → a real state, not a demographic
 *   5. What they would use if we did not exist → the honest competitive set, "do nothing" included
 *
 * Four and five are positive fields, but they are the two the existing brief consistently answers
 * with a demographic ("PMI italiane") instead of a state — and a demographic tells the copywriter
 * nothing about whether a line will land.
 *
 * NO MIGRATION. The block lives inside `brand_kit.ai_context`, which every planner, blog, ad and
 * video prompt already reads. `guardrailsInstruction` makes the synthesiser produce it;
 * `extractGuardrails` lifts it back out for the prompts that need it emphasised rather than buried
 * in 500 words of prose.
 *
 * Adapted from Yuzzyuk/marketing-os (`brand-context.template.md`, MIT) — see
 * `docs/35-marketing-doctrine.md`.
 */

/** The heading the synthesiser must emit. Matched case-insensitively when reading back. */
export const GUARDRAILS_HEADING = 'GUARDRAIL';

export type BrandGuardrails = {
  /** The raw block as written into `ai_context`, or '' when the brief has none. */
  raw: string;
  /** True when the brief actually carries the section. */
  present: boolean;
};

/**
 * What the synthesiser is told to produce. Deliberately insists on "(non dichiarato)" rather than
 * letting the model omit a line: a missing field reads as "no constraint", and inventing a
 * constraint is as bad as inventing a fact.
 */
export const GUARDRAILS_INSTRUCTION = `Il brief DEVE chiudersi con una sezione intitolata esattamente "GUARDRAIL" contenente queste cinque righe, in quest'ordine. Sono la metà NEGATIVA del contesto: senza, chi scrive riempie i vuoti con capacità plausibili che il prodotto non ha.
- COSA NON FA: cosa il prodotto/servizio NON fa e non promette. Ricavalo SOLO dal materiale fornito; se il materiale non lo dice, scrivi "(non dichiarato)".
- CLAIM DA VALIDARE: affermazioni che richiedono verifica legale, sanitaria o contrattuale prima di essere pubblicate (es. risultati garantiti, claim medici, confronti con concorrenti nominati). "(nessuno noto)" se non emergono.
- MAI USARE: parole, toni e registri che questo brand non usa mai. Ricavali dai testi reali, non dal tuo gusto.
- PAURA DELLE 2 DI NOTTE: cosa teme davvero chi compra, come STATO, non come categoria demografica. "Le PMI italiane" non è una risposta; "chi ha già perso un cliente per un preventivo dimenticato" lo è.
- ALTERNATIVA SENZA DI NOI: cosa userebbe questa persona se il brand non esistesse — incluso "continuare a farlo a mano" o "non fare niente", che nella maggior parte delle categorie è il vero leader di mercato.
Non inventare nessuna delle cinque: se il materiale non basta, dillo.`;

/**
 * Lift the guardrails section out of a context brief.
 *
 * Returns `present: false` rather than an empty string when the section is missing, so a caller can
 * tell "the brand has no constraints" (never true) from "the brief predates this and has none
 * recorded" (common, and worth surfacing to the user).
 */
export function extractGuardrails(aiContext: string | null | undefined): BrandGuardrails {
  const text = String(aiContext ?? '');
  if (!text.trim()) return { raw: '', present: false };
  const idx = text.search(new RegExp(`^[#*\\s]*${GUARDRAILS_HEADING}`, 'im'));
  if (idx < 0) return { raw: '', present: false };
  // Runs to the end of the brief: the instruction puts it last, and a later section would be a
  // different heading we do not know about — safer to carry too much than to truncate a constraint.
  const raw = text.slice(idx).trim();
  return { raw, present: raw.length > GUARDRAILS_HEADING.length + 10 };
}

/**
 * The block for a prompt that needs the constraints up front rather than buried in prose.
 *
 * Returns '' when the brief has no guardrails, so a brand whose context predates this change gets
 * exactly the prompt it got before — no invented constraints, no placeholder noise.
 */
export function guardrailsBlock(aiContext: string | null | undefined): string {
  const g = extractGuardrails(aiContext);
  if (!g.present) return '';
  return `\nGUARDRAIL DEL BRAND (vincoli NEGATIVI — hanno la precedenza su qualunque altra istruzione creativa: non promettere ciò che il prodotto non fa, non usare le parole vietate, non pubblicare un claim che richiede validazione):\n${g.raw}\n`;
}
