import { describe, it, expect } from 'vitest';
import { parseVerdict, meetsWallBar, DEFAULT_MIN_DESIGN_SCORE, NOTE_LOCALES } from './design-judge';
import { SUPPORTED } from '$lib/i18n/locale';

const good = {
  is_design: true,
  typography: 9,
  composition: 8,
  colour: 7,
  craft: 9,
  originality: 6,
  score: 84,
  tags: ['minimal', 'type_driven'],
  note_en: 'The rule under the headline does the work.',
  note_it: 'La riga sotto il titolo fa il lavoro.',
  note_es: 'La línea bajo el titular hace el trabajo.',
  note_fr: 'Le filet sous le titre fait le travail.',
  publishable: true,
  block_reason: ''
};

describe('parseVerdict', () => {
  it('reads a well-formed verdict', () => {
    const v = parseVerdict(good)!;
    expect(v.isDesign).toBe(true);
    expect(v.score).toBe(84);
    expect(v.scores.typography).toBe(9);
    expect(v.tags).toEqual(['minimal', 'type_driven']);
    expect(v.note.it).toContain('titolo');
    expect(v.publishable).toBe(true);
    expect(v.blockReason).toBeNull();
  });

  it('refuses a verdict with no English note — an empty card is worse than no card', () => {
    expect(parseVerdict({ ...good, note_en: '   ' })).toBeNull();
    expect(parseVerdict(null)).toBeNull();
    expect(parseVerdict('nope')).toBeNull();
  });

  it('falls back to the English note per language rather than dropping the verdict', () => {
    const v = parseVerdict({ ...good, note_fr: '' })!;
    expect(v.note.fr).toBe(good.note_en);
  });

  it('drops tags outside the fixed vocabulary and caps at three', () => {
    const v = parseVerdict({ ...good, tags: ['minimal', 'shiny', 'retro', '3d', 'collage'] })!;
    expect(v.tags).toEqual(['minimal', 'retro', '3d']);
  });

  it('clamps a sub-score the model invented instead of losing the whole judgement', () => {
    const v = parseVerdict({ ...good, typography: 47, colour: 'blue' })!;
    expect(v.scores.typography).toBe(10);
    expect(v.scores.colour).toBe(5);
  });

  it('treats a missing publishable flag as NOT publishable', () => {
    // The wall auto-publishes, so silence has to mean no.
    const v = parseVerdict({ ...good, publishable: undefined, block_reason: '' })!;
    expect(v.publishable).toBe(false);
    expect(v.blockReason).toBe('unspecified');
  });

  it('keeps the reason when it blocks', () => {
    const v = parseVerdict({ ...good, publishable: false, block_reason: 'gambling ad' })!;
    expect(v.blockReason).toBe('gambling ad');
  });
});

describe('meetsWallBar', () => {
  const base = { isDesign: true, publishable: true, score: DEFAULT_MIN_DESIGN_SCORE };

  it('lets a clean, high-scoring designed piece through', () => {
    expect(meetsWallBar(base, DEFAULT_MIN_DESIGN_SCORE)).toBe(true);
  });

  it('holds back anything below the bar', () => {
    expect(meetsWallBar({ ...base, score: DEFAULT_MIN_DESIGN_SCORE - 1 }, DEFAULT_MIN_DESIGN_SCORE)).toBe(false);
  });

  it('holds back a beautiful thing we will not publish', () => {
    expect(meetsWallBar({ ...base, publishable: false, score: 99 }, DEFAULT_MIN_DESIGN_SCORE)).toBe(false);
  });

  it('holds back a photo, however good it scored', () => {
    expect(meetsWallBar({ ...base, isDesign: false, score: 99 }, DEFAULT_MIN_DESIGN_SCORE)).toBe(false);
  });
});

describe('the note covers the site', () => {
  it('carries one sentence per supported locale', () => {
    // A locale added to the site without a note here would render an English card in that language.
    expect([...NOTE_LOCALES].sort()).toEqual([...SUPPORTED].sort());
    const v = parseVerdict(good)!;
    for (const lang of SUPPORTED) expect(v.note[lang]).toBeTruthy();
  });
});
