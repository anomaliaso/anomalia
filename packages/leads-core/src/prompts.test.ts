import { describe, it, expect } from 'vitest';
import { buildEngagePrompt, selectTopComments, COMMENT_MIN_RELEVANCE } from './prompts';

describe('buildEngagePrompt (la lingua è quella del THREAD, non del brand)', () => {
  // Brand italiano, thread inglese: il caso reale che produceva bozze in italiano su Reddit EN.
  const base = {
    brandName: 'Trattoria Bio',
    about: 'Prodotti biologici italiani, spedizione in tutta Europa.',
    siteUrl: 'https://trattoriabio.it',
    aiContext: 'Voce: diretta, concreta, italiana.',
    sourceName: 'r/organicfarming',
    title: 'What should I look for when buying organic olive oil?',
    body: 'I keep seeing conflicting labels at the store. My budget is limited. How do I know the oil is actually organic?',
    topComments: '- Look for the EU organic leaf logo',
    author: 'oliveguy',
    intent: 'researching' as const,
    profileBlock: '',
    toneHint: '\nTONE: Write in a friendly tone.',
    styleHint: '\nSTYLE INSTRUCTIONS (PRIORITY — override any conflicting rules below): Sii cinico. No emoji.'
  };

  it('pins the reply language to the thread and carries the thread text the model detects it from', () => {
    const p = buildEngagePrompt(base);
    expect(p).toContain('REPLY LANGUAGE — ABSOLUTE RULE');
    expect(p).toContain('language of the THREAD');
    // le istruzioni di stile (spesso in italiano) governano lo stile, mai la lingua
    expect(p).toContain('Style instructions shape style, never language');
    // il testo su cui rilevare la lingua è nel prompt: titolo e corpo del thread
    expect(p).toContain(base.title);
    expect(p).toContain('conflicting labels');
  });

  it('guards the known failure modes: filler openers, title-only answers, echoing the thread, unsolicited pitch', () => {
    const p = buildEngagePrompt(base);
    expect(p).toContain('NO FILLER OPENERS');
    expect(p).toContain('ANSWER THE ACTUAL QUESTION');
    expect(p).toContain('ADD VALUE BEYOND THE THREAD');
    expect(p).toContain('NO UNSOLICITED PITCH');
    // i commenti già presenti arrivano al drafter come "già detto", non come suggerimento
    expect(p).toContain('EU organic leaf logo');
    expect(p).toContain('never restate it');
  });

  it("includes the owner's recent before→after edits, and omits the block when there are none", () => {
    const withPairs = buildEngagePrompt({
      ...base,
      editPairs: [{ before: 'Bozza lunga e promozionale', after: 'Corta e utile', feedback: 'meno pitch' }]
    });
    expect(withPairs).toContain('HOW THE OWNER REWRITES YOUR DRAFTS');
    expect(withPairs).toContain('BEFORE: Bozza lunga e promozionale');
    expect(withPairs).toContain('AFTER: Corta e utile');
    expect(withPairs).toContain('meno pitch');
    // senza riscritture il drafter lavora come prima: nessun blocco vuoto nel prompt
    expect(buildEngagePrompt(base)).not.toContain('HOW THE OWNER REWRITES');
  });
});

describe('selectTopComments (il cap è "gli N migliori", non "i primi N")', () => {
  const c = (id: string, relevance: number, intent: 'seeking_now' | 'none') =>
    ({ id, action: 'comment', relevance, intent });

  it('picks by intent then relevance, regardless of arrival order', () => {
    const picked = [c('a', 72, 'none'), c('b', 90, 'none'), c('c', 71, 'seeking_now'), c('d', 99, 'none')];
    // 'c' compra adesso (batte tutti), poi 'd' per rilevanza — 'a' arrivato primo NON entra.
    expect(selectTopComments(picked, 2).map((x) => x.id)).toEqual(['c', 'd']);
  });

  it('drops below-floor comments and non-comment actions, and honours a zero budget', () => {
    const picked = [
      { id: 'p', action: 'post', relevance: 99, intent: 'none' as const },
      c('low', COMMENT_MIN_RELEVANCE - 1, 'seeking_now'),
      c('ok', 80, 'none')
    ];
    expect(selectTopComments(picked, 5).map((x) => x.id)).toEqual(['ok']);
    expect(selectTopComments(picked, 0)).toEqual([]);
  });
});
