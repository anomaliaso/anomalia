import { describe, expect, it } from 'vitest';
import {
  CONTENT_SCORER_VERSION,
  bandFor,
  checkValues,
  hookOf,
  jaccard,
  normalizeText,
  scoreContentQuality,
  shingles
} from './content-quality';

const valueOf = (caption: string, id: string, extra: Parameters<typeof scoreContentQuality>[0] = { caption }) =>
  scoreContentQuality({ ...extra, caption }).checks.find((c) => c.id === id)!.value;

// A caption that passes essentially every check — the reference "good" sample used to prove the
// index can actually reach the top of the range, not just avoid the bottom.
const GOOD = `Hai perso 3 clienti questo mese e non sai perché?

Abbiamo analizzato 240 preventivi di studi come Rossi Architetti: il 68% si perde nelle 48 ore di silenzio dopo l'invio.

Un follow-up automatico a 24 ore ne recupera 1 su 4.

Scrivici in DM e ti mandiamo il template.

#studioarchitettura #preventivi #followup`;

describe('scoreContentQuality', () => {
  it('is deterministic — the same input always returns the same index', () => {
    const a = scoreContentQuality({ caption: GOOD, platform: 'instagram' });
    const b = scoreContentQuality({ caption: GOOD, platform: 'instagram' });
    expect(a.index).toBe(b.index);
    expect(a.metrics).toEqual(b.metrics);
  });

  it('scores a strong caption high', () => {
    const q = scoreContentQuality({ caption: GOOD, platform: 'instagram' });
    expect(q.index).toBeGreaterThan(75);
  });

  it('scores an empty caption 0 rather than rewarding it for having no spam', () => {
    const q = scoreContentQuality({ caption: '', platform: 'instagram' });
    expect(q.index).toBe(0);
    // The hygiene checks must not hand a broken post free points.
    expect(q.checks.every((c) => c.value === 0)).toBe(true);
  });

  it('treats a null caption like an empty one', () => {
    expect(scoreContentQuality({ caption: null }).index).toBe(0);
  });

  it('weights sum to 100 so the index is a true 0..100', () => {
    const q = scoreContentQuality({ caption: GOOD, platform: 'instagram' });
    expect(q.checks.reduce((s, c) => s + c.weight, 0)).toBe(100);
  });

  it('caps the index at 100', () => {
    const q = scoreContentQuality({ caption: GOOD, platform: 'instagram' });
    expect(q.index).toBeLessThanOrEqual(100);
  });
});

describe('hook_strength', () => {
  it('rewards a hook that names a stake and addresses the reader', () => {
    expect(valueOf('Stai perdendo il 30% dei tuoi lead. Ecco perché.', 'hook_strength')).toBeGreaterThan(0.7);
  });

  it('punishes a caption that opens by talking about the brand', () => {
    const weak = valueOf('Siamo entusiasti di annunciare il nostro nuovo servizio.', 'hook_strength');
    const strong = valueOf('Stai perdendo il 30% dei tuoi lead. Ecco perché.', 'hook_strength');
    expect(weak).toBeLessThan(strong);
    expect(weak).toBeLessThan(0.3);
  });

  it('punishes a hook that is a whole paragraph', () => {
    const long = `${'Questa è una premessa molto lunga che continua senza mai arrivare al punto '.repeat(3)}?`;
    expect(valueOf(long, 'hook_strength')).toBeLessThan(0.6);
  });

  it('reads the first non-empty line, not leading blank lines', () => {
    expect(hookOf('\n\n  Hai 3 problemi.  \nAltro testo')).toBe('Hai 3 problemi.');
  });
});

describe('ai_tells', () => {
  it('gives a clean caption full marks', () => {
    expect(valueOf('Tre preventivi persi in una settimana. Ecco cosa abbiamo cambiato.', 'ai_tells')).toBe(1);
  });

  it('penalises LLM boilerplate', () => {
    const v = valueOf('Nel mondo di oggi, scopri come portare il tuo business al livello successivo.', 'ai_tells');
    expect(v).toBeLessThan(0.5);
  });

  it('matches boilerplate regardless of accents and punctuation', () => {
    const q = scoreContentQuality({ caption: "Non è un segreto che, oggi, tutto cambi." });
    expect(q.metrics.aiTells).toContain('non e un segreto che');
  });

  it('scores by density, so one tell hurts a short caption more than a long one', () => {
    const tell = 'Le possibilità sono infinite.';
    const filler = ' Abbiamo misurato 240 preventivi e recuperato 1 cliente su 4 in 48 ore.'.repeat(8);
    expect(valueOf(tell, 'ai_tells')).toBeLessThan(valueOf(tell + filler, 'ai_tells'));
  });
});

describe('self_repetition', () => {
  const caption = 'Hai perso 3 clienti questo mese? Il follow-up automatico a 24 ore ne recupera uno su quattro.';

  it('is neutral when there is no history to compare against', () => {
    expect(scoreContentQuality({ caption }).checks.find((c) => c.id === 'self_repetition')!.value).toBe(1);
  });

  it('punishes a near-duplicate of a recent post', () => {
    const q = scoreContentQuality({ caption, recentCaptions: [caption] });
    const check = q.checks.find((c) => c.id === 'self_repetition')!;
    expect(check.value).toBeLessThan(0.2);
    expect(q.metrics.maxSimilarity).toBeGreaterThan(0.9);
  });

  it('leaves a genuinely different post alone', () => {
    const q = scoreContentQuality({
      caption,
      recentCaptions: ['Domani apriamo le iscrizioni al workshop di novembre a Bologna. 12 posti.']
    });
    expect(q.checks.find((c) => c.id === 'self_repetition')!.value).toBe(1);
  });

  it('catches reshuffled boilerplate that a word-overlap check would miss', () => {
    const original = 'Il follow-up automatico a 24 ore recupera un cliente su quattro sempre';
    const reshuffled = 'Sempre il follow-up automatico a 24 ore recupera un cliente su quattro';
    const q = scoreContentQuality({ caption: reshuffled, recentCaptions: [original] });
    expect(q.metrics.maxSimilarity).toBeGreaterThan(0.5);
  });

  it('ignores blank entries in the history', () => {
    const q = scoreContentQuality({ caption, recentCaptions: [null, '', '   ', undefined] });
    expect(q.checks.find((c) => c.id === 'self_repetition')!.value).toBe(1);
  });
});

describe('cta', () => {
  it('scores a closing CTA full marks', () => {
    expect(valueOf('Abbiamo misurato 240 preventivi. Scrivici in DM per il template.', 'cta')).toBe(1);
  });

  it('discounts a CTA buried at the top', () => {
    const v = valueOf(
      'Scrivici subito. ' + 'Poi seguono molte righe di contesto che non chiudono con nessuna azione. '.repeat(6),
      'cta'
    );
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  it('scores 0 when there is no action at all', () => {
    expect(valueOf('Oggi il cielo è azzurro e il caffè è buono.', 'cta')).toBe(0);
  });

  it('does not mistake a mid-word match for a call to action', () => {
    // "vantaggio" contains "tag", "follow-up" contains "follow" — neither is a CTA.
    expect(valueOf('Il vantaggio del follow-up automatico è il recupero dei preventivi.', 'cta')).toBe(0);
  });

  it('credits a CTA that IS the closing sentence of a short caption', () => {
    // Regression guard: reading the tail by slicing the string used to cut the marker in half.
    expect(valueOf('240 preventivi analizzati. Scrivici in DM.', 'cta')).toBe(1);
  });
});

describe('length_fit and hashtag_hygiene are platform-aware', () => {
  it('accepts on X a caption that is too short for LinkedIn', () => {
    const short = 'Il 68% dei preventivi muore nelle 48 ore di silenzio. Il follow-up a 24h ne salva uno su quattro.';
    const onX = valueOf(short, 'length_fit', { caption: short, platform: 'x' });
    const onLinkedIn = valueOf(short, 'length_fit', { caption: short, platform: 'linkedin' });
    expect(onX).toBeGreaterThan(onLinkedIn);
  });

  it('penalises Instagram hashtag stuffing', () => {
    const tags = Array.from({ length: 28 }, (_, i) => `#tag${i}`).join(' ');
    expect(valueOf(`Testo utile. ${tags}`, 'hashtag_hygiene', { caption: `Testo utile. ${tags}`, platform: 'instagram' })).toBeLessThan(0.4);
  });

  it('does not require hashtags on LinkedIn', () => {
    const c = 'Analisi di 240 preventivi: il 68% si perde in 48 ore.';
    expect(valueOf(c, 'hashtag_hygiene', { caption: c, platform: 'linkedin' })).toBe(1);
  });

  it('falls back to a default band for an unknown platform', () => {
    expect(bandFor('mastodon')).toEqual(bandFor(null));
  });
});

describe('emoji_hygiene', () => {
  it('treats no emoji as fine', () => {
    expect(valueOf('Tre preventivi persi. Ecco il fix.', 'emoji_hygiene')).toBe(1);
  });

  it('penalises an emoji wall', () => {
    expect(valueOf('Novità 🚀🔥💥✨🎉🙌💪👏🥳🤩 oggi', 'emoji_hygiene')).toBeLessThan(0.6);
  });
});

describe('readability', () => {
  it('penalises an unbroken wall of text', () => {
    const wall = 'Una frase di media lunghezza che dice qualcosa di sensato e continua. '.repeat(12);
    expect(valueOf(wall, 'readability')).toBeLessThanOrEqual(0.35);
  });
});

describe('structural_tells', () => {
  it('gives clean copy full marks', () => {
    expect(valueOf(GOOD, 'structural_tells')).toBe(1);
  });

  it('catches "non è solo X, è Y" — the most recognisable construction there is', () => {
    expect(valueOf('Non è solo un gestionale — è il motore della tua crescita.', 'structural_tells')).toBeLessThan(0.6);
    expect(valueOf("It's not just a CRM, it's a growth engine.", 'structural_tells')).toBeLessThan(0.6);
  });

  it('lets one tricolon pass and punishes the pattern', () => {
    expect(valueOf('Più veloce, più chiaro e più economico.', 'structural_tells')).toBe(1);
    const pattern = 'Più veloce, più chiaro e più economico. Progetti, preventivi e clienti. Ordine, calma e controllo.';
    expect(valueOf(pattern, 'structural_tells')).toBeLessThan(1);
  });

  it('reads the em-dash as a signature only when it repeats', () => {
    expect(valueOf('Abbiamo tagliato i tempi — del 40%.', 'structural_tells')).toBe(1);
    expect(
      valueOf('Abbiamo tagliato i tempi — del 40% — su 240 preventivi — misurati a marzo.', 'structural_tells')
    ).toBeLessThan(1);
  });

  it('catches a rhetorical question the copy answers itself', () => {
    expect(valueOf('Esiste un modo migliore? Esiste.', 'structural_tells')).toBeLessThan(1);
  });

  it('catches hedged claims that should be flat', () => {
    expect(valueOf('Può aiutarti a ridurre i costi potenzialmente fino al 30%.', 'structural_tells')).toBeLessThan(0.8);
  });

  it('catches a benefit with no mechanism and clears one that has it', () => {
    expect(valueOf('Risparmia tempo ogni settimana.', 'structural_tells')).toBeLessThan(1);
    expect(valueOf('Risparmia tempo abbinando in automatico i preventivi ai clienti.', 'structural_tells')).toBe(1);
  });

  it('catches an audience named by demographic and clears one named by state', () => {
    expect(valueOf('Il gestionale per le PMI.', 'structural_tells')).toBeLessThan(1);
    expect(valueOf('Per gli studi che inseguono ancora i preventivi via email.', 'structural_tells')).toBe(1);
  });

  it('catches a reassuring close that restates without adding', () => {
    expect(
      valueOf('Abbiamo tagliato del 40% i tempi di risposta. Ed è questo che fa la differenza.', 'structural_tells')
    ).toBeLessThan(1);
  });

  it('halves the STYLE penalties for a formal register but never the emptiness ones', () => {
    const styleTell = 'Esiste un modo migliore? Esiste.';
    const casual = scoreContentQuality({ caption: styleTell }).checks.find((c) => c.id === 'structural_tells')!.value;
    const formal = scoreContentQuality({ caption: styleTell, register: 'formal' }).checks.find(
      (c) => c.id === 'structural_tells'
    )!.value;
    expect(formal).toBeGreaterThan(casual);

    // Emptiness is not a register: a formal brand gets no discount on "not just X, but Y".
    const empty = 'Non è solo un gestionale, è il motore della tua crescita.';
    expect(scoreContentQuality({ caption: empty, register: 'formal' }).checks.find((c) => c.id === 'structural_tells')!.value).toBe(
      scoreContentQuality({ caption: empty }).checks.find((c) => c.id === 'structural_tells')!.value
    );
  });

  it('records the tells it found in metrics', () => {
    const q = scoreContentQuality({ caption: 'Non è solo un gestionale, è il motore della crescita.' });
    expect(q.metrics.structuralTells).toContain('not_just_x_but_y');
  });
});

describe('sentence_rhythm', () => {
  it('stays neutral when the caption is too short to have a rhythm', () => {
    expect(valueOf('Tre clienti persi a marzo.', 'sentence_rhythm')).toBe(1);
    expect(scoreContentQuality({ caption: 'Tre clienti persi a marzo.' }).metrics.sentenceCv).toBeNull();
  });

  it('punishes metronomic sentence length', () => {
    const metronome = Array.from(
      { length: 6 },
      (_, i) => `La squadra ha rivisto il processo interno con molta attenzione numero ${i}.`
    ).join(' ');
    expect(valueOf(metronome, 'sentence_rhythm')).toBeLessThan(0.5);
  });

  it('rewards writing that varies violently', () => {
    const human =
      'Tre clienti. Persi. Poi abbiamo guardato i dati e abbiamo scoperto che il 68% dei preventivi muore nelle 48 ore di silenzio dopo l\'invio, cosa che nessuno in studio aveva mai misurato prima. Un follow-up a 24 ore ne recupera uno su quattro. Basta.';
    expect(valueOf(human, 'sentence_rhythm')).toBeGreaterThan(0.7);
  });
});

describe('text helpers', () => {
  it('folds accents and strips punctuation', () => {
    expect(normalizeText('Perché, davvero?!')).toBe('perche davvero');
  });

  it('builds 3-gram shingles', () => {
    expect(shingles('uno due tre quattro')).toEqual(new Set(['uno due tre', 'due tre quattro']));
  });

  it('keeps short texts addressable as a single shingle', () => {
    expect(shingles('uno due')).toEqual(new Set(['uno due']));
    expect(shingles('')).toEqual(new Set());
  });

  it('computes jaccard similarity', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
  });
});

describe('checkValues', () => {
  it('flattens to a { id: value } map for storage', () => {
    const flat = checkValues(scoreContentQuality({ caption: GOOD, platform: 'instagram' }));
    expect(Object.keys(flat)).toContain('hook_strength');
    expect(Object.keys(flat)).toHaveLength(
      scoreContentQuality({ caption: GOOD, platform: 'instagram' }).checks.length
    );
    for (const v of Object.values(flat)) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe('scorer version', () => {
  it('is a positive integer — samples are stored and compared per version', () => {
    expect(Number.isInteger(CONTENT_SCORER_VERSION)).toBe(true);
    expect(CONTENT_SCORER_VERSION).toBeGreaterThan(0);
  });
});

describe('proof_discipline', () => {
  it('gives a caption with no unsupported claims full marks', () => {
    expect(valueOf(GOOD, 'proof_discipline')).toBe(1);
  });

  it('punishes a statistic asserted as measured with nothing behind it', () => {
    expect(valueOf('Il 68% dei clienti abbandona nelle prime 48 ore.', 'proof_discipline')).toBeLessThan(0.6);
  });

  it('clears the same claim once the source is stated', () => {
    expect(
      valueOf('Secondo il nostro studio del 2025, il 68% dei clienti abbandona nelle prime 48 ore.', 'proof_discipline')
    ).toBe(1);
  });

  it('does NOT penalise a [NEED:] marker — that is the system being honest', () => {
    // Penalising it would teach the generator to drop the marker and keep the invented number.
    expect(valueOf('Recuperi [NEED: cifra reale] preventivi al mese.', 'proof_discipline')).toBe(1);
  });

  it('records both the unsupported claims and the open [NEED:] gaps in metrics', () => {
    const q = scoreContentQuality({
      caption: 'Siamo il leader di mercato. Recuperi [NEED: cifra reale] preventivi.'
    });
    expect(q.metrics.unattributedProof.join(' ')).toContain('unbacked_superlative');
    expect(q.metrics.needMarkers).toEqual(['cifra reale']);
  });
});
