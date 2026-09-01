import { describe, expect, it } from 'vitest';
import {
  checkRubricsAndBatchFeasibility,
  checkRubricsInEditorialPlan,
  rubricNameSet,
  stripUngroundedStories
} from './rubrics-feasibility';
import type { EditorialPlan } from './editorial-plan';
import type { PostSeed } from './content-preview';
import type { Rubric } from './rubrics';
import { creditsForBatch } from './content-cost';

const rubrics: Rubric[] = [
  {
    name: 'Dietro le quinte',
    promise: 'Show the lab',
    strategic_role: 'consideration',
    format: 'carousel',
    cadence: '1/week',
    differentiation: 'insider',
    rationale: 'trust'
  },
  {
    name: 'Tips rapidi',
    promise: 'Actionable tip',
    strategic_role: 'awareness',
    format: 'single_image',
    cadence: '2/week',
    differentiation: 'utility',
    rationale: 'reach'
  }
];

function editorialPlan(weekMix: EditorialPlan['weeks'][0]['content_mix']): EditorialPlan {
  return {
    strategy: 'Test',
    voice: { mood: '', tone: '', goal: '', personality: '' },
    cadence: '3/week',
    platform_mix: [],
    gtm: null,
    weeks: [
      {
        index: 0,
        week_start: null,
        theme: 'T',
        focus: 'F',
        content_mix: weekMix,
        rationale: 'R',
        brief: null,
        products: null,
        status: 'upcoming'
      }
    ]
  };
}

function seed(overrides: Omit<Partial<PostSeed>, 'beats'> & { beats?: unknown }): PostSeed {
  return {
    platform: 'instagram',
    platforms: ['instagram'],
    pillar: 'tips',
    format: 'single_image',
    media: 'image',
    day: 'Mon',
    time: '10:00',
    product: '',
    person: '',
    angle: 'angle',
    subject: 'subject',
    setting: 'studio',
    props: '',
    ...overrides
  } as PostSeed;
}

describe('rubrics feasibility', () => {
  it('builds rubric name set', () => {
    expect(rubricNameSet(rubrics)).toEqual(new Set(['dietro le quinte', 'tips rapidi']));
  });

  it('flags editorial plan mix types that are not rubric names', () => {
    const violations = checkRubricsInEditorialPlan(
      editorialPlan([{ type: 'educational', count: 2 }, { type: 'Tips rapidi', count: 1 }]),
      rubrics
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('educational');
  });

  it('passes when content_mix uses only rubric names', () => {
    expect(
      checkRubricsInEditorialPlan(
        editorialPlan([{ type: 'Dietro le quinte', count: 1 }, { type: 'Tips rapidi', count: 2 }]),
        rubrics
      )
    ).toEqual([]);
  });

  it('requires rubric on seeds when brand has approved rubrics', () => {
    const violations = checkRubricsAndBatchFeasibility(
      [seed({ rubric: undefined }), seed({ rubric: 'Tips rapidi' })],
      {
        expectedSeedCount: 2,
        selectedPlatforms: ['instagram'],
        products: [],
        people: [],
        mediaIds: new Set(),
        rubrics,
        weekMix: [{ type: 'Tips rapidi', count: 2 }]
      }
    );
    expect(violations.some((v) => v.includes('no rubric'))).toBe(true);
    expect(violations.some((v) => v.includes('Week mix wants'))).toBe(true);
  });

  it('flags wrong format for rubric', () => {
    const violations = checkRubricsAndBatchFeasibility(
      [seed({ rubric: 'Dietro le quinte', format: 'single_image' })],
      {
        expectedSeedCount: 1,
        selectedPlatforms: ['instagram'],
        products: [],
        people: [],
        mediaIds: new Set(),
        rubrics
      }
    );
    expect(violations.some((v) => v.includes('requires format carousel'))).toBe(true);
  });

  it('skips week-mix count when plan mix uses legacy labels, not rubric names', () => {
    const violations = checkRubricsAndBatchFeasibility(
      [
        seed({ rubric: 'Un Tap e Via', hook: 'a' }),
        seed({ rubric: 'Tips rapidi', hook: 'b' })
      ],
      {
        expectedSeedCount: 2,
        selectedPlatforms: ['instagram'],
        products: [],
        people: [],
        mediaIds: new Set(),
        rubrics: [
          ...rubrics,
          {
            name: 'Un Tap e Via',
            promise: 'p',
            strategic_role: 'awareness',
            format: 'video',
            cadence: '1/week',
            differentiation: 'd',
            rationale: 'r'
          }
        ],
        weekMix: [
          { type: 'educational', count: 1 },
          { type: 'product', count: 1 }
        ]
      }
    );
    expect(violations.some((v) => v.includes('Week mix wants'))).toBe(false);
  });
});

// Le battute erano una riga di prompt, e una riga di prompt si salta. Qui diventano un vincolo:
// un carosello senza storia torna indietro all'agente prima di costare un render.
describe('carousel beats', () => {
  const ctx = {
    expectedSeedCount: 1,
    selectedPlatforms: ['instagram'],
    products: [],
    people: [],
    mediaIds: new Set<string>(),
    rubrics: [],
    weekMix: []
  };

  it('flags a carousel that arrives without its beats', () => {
    const violations = checkRubricsAndBatchFeasibility([seed({ format: 'carousel', slide_count: 5 })], ctx);
    expect(violations.some((v) => v.includes('beats'))).toBe(true);
  });

  it('flags a beat count that does not match the slides', () => {
    const violations = checkRubricsAndBatchFeasibility(
      [seed({ format: 'carousel', slide_count: 5, beats: [{ shows: 'b1', who: 'Sam', thinks: 'x' }, { shows: 'b2', who: 'Sam', thinks: 'y' }, { shows: 'b3', who: 'Sam', thinks: 'z' }] })],
      ctx
    );
    expect(violations.some((v) => v.includes('beats'))).toBe(true);
  });

  it('passes a carousel whose beats match its slides', () => {
    const violations = checkRubricsAndBatchFeasibility(
      [seed({ format: 'carousel', slide_count: 4, sourced_from: 'nota dello Studio', beats: [{ shows: 'b1', who: 'Sam', thinks: 'x' }, { shows: 'b2', who: 'Sam', thinks: 'y' }, { shows: 'b3', who: 'Sam', thinks: 'z' }, { shows: 'b4', who: 'Sam', thinks: 'w' }] })],
      ctx
    );
    expect(violations).toEqual([]);
  });

  // Un carosello o è una STORIA (qualcuno la vive) o è una GUIDA (dei passi). Il riquadro muto è un
  // difetto solo dentro una storia: pretendere la voce di dentro su una scheda esplicativa produce
  // "Basta non farsi prendere dall'ansia" stampato accanto a un'icona.
  it('coglie il riquadro muto dentro una storia', () => {
    const violations = checkRubricsAndBatchFeasibility(
      [seed({ format: 'carousel', slide_count: 3, sourced_from: 'nota dello Studio', beats: [
        { shows: 'b1', who: 'Sam', thinks: 'ci risiamo' }, { shows: 'b2', who: 'Sam', thinks: '' }, { shows: 'b3', who: 'Sam', thinks: 'vabbè' }
      ] })],
      ctx
    );
    expect(violations.some((v) => v.includes('inner line'))).toBe(true);
  });

  it('lascia in pace una guida, che di voce di dentro non ne ha nessuna', () => {
    const violations = checkRubricsAndBatchFeasibility(
      [seed({ format: 'carousel', slide_count: 3, beats: ['passo 1', 'passo 2', 'passo 3'] })],
      ctx
    );
    expect(violations).toEqual([]);
  });

  it('never asks a non-carousel seed for beats', () => {
    expect(checkRubricsAndBatchFeasibility([seed({ format: 'single_image' })], ctx)).toEqual([]);
  });
});

// `hit` veniva usato DOPO il ramo che gestisce la sua assenza: un seed che nomina una rubrica non
// approvata non produceva una violazione, faceva esplodere il controllo.
describe('rubrica sconosciuta', () => {
  it('non fa esplodere il controllo', () => {
    const run = () =>
      checkRubricsAndBatchFeasibility([seed({ rubric: 'Una serie che non esiste' })], {
        expectedSeedCount: 1,
        selectedPlatforms: ['instagram'],
        products: [],
        people: [],
        mediaIds: new Set<string>(),
        rubrics,
        weekMix: []
      });
    expect(run).not.toThrow();
    expect(run().some((v) => v.includes('not an approved series'))).toBe(true);
  });
});

// L'agente ha scritto tre episodi facendo ZERO ricerche e riempiendo comunque la fonte:
// «Linee guida CNOPD», «Procedure SPID AgID». Nessun URL, nessuna ricerca, tre citazioni
// autorevoli inventate — peggio del campo vuoto, perché sembra che sappiamo. Una regola di prompt
// non può creare una fonte: questo gate sì.
describe('fonte di un episodio narrativo', () => {
  const base = {
    expectedSeedCount: 1,
    selectedPlatforms: ['instagram'],
    products: [],
    people: [],
    mediaIds: new Set<string>(),
    rubrics: [],
    weekMix: []
  };
  const story = (over: Record<string, unknown> = {}) =>
    seed({
      format: 'carousel',
      slide_count: 3,
      beats: [
        { shows: 'a', who: 'Sam', thinks: 'ci risiamo' },
        { shows: 'b', who: 'Sam', thinks: 'domani torno' },
        { shows: 'c', who: 'Sam', thinks: 'vabbè' }
      ],
      ...over
    });

  it('rifiuta una storia senza fonte', () => {
    const v = checkRubricsAndBatchFeasibility([story()], base);
    expect(v.some((x) => x.includes('no source'))).toBe(true);
  });

  it('rifiuta una fonte che non viene da nessuna ricerca fatta', () => {
    const v = checkRubricsAndBatchFeasibility(
      [story({ sourced_from: 'Linee guida CNOPD e regolamenti atenei italiani.' })],
      { ...base, researchedUrls: new Set(['https://example.org/racconto']) }
    );
    expect(v.some((x) => x.includes('not grounded'))).toBe(true);
  });

  it('accetta una fonte che cita una pagina davvero letta', () => {
    const v = checkRubricsAndBatchFeasibility(
      [story({ sourced_from: 'racconto in prima persona — https://example.org/racconto' })],
      { ...base, researchedUrls: new Set(['https://example.org/racconto']) }
    );
    expect(v).toEqual([]);
  });

  it('non pretende URL dove le ricerche non esistono (percorso senza agente)', () => {
    const v = checkRubricsAndBatchFeasibility([story({ sourced_from: 'nota dello Studio del brand' })], base);
    expect(v).toEqual([]);
  });

  it('non chiede la fonte a una guida', () => {
    const v = checkRubricsAndBatchFeasibility(
      [seed({ format: 'carousel', slide_count: 3, beats: ['p1', 'p2', 'p3'] })],
      { ...base, researchedUrls: new Set<string>() }
    );
    expect(v).toEqual([]);
  });
});

// Il mix di formati lo decideva un tetto fisso (`CAROUSEL_MAX_PER_BATCH`, default 1) e una
// percentuale della quota. Nessuno dei due sa quanto costa quello che sceglie: un video vale ~16
// immagini, cioè un'intera storia illustrata. Ora il budget è un vincolo, e questo lo fa rispettare.
describe('budget di produzione', () => {
  const base = {
    expectedSeedCount: 2,
    selectedPlatforms: ['instagram'],
    products: [],
    people: [],
    mediaIds: new Set<string>(),
    rubrics: [],
    weekMix: []
  };

  it('lascia passare un batch che ci sta dentro', () => {
    const v = checkRubricsAndBatchFeasibility(
      [seed({ format: 'single_image' }), seed({ format: 'single_image' })],
      { ...base, creditBudget: 1000 }
    );
    expect(v).toEqual([]);
  });

  // Il budget si deriva dal listino invece di essere un numero fisso: i prezzi sono misurati e
  // cambiano col modello — un test calibrato su una tariffa si rompe quando la tariffa si corregge,
  // ed è quello che è appena successo quando il video è passato da $1.18 a $0.12.
  it('rifiuta un batch che il brand non può produrre', () => {
    const posts = [seed({ format: 'video' }), seed({ format: 'video' })];
    const cost = creditsForBatch(posts.map((p) => ({ format: p.format, slideCount: p.slide_count })));
    const v = checkRubricsAndBatchFeasibility(posts, { ...base, creditBudget: cost - 1 });
    expect(v.some((x) => x.includes('costs'))).toBe(true);
  });

  it('senza budget noto non inventa un vincolo', () => {
    const v = checkRubricsAndBatchFeasibility(
      [seed({ format: 'video' }), seed({ format: 'video' })],
      base
    );
    expect(v).toEqual([]);
  });
});

// Con un batch che copre due settimane, un mix solo per tutto il batch non dice niente: due post
// "narrativo" possono stare entrambi nella prima settimana e lasciare la seconda senza. Il conto va
// fatto settimana per settimana, che è il motivo per cui il seed porta la sua.
describe('mix per settimana', () => {
  const rubs: Rubric[] = [
    { name: 'Giorni normali', promise: 'p', strategic_role: 'r', format: 'carousel', cadence: '1/week', differentiation: 'd', rationale: 'r' }
  ];
  const ctxFor = (mix: Array<{ week?: number; type: string; count: number }>) => ({
    expectedSeedCount: 2,
    selectedPlatforms: ['instagram'],
    products: [],
    people: [],
    mediaIds: new Set<string>(),
    rubrics: rubs,
    weekMix: mix
  });
  const ep = (week: number) =>
    seed({
      week,
      rubric: 'Giorni normali',
      format: 'carousel',
      slide_count: 3,
      sourced_from: 'nota',
      beats: [
        { shows: 'a', who: 'Sam', thinks: 'x' },
        { shows: 'b', who: 'Sam', thinks: 'y' },
        { shows: 'c', who: 'Sam', thinks: 'z' }
      ]
    });

  it('accetta un episodio per settimana quando ognuna ne chiede uno', () => {
    const v = checkRubricsAndBatchFeasibility([ep(0), ep(1)], ctxFor([
      { week: 0, type: 'Giorni normali', count: 1 },
      { week: 1, type: 'Giorni normali', count: 1 }
    ]));
    expect(v).toEqual([]);
  });

  it('rifiuta due episodi nella stessa settimana e nessuno nell\'altra', () => {
    const v = checkRubricsAndBatchFeasibility([ep(0), ep(0)], ctxFor([
      { week: 0, type: 'Giorni normali', count: 1 },
      { week: 1, type: 'Giorni normali', count: 1 }
    ]));
    expect(v.some((x) => x.includes('Week mix wants'))).toBe(true);
  });

  it('un mix senza settimana vale per tutto il batch, come prima', () => {
    const v = checkRubricsAndBatchFeasibility([ep(0), ep(1)], ctxFor([{ type: 'Giorni normali', count: 2 }]));
    expect(v).toEqual([]);
  });
});

// Quando l'agente esaurisce i tentativi, il batch esce lo stesso: meglio un difetto minore che
// niente. Ma «la fonte è inventata» non è un difetto minore — è una vita altrui raccontata su una
// citazione falsa. Lì non si butta il post: si butta la PRETESA, e il post continua senza storia.
describe('stripUngroundedStories', () => {
  const story = (over: Record<string, unknown> = {}) =>
    seed({
      format: 'carousel',
      slide_count: 3,
      beats: [
        { shows: 'a', who: 'Sam', thinks: 'x' },
        { shows: 'b', who: 'Sam', thinks: 'y' },
        { shows: 'c', who: 'Sam', thinks: 'z' }
      ],
      ...over
    });

  it('toglie storia e fonte a un episodio che cita una pagina mai letta', () => {
    const seeds = [story({ sourced_from: 'Linee guida CNOPD' })];
    const stripped = stripUngroundedStories(seeds, new Set(['https://vero.example/x']));
    expect(stripped).toBe(1);
    expect(seeds[0].beats).toBeUndefined();
    expect(seeds[0].sourced_from).toBeUndefined();
  });

  it('lascia intatto un episodio ancorato davvero', () => {
    const seeds = [story({ sourced_from: 'racconto — https://vero.example/x' })];
    expect(stripUngroundedStories(seeds, new Set(['https://vero.example/x']))).toBe(0);
    expect(seeds[0].beats).toHaveLength(3);
  });

  it('non tocca una guida, che una fonte non la deve avere', () => {
    const seeds = [seed({ format: 'carousel', slide_count: 3, beats: ['p1', 'p2', 'p3'] })];
    expect(stripUngroundedStories(seeds, new Set<string>())).toBe(0);
    expect(seeds[0].beats).toHaveLength(3);
  });

  it('senza ricerche non giudica: non può dimostrare niente', () => {
    const seeds = [story({ sourced_from: 'nota dello Studio' })];
    expect(stripUngroundedStories(seeds, undefined)).toBe(0);
    expect(seeds[0].beats).toHaveLength(3);
  });
});

describe('un rilievo indica sempre QUALE seed', () => {
	it('usa il giorno e il formato quando il modello non ha ancora scritto un angle', () => {
		const violations = checkRubricsAndBatchFeasibility(
			[{ format: 'carousel', slide_count: 3, day: 'tuesday', beats: [], sourced_from: '' } as never],
			{
				expectedSeedCount: 1,
				selectedPlatforms: ['instagram'],
				products: [],
				people: [],
				mediaIds: new Set<string>(),
				rubrics: [],
				weekMix: []
			}
		);
		expect(violations.join(' ')).not.toContain('undefined');
		expect(violations.join(' ')).toContain('tuesday');
	});
});

// L'agente ha saltato draft_seeds e ha scritto i seed da sé: sono usciti col solo titolo, senza
// niente con cui programmarli. Un piano che non si può mettere in calendario non è un piano.
describe('un seed deve poter essere messo in calendario', () => {
	const ctx = () => ({
		expectedSeedCount: 1,
		selectedPlatforms: ['instagram'],
		products: [],
		people: [],
		mediaIds: new Set<string>(),
		rubrics: [],
		weekMix: []
	});

	it('rifiuta un seed senza piattaforma né giorno', () => {
		const violations = checkRubricsAndBatchFeasibility(
			[{ title: "L'albo pretorio", format: 'carousel', slide_count: 1, beats: [{ shows: 'x', who: 'Sam', thinks: 'y' }], sourced_from: '' } as never],
			ctx()
		);
		expect(violations.join(' ')).toContain('platform');
		expect(violations.join(' ')).toContain('day');
	});

	it('tace quando il seed li porta', () => {
		const violations = checkRubricsAndBatchFeasibility([seed({ format: 'single_image' })], ctx());
		expect(violations.join(' ')).not.toContain('cannot be scheduled');
	});
});
