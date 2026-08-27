import { describe, expect, it } from 'vitest';
import { AGENTS } from './agents';
import {
  MAX_SUBAGENT_RUNS,
  SUBAGENT_TOOL_KEYS,
  isReadOnlyToolName,
  parseVerdict,
  subagentToolNames
} from './subagents';

/**
 * Il set di nomi che gira davvero in chat, abbastanza vario da far fallire le scorciatoie:
 * letture per prefisso, scritture, tool di interazione, tool del team, e le deleghe stesse.
 */
const AVAILABLE = [
  'read_posts',
  'read_brand_kit',
  'list_articles',
  'grep_source',
  'search_web',
  'dfs_serp',
  'summarize_attachment',
  'check_job_status',
  'capture_website',
  'study_motion_reference',
  'create_post',
  'update_post',
  'approve_post',
  'generate_image',
  'design_graphic',
  'update_article',
  'generate_strategy',
  'ask_user_questions',
  'propose_open_tab',
  'offer_upgrade',
  'propose_app_connection',
  'notify_user',
  'add_memory',
  'suggest_agent_team',
  'propose_custom_agent',
  'create_scheduled_agent',
  'list_scheduled_agents',
  'show_setup_checklist',
  ...SUBAGENT_TOOL_KEYS
];

describe('isReadOnlyToolName', () => {
  it('accepts the read prefixes used across the chat registry', () => {
    for (const n of ['read_posts', 'list_articles', 'grep_source', 'search_web', 'dfs_serp', 'fetch_social_thumbs', 'summarize_attachment', 'check_job_status']) {
      expect(isReadOnlyToolName(n)).toBe(true);
    }
  });

  it('accepts the observation tools that do not match a prefix', () => {
    expect(isReadOnlyToolName('study_motion_reference')).toBe(true);
    expect(isReadOnlyToolName('capture_website')).toBe(true);
    // Guardare non è scrivere: senza questo, un `verify` sulla pagina Motion legge il TSX come
    // testo e non può vedere un solo fotogramma di quello che sta verificando.
    expect(isReadOnlyToolName('render_stills')).toBe(true);
  });

  it('rejects every write, however it is named', () => {
    for (const n of ['create_post', 'update_post', 'approve_post', 'generate_image', 'design_graphic', 'write_source', 'add_memory']) {
      expect(isReadOnlyToolName(n)).toBe(false);
    }
  });

  it('rejects reads a worker must not have', () => {
    // Il team ricorrente resta un atto dell'utente davanti all'orchestratore.
    expect(isReadOnlyToolName('list_scheduled_agents')).toBe(false);
    expect(isReadOnlyToolName('show_setup_checklist')).toBe(false);
  });
});

describe('subagentToolNames — research e verify non possono scrivere', () => {
  for (const role of ['research', 'verify'] as const) {
    it(`${role}: solo letture`, () => {
      const names = subagentToolNames(role, 'content', AVAILABLE);
      expect(names).toContain('read_posts');
      expect(names).toContain('search_web');
      expect(names.every(isReadOnlyToolName)).toBe(true);
      for (const w of ['create_post', 'update_post', 'approve_post', 'generate_image', 'update_article']) {
        expect(names).not.toContain(w);
      }
    });
  }
});

describe('subagentToolNames — execute', () => {
  it('scrive dentro il suo hub e legge ovunque', () => {
    const names = subagentToolNames('execute', 'content', AVAILABLE);
    expect(names).toContain('create_post');
    expect(names).toContain('approve_post');
    // Lettura di un altro hub: sempre concessa, come in chat.
    expect(names).toContain('list_articles');
    // Scrittura di un altro hub: no. update_article è del Web hub, non di Publish.
    expect(AGENTS.content.toolKeys).not.toContain('update_article');
    expect(names).not.toContain('update_article');
    expect(names).not.toContain('generate_strategy');
  });

  it('senza hub esplicito non restringe le scritture (comportamento omni)', () => {
    const names = subagentToolNames('execute', null, AVAILABLE);
    expect(names).toContain('create_post');
    expect(names).toContain('update_article');
  });
});

describe('subagentToolNames — i divieti che valgono per ogni ruolo', () => {
  const everyRole = (['research', 'execute', 'verify'] as const).map((r) => subagentToolNames(r, 'content', AVAILABLE));

  it('niente ricorsione: un sotto-agente non delega', () => {
    for (const names of everyRole) {
      for (const k of SUBAGENT_TOOL_KEYS) expect(names).not.toContain(k);
    }
  });

  it('niente voce verso l’utente: parla solo l’orchestratore', () => {
    for (const names of everyRole) {
      // notify_user è la voce più forte che abbiamo: email a tutto il progetto. Una pipeline da
      // tre fasi che la potesse chiamare busserebbe tre volte per lo stesso lavoro.
      // propose_app_connection apre un link di autorizzazione OAuth: gesto verso la persona.
      for (const k of ['ask_user_questions', 'propose_open_tab', 'offer_upgrade', 'propose_app_connection', 'show_setup_checklist', 'notify_user']) {
        expect(names).not.toContain(k);
      }
    }
  });

  it('niente team ricorrente, niente memoria di progetto, niente DM a colleghi', () => {
    for (const names of everyRole) {
      for (const k of ['suggest_agent_team', 'propose_custom_agent', 'create_scheduled_agent', 'list_scheduled_agents', 'add_memory', 'message_agent']) {
        expect(names).not.toContain(k);
      }
    }
  });

  it('non apre mai una porta che l’orchestratore non aveva', () => {
    // `available` in modalità ask: solo letture. Nemmeno execute inventa una scrittura.
    const askMode = ['read_posts', 'read_brand_kit', 'list_articles'];
    expect(subagentToolNames('execute', 'content', askMode).sort()).toEqual([...askMode].sort());
  });
});

describe('subagentToolNames — sandbox', () => {
  it('sul brand è in sola lettura: la sua macchina non è il brand', () => {
    const names = subagentToolNames('sandbox', 'content', AVAILABLE);
    expect(names).toContain('read_posts');
    expect(names).toContain('search_web');
    expect(names.every(isReadOnlyToolName)).toBe(true);
    for (const w of ['create_post', 'approve_post', 'generate_image']) expect(names).not.toContain(w);
  });

  it('i tool della VM non stanno nel set della chat: si aggiungono a run time', () => {
    // Se finissero in `available` li vedrebbe anche un research, che una VM non ce l'ha.
    for (const role of ['research', 'execute', 'verify'] as const) {
      const names = subagentToolNames(role, 'content', AVAILABLE);
      expect(names.some((n) => n.startsWith('sandbox_'))).toBe(false);
    }
  });
});

describe('parseVerdict', () => {
  it('legge il verdetto in testa al rapporto', () => {
    expect(parseVerdict('VERDICT: pass\nEVIDENCE — …')).toBe('pass');
    expect(parseVerdict('verdict: FAIL\nDEFECTS — …')).toBe('fail');
    expect(parseVerdict('**VERDICT:** partial\n')).toBe('partial');
  });

  it('un rapporto senza verdetto non vale come pass', () => {
    expect(parseVerdict('Tutto sembra a posto.')).toBe('unknown');
    expect(parseVerdict('')).toBe('unknown');
    // "pass" citato nel corpo non è il verdetto: solo la riga iniziale conta.
    expect(parseVerdict('EVIDENCE — the post would pass a review')).toBe('unknown');
  });
});

describe('budget', () => {
  it('un turno ha un tetto di deleghe: 50 run, con una rete sotto i typo', () => {
    expect(MAX_SUBAGENT_RUNS).toBe(50);
    expect(MAX_SUBAGENT_RUNS).toBeLessThanOrEqual(200);
  });
});

/**
 * Il ruolo che si parallelizza. La proprietà da tenere è UNA e vale la suite: `compose` non deve
 * poter scrivere sull'oggetto condiviso, altrimenti N worker sullo stesso file si sovrascrivono a
 * vicenda e ognuno riceve "fatto" dal proprio tool.
 */
describe('subagentToolNames — compose non tocca l’oggetto condiviso', () => {
  it('legge tutto come un research', () => {
    const names = subagentToolNames('compose', 'motion', AVAILABLE);
    expect(names).toContain('read_posts');
    expect(names).toContain('search_web');
    expect(names).toContain('study_motion_reference');
  });

  it('può coniare il materiale del proprio pezzo', () => {
    const names = subagentToolNames('compose', 'motion', AVAILABLE);
    // Non sono letture, ma non toccano l'oggetto condiviso: mintano un asset e basta.
    expect(names).toContain('generate_image');
    expect(names).toContain('capture_website');
  });

  it('non riceve NESSUNA scrittura sull’oggetto condiviso', () => {
    const names = subagentToolNames('compose', 'motion', [
      ...AVAILABLE,
      'write_source',
      'replace_source'
    ]);
    for (const w of ['write_source', 'replace_source', 'create_post', 'update_post', 'update_article', 'design_graphic']) {
      expect(names).not.toContain(w);
    }
  });
});

describe('subagentToolNames — perimetro di una superficie che non è un hub di chat', () => {
  // La pagina Motion chiama i suoi tool `replace_source`, non `replace_motion_source`: senza
  // override, lo scope per hub taglia ogni scrittura e l'execute torna sempre a mani vuote.
  const SURFACE = [...AVAILABLE, 'write_source', 'replace_source', 'set_title', 'finish'];

  it('senza override, i nomi della superficie non passano lo scope dell’hub', () => {
    const names = subagentToolNames('execute', 'motion', SURFACE);
    expect(names).not.toContain('write_source');
    expect(names).not.toContain('replace_source');
  });

  it('con hubToolKeys, l’execute scrive con i nomi della superficie', () => {
    const names = subagentToolNames('execute', 'motion', SURFACE, [
      'replace_source',
      'write_source',
      'generate_image'
    ]);
    expect(names).toContain('replace_source');
    expect(names).toContain('write_source');
    expect(names).toContain('generate_image');
    // Le letture restano trasversali anche con l'override.
    expect(names).toContain('read_posts');
  });

  it('`finish` e `set_title` non passano mai, con o senza override', () => {
    for (const keys of [undefined, ['replace_source', 'write_source', 'set_title', 'finish']]) {
      for (const role of ['research', 'execute', 'verify', 'compose'] as const) {
        const names = subagentToolNames(role, 'motion', SURFACE, keys);
        expect(names).not.toContain('finish');
        expect(names).not.toContain('set_title');
      }
    }
  });
});

describe('nessuna ricorsione', () => {
  it('nessun ruolo riceve i tool di delega', () => {
    for (const role of ['research', 'execute', 'verify', 'sandbox', 'compose'] as const) {
      const names = subagentToolNames(role, 'content', AVAILABLE);
      for (const key of SUBAGENT_TOOL_KEYS) expect(names).not.toContain(key);
    }
  });
});

describe('hubToolKeys vuoto non è "nessuna scrittura"', () => {
	// Il bug che questo test blocca è già stato scritto una volta: `agent-base.ts` passava
	// `surfaceWriteKeys` tale e quale, la chat non ne ha uno proprio e mandava `[]`, e `[]` è
	// truthy — quindi il perimetro di scrittura diventava vuoto e ogni `execute` delegato dalla
	// chat restava senza un solo tool per eseguire. Vuoto vuol dire "usa lo scope dell'hub".
	const SURFACE = [...AVAILABLE, 'write_source', 'replace_source'];

	it('con lista vuota vale lo scope dell’hub, non il vuoto', () => {
		const empty = subagentToolNames('execute', 'content', SURFACE, []);
		const none = subagentToolNames('execute', 'content', SURFACE, undefined);
		expect(empty).toEqual(none);
		expect(empty).toContain('create_post');
	});

	it('una lista piena resta il perimetro', () => {
		const names = subagentToolNames('execute', 'content', SURFACE, ['replace_source']);
		expect(names).toContain('replace_source');
		expect(names).not.toContain('create_post');
	});
});
