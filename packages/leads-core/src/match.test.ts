import { describe, it, expect } from 'vitest';
import { matchScore, pickMatch, shingles, normalizeForMatch, isCheckable, MATCH_THRESHOLD } from './match';

const draft =
  'Most founders overcomplicate this. Forget paid ads when you have zero traction. For the first ten users it is pure unscalable grind, search for people complaining about the exact bottleneck you solve and reply with actual help.';

describe('normalizeForMatch', () => {
  it('toglie url, punteggiatura e maiuscole — le prime cose che cambiano quando uno incolla', () => {
    expect(normalizeForMatch('Guarda https://anomalia.so — è UTILE, davvero!')).toBe('guarda è utile davvero');
  });
});

describe('shingles', () => {
  it('spezza in gruppi di tre parole', () => {
    expect([...shingles('uno due tre quattro')]).toEqual(['uno due tre', 'due tre quattro']);
  });

  it('non perde i testi più corti di una shingle', () => {
    expect([...shingles('due parole')]).toEqual(['due parole']);
    expect(shingles('').size).toBe(0);
  });
});

describe('matchScore', () => {
  it('riconosce il testo incollato tale e quale', () => {
    expect(matchScore(draft, draft)).toBe(1);
  });

  it('regge il taglio e l\'aggiunta: chi incolla riscrive', () => {
    const edited = `Ciao! ${draft.replace('Most founders overcomplicate this. ', '')} Comunque in bocca al lupo.`;
    expect(matchScore(draft, edited)).toBeGreaterThan(MATCH_THRESHOLD);
  });

  it('non confonde due commenti che parlano dello stesso tema con parole proprie', () => {
    const altro =
      'Honestly paid ads are a waste early on. Talk to users, do things that do not scale, and only then think about growth channels.';
    expect(matchScore(draft, altro)).toBeLessThan(MATCH_THRESHOLD);
  });

  it('vale zero contro il vuoto invece di dividere per zero', () => {
    expect(matchScore('', draft)).toBe(0);
    expect(matchScore(draft, '')).toBe(0);
  });
});

describe('pickMatch', () => {
  const comments = [
    { body: 'First! nothing to add here', author: 'tizio', ups: 3, replies: 0 },
    { body: `${draft} Hope it helps.`, author: 'noi', ups: 12, replies: 2, permalink: '/r/SaaS/comments/x/y/' },
    { body: 'Completely disagree with the above', author: 'caio', ups: 1, replies: 0 }
  ];

  it('trova il nostro commento per testo e riporta i suoi numeri', () => {
    const hit = pickMatch(draft, comments);
    expect(hit?.method).toBe('text');
    expect(hit?.comment.ups).toBe(12);
    expect(hit?.score).toBeGreaterThan(MATCH_THRESHOLD);
  });

  it('restituisce null quando il nostro commento non c\'è: nessun ripiego sul meno peggio', () => {
    expect(pickMatch(draft, [comments[0], comments[2]])).toBeNull();
    expect(pickMatch(draft, [])).toBeNull();
  });

  it('l\'handle dichiarato batte la somiglianza: è un\'identità, non un indizio', () => {
    // Stesso testo su due account: senza handle vincerebbe il punteggio, con handle vince chi siamo.
    const due = [
      { body: `${draft} extra`, author: 'ladro', ups: 99, replies: 9 },
      { body: draft.slice(0, 120), author: 'NoiStessi', ups: 4, replies: 1 }
    ];
    const hit = pickMatch(draft, due, { handle: 'u/noistessi' });
    expect(hit?.method).toBe('handle');
    expect(hit?.comment.ups).toBe(4);
  });
});

describe('isCheckable', () => {
  it('solo Reddit: è l\'unica superficie da cui possiamo rileggere i commenti', () => {
    expect(isCheckable('https://www.reddit.com/r/SaaS/comments/abc/def/')).toBe(true);
    expect(isCheckable('https://www.threads.net/@tizio/post/abc')).toBe(false);
    expect(isCheckable('https://www.linkedin.com/posts/abc')).toBe(false);
    expect(isCheckable('')).toBe(false);
  });
});
