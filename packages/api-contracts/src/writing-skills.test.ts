import { describe, expect, it } from 'vitest';
import { GET_WRITING_SKILLS, WRITING_DECK_AGENTS } from './writing-skills';
import { BRAND_ENDPOINTS } from './index';

describe('il contratto delle skill di scrittura', () => {
  it('è registrato, o il tool MCP non nasce', () => {
    expect(BRAND_ENDPOINTS).toContain(GET_WRITING_SKILLS);
  });

  it('è una lettura: leggere il mestiere non lo cambia', () => {
    expect(GET_WRITING_SKILLS.method).toBe('GET');
    expect(GET_WRITING_SKILLS.destructive).toBe(false);
    expect(GET_WRITING_SKILLS.openWorld).toBeUndefined();
  });

  it('si può chiamare senza argomenti: il mazzo di scrittura è il default', () => {
    expect(GET_WRITING_SKILLS.input.safeParse({}).success).toBe(true);
  });

  it('accetta solo gli agenti che hanno un mazzo', () => {
    for (const agent of WRITING_DECK_AGENTS) {
      expect(GET_WRITING_SKILLS.input.safeParse({ agent }).success, agent).toBe(true);
    }
    expect(GET_WRITING_SKILLS.input.safeParse({ agent: 'inventato' }).success).toBe(false);
  });

  it('rifiuta un parametro che non dichiara invece di scartarlo in silenzio', () => {
    expect(GET_WRITING_SKILLS.input.safeParse({ skill: 'humanizer' }).success).toBe(false);
  });

  it('dichiara il 404 del riferimento che non esiste', () => {
    expect(GET_WRITING_SKILLS.failures).toContainEqual({ error: 'reference_not_found', status: 404 });
  });

  /**
   * La descrizione è l'unica istruzione che un modello esterno riceve. Se non dice QUANDO
   * chiamarlo, non lo chiama, e la copy torna a suonare da chatbot senza che niente fallisca.
   */
  it('dice quando va chiamato, o non verrà chiamato', () => {
    expect(GET_WRITING_SKILLS.description).toContain('BEFORE WRITING');
    expect(GET_WRITING_SKILLS.description).toMatch(/no credits/i);
  });

  it('distingue una skill di prodotto da una procedura del brand', () => {
    const parsed = GET_WRITING_SKILLS.output.safeParse({
      skills: [
        { name: 'humanizer', source: 'product', description: 'x', body: 'y', references: [] },
        { name: 'lancio', source: 'brand', description: 'x', body: 'y', references: [] }
      ],
      reference: null
    });

    expect(parsed.success).toBe(true);
    expect(
      GET_WRITING_SKILLS.output.safeParse({
        skills: [{ name: 'x', source: 'inventata', description: '', body: '', references: [] }],
        reference: null
      }).success
    ).toBe(false);
  });
});
