import { describe, it, expect } from 'vitest';
import { estimateBlogMonth } from './blog-cost';
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

  it('prices fast mode above batch mode — batch is the 50% image discount', () => {
    const batch = estimateBlogMonth({ articles: 30, mode: 'batch' });
    const fast = estimateBlogMonth({ articles: 30, mode: 'fast' });
    expect(fast.credits).toBeGreaterThan(batch.credits);
    // Solo le immagini cambiano fra i due modi, quindi fast sta sotto il doppio di batch.
    expect(fast.credits).toBeLessThan(batch.credits * 2);
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
    const e = estimateBlogMonth({ articles: 30, mode: 'fast', translationsPerArticle: 3 });
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
