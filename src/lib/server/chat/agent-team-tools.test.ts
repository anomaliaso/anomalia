import { describe, it, expect } from 'vitest';
import { createAgentTeamTools } from './agent-team-tools';
import { MAX_CUSTOM_AGENT_SCHEDULES } from '$lib/server/custom-agents';
import { ROSTER_JOBS, clearJobRosterCache } from '$lib/server/job-roster';
import { JOB_OWNERS, TEAM_SPECIALIST_IDS } from '$lib/agent-owners';
import { normalizeTeamPayload } from '$lib/chat-team';
import { normalizeRoutineEvent } from '$lib/chat-routine-event';

/**
 * UNA ROUTINE HA UN PROPRIETARIO — e queste sono le quattro cose che devono restare vere:
 *
 *  1. il proprietario si valida contro il roster VIVO e i custom del brand ('self', uno
 *     specialista, un id custom) — un nome inventato non crea niente in silenzio;
 *  2. si scrive nella colonna `agent` col prefisso (`team:` / `custom:`), niente tabelle nuove;
 *  3. il nome è un COMPITO: con un proprietario che esiste già, un nome che suona come un ruolo
 *     viene rifiutato prima di finire su una card;
 *  4. i due freni di sempre non si toccano: niente duplicati di nome, tetto 25.
 */

type Row = Record<string, unknown>;

/** Fake Supabase: quel tanto di chainable che questi tool usano davvero. */
function db(tables: Record<string, Row[]>) {
  const inserted: Row[] = [];
  const make = (table: string) => {
    const rows = () => tables[table] ?? [];
    const filters: Array<[string, unknown]> = [];
    let head = false;
    /** update/delete si applicano al momento dell'await, quando i .eq() sono tutti arrivati. */
    let pending: { op: 'update'; patch: Row } | { op: 'delete' } | null = null;
    const matching = () =>
      rows().filter((r) => filters.every(([k, v]) => r[k] === v));
    const result = () => {
      if (pending?.op === 'update') {
        for (const r of matching()) Object.assign(r, pending.patch);
        return { data: null, error: null };
      }
      if (pending?.op === 'delete') {
        const gone = new Set(matching());
        tables[table] = rows().filter((r) => !gone.has(r));
        return { data: null, error: null };
      }
      return head ? { count: matching().length, data: null } : { data: matching(), error: null };
    };
    const b: Record<string, unknown> = {
      select: (_cols?: string, opts?: { head?: boolean }) => {
        head = Boolean(opts?.head);
        return b;
      },
      update: (patch: Row) => {
        pending = { op: 'update', patch };
        return b;
      },
      delete: () => {
        pending = { op: 'delete' };
        return b;
      },
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return b;
      },
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      insert: (row: Row) => {
        const withId = { id: `new-${inserted.length + 1}`, ...row };
        inserted.push(withId);
        (tables[table] ??= []).push(withId);
        return {
          select: () => ({ maybeSingle: async () => ({ data: withId, error: null }) })
        };
      },
      then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res)
    };
    return b;
  };
  return { client: { from: make } as never, inserted, tables };
}

const CUSTOM_ID = '11111111-2222-3333-4444-555555555555';

function tools(extra: Record<string, Row[]> = {}, threadId = 'thread-1') {
  const store = db({
    custom_agent_schedules: [
      { id: CUSTOM_ID, brand_id: 'b1', name: 'Watcher', agent: 'content', enabled: true, days_of_week: [1], times: ['09:00'] }
    ],
    // Il thread di questo turno dice chi è `self`: qui parla l'Analyst.
    chat_threads: [{ id: 'thread-1', brand_id: 'b1', user_id: 'u1', agent: 'analyst', custom_agent_id: null }],
    ...extra
  });
  return {
    store,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    t: createAgentTeamTools({
      supabase: store.client,
      brandId: 'b1',
      userId: 'u1',
      locale: 'it',
      timezone: 'Europe/Rome',
      threadId
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any
  };
}

const base = {
  name: 'Recap del lunedì',
  prompt: 'Leggi le performance degli ultimi 7 giorni e scrivi cosa cambiare la settimana prossima.',
  agent: 'auto' as const,
  days: [1],
  times: ['09:00'],
  because: 'Serve un punto fisso',
  enabled: true
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (tool: any, input: unknown) => tool.execute(input, {} as never);

describe('owner di una routine', () => {
  it('self = l’agente che sta parlando in questo turno, preso dal thread', async () => {
    const { t } = tools();
    const out = await run(t.create_scheduled_agent, { ...base, owner: 'self' });
    expect(out.success).toBe(true);
    expect(out.owner).toBe('team:analyst');
    expect(out.agent).toBe('team:analyst');
  });

  it('un id di specialista assegna la routine a quel collega', async () => {
    const { t, store } = tools();
    const out = await run(t.create_scheduled_agent, { ...base, owner: 'web' });
    expect(out.success).toBe(true);
    expect(out.owner).toBe('team:web');
    // Scritto nella colonna che c'era già: nessuna migration.
    expect(store.inserted[0].agent).toBe('team:web');
  });

  it('un custom agent del brand vale come proprietario, con o senza prefisso', async () => {
    for (const target of [CUSTOM_ID, `custom:${CUSTOM_ID}`]) {
      const { t } = tools();
      const out = await run(t.create_scheduled_agent, { ...base, owner: target });
      expect(out.success, target).toBe(true);
      expect(out.owner).toBe(`custom:${CUSTOM_ID}`);
      expect(out.owner_name).toBe('Watcher');
    }
  });

  it('un proprietario che non esiste non crea niente in silenzio', async () => {
    const { t, store } = tools();
    for (const owner of ['fabrizio', '99999999-0000-0000-0000-000000000000', 'team:pippo']) {
      const out = await run(t.create_scheduled_agent, { ...base, owner });
      expect(out.success, owner).toBe(false);
      expect(out.error).toBe('owner');
    }
    expect(store.inserted).toHaveLength(0);
  });

  it('owner:"new" assume un AGENTE e gli dà il primo incarico: due righe, non una', async () => {
    const { t, store } = tools();
    const out = await run(t.create_scheduled_agent, {
      ...base,
      name: 'Ronda prezzi concessionari',
      prompt: 'Controlla i listini dei tre concessionari convenzionati e segnala gli scostamenti.',
      owner: 'new',
      new_agent_because: 'Nessuno dei sei presidia i listini dei concessionari convenzionati.',
      agent: 'web'
    });
    expect(out.success).toBe(true);

    // L'identità: una riga su `custom_agents`, con lo specialista che la esegue.
    const agents = store.tables.custom_agents ?? [];
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('Ronda prezzi concessionari');
    expect(agents[0].agent).toBe('web');

    // L'incarico: una riga a parte, che dice a chi appartiene. Prima era la STESSA riga, ed è per
    // questo che un custom agent non poteva avere due routine né zero.
    const routines = (store.tables.custom_agent_schedules ?? []).filter((r) => r.id !== CUSTOM_ID);
    expect(routines).toHaveLength(1);
    expect(routines[0].agent).toBe(`custom:${agents[0].id}`);
    expect(out.owner).toBe(`custom:${agents[0].id}`);
  });

  it('una seconda routine su un agente che esiste non ne assume un altro', async () => {
    const { t, store } = tools();
    const out = await run(t.create_scheduled_agent, {
      ...base,
      name: 'Ronda serale',
      owner: `custom:${CUSTOM_ID}`
    });
    expect(out.success).toBe(true);
    expect(out.owner).toBe(`custom:${CUSTOM_ID}`);
    // Nessuna assunzione: Watcher ora ha due incarichi, non un sosia.
    expect(store.tables.custom_agents ?? []).toHaveLength(0);
    expect(store.inserted.filter((r) => r.agent === `custom:${CUSTOM_ID}`)).toHaveLength(1);
  });
});

/**
 * PRIMA DI ASSUMERE, GUARDA CHI C'È GIÀ — il caso vero: l'agente ha proposto di CREARE un agente
 * "SEO and GEO upkeep" mentre il Web Specialist, che quel lavoro lo fa di mestiere, era lì. La
 * regola in prosa non aveva retto due volte, quindi qui è un vincolo che rifiuta.
 */
describe('un agente nuovo è l’eccezione, non la strada di default', () => {
  const seo = {
    ...base,
    name: 'SEO and GEO upkeep',
    prompt: 'Weekly audit snapshot, priority fix and citation gaps for the site.'
  };

  it('compito SEO/GEO senza owner: rifiutato, e indica web', async () => {
    const { t, store } = tools();
    for (const tool of ['create_scheduled_agent', 'propose_custom_agent']) {
      const out = await run(t[tool], seo);
      expect(out.success, tool).toBe(false);
      expect(out.error, tool).toBe('owner_suggested');
      expect(out.owner_suggested, tool).toBe('web');
      // Il messaggio deve dire cosa fare, non solo che è no.
      expect(String(out.message)).toContain('owner:"web"');
    }
    expect(store.inserted).toHaveLength(0);
  });

  it('lo stesso compito con owner:"web" passa: cambia l’incarico, non l’agente', async () => {
    const { t, store } = tools();
    const out = await run(t.create_scheduled_agent, { ...seo, name: 'Controllo SEO settimanale', owner: 'web' });
    expect(out.success).toBe(true);
    expect(store.inserted[0].agent).toBe('team:web');
    // Il prompt resta il comando personalizzato: è lui a rendere il lavoro specifico.
    expect(store.inserted[0].prompt).toBe(seo.prompt);
  });

  it('un compito che nessuno copre è ammesso, ma va motivato', async () => {
    const orphan = {
      ...base,
      name: 'Ronda listini concessionari',
      prompt: 'Controlla i listini dei tre concessionari convenzionati e segnala gli scostamenti.'
    };
    const { t } = tools();

    // Senza owner: nessun mestiere lo copre, quindi non si suggerisce nessuno — ma si chiede
    // comunque di dichiarare a chi va, invece di far nascere un collega per omissione.
    const bare = await run(t.create_scheduled_agent, orphan);
    expect(bare.success).toBe(false);
    expect(bare.error).toBe('owner_required');
    expect(bare.owner_suggested).toBeUndefined();
    // La lista dei custom del brand arriva col rifiuto: serve a scegliere, non a indovinare.
    expect(String(bare.message)).toContain('Watcher');

    // owner:"new" nudo: l'eccezione non è gratis.
    const unjustified = await run(t.create_scheduled_agent, { ...orphan, owner: 'new' });
    expect(unjustified.success).toBe(false);
    expect(unjustified.error).toBe('new_agent_unjustified');

    // Con la motivazione, passa.
    const ok = await run(t.create_scheduled_agent, {
      ...orphan,
      owner: 'new',
      new_agent_because: 'Nessuno dei sei presidia i listini dei concessionari convenzionati.'
    });
    expect(ok.success).toBe(true);
    // Il proprietario è l'agente appena assunto: la routine non resta orfana di una card.
    expect(String(ok.owner)).toMatch(/^custom:/);
  });

  it('owner:"new" su un compito che web copre chiede comunque il perché, e lo nomina', async () => {
    const { t } = tools();
    const out = await run(t.create_scheduled_agent, { ...seo, owner: 'new' });
    expect(out.success).toBe(false);
    expect(out.error).toBe('new_agent_unjustified');
    expect(out.owner_suggested).toBe('web');
  });
});

describe('il nome di una routine è un compito, non una persona', () => {
  it('con un proprietario esistente, un nome che suona come un ruolo viene rifiutato', async () => {
    const { t, store } = tools();
    for (const name of ['Analyst', 'Social Media Manager', 'SEO Specialist']) {
      const out = await run(t.create_scheduled_agent, { ...base, name, owner: 'analyst' });
      expect(out.success, name).toBe(false);
      expect(out.error).toBe('name_is_a_role');
    }
    expect(store.inserted).toHaveLength(0);
  });

  it('senza proprietario lo stesso nome passa: lì stai davvero assumendo qualcuno', async () => {
    const { t } = tools();
    const out = await run(t.create_scheduled_agent, {
      ...base,
      name: 'Vetrinista',
      prompt: 'Controlla i listini dei tre concessionari convenzionati e segnala gli scostamenti.',
      owner: 'new',
      new_agent_because: 'Nessuno dei sei presidia i listini dei concessionari convenzionati.'
    });
    expect(out.success).toBe(true);
  });
});

describe('i due freni di sempre restano', () => {
  it('rifiuta un nome già in uso', async () => {
    const { t } = tools();
    const out = await run(t.create_scheduled_agent, { ...base, name: 'watcher', owner: 'web' });
    expect(out.success).toBe(false);
    expect(out.error).toBe('duplicate');
    expect(out.existing_id).toBe(CUSTOM_ID);
  });

  it('rifiuta oltre il tetto di 25, prima di scrivere', async () => {
    const full = Array.from({ length: MAX_CUSTOM_AGENT_SCHEDULES }, (_, i) => ({
      id: `s${i}`,
      brand_id: 'b1',
      name: `Routine ${i}`,
      agent: 'content',
      enabled: true,
      days_of_week: [1],
      times: ['09:00']
    }));
    const { t, store } = tools({ custom_agent_schedules: full });
    const out = await run(t.create_scheduled_agent, { ...base, owner: 'web' });
    expect(out.success).toBe(false);
    expect(out.error).toBe('limit');
    expect(store.inserted).toHaveLength(0);
  });

  it('la scheda rifiuta esattamente quello che rifiuterebbe la creazione', async () => {
    const { t } = tools();
    const dup = await run(t.propose_custom_agent, { ...base, name: 'Watcher', owner: 'web' });
    expect(dup.success).toBe(false);
    expect(dup.error).toBe('duplicate');

    const role = await run(t.propose_custom_agent, { ...base, name: 'Copywriter', owner: 'web' });
    expect(role.success).toBe(false);
    expect(role.error).toBe('name_is_a_role');

    const ghost = await run(t.propose_custom_agent, { ...base, owner: 'fabrizio' });
    expect(ghost.success).toBe(false);
    expect(ghost.error).toBe('owner');
  });

  it('la scheda porta il proprietario fino al bottone Conferma', async () => {
    const { t } = tools();
    const out = await run(t.propose_custom_agent, { ...base, owner: 'analyst' });
    expect(out.success).toBe(true);
    // È `agent` che il confirm rilegge dal messaggio salvato: il prefisso deve arrivarci intero,
    // o una scheda che diceva "routine dell'Analyst" creerebbe un collega nuovo.
    expect(out.proposal.agent).toBe('team:analyst');
    expect(out.proposal.owner_name).toBeTruthy();
  });
});

describe('list_scheduled_agents', () => {
  it('raggruppa per proprietario, così chi sta per crearne una vede cosa gira già', async () => {
    const { t } = tools({
      custom_agent_schedules: [
        { id: CUSTOM_ID, brand_id: 'b1', name: 'Watcher', agent: 'content', enabled: true, days_of_week: [1], times: ['09:00'] },
        { id: 's2', brand_id: 'b1', name: 'Recap', agent: 'team:analyst', enabled: true, days_of_week: [1], times: ['09:00'] },
        { id: 's3', brand_id: 'b1', name: 'Numeri', agent: 'team:analyst', enabled: false, days_of_week: [2], times: ['10:00'] },
        { id: 's4', brand_id: 'b1', name: 'Ronda', agent: `custom:${CUSTOM_ID}`, enabled: true, days_of_week: [3], times: ['11:00'] }
      ]
    });
    const out = await run(t.list_scheduled_agents, {});
    const byKey = Object.fromEntries(out.by_owner.map((g: Row) => [g.owner_key, g]));

    expect(byKey['team:analyst'].routines.map((r: Row) => r.name)).toEqual(['Recap', 'Numeri']);
    expect(byKey[`custom:${CUSTOM_ID}`].routines.map((r: Row) => r.name)).toEqual(['Ronda']);
    // Il nome del proprietario custom arriva dalle stesse righe: nessuna seconda query.
    expect(byKey[`custom:${CUSTOM_ID}`].owner_name).toBe('Watcher');
    // I custom agent classici (senza proprietario) restano un gruppo a parte.
    expect(byKey.standalone.routines.map((r: Row) => r.name)).toEqual(['Watcher']);
    expect(out.count).toBe(4);
  });
});

// ── show_team: la squadra si MOSTRA, non si racconta ───────────────────────────────────────────
// L'onboarding reale del 2026-08-22 presentava i sei agenti in un paragrafo e metteva a schermo
// UN SOLO agente custom: l'utente ha concluso di non avere una squadra. La card deve contenere
// tutti e sei, con le loro routine, e i custom del brand accanto — senza una riga di testo dal
// modello, così non può né dimenticarne uno né inventarne uno.

describe('show_team', () => {
  it('rende i sei agenti di default con le loro routine, e i custom del brand accanto', async () => {
    clearJobRosterCache();
    const { t } = tools({ brands: [{ id: 'b1', plan: 'starter' }] });
    const out = await run(t.show_team, {});
    expect(out.success).toBe(true);

    // I CINQUE MESTIERI, nell'ordine della pagina /agents — nessuno può sparire in silenzio.
    // Anomalia non c'è: non è un mestiere, e la card della squadra è dove si scelgono i mestieri.
    expect(out.team.agents.map((a: { id: string }) => a.id)).toEqual([...TEAM_SPECIALIST_IDS]);
    expect(out.team.agents.map((a: { id: string }) => a.id)).not.toContain('auto');
    // Ogni routine del roster sta sotto il suo proprietario, una sola volta.
    for (const job of ROSTER_JOBS) {
      const owner = out.team.agents.find((a: { id: string }) => a.id === JOB_OWNERS[job.key]);
      expect(owner.routines.some((r: { key: string }) => r.key === job.key), job.key).toBe(true);
    }
    // Il custom del brand è una routine dell'agente che la esegue solo se ha un owner: 'content'
    // nudo non è un owner, quindi resta fra i colleghi a sé.
    expect(out.team.standalone.map((r: { name: string }) => r.name)).toContain('Watcher');
    // Piano pagante → il lavoro ricorrente parte davvero.
    expect(out.team.scheduled).toBe(true);
    // E la card sa leggere quello che il tool ha prodotto.
    expect(normalizeTeamPayload(out)?.agents).toHaveLength(TEAM_SPECIALIST_IDS.length);
  });

  it('senza piano a pagamento la card dice che le routine non partono ancora', async () => {
    clearJobRosterCache();
    const { t } = tools({ brands: [{ id: 'b1', plan: null }] });
    const out = await run(t.show_team, {});
    expect(out.team.scheduled).toBe(false);
  });

  it('non crea, non modifica e non schedula niente', async () => {
    clearJobRosterCache();
    const { t, store } = tools({ brands: [{ id: 'b1', plan: 'starter' }] });
    await run(t.show_team, {});
    expect(store.inserted).toHaveLength(0);
  });

  it('una routine assegnata a un agente di default compare sotto di lui', async () => {
    clearJobRosterCache();
    const { t } = tools({
      brands: [{ id: 'b1', plan: 'starter' }],
      custom_agent_schedules: [
        { id: '99999999-1111-2222-3333-444444444444', brand_id: 'b1', name: 'Sweep concorrenti', agent: 'team:analyst', enabled: true, days_of_week: [2], times: ['08:00'] }
      ]
    });
    const out = await run(t.show_team, {});
    const analyst = out.team.agents.find((a: { id: string }) => a.id === 'analyst');
    expect(analyst.custom.map((c: { name: string }) => c.name)).toEqual(['Sweep concorrenti']);
    expect(out.team.standalone).toHaveLength(0);
  });
});

/**
 * L'EVENTO DI SISTEMA DEL CICLO DI VITA. Ogni tool che crea, cambia o spegne una routine
 * restituisce anche `routine_event`, ed è quello che la chat disegna come riga centrata
 * (`Nuova routine "…"`). Le cose che devono restare vere:
 *
 *  1. l'evento nasce DAL TOOL, non dalla prosa del modello — e ha i fatti, non le etichette;
 *  2. dice PER CHI, quando la routine non è di chi parla (il caso "per gli altri");
 *  3. una modifica porta il prima → dopo;
 *  4. uno spegnimento e una cancellazione portano ancora nome e brief: dopo il delete non
 *     esistono più da nessuna parte, quindi vanno letti prima.
 */
describe('routine_event', () => {
  const OWNED_ID = '77777777-8888-9999-aaaa-bbbbbbbbbbbb';
  const owned = {
    id: OWNED_ID,
    brand_id: 'b1',
    name: 'Ronda SEO',
    prompt: 'Controlla le posizioni delle pagine chiave e segnala i cali oltre tre posizioni.',
    agent: 'team:web',
    avatar_face: 'wide',
    avatar_color: '#111111',
    enabled: true,
    reuse_thread: false,
    days_of_week: [1],
    times: ['09:00']
  };

  it('create_scheduled_agent emette l’evento con proprietario, cadenza, brief e prossimo giro', async () => {
    const { t } = tools();
    const out = await run(t.create_scheduled_agent, { ...base, owner: 'self' });
    const ev = normalizeRoutineEvent(out);
    expect(ev).toBeTruthy();
    expect(ev!.kind).toBe('created');
    expect(ev!.name).toBe(base.name);
    expect(ev!.prompt).toBe(base.prompt);
    expect(ev!.agent).toBe('team:analyst');
    expect(ev!.days).toEqual([1]);
    expect(ev!.times).toEqual(['09:00']);
    // Chi parla è l'Analyst e la routine è sua: niente "per X" da dire.
    expect(ev!.self).toBe(true);
    expect(ev!.by).toBe(ev!.ownerName);
    expect(ev!.nextRun).toBeTruthy();
  });

  it('una routine data a un COLLEGA porta il suo nome e non è "self"', async () => {
    const { t } = tools();
    const out = await run(t.create_scheduled_agent, { ...base, owner: 'web' });
    const ev = normalizeRoutineEvent(out)!;
    expect(ev.self).toBe(false);
    expect(ev.ownerName).toBeTruthy();
    expect(ev.ownerName).not.toBe(ev.by);
  });

  it('update_scheduled_agent cambia la riga e dice cosa è cambiato, prima → dopo', async () => {
    const { t, store } = tools({ custom_agent_schedules: [{ ...owned }] });
    const out = await run(t.update_scheduled_agent, {
      id: OWNED_ID,
      name: 'Ronda posizioni',
      times: ['07:30']
    });
    expect(out.success).toBe(true);
    // Il DB è cambiato davvero, e l'avatar della routine non è stato rifatto.
    const row = store.tables.custom_agent_schedules.find((r) => r.id === OWNED_ID)!;
    expect(row.name).toBe('Ronda posizioni');
    expect(row.times).toEqual(['07:30']);
    expect(row.avatar_face).toBe('wide');

    const ev = normalizeRoutineEvent(out)!;
    expect(ev.kind).toBe('updated');
    expect(ev.changes.map((c) => c.field).sort()).toEqual(['name', 'schedule']);
    expect(ev.changes.find((c) => c.field === 'name')).toMatchObject({
      from: 'Ronda SEO',
      to: 'Ronda posizioni'
    });
    // Il brief non è stato toccato: non compare fra i cambiamenti, ma resta per intero.
    expect(ev.changes.some((c) => c.field === 'prompt')).toBe(false);
    expect(ev.prompt).toBe(owned.prompt);
    // È del Web Specialist, e a parlare è l'Analyst.
    expect(ev.self).toBe(false);
  });

  it('update senza niente da cambiare non scrive e non inventa un evento', async () => {
    const { t } = tools({ custom_agent_schedules: [{ ...owned }] });
    const out = await run(t.update_scheduled_agent, { id: OWNED_ID, times: ['9:00'] });
    expect(out.success).toBe(false);
    expect(out.error).toBe('nothing_to_change');
    expect(normalizeRoutineEvent(out)).toBeNull();
  });

  it('pause / resume / delete portano nome e brief letti PRIMA dell’azione', async () => {
    for (const [action, kind] of [
      ['pause', 'paused'],
      ['resume', 'resumed'],
      ['delete', 'deleted']
    ] as const) {
      const { t, store } = tools({ custom_agent_schedules: [{ ...owned }] });
      const out = await run(t.set_scheduled_agent_enabled, { id: OWNED_ID, action });
      expect(out.success, action).toBe(true);
      const ev = normalizeRoutineEvent(out)!;
      expect(ev.kind, action).toBe(kind);
      expect(ev.name).toBe('Ronda SEO');
      expect(ev.prompt).toBe(owned.prompt);
      expect(ev.by).toBeTruthy();
      // Solo una routine riaccesa ha un prossimo giro.
      expect(Boolean(ev.nextRun), action).toBe(action === 'resume');
      if (action === 'delete') {
        expect(store.tables.custom_agent_schedules.find((r) => r.id === OWNED_ID)).toBeUndefined();
      }
    }
  });

  it('una routine che non esiste non produce nessuna riga', async () => {
    const { t } = tools();
    const gone = await run(t.set_scheduled_agent_enabled, { id: OWNED_ID, action: 'pause' });
    expect(gone.success).toBe(false);
    expect(normalizeRoutineEvent(gone)).toBeNull();
    const nope = await run(t.update_scheduled_agent, { id: OWNED_ID, name: 'X' });
    expect(nope.error).toBe('missing');
    expect(normalizeRoutineEvent(nope)).toBeNull();
  });
});
