import { describe, it, expect } from 'vitest';
import { formatFieldPlaybook, isFieldFresh, type FieldPlaybook } from './market-field';

const playbook = (over: Partial<FieldPlaybook> = {}): FieldPlaybook => ({
  summary: 'Nel campo gira chi mostra il conto, non chi promette il risultato.',
  hooks: [{ pattern: 'apre con il numero che fa male', example: 'Ho perso 4.000€ in tre mesi' }],
  tones: ['uno che ce l\'ha fatta e lo racconta'],
  fieldRagebait: 3,
  moves: [
    { move: 'Apri con il numero che li spaventa', why: 'i post con la cifra in prima riga tengono', howToAdapt: 'usa il costo di un preventivo dimenticato', ragebait: 2 }
  ],
  avoid: ['callout con nome dei concorrenti'],
  postsSeen: 7,
  updatedAt: new Date().toISOString(),
  ...over
});

describe('formatFieldPlaybook', () => {
  it('rende le mosse con il loro livello di ragebait — chi scrive deve sapere cosa prende in mano', () => {
    const out = formatFieldPlaybook(playbook());
    expect(out).toContain('7 post smontati');
    expect(out).toContain('Apri con il numero che li spaventa');
    expect(out).toContain('ragebait 2/10');
    expect(out).toContain('DA NON PRENDERE');
  });

  it('dice al writer che qui lo scontro NON è la leva quando il campo è freddo', () => {
    const out = formatFieldPlaybook(playbook({ fieldRagebait: 2 }));
    expect(out).toContain('ragebait medio 2/10');
    expect(out).toContain('NON è la leva');
  });

  it('dà il permesso di esporsi quando il campo vive di scontro — senza mentire né attaccare persone', () => {
    const out = formatFieldPlaybook(playbook({ fieldRagebait: 8 }));
    expect(out).toContain('lo scontro funziona');
    expect(out).toContain('senza mentire');
    expect(out).not.toContain('NON è la leva');
  });

  it('è vuoto senza playbook, così nessun blocco vuoto entra nel prompt', () => {
    expect(formatFieldPlaybook(null)).toBe('');
    expect(formatFieldPlaybook(undefined)).toBe('');
  });

  it('non rende un blocco fatto della sola temperatura: un numero senza prove non entra nel prompt', () => {
    const empty = playbook({ summary: '', moves: [], hooks: [], tones: [], avoid: [] });
    expect(formatFieldPlaybook(empty)).toBe('');
  });

  it('rende comunque le mosse quando manca il sommario', () => {
    const out = formatFieldPlaybook(playbook({ summary: '' }));
    expect(out).toContain('MOSSE CHE FUNZIONANO');
  });
});

describe('isFieldFresh', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  it('è fresco dentro la finestra e stantio fuori', () => {
    expect(isFieldFresh(daysAgo(2))).toBe(true);
    expect(isFieldFresh(daysAgo(9))).toBe(false);
    expect(isFieldFresh(daysAgo(20), 30)).toBe(true);
  });

  it('tratta il mai-scritto e le date impossibili come stantii, mai come freschi', () => {
    expect(isFieldFresh(null)).toBe(false);
    expect(isFieldFresh(undefined)).toBe(false);
    expect(isFieldFresh('non una data')).toBe(false);
    // Una data futura significa orologio sballato o riga scritta male: rigenerare è il male minore.
    expect(isFieldFresh(new Date(Date.now() + 86_400_000).toISOString())).toBe(false);
  });
});
