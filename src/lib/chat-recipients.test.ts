import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recipientsAgent } from './chat-recipients';
import { DEFAULT_AGENT_ID, NEW_CHAT_AGENT_ID } from './agent-icons';

const OPTS = { fallback: NEW_CHAT_AGENT_ID, generalist: DEFAULT_AGENT_ID };
const who = (keys: string[], customs: Array<{ id: string; agent: string | null }> = []) =>
  recipientsAgent(keys, customs, OPTS);

describe('recipientsAgent — chi risponde lo dice il campo "A"', () => {
  it('UN destinatario: il thread nasce con LUI, non con il default', () => {
    // Il difetto vero: si sceglieva Motion nel campo "A" e il thread nasceva Content, perché il
    // ramo "nessun thread" riscriveva l'agente con una costante dopo che i chip erano tornati.
    expect(who(['motion']).agent).toBe('motion');
    expect(who(['motion']).agent).not.toBe(NEW_CHAT_AGENT_ID);
    expect(who(['analyst']).agent).toBe('analyst');
    expect(who(['motion']).room).toEqual([]);
    expect(who(['motion']).customAgentId).toBeNull();
  });

  it('nessun destinatario = chat davvero nuova: il default di partenza', () => {
    expect(who([]).agent).toBe(NEW_CHAT_AGENT_ID);
    expect(who([]).customAgentId).toBeNull();
    expect(who([]).room).toEqual([]);
  });

  it('un agente custom porta il thread sul mestiere per cui è stato scritto', () => {
    const customs = [{ id: 'u-1', agent: 'web' }];
    expect(who(['custom:u-1'], customs)).toEqual({
      agent: 'web',
      customAgentId: 'u-1',
      room: []
    });
    // Lista non ancora atterrata: `null` = non toccare l'agente corrente, mai indovinarlo.
    expect(who(['custom:u-1']).agent).toBeNull();
    expect(who(['custom:u-1']).customAgentId).toBeNull();
  });

  it('stanza: la ricaduta preferisce un MESTIERE vero al generalista', () => {
    const r = who([DEFAULT_AGENT_ID, 'content']);
    expect(r.room).toEqual([DEFAULT_AGENT_ID, 'content']);
    // Se il server rifiutasse la stanza, il thread resta di Content — non del generalista, o la
    // scelta esplicita dell'utente sparirebbe senza dirlo.
    expect(r.agent).toBe('content');
  });

  it('stanza di soli custom: nessuna ricaduta inventata', () => {
    expect(who(['custom:a', 'custom:b']).agent).toBeNull();
  });
});

describe('il composer usa QUESTA regola, non una copia', () => {
  const src = readFileSync(join(__dirname, 'components/ChatColumn.svelte'), 'utf8');
  /** La chiamata su una riga sola: cosi` un a capo in piu` non spegne la guardia. */
  const call = src.slice(src.indexOf('await createThread('), src.indexOf('await createThread(') + 400).replace(/\s+/g, ' ');

  it('il ramo senza thread chiede al campo "A" invece di riscrivere il default', () => {
    expect(src).toContain("from '$lib/chat-recipients'");
    // La riga che creava il difetto: `agentSel = NEW_CHAT_AGENT` incondizionato nel reset.
    expect(src).not.toMatch(/agentSel !== NEW_CHAT_AGENT\)\) agentSel = NEW_CHAT_AGENT/);
    expect(src).toMatch(/whoAnswers\(embedded \? recipients : \[\]\)/);
  });

  it('il thread nasce con l’agente selezionato, non con una costante', () => {
    expect(call).toMatch(/^await createThread\( brandSlug, undefined, agentSel, roomSel, /);
  });

  it('l’agente custom scelto viaggia con la CREAZIONE del thread, non con una PATCH dopo', () => {
    expect(call).toMatch(/roomSel\.length \? null : customAgentSel/);
  });

  /** Come l'agente, anche il modello: sceglierlo dalla home e ritrovare il default era un bug. */
  it('e con lui la scelta di modello, per la stessa ragione', () => {
    expect(call).toMatch(/policyForChoice\(chatTier, chatReasoning\)/);
  });
});
