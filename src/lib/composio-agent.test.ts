import { describe, expect, it } from 'vitest';
import {
  buildConnectorsPrompt,
  compactSchema,
  MAX_AGENT_TOOLS_LISTED,
  toAgentTools,
  truncateJson
} from './composio-agent';

describe('toAgentTools', () => {
  it('maps Composio tools to the agent shape and drops nameless rows', () => {
    const tools = toAgentTools([
      { slug: 'NOTION_CREATE_PAGE', description: 'Create a page', inputSchema: { type: 'object' } },
      { slug: '', description: 'nope' }
    ]);
    expect(tools).toEqual([
      {
        name: 'NOTION_CREATE_PAGE',
        description: 'Create a page',
        inputSchema: { type: 'object' }
      }
    ]);
  });

  it('caps the listing so one toolkit cannot flood the context', () => {
    const many = Array.from({ length: MAX_AGENT_TOOLS_LISTED + 20 }, (_, i) => ({
      slug: `TOOL_${i}`,
      description: 'x'
    }));
    expect(toAgentTools(many)).toHaveLength(MAX_AGENT_TOOLS_LISTED);
  });
});

describe('compactSchema', () => {
  it('keeps small schemas and replaces oversized ones with a hint', () => {
    const small = { type: 'object', properties: { a: { type: 'string' } } };
    expect(compactSchema(small)).toBe(small);
    const huge = { type: 'object', properties: Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [`field_${i}`, { type: 'string', description: 'x'.repeat(20) }])
    ) };
    expect(compactSchema(huge)).toMatchObject({ type: 'object' });
    expect(JSON.stringify(compactSchema(huge)).length).toBeLessThan(200);
    expect(compactSchema(null)).toBeUndefined();
  });
});

describe('truncateJson', () => {
  it('passes small results through and truncates large ones', () => {
    expect(truncateJson({ ok: true })).toEqual({ ok: true });
    const big = { text: 'y'.repeat(50) };
    expect(truncateJson(big, 20)).toMatchObject({ truncated: true });
  });
});

describe('buildConnectorsPrompt', () => {
  it('lists connected toolkits with their status', () => {
    const prompt = buildConnectorsPrompt([
      { toolkit: 'NOTION', kind: 'app', status: 'active', displayName: 'Notion' },
      { toolkit: 'HUBSPOT', kind: 'mcp', status: 'error', displayName: 'HubSpot' }
    ]);
    expect(prompt).toContain('- NOTION (App · Notion) status=active');
    expect(prompt).toContain('- HUBSPOT (Tools · HubSpot) status=error');
  });

  it('leaves out a connect flow the user never finished', () => {
    const prompt = buildConnectorsPrompt([
      { toolkit: 'NOTION', kind: 'app', status: 'active', displayName: 'Notion' },
      { toolkit: 'SLACK', kind: 'mcp', status: 'pending', displayName: 'Slack' }
    ]);
    expect(prompt).toContain('NOTION');
    expect(prompt).not.toContain('SLACK');
  });

  it('an empty list is a starting point, not a limit', () => {
    const prompt = buildConnectorsPrompt([
      { toolkit: 'NOTION', kind: 'app', status: 'disconnected', displayName: 'Notion' },
      { toolkit: 'SLACK', kind: 'mcp', status: 'pending', displayName: 'Slack' }
    ]);
    expect(prompt).toContain('No integrations connected yet');
    expect(prompt).toContain('not a limit');
  });

  /**
   * Il difetto vero: alla domanda "puoi accedere a Google Calendar?" l'agente rispondeva no.
   * Questa regola deve stare nel blocco che finisce in OGNI prompt di chat, connessioni o no —
   * un brand con Notion collegato e uno senza niente devono leggere la stessa cosa.
   */
  it('always carries the connect-on-demand rule, connected or not', () => {
    for (const rows of [
      [] as Parameters<typeof buildConnectorsPrompt>[0],
      [{ toolkit: 'NOTION', kind: 'app' as const, status: 'active', displayName: 'Notion' }]
    ]) {
      const prompt = buildConnectorsPrompt(rows);
      expect(prompt).toContain('propose_app_connection');
      expect(prompt).toContain('NOT CONNECTED NEVER MEANS NOT POSSIBLE');
      // Proattivo, non insistente: la misura è parte della regola.
      expect(prompt).toContain('ONE unprompted card per turn');
      // Mai dichiarare una connessione che solo il tool e la card conoscono.
      expect(prompt).toContain('NEVER SAY AN APP IS CONNECTED');
      // I social non passano da Composio: mandarli su Connectors è il posto sbagliato.
      expect(prompt).toContain('/settings/connected-accounts');
    }
  });
});
