import { describe, expect, it } from 'vitest';
import { GUARDRAILS_INSTRUCTION, extractGuardrails, guardrailsBlock } from './brand-guardrails';

const brief = `VOCE: diretta, prima persona, niente entusiasmo.
TEMI: preventivi, gestione studio.

GUARDRAIL
- COSA NON FA: non firma i preventivi al posto tuo e non sostituisce il commercialista.
- CLAIM DA VALIDARE: qualunque promessa di recupero fatturato.
- MAI USARE: "rivoluzionario", "soluzione all-in-one", punti esclamativi.
- PAURA DELLE 2 DI NOTTE: aver perso un cliente per un preventivo dimenticato.
- ALTERNATIVA SENZA DI NOI: un foglio Excel e la memoria.`;

describe('extractGuardrails', () => {
  it('lifts the section out of a brief that has one', () => {
    const g = extractGuardrails(brief);
    expect(g.present).toBe(true);
    expect(g.raw).toContain('COSA NON FA');
    expect(g.raw).toContain('ALTERNATIVA SENZA DI NOI');
    expect(g.raw).not.toContain('TEMI:');
  });

  it('says absent rather than empty, so a pre-existing brief is distinguishable', () => {
    expect(extractGuardrails('VOCE: diretta.').present).toBe(false);
    expect(extractGuardrails('').present).toBe(false);
    expect(extractGuardrails(null).present).toBe(false);
  });

  it('finds the heading whatever markdown decoration it carries', () => {
    expect(extractGuardrails('VOCE: x\n\n## GUARDRAIL\n- COSA NON FA: niente di che').present).toBe(true);
    expect(extractGuardrails('VOCE: x\n\n**GUARDRAIL**\n- COSA NON FA: niente di che').present).toBe(true);
  });

  it('treats a heading with nothing under it as absent', () => {
    expect(extractGuardrails('VOCE: x\n\nGUARDRAIL').present).toBe(false);
  });
});

describe('guardrailsBlock', () => {
  it('marks the constraints as taking precedence over creative instructions', () => {
    const block = guardrailsBlock(brief);
    expect(block).toContain('precedenza');
    expect(block).toContain('COSA NON FA');
  });

  it('returns nothing for a brief that predates the section — no invented constraints', () => {
    expect(guardrailsBlock('VOCE: diretta.')).toBe('');
  });
});

describe('GUARDRAILS_INSTRUCTION', () => {
  it('demands all five fields and forbids inventing any of them', () => {
    for (const field of [
      'COSA NON FA',
      'CLAIM DA VALIDARE',
      'MAI USARE',
      'PAURA DELLE 2 DI NOTTE',
      'ALTERNATIVA SENZA DI NOI'
    ]) {
      expect(GUARDRAILS_INSTRUCTION).toContain(field);
    }
    expect(GUARDRAILS_INSTRUCTION).toContain('(non dichiarato)');
    expect(GUARDRAILS_INSTRUCTION).toContain('Non inventare');
  });

  it('insists the 2am fear is a state and not a demographic', () => {
    expect(GUARDRAILS_INSTRUCTION).toContain('non come categoria demografica');
  });

  it('names doing nothing as a real alternative', () => {
    expect(GUARDRAILS_INSTRUCTION).toContain('non fare niente');
  });
});
