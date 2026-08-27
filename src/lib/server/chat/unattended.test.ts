import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { UNATTENDED_TOOL_EXCLUSIONS, stripUnattendedTools } from './unattended';

/**
 * Il perimetro del turno non presidiato: minimo, non un recinto. Le proprietà che contano:
 *   1. la lista esclude SOLO i tool che presuppongono una persona nella stanza;
 *   2. `notify_user` resta dentro — è l'unico modo di raggiungere l'utente da un turno schedulato;
 *   3. lo strip toglie quelli e solo quelli;
 *   4. la coda lo applica SOLO ai job schedulati (default E custom passano di lì), mai ai turni
 *      interattivi (che non transitano da processNextQueuedChatJob con scheduled=true).
 */
describe('UNATTENDED_TOOL_EXCLUSIONS', () => {
  it('contiene esattamente i tool che richiedono una persona presente', () => {
    expect([...UNATTENDED_TOOL_EXCLUSIONS].sort()).toEqual(
      [
        'ask_user_questions',
        'offer_upgrade',
        'create_scheduled_agent',
        // Riscrivere il proprio brief senza nessuno che guarda è cambiarsi il mandato da soli.
        'update_scheduled_agent',
        // Una stanza si anima solo se ci scrive una persona: aperta di notte è un thread vuoto.
        'create_group_chat',
        'set_expression',
        'update_logo',
        'update_brand_colors',
        'extract_colors'
      ].sort()
    );
  });

  /**
   * IL CONFINE È IL CONSENSO, NON LA PRESENZA — e da quando una routine può avere un
   * proprietario è la differenza che tiene in piedi tutto il resto: un turno notturno che si
   * auto-assegna (o assegna a un collega) lavoro ricorrente moltiplica i turni pagati senza che
   * nessuno abbia detto sì. Quindi PUÒ proporre — la scheda resta nel diario e aspetta una
   * persona — e NON PUÒ creare.
   */
  it('un turno schedulato può proporre una routine, mai crearla', () => {
    expect(UNATTENDED_TOOL_EXCLUSIONS).toContain('create_scheduled_agent');
    expect(UNATTENDED_TOOL_EXCLUSIONS).not.toContain('propose_custom_agent');
    const out = stripUnattendedTools({
      propose_custom_agent: {},
      create_scheduled_agent: {},
      list_scheduled_agents: {}
    });
    expect(out.propose_custom_agent).toBeDefined();
    expect(out.create_scheduled_agent).toBeUndefined();
    // Vedere cosa gira già resta permesso: è l'anti-duplicato di chi sta per proporre.
    expect(out.list_scheduled_agents).toBeDefined();
  });

  it('notify_user NON è escluso: è come un turno non presidiato raggiunge la persona', () => {
    expect(UNATTENDED_TOOL_EXCLUSIONS).not.toContain('notify_user');
  });

  it('stripUnattendedTools toglie le esclusioni e lascia tutto il resto', () => {
    const tools = Object.fromEntries(
      [...UNATTENDED_TOOL_EXCLUSIONS, 'notify_user', 'produce_week', 'update_gtm_plan', 'call_integrations_tools'].map(
        (n) => [n, { name: n }]
      )
    );
    const out = stripUnattendedTools(tools);
    for (const n of UNATTENDED_TOOL_EXCLUSIONS) expect(out[n]).toBeUndefined();
    expect(out.notify_user).toBeDefined();
    expect(out.produce_week).toBeDefined();
    expect(out.update_gtm_plan).toBeDefined();
    expect(out.call_integrations_tools).toBeDefined();
    // Non muta l'input: il set completo resta il tetto dei sotto-agenti altrove.
    expect(tools.ask_user_questions).toBeDefined();
  });

  it('la coda lo applica dentro il ramo non presidiato (scheduled o DM), e solo lì', () => {
    // Stesso stile del test su autopilot_enabled: si legge il sorgente, perché il cablaggio è
    // una riga e la regressione tipica è spostarla fuori dal guard (o perderla in un merge).
    // Il guard oggi copre anche `isDm`: il turno di risposta di un DM fra agenti è non
    // presidiato quanto uno schedulato — risponde a un altro agente, non a una persona.
    const src = readFileSync('src/lib/server/chat/queue.ts', 'utf8');
    const guard = src.indexOf('if (params.scheduled === true || isDm) {', src.indexOf('createChatTools('));
    const strip = src.indexOf('stripUnattendedTools(allTools)');
    expect(guard).toBeGreaterThan(-1);
    expect(strip).toBeGreaterThan(guard);
    // Una sola applicazione, dentro il guard: nessuno strip incondizionato.
    expect(src.split('stripUnattendedTools(').length).toBe(2); // un solo uso (l'import non ha parentesi)
  });
});
