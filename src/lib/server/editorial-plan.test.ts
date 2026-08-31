import { describe, it, expect } from 'vitest';
import { cadenceAllowed, profileBlock, clampCadence, mondayOf, stampWeekStarts, currentWeekIndex, prefsFromPlan, weekStrategyBrief, postsForWeek, normalizePlan, PLAN_WEEKS, type EditorialPlan, type PlanWeek, postsForWeeks, weekMixForSpan } from './editorial-plan';

const week = (over: Partial<PlanWeek> = {}): PlanWeek => ({
  index: 0,
  week_start: null,
  theme: 'Theme',
  focus: 'Focus',
  content_mix: [{ type: 'educational', count: 3 }],
  rationale: 'Why',
  brief: null,
  products: null,
  status: 'upcoming',
  ...over
});

const plan = (over: Partial<EditorialPlan> = {}): EditorialPlan => ({
  strategy: 'Own the niche.',
  voice: { mood: 'Bold', tone: 'Dry', goal: 'awareness', personality: 'Deadpan and precise.' },
  cadence: '5/week',
  platform_mix: [{ platform: 'instagram', share: '60%', role: 'discovery' }],
  gtm: null,
  weeks: [0, 1, 2, 3].map((i) => week({ index: i, theme: `Theme ${i + 1}` })),
  ...over
});

describe('cadenceAllowed / clampCadence', () => {
  it('bounds go to 3/week; starter (and unknown) below daily; pro gets everything', () => {
    expect(cadenceAllowed('go')).toEqual(['3/week']);
    expect(cadenceAllowed('starter')).toEqual(['3/week', '5/week']);
    expect(cadenceAllowed(null)).toEqual(['3/week', '5/week']);
    expect(cadenceAllowed('pro')).toContain('daily');
  });

  it('clamps a disallowed LLM cadence to the top allowed one', () => {
    expect(clampCadence('daily', ['3/week', '5/week'])).toBe('5/week');
    expect(clampCadence('5/week', ['3/week', '5/week'])).toBe('5/week');
    expect(clampCadence('made-up', ['3/week', '5/week'])).toBe('5/week');
  });
});

describe('mondayOf / stampWeekStarts', () => {
  it('returns the Monday of the week in the given timezone', () => {
    // 2026-06-10 is a Wednesday → Monday is 2026-06-08.
    expect(mondayOf('Europe/Rome', new Date('2026-06-10T12:00:00Z'))).toBe('2026-06-08');
    // A Monday maps to itself.
    expect(mondayOf('Europe/Rome', new Date('2026-06-08T12:00:00Z'))).toBe('2026-06-08');
    // Sunday late evening UTC is already Monday in Auckland.
    expect(mondayOf('Pacific/Auckland', new Date('2026-06-07T20:00:00Z'))).toBe('2026-06-08');
  });

  it('stamps consecutive Mondays and re-indexes', () => {
    const weeks = stampWeekStarts(plan().weeks, 'Europe/Rome', new Date('2026-06-10T12:00:00Z'));
    expect(weeks.map((w) => w.week_start)).toEqual(['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']);
    expect(weeks.map((w) => w.index)).toEqual([0, 1, 2, 3]);
  });
});

describe('currentWeekIndex', () => {
  const stamped = { weeks: stampWeekStarts(plan().weeks, 'Europe/Rome', new Date('2026-06-10T12:00:00Z')) };

  it('maps now into the right week of the cycle', () => {
    expect(currentWeekIndex(stamped, 'Europe/Rome', new Date('2026-06-10T12:00:00Z'))).toBe(0);
    expect(currentWeekIndex(stamped, 'Europe/Rome', new Date('2026-06-16T12:00:00Z'))).toBe(1);
    expect(currentWeekIndex(stamped, 'Europe/Rome', new Date('2026-07-05T12:00:00Z'))).toBe(3); // Sunday of week 4
  });

  it('returns null once the cycle is over (rollover time) and for unstamped plans', () => {
    expect(currentWeekIndex(stamped, 'Europe/Rome', new Date('2026-07-06T12:00:00Z'))).toBeNull();
    expect(currentWeekIndex({ weeks: plan().weeks }, 'Europe/Rome')).toBeNull();
  });

  it('clamps to 0 before the stamped start', () => {
    expect(currentWeekIndex(stamped, 'Europe/Rome', new Date('2026-06-01T12:00:00Z'))).toBe(0);
  });
});

describe('prefsFromPlan', () => {
  it('writes voice + cadence and preserves language/platformInstructions', () => {
    const out = prefsFromPlan(plan(), {
      mood: 'old',
      language: 'Italian',
      platformInstructions: { x: 'short' }
    });
    expect(out).toEqual({
      mood: 'Bold',
      tone: 'Dry',
      goal: 'awareness',
      personality: 'Deadpan and precise.',
      frequency: '5/week',
      language: 'Italian',
      platformInstructions: { x: 'short' }
    });
  });

  it('preserves existing personality when the plan has none', () => {
    const p = plan();
    p.voice.personality = '';
    const out = prefsFromPlan(p, { personality: 'Warm founder voice' });
    expect(out.personality).toBe('Warm founder voice');
  });
});

describe('weekStrategyBrief', () => {
  it('serialises the week (theme, focus, mix) into the planner brief', () => {
    const brief = weekStrategyBrief(plan(), 1);
    expect(brief).toContain('week 2 of 4');
    expect(brief).toContain('Theme 2');
    expect(brief).toContain('3× educational');
    expect(brief).toContain('Own the niche.');
  });

  it('marks the user brief as authoritative when present', () => {
    const p = plan();
    p.weeks[2].brief = 'Launch of the spring collection';
    const brief = weekStrategyBrief(p, 2);
    expect(brief).toContain('USER BRIEF FOR THIS WEEK');
    expect(brief).toContain('Launch of the spring collection');
  });

  it('includes the 0→1 GTM context and returns "" for a missing week', () => {
    const p = plan({ gtm: { stage: 'zero_to_one', summary: 'Build from zero.', platform_recs: [], plays: [] } });
    expect(weekStrategyBrief(p, 0)).toContain('GO-TO-MARKET CONTEXT');
    expect(weekStrategyBrief(p, 9)).toBe('');
  });
});

describe('postsForWeek', () => {
  it("returns the week's content-mix sum — the number the user approved", () => {
    const p = plan();
    p.weeks[1].content_mix = [
      { type: 'educational', count: 2 },
      { type: 'product', count: 1 },
      { type: 'behind the scenes', count: 1 }
    ];
    expect(postsForWeek(p, 1)).toBe(4);
  });

  it('falls back to the cadence when the mix is empty, and clamps absurd sums', () => {
    const p = plan({ cadence: '3/week' });
    p.weeks[0].content_mix = [];
    expect(postsForWeek(p, 0)).toBe(3);
    p.weeks[2].content_mix = [{ type: 'spam', count: 99 }];
    expect(postsForWeek(p, 2)).toBe(14);
  });
});

describe('normalizePlan', () => {
  it('clamps cadence, pads to exactly 4 weeks and drops malformed mix entries', () => {
    const out = normalizePlan(
      {
        strategy: 's',
        voice: { mood: 'm', tone: 't', goal: 'g', personality: 'p' },
        cadence: 'daily',
        platform_mix: [{ platform: 'Instagram', share: '50%', role: 'r' }, { share: 'orphan' }],
        gtm: { stage: 'zero_to_one', summary: 'go', platform_recs: [{ platform: 'TikTok', priority: 'primary', why: 'w', organic_potential: 'o' }], plays: ['a'] },
        weeks: [{ theme: 'only one', content_mix: [{ type: 'edu', count: 2 }, { type: '', count: 3 }, { type: 'x', count: 0 }] }]
      },
      ['3/week', '5/week']
    );
    expect(out.cadence).toBe('5/week');
    expect(out.weeks).toHaveLength(PLAN_WEEKS);
    expect(out.weeks[0].content_mix).toEqual([{ type: 'edu', count: 2 }]);
    expect(out.platform_mix).toEqual([{ platform: 'instagram', share: '50%', role: 'r' }]);
    expect(out.gtm?.platform_recs[0].platform).toBe('tiktok');
  });

  it('nulls an empty gtm and keeps changes_summary only when provided', () => {
    const bare = normalizePlan({ weeks: [] }, ['3/week']);
    expect(bare.gtm).toBeNull();
    expect('changes_summary' in bare).toBe(false);
    const rev = normalizePlan({ weeks: [], changes_summary: ['Changed cadence'] }, ['3/week']);
    expect(rev.changes_summary).toEqual(['Changed cadence']);
  });
});

describe('profileBlock (the brand half of every plan prompt)', () => {
  const profile = {
    name: 'Caffè Milano',
    category: 'Caffè specialty',
    about: 'Torrefazione artigianale',
    target_audience: 'Professionisti urbani',
    brand_style: 'Minimal, caldo, autentico',
    site_type: 'ecommerce',
    content_pillars: ['Dietro le quinte'],
    brand_colors: ['#7c5cff'],
    fonts: ['Inter'],
    logos: [{ url: 'https://caffemilano.it/logo.png', type: 'html-img-src' }],
    visual_style: `## VISUAL STYLE\n\n### PALETTE\n- #7c5cff — primario\n${'dettaglio di direzione artistica. '.repeat(40)}`,
    ai_context: '### VOICE\ndiretta\n\n### GUARDRAIL\n- MAI USARE: "imperdibile"',
    language: 'it',
    target_platforms: ['instagram'],
    studio_products: [{ id: 'p1', title: 'Blend Milano', url: 'https://caffemilano.it/blend', pricing: '18,50 €' }],
    studio_people: [{ id: 'pe1', name: 'Giulia', role: 'fondatrice', kind: 'real' }],
    studio_competitors: [{ name: 'Caffè Rivale', kind: 'direct', website: 'https://cafferivale.it' }],
    pages: [{ title: 'Guida al caffè', url: 'https://caffemilano.it/guida' }]
  };

  it('carries the branding the planner used to be blind to', () => {
    const block = profileBlock(profile);
    expect(block).toContain('Minimal, caldo, autentico'); // voice
    expect(block).toContain('#7c5cff'); // palette
    expect(block).toContain('https://caffemilano.it/logo.png'); // mark
    expect(block).toContain('Blend Milano'); // catalogue
    expect(block).toContain('Giulia'); // faces
    expect(block).toContain('Caffè Rivale'); // competitive set
    expect(block).toContain('MAI USARE'); // the guardrails still ride along
  });

  it('keeps the site-pages block and its no-invented-URLs rule', () => {
    expect(profileBlock(profile)).toContain('OWN SITE CONTENT');
    expect(profileBlock({ ...profile, pages: [] })).toContain('none indexed');
  });

  it('summarises the visual brief instead of handing the planner the whole art direction', () => {
    const block = profileBlock(profile);
    expect(block).toContain('VISUAL STYLE (summary');
    // The markdown of the full brief does not come along — only a flattened opening line.
    expect(block).not.toContain('### PALETTE');
    expect(block).toContain('PALETTE');
    expect(block).not.toContain(profile.visual_style);
  });

  it('drops the knowledge index — the planner has no way to read a document', () => {
    expect(profileBlock(profile)).not.toContain('BRAND DOCUMENTS');
  });

  it('emits no tool instructions: the plan engine is a structured call with no tools', () => {
    expect(profileBlock(profile)).not.toContain('read_products');
  });

  it('still renders for a bare profile, so an onboarding-shaped one does not break the prompt', () => {
    const block = profileBlock({ name: 'Nuovo', about: 'Solo questo' });
    expect(block).toContain('Nuovo');
    expect(block).not.toContain('undefined');
  });
});

// Un batch che copre due settimane deve vedere ENTRAMBE, con il tema e il mix di ciascuna: con il
// brief di una sola, i post della seconda nascono sul tema della prima.
describe('weekStrategyBrief su più settimane', () => {
  const plan = (): EditorialPlan => ({
    strategy: 'S',
    voice: { mood: '', tone: '', goal: '', personality: '' },
    cadence: '3/week',
    platform_mix: [],
    gtm: null,
    weeks: [
      { index: 0, week_start: null, theme: 'Settimana uno', focus: 'F1', content_mix: [{ type: 'educational', count: 3 }], rationale: 'R1', brief: null, products: null, status: 'upcoming' },
      { index: 1, week_start: null, theme: 'Settimana due', focus: 'F2', content_mix: [{ type: 'narrativo', count: 2 }], rationale: 'R2', brief: null, products: null, status: 'upcoming' },
      { index: 2, week_start: null, theme: 'Settimana tre', focus: 'F3', content_mix: [], rationale: '', brief: null, products: null, status: 'upcoming' }
    ]
  });

  it('porta il tema e il mix di ogni settimana coperta', () => {
    const brief = weekStrategyBrief(plan(), 0, [], 2);
    expect(brief).toContain('Settimana uno');
    expect(brief).toContain('Settimana due');
    expect(brief).toContain('3× educational');
    expect(brief).toContain('2× narrativo');
  });

  it('non tira dentro settimane fuori dal batch', () => {
    expect(weekStrategyBrief(plan(), 0, [], 2)).not.toContain('Settimana tre');
  });

  it('con una settimana sola resta quello di prima', () => {
    expect(weekStrategyBrief(plan(), 0, [], 1)).toBe(weekStrategyBrief(plan(), 0));
  });

  it('non sfora la fine del ciclo', () => {
    const brief = weekStrategyBrief(plan(), 2, [], 4);
    expect(brief).toContain('Settimana tre');
    expect(brief).not.toContain('undefined');
  });
});

// Un batch che copre due settimane deve produrne il totale, e chiedere a ogni settimana il SUO mix.
describe('postsForWeeks e i mix dello span', () => {
  const plan = (): EditorialPlan => ({
    strategy: 'S',
    voice: { mood: '', tone: '', goal: '', personality: '' },
    cadence: '3/week',
    platform_mix: [],
    gtm: null,
    weeks: [
      { index: 0, week_start: null, theme: 'W1', focus: '', content_mix: [{ type: 'a', count: 3 }], rationale: '', brief: null, products: null, status: 'upcoming' },
      { index: 1, week_start: null, theme: 'W2', focus: '', content_mix: [{ type: 'b', count: 2 }], rationale: '', brief: null, products: null, status: 'upcoming' },
      { index: 2, week_start: null, theme: 'W3', focus: '', content_mix: [{ type: 'c', count: 4 }], rationale: '', brief: null, products: null, status: 'upcoming' }
    ]
  });

  it('somma le settimane coperte', () => {
    expect(postsForWeeks(plan(), 0, 2)).toBe(5);
  });

  it('con una settimana sola è quello di prima', () => {
    expect(postsForWeeks(plan(), 0, 1)).toBe(postsForWeek(plan(), 0));
  });

  it('non conta settimane che non esistono', () => {
    expect(postsForWeeks(plan(), 2, 3)).toBe(4);
  });

  it('etichetta ogni voce di mix con la sua settimana', () => {
    const mix = weekMixForSpan(plan(), 0, 2);
    expect(mix).toEqual([
      { week: 0, type: 'a', count: 3 },
      { week: 1, type: 'b', count: 2 }
    ]);
  });

  it('su una settimana sola non etichetta niente: il mix vale per il batch', () => {
    expect(weekMixForSpan(plan(), 1, 1)).toEqual([{ type: 'b', count: 2 }]);
  });
});
