import { describe, it, expect } from 'vitest';
import { estimateBlogMonth, articlesAffordable } from './blog-cost';
import { creditQuota } from './credits';

// This estimate decides whether a month job is allowed to start. Two properties matter more than the
// exact number: it must never UNDER-estimate (a job that starts and dies halfway leaves half the
// month as empty placeholders), and it must stay well inside the plan quota it gates — otherwise the
// button is permanently refused and the feature is dead on arrival.
describe('estimateBlogMonth', () => {
  it('quotes a batch month of 30 articles at a fraction of the starter quota', () => {
    const e = estimateBlogMonth({ articles: 30 });
    expect(e.credits).toBeGreaterThan(0);
    // Sanity: the whole point of batch + Nano Banana 2 is that a full month fits comfortably.
    expect(e.credits).toBeLessThan(creditQuota('starter') / 2);
  });

  // Il preventivo teneva le tariffe DeepSeek ($0.14/$0.28 per 1M) dopo che il lavoro era tornato
  // su Gemini Flash ($1.50/$7.50): un mese di testo veniva quotato ~31 crediti invece di ~500, e il
  // gate lasciava partire mesi che sarebbero morti a metà. Se questo numero torna piccolo, il
  // preventivo ha ripreso a prezzare un modello che non scrive più niente.
  it('prezza il testo sul modello che lo scrive davvero, non su tariffe di un altro provider', () => {
    const e = estimateBlogMonth({ articles: 30 });
    expect(e.breakdown.text).toBeGreaterThan(200);
    // Le immagini non sono più la voce dominante — con Gemini Flash le due sono dello stesso ordine
    // di grandezza — ma il batch resta la leva più grossa su cui il preventivo può agire.
    expect(e.breakdown.images).toBeGreaterThan(e.breakdown.text / 4);
  });

  it('scales linearly in the article count', () => {
    const ten = estimateBlogMonth({ articles: 10 }).usd;
    const thirty = estimateBlogMonth({ articles: 30 }).usd;
    expect(thirty).toBeCloseTo(ten * 3, 5);
  });

  it('adds translations without images — they reuse the originals', () => {
    const plain = estimateBlogMonth({ articles: 30 });
    const translated = estimateBlogMonth({ articles: 30, translationsPerArticle: 3 });
    expect(translated.translations).toBe(90);
    expect(translated.breakdown.images).toBe(plain.breakdown.images);
    // Cheap enough to be a plan perk rather than a metered add-on — that's the design claim.
    expect(translated.breakdown.translations).toBeLessThan(plain.breakdown.images);
  });

  it('a full Pro month with all translations still fits the Pro quota', () => {
    const e = estimateBlogMonth({ articles: 30, translationsPerArticle: 3 });
    expect(e.credits).toBeLessThan(creditQuota('pro'));
  });

  it('rounds credits UP, so the quote is never below what the job spends', () => {
    const e = estimateBlogMonth({ articles: 1 });
    expect(e.credits).toBeGreaterThanOrEqual(e.usd * 100);
    expect(Number.isInteger(e.credits)).toBe(true);
  });

  it('is zero for zero articles and ignores negative/fractional input', () => {
    expect(estimateBlogMonth({ articles: 0 }).credits).toBe(0);
    expect(estimateBlogMonth({ articles: -5 }).credits).toBe(0);
    expect(estimateBlogMonth({ articles: 2.7 }).articles).toBe(2);
  });

  it('treats a negative translation count as none', () => {
    expect(estimateBlogMonth({ articles: 5, translationsPerArticle: -2 }).translations).toBe(0);
  });
});

// `estimateBlogMonth` esisteva per non far partire un mese che non può finire, ma era collegato al
// solo bottone manuale: il percorso automatico pianificava per quota, senza guardare il costo. È
// esattamente il guasto che questo file dice di voler impedire — 14 articoli scritti e 16 vuoti.
describe('articlesAffordable', () => {
  it('taglia il mese a quello che i crediti coprono', () => {
    const perArticle = estimateBlogMonth({ articles: 1 }).credits;
    expect(articlesAffordable(10, perArticle * 4)).toBe(4);
  });

  it('non pianifica più di quanti ne sono richiesti', () => {
    const perArticle = estimateBlogMonth({ articles: 1 }).credits;
    expect(articlesAffordable(3, perArticle * 100)).toBe(3);
  });

  it('con crediti insufficienti per uno solo, zero', () => {
    expect(articlesAffordable(10, 0)).toBe(0);
  });

  it('senza budget noto non taglia niente: nessun vincolo inventato', () => {
    expect(articlesAffordable(10, null)).toBe(10);
  });

  it('tiene conto delle traduzioni, che si pagano per articolo', () => {
    const budget = estimateBlogMonth({ articles: 4 }).credits;
    expect(articlesAffordable(10, budget, { translationsPerArticle: 3 })).toBeLessThan(4);
  });
});
