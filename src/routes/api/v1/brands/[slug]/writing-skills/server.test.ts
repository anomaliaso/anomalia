import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn()
}));

import { GET } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { brandSkills } from '$lib/server/brand-skills';
import { DEFAULT_SKILLS, defaultSkillsFor } from '$lib/server/default-skills';
import { TEAM_AGENT_IDS } from '$lib/agent-owners';
import { WRITING_DECK_AGENTS } from '@anomalia/api-contracts';

type Row = Record<string, unknown>;

function fakeSupabase(memory: Row[]) {
  return {
    from(table: string) {
      let rows = table === 'brand_memory' ? [...memory] : [];
      const q = {
        select: () => q,
        eq(column: string, value: unknown) {
          rows = rows.filter((r) => r[column] === value);
          return q;
        },
        neq(column: string, value: unknown) {
          rows = rows.filter((r) => r[column] !== value);
          return q;
        },
        order: () => q,
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null })
      };
      return q;
    }
  };
}

const OWN_SKILL: Row = {
  id: 'm1',
  brand_id: 'brand-1',
  layer: 'project',
  category: 'skill',
  key: 'lancio-prodotto',
  value: 'Quando esce un prodotto nuovo.\n\n1. Cita il problema prima del nome.\n2. Un prezzo, mai due.',
  agent: null
};

const FOREIGN_SKILL: Row = {
  id: 'm2',
  brand_id: 'brand-2',
  layer: 'project',
  category: 'skill',
  key: 'procedura-del-vicino',
  value: 'Quando il concorrente lancia.\n\nSconta del 40 percento.',
  agent: null
};

const A_FACT: Row = {
  id: 'm3',
  brand_id: 'brand-1',
  layer: 'project',
  category: 'fact',
  key: 'sede',
  value: 'Milano',
  agent: null
};

function signedIn(memory: Row[] = [OWN_SKILL, FOREIGN_SKILL, A_FACT]) {
  vi.mocked(authenticate).mockResolvedValue({
    supabase: fakeSupabase(memory),
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: 'brand-1', slug: 'demo', name: 'Demo Brand' },
    error: null
  } as never);
}

function call(query: Record<string, string> = {}, slug = 'demo') {
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/writing-skills`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return (GET as (event: unknown) => Promise<Response>)({
    request: new Request(url),
    params: { slug },
    url
  }).then(async (res) => ({ res, body: await res.json() }));
}

/** Il mazzo dei markdown del mestiere, separato dalle skill di default in codice. */
const craftDeck = (body: { skills: { name: string }[] }) =>
  body.skills
    .filter((skill) => brandSkills.some((craft) => craft.name === skill.name))
    .map((skill) => skill.name)
    .sort();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /writing-skills', () => {
  /**
   * IL TEST CHE ESISTE PER LA REGRESSIONE SILENZIOSA. Le skill di scrittura raggiungevano un
   * modello solo attraverso `skillsForAgent`, che aveva un unico chiamante dentro il bridge in
   * smantellamento: cancellato quello, il testo smetteva di arrivare a chiunque e nessun test
   * diventava rosso. Questo diventa rosso.
   */
  it('ogni skill di prodotto raggiunge un modello per una strada che non passa dal bridge', async () => {
    signedIn();

    const reachable = new Set<string>();
    for (const agent of WRITING_DECK_AGENTS) {
      const { body } = await call({ agent });
      for (const name of craftDeck(body)) reachable.add(name);
    }

    expect([...reachable].sort()).toEqual(brandSkills.map((s) => s.name).sort());
  });

  /**
   * Le skill di default sono TECNICA DEL PRODOTTO in codice — i gate che fanno rifiutare un
   * render. Arrivavano a un modello solo da `read_memory` in `agent/tools/`, cioè dallo stesso
   * perimetro in smantellamento: senza questo, un agente esterno scrive uno script che il voice
   * gate boccia e non sa perché.
   */
  it('anche le skill di default in codice escono dal perimetro che sta per sparire', async () => {
    signedIn();

    const reachable = new Set<string>();
    for (const agent of WRITING_DECK_AGENTS) {
      const { body } = await call({ agent });
      for (const skill of body.skills) reachable.add(skill.name);
    }

    for (const skill of DEFAULT_SKILLS) {
      expect([...reachable], skill.key).toContain(skill.key);
    }
  });

  it('ogni agente vede solo le skill di default che lo riguardano', async () => {
    signedIn();

    const { body } = await call({ agent: 'analyst' });
    const served = body.skills.map((s: { name: string }) => s.name);

    expect(defaultSkillsFor('analyst')).toEqual([]);
    for (const skill of DEFAULT_SKILLS) {
      expect(served, skill.key).not.toContain(skill.key);
    }
  });

  it('una skill di default porta il trigger come descrizione e i passi come corpo', async () => {
    signedIn();

    const { body } = await call({ agent: 'motion' });
    const voice = body.skills.find((s: { name: string }) => s.name === 'motion-voiceover-fit');

    expect(voice.source).toBe('product');
    expect(voice.description).toBe('Use when a motion video has (or should have) a voice-over.');
    expect(voice.body).toContain('generate_voiceover');
    expect(voice.body).not.toContain('Use when a motion video has');
  });

  it('serve il testo, non un riferimento a un file che il modello non può aprire', async () => {
    signedIn();

    const { res, body } = await call();

    expect(res.status).toBe(200);
    const humanizer = body.skills.find((s: { name: string }) => s.name === 'humanizer');
    expect(humanizer.source).toBe('product');
    expect(humanizer.description.length).toBeGreaterThan(0);
    expect(humanizer.body.length).toBeGreaterThan(1000);
  });

  it('il mazzo predefinito è quello di scrittura: nessun agente scrive come un bot', async () => {
    signedIn();

    const { body } = await call();

    expect(craftDeck(body)).toEqual(['humanizer', 'stop-slop']);
  });

  it('ogni agente porta il suo mazzo, e chi scrive social porta `social`', async () => {
    signedIn();

    const content = await call({ agent: 'content' });
    const web = await call({ agent: 'web' });

    expect(craftDeck(content.body)).toEqual(['humanizer', 'social', 'stop-slop']);
    expect(craftDeck(web.body)).toEqual(['humanizer', 'seo-audit', 'stop-slop']);
  });

  it('elenca i riferimenti senza spedirli: 145 KB non stanno in una risposta', async () => {
    signedIn();

    const { body } = await call({ agent: 'content' });

    const social = body.skills.find((s: { name: string }) => s.name === 'social');
    expect(social.references).toContain('references/platform-limits.md');
    expect(social.references).toContain('references/carousel-frameworks.md');
    expect(JSON.stringify(body)).not.toContain('CAROUSEL_FRAMEWORK_MARKER_THAT_DOES_NOT_EXIST');
    expect(body.reference).toBeNull();
  });

  it('consegna un riferimento quando lo si chiede per nome, e allora solo quello', async () => {
    signedIn();

    const { body } = await call({ reference: 'social/references/platform-limits.md' });

    expect(body.skills).toEqual([]);
    expect(body.reference.path).toBe('social/references/platform-limits.md');
    expect(body.reference.content.length).toBeGreaterThan(100);
  });

  it('un riferimento inventato è un 404, non un corpo vuoto che sembra un file vuoto', async () => {
    signedIn();

    const { res, body } = await call({ reference: 'social/references/inventato.md' });

    expect(res.status).toBe(404);
    expect(body.error).toBe('reference_not_found');
  });

  it('non lascia uscire un file fuori dalle skill nemmeno risalendo le cartelle', async () => {
    signedIn();

    for (const path of ['../../../../etc/passwd', 'social/../../../package.json', '/etc/passwd']) {
      const { res } = await call({ reference: path });
      expect(res.status, path).toBe(404);
    }
  });

  it('le procedure del brand viaggiano col brand, e quelle di un altro non compaiono', async () => {
    signedIn();

    const { body } = await call();

    const own = body.skills.filter((s: { source: string }) => s.source === 'brand');
    expect(own).toEqual([
      {
        name: 'lancio-prodotto',
        source: 'brand',
        description: 'Quando esce un prodotto nuovo.',
        body: '1. Cita il problema prima del nome.\n2. Un prezzo, mai due.',
        references: []
      }
    ]);
    expect(JSON.stringify(body)).not.toContain('procedura-del-vicino');
    expect(JSON.stringify(body)).not.toContain('Sconta del 40 percento');
  });

  it('una nota che non è una procedura non finisce fra le skill', async () => {
    signedIn();

    const { body } = await call();

    expect(JSON.stringify(body)).not.toContain('Milano');
  });

  it('gli agenti dichiarati nel contratto sono quelli che il team ha davvero', () => {
    expect([...WRITING_DECK_AGENTS].sort()).toEqual([...TEAM_AGENT_IDS].sort());
  });

  it('un brand senza procedure proprie riceve comunque quelle di prodotto', async () => {
    signedIn([]);

    const { body } = await call();

    expect(body.skills.every((s: { source: string }) => s.source === 'product')).toBe(true);
    expect(craftDeck(body)).toEqual(['humanizer', 'stop-slop']);
  });
});
