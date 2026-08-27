import { describe, expect, it } from 'vitest';
import {
  CONTRAST_DEVICES,
  CONTRAST_DEVICE_IDS,
  DISRUPTIVE_TESTS,
  contrastDeviceById,
  disruptiveBriefSection,
  disruptiveSystemSection,
  isContrastDeviceId,
  isDisruptiveStatus
} from './disruptive';
import { buildUgcPlanAgentSystem } from './server/media-generator/ugc-plan-agent';

describe('the contrast devices', () => {
  it('has one entry per id, each with an example, a failure mode and a limit', () => {
    expect(CONTRAST_DEVICES.map((d) => d.id).sort()).toEqual([...CONTRAST_DEVICE_IDS].sort());
    for (const d of CONTRAST_DEVICES) {
      // The example is the part a model actually copies: an abstract lever produces abstract ideas.
      expect(d.example.length, d.id).toBeGreaterThan(40);
      expect(d.failsWhen.length, d.id).toBeGreaterThan(20);
      // Every lever carries its own limit — the directive is what keeps "be disruptive" from
      // arriving at defamation in two steps.
      expect(d.limit.length, d.id).toBeGreaterThan(20);
    }
  });

  it('resolves ids and refuses anything else', () => {
    expect(contrastDeviceById('destroy_the_alternative')?.label).toBeTruthy();
    expect(contrastDeviceById('nope')).toBeNull();
    expect(isContrastDeviceId('own_sacrifice')).toBe(true);
    expect(isContrastDeviceId('own sacrifice')).toBe(false);
  });

  it('keeps the reference example — the burnt low-cost shirt — inside the catalog', () => {
    const device = contrastDeviceById('destroy_the_alternative')!;
    expect(device.example).toMatch(/brucia/i);
    // And the marchio-never-shown rule travels with it.
    expect(device.failsWhen + device.limit).toMatch(/marchio|logo/i);
  });
});

describe('statuses', () => {
  it('accepts the four bank states only', () => {
    for (const s of ['new', 'shortlisted', 'used', 'archived']) expect(isDisruptiveStatus(s)).toBe(true);
    expect(isDisruptiveStatus('done')).toBe(false);
  });
});

describe('disruptiveSystemSection', () => {
  const section = disruptiveSystemSection();

  it('carries the three tests, in order', () => {
    const positions = DISRUPTIVE_TESTS.map((t) => section.indexOf(t.label));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('names every lever so the agent can say which one it used', () => {
    for (const id of CONTRAST_DEVICE_IDS) expect(section).toContain(id);
  });

  it('states the non-negotiable limits and points at both bank tools', () => {
    expect(section).toMatch(/concorrente reale/i);
    expect(section).toMatch(/prova inventata/i);
    expect(section).toMatch(/pericoloso/i);
    expect(section).toMatch(/categorie protette/i);
    expect(section).toContain('save_disruptive_idea');
    expect(section).toContain('read_disruptive_ideas');
  });
});

describe('disruptiveBriefSection', () => {
  it('is the compact version: levers and tests, no tool chapter', () => {
    const brief = disruptiveBriefSection();
    expect(brief).toContain('destroy_the_alternative');
    expect(brief).toMatch(/logo/i);
    expect(brief).not.toContain('save_disruptive_idea');
    expect(brief.length).toBeLessThan(disruptiveSystemSection().length);
  });
});

/**
 * NESSUNA QUOTA NEI PROMPT, ed è il test che nasce da un difetto vero.
 *
 * L'agente ricava i criteri di `set_goal` dal system prompt che sta leggendo. Una frase contabile
 * ("almeno UNA delle proposte deve…") non resta un orientamento del mestiere: diventa una casella
 * da spuntare, e un obiettivo su un post grafico è finito in produzione con
 * `c3: At least two new disruptive ideas are saved in the banco` accanto ai criteri veri.
 *
 * La dottrina del contrasto resta forte — un lavoro di tre varianti prudenti NON è buono, e i
 * prompt lo dicono — ma la forza sta nel giudizio sul lavoro, non in un numero di cose da
 * consegnare. Il divieto è sulla FAMIGLIA di parole, non su una frase: chi riscrive la quota la
 * riscrive con queste.
 *
 * Il banco idee ha la sua copia di questo divieto in `server/disruptive-ideas.test.ts` (la sezione
 * lì ha bisogno di un finto Supabase e non è raggiungibile da qui). Toccando una, guardare l'altra.
 */
describe('no quota an agent can turn into a goal criterion', () => {
  const sections: [string, string][] = [
    ['disruptiveSystemSection', disruptiveSystemSection()],
    ['disruptiveBriefSection', disruptiveBriefSection()],
    ['buildUgcPlanAgentSystem', buildUgcPlanAgentSystem({ count: 4 })]
  ];

  for (const [name, text] of sections) {
    it(`${name} judges the work instead of counting deliverables`, () => {
      expect(text, name).not.toMatch(/almeno (UN|UNA|DUE|TRE|\d)/i);
      expect(text, name).not.toMatch(/at least (ONE|TWO|THREE|\d)/i);
      // Mirato: `break_the_ritual` DESCRIVE "il rituale obbligatorio della categoria", ed è la
      // parola giusta lì. Quello che si vieta è l'intestazione che rende obbligatoria la consegna.
      expect(text, name).not.toMatch(/CONTRASTO OBBLIGATORIO/i);
      expect(text, name).not.toMatch(/deve essere costruita|deve lasciare|must be the disruptive|must leave/i);
    });
  }

  it('keeps the doctrine strong: a batch of safe variants is still called out as bad', () => {
    expect(disruptiveSystemSection()).toMatch(/intercambiabili/i);
    expect(disruptiveBriefSection()).toMatch(/intercambiabili/i);
    // Il contrasto resta nominato come mestiere, non è sparito insieme alla quota.
    expect(disruptiveSystemSection()).toMatch(/CONTRASTO/);
  });
});
