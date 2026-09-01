import { describe, it, expect } from 'vitest';
import { normalizeRubric, rubricsBrief, applyRubricToSeed, type Rubric } from './rubrics';
import { weekStrategyBrief, type EditorialPlan } from './editorial-plan';
import type { ContentFormat } from '$lib/content-formats';

type SeedLike = { rubric?: string; rubric_id?: string; format: ContentFormat; art_direction?: string };

const rubric = (over: Partial<Rubric> = {}): Rubric => ({
  id: 'r-1',
  name: 'Dietro le quinte del lab',
  promise: 'Ogni settimana un processo reale mostrato senza filtri',
  strategic_role: 'consideration',
  format: 'carousel',
  cadence: '1/week',
  differentiation: 'Nessun competitor mostra il processo',
  rationale: 'Il brand ha un laboratorio vero',
  ...over
});

describe('normalizeRubric', () => {
  it('normalises the format onto the enum and trims fields', () => {
    const r = normalizeRubric({ name: '  Serie X ', format: 'reel', promise: ' p ' });
    expect(r.name).toBe('Serie X');
    expect(r.format).toBe('video');
    expect(r.promise).toBe('p');
  });

  it('never crashes on garbage', () => {
    const r = normalizeRubric({});
    expect(r.name).toBe('');
    expect(r.format).toBe('single_image');
  });
});

describe('rubricsBrief (the single injection point)', () => {
  // THE backward-compat invariant: no approved rubrics → empty string → every planner prompt
  // that appends this is byte-identical to the pre-rubric behaviour.
  it('returns EMPTY for no rubrics (brands that never adopted them)', () => {
    expect(rubricsBrief([])).toBe('');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(rubricsBrief(undefined as any)).toBe('');
    expect(rubricsBrief([normalizeRubric({})])).toBe(''); // nameless rows count as none
  });

  it('lists every rubric with name, format and cadence when present', () => {
    const out = rubricsBrief([rubric(), rubric({ id: 'r-2', name: 'Il numero della settimana', format: 'single_image', cadence: '2/week' })]);
    expect(out).toContain('APPROVED RUBRICS');
    expect(out).toContain('"Dietro le quinte del lab" [format: carousel, cadence: 1/week]');
    expect(out).toContain('"Il numero della settimana" [format: single_image, cadence: 2/week]');
  });
});

describe('applyRubricToSeed', () => {
  it('resolves the picked name (case-insensitive) and stamps id + authoritative format', () => {
    const seed: SeedLike = { rubric: 'dietro le quinte del LAB', format: 'single_image' };
    const out = applyRubricToSeed(seed, [rubric()]);
    expect(out.rubric).toBe('Dietro le quinte del lab');
    expect(out.rubric_id).toBe('r-1');
    expect(out.format).toBe('carousel');
  });

  it('clears an invented rubric name and leaves the seed format alone', () => {
    const seed: SeedLike = { rubric: 'Serie inventata', format: 'single_image' };
    const out = applyRubricToSeed(seed, [rubric()]);
    expect(out.rubric).toBe('');
    expect(out.rubric_id).toBeUndefined();
    expect(out.format).toBe('single_image');
  });

  it('is a no-op for brands without rubrics', () => {
    const seed: SeedLike = { rubric: 'qualsiasi', format: 'video' };
    const out = applyRubricToSeed(seed, []);
    expect(out.format).toBe('video');
    expect(out.rubric_id).toBeUndefined();
  });
});

describe('weekStrategyBrief rubric block (opt-in)', () => {
  const plan = (): EditorialPlan => ({
    strategy: 'S',
    voice: { mood: '', tone: '', goal: '', personality: '' },
    cadence: '3/week',
    platform_mix: [],
    gtm: null,
    weeks: [
      { index: 0, week_start: null, theme: 'T', focus: 'F', content_mix: [{ type: 'educational', count: 3 }], rationale: 'R', brief: null, products: null, status: 'upcoming' }
    ]
  });

  it('is byte-identical to the no-arg call when the brand has no rubrics', () => {
    expect(weekStrategyBrief(plan(), 0, [])).toBe(weekStrategyBrief(plan(), 0));
    expect(weekStrategyBrief(plan(), 0)).not.toContain('RUBRIC');
  });

  it('adds the approved-rubrics block when rubrics exist', () => {
    const brief = weekStrategyBrief(plan(), 0, [rubric()]);
    expect(brief).toContain('APPROVED RUBRICS');
    expect(brief).toContain('Dietro le quinte del lab');
  });
});

// Una rubrica senza direzione artistica è solo un nome: l'episodio finisce renderizzato nello
// stile unico del brand, e "carosello a fumetti" resta una parola nel titolo della serie.
describe('art_direction (la grammatica visiva della serie)', () => {
  it('sopravvive alla normalizzazione', () => {
    const r = normalizeRubric({ name: 'Storie', format: 'carousel', art_direction: '  fumetto a due colori, lettering a mano  ' });
    expect(r.art_direction).toBe('fumetto a due colori, lettering a mano');
  });

  it('finisce nel brief che ogni planner legge', () => {
    const out = rubricsBrief([rubric({ art_direction: 'fumetto a due colori, vignette squadrate' })]);
    expect(out).toContain('fumetto a due colori, vignette squadrate');
  });

  it('viene stampata sull\'episodio, così arriva al renderer', () => {
    const seed: SeedLike = { rubric: 'Dietro le quinte del lab', format: 'single_image' };
    const out = applyRubricToSeed(seed, [rubric({ art_direction: 'illustrazione a china' })]);
    expect(out.art_direction).toBe('illustrazione a china');
  });

  it('non inventa una direzione artistica quando la rubrica non ne ha', () => {
    const seed: SeedLike = { rubric: 'Dietro le quinte del lab', format: 'single_image' };
    expect(applyRubricToSeed(seed, [rubric()]).art_direction).toBeUndefined();
  });
});
