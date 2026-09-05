import { describe, expect, it } from 'vitest';
import { pathFor } from './index';
import { PLAN_CYCLE_WEEKS, PLAN_WEEK, REPLAN_WEEK, SAVE_BRIEF, SAVE_PLAN, SAVE_WEEK_SEEDS } from './plans';

const validPlan = () => ({
  strategy: 'Portare fuori il lavoro vero di chi monta le tastiere.',
  voice: { mood: 'diretto', tone: 'asciutto', goal: 'far provare', personality: 'un artigiano che spiega' },
  cadence: '3/week',
  platform_mix: [{ platform: 'instagram', share: '70%', role: 'vetrina' }],
  weeks: [
    {
      theme: 'Il banco di lavoro',
      focus: 'Mostrare il montaggio a mano',
      content_mix: [{ type: 'behind the scenes', count: 3 }]
    }
  ]
});

const validSeeds = () => ({
  week_index: 0,
  theme: 'Il banco di lavoro',
  seeds: [{ platform: 'instagram', angle: 'Il primo switch che monti storto' }]
});

describe('il contratto di un piano scritto fuori da Anomalia', () => {
  it('accetta un piano completo', () => {
    expect(SAVE_PLAN.input.safeParse(validPlan()).success).toBe(true);
  });

  it('non spende niente: non è distruttivo ed è una scrittura', () => {
    expect(SAVE_PLAN.method).toBe('POST');
    expect(SAVE_PLAN.destructive).toBe(false);
  });

  it.each([
    ['strategy', { strategy: '' }],
    ['cadence', { cadence: '2/week' }],
    ['platform_mix', { platform_mix: [] }],
    ['weeks', { weeks: [] }]
  ])('rifiuta un piano senza %s, nominando il campo', (field, patch) => {
    const parsed = SAVE_PLAN.input.safeParse({ ...validPlan(), ...patch });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path[0]).toBe(field);
  });

  it('nomina la settimana e il campo che le manca, non solo "weeks"', () => {
    const plan = validPlan();
    plan.weeks[0].theme = '';
    const parsed = SAVE_PLAN.input.safeParse(plan);

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['weeks', 0, 'theme']);
  });

  it('rifiuta più settimane di quante ne ha un ciclo', () => {
    const plan = validPlan();
    plan.weeks = Array.from({ length: PLAN_CYCLE_WEEKS + 1 }, () => validPlan().weeks[0]);

    expect(SAVE_PLAN.input.safeParse(plan).success).toBe(false);
  });

  it('rifiuta un campo che il contratto non dichiara invece di scartarlo', () => {
    expect(SAVE_PLAN.input.safeParse({ ...validPlan(), campo_inventato: 'x' }).success).toBe(false);
  });
});

describe('il contratto dei seed scritti fuori da Anomalia', () => {
  it('accetta una settimana di seed', () => {
    expect(SAVE_WEEK_SEEDS.input.safeParse(validSeeds()).success).toBe(true);
  });

  it.each([
    ['week_index', { week_index: PLAN_CYCLE_WEEKS }],
    ['theme', { theme: '' }],
    ['seeds', { seeds: [] }]
  ])('rifiuta i seed con %s fuori contratto', (field, patch) => {
    const parsed = SAVE_WEEK_SEEDS.input.safeParse({ ...validSeeds(), ...patch });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path[0]).toBe(field);
  });

  it('nomina il seed a cui manca la piattaforma: senza, la normalizzazione lo butterebbe muta', () => {
    const parsed = SAVE_WEEK_SEEDS.input.safeParse({
      ...validSeeds(),
      seeds: [{ platform: '', angle: 'un angolo' }]
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['seeds', 0, 'platform']);
  });

  it('porta il copione parlato di un video, o una clip esce muta', () => {
    const parsed = SAVE_WEEK_SEEDS.input.safeParse({
      ...validSeeds(),
      seeds: [
        {
          platform: 'instagram',
          angle: 'la prova sul banco',
          format: 'video',
          media: 'video',
          hook: 'Questa tastiera fa un rumore che nessuno ti racconta',
          body: 'La monto e te la faccio sentire',
          cta: 'Provala in negozio'
        }
      ]
    });

    expect(parsed.success).toBe(true);
  });
});

describe('le tre azioni sulla settimana', () => {
  it('chiamano la settimana col nome che il tool ha sempre esposto', () => {
    for (const endpoint of [SAVE_BRIEF, REPLAN_WEEK, PLAN_WEEK]) {
      expect(Object.keys(endpoint.input.shape), endpoint.tool).toContain('week');
      expect(endpoint.input.safeParse({ week: -1, brief: 'x' }).success, endpoint.tool).toBe(false);
    }
  });

  it('indirizzano le rotte che esistono già', () => {
    expect(pathFor(SAVE_BRIEF, 'demo')).toBe('/api/v1/brands/demo/editorial-plan/save-brief');
    expect(pathFor(REPLAN_WEEK, 'demo')).toBe('/api/v1/brands/demo/editorial-plan/replan-week');
    expect(pathFor(PLAN_WEEK, 'demo')).toBe('/api/v1/brands/demo/weekly-plan/plan');
  });

  it('un brief vuoto vale per salvarlo, non per rigenerare la settimana', () => {
    expect(SAVE_BRIEF.input.safeParse({ week: 0, brief: '' }).success).toBe(true);
    expect(REPLAN_WEEK.input.safeParse({ week: 0, brief: '' }).success).toBe(false);
  });
});
