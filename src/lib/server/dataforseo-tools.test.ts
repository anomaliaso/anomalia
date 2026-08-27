import { describe, expect, it } from 'vitest';
import { DATAFORSEO_CHAT_TOOL_KEYS, DATAFORSEO_TOOL_KEYS } from './dataforseo-tools';
import { AGENT_IDS, AGENTS, SHARED_TOOL_KEYS, WEB_HUB_TOOL_KEYS, pickTools } from './chat/agents';

describe('DataForSEO agent tool pack', () => {
  it('exposes chat + history tool keys', () => {
    expect(DATAFORSEO_CHAT_TOOL_KEYS).toContain('dfs_backlinks');
    expect(DATAFORSEO_CHAT_TOOL_KEYS).not.toContain('dfs_traffic_history');
    expect(DATAFORSEO_TOOL_KEYS).toContain('dfs_traffic_history');
  });

  /**
   * LA REGOLA È CAMBIATA IL 23/8/2026, e questo test è la sua nuova forma.
   *
   * Prima asseriva l'opposto: «ogni specialista deve poter fondare un'affermazione SEO su dati
   * veri», quindi dfs_* stava in SHARED_TOOL_KEYS. Fondare resta obbligatorio — cambia CHI tiene
   * lo strumento. 2.683 caratteri di definizioni (~670 token) viaggiavano a ogni step di tutti e
   * cinque i mestieri, e in 60 giorni cinque di questi sette non sono mai stati chiamati. Il dato
   * SEO si chiede a `web` con delegate_task: il canale esiste, e si paga solo quando serve.
   */
  it('non è condiviso: il pacchetto è del solo Web Specialist', () => {
    for (const key of DATAFORSEO_CHAT_TOOL_KEYS) {
      expect(SHARED_TOOL_KEYS, key).not.toContain(key);
      expect(AGENTS.web.toolKeys, key).toContain(key);
      expect(WEB_HUB_TOOL_KEYS, key).toContain(key);
    }
  });

  it('pickTools lo dà a web e lo toglie a tutti gli altri', () => {
    const stub = Object.fromEntries(DATAFORSEO_CHAT_TOOL_KEYS.map((k) => [k, 1]));
    for (const key of DATAFORSEO_CHAT_TOOL_KEYS) {
      expect(pickTools(stub, 'web')[key], key).toBe(1);
    }
    for (const agent of AGENT_IDS.filter((a) => a !== 'web')) {
      // Vuoto, non parziale: mezzo pacchetto sarebbe il peggio dei due mondi.
      expect(Object.keys(pickTools(stub, agent)), agent).toEqual([]);
    }
  });
});
