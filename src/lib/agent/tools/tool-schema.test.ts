import { describe, expect, it } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';
import { createChatTools } from './index';
import { AGENT_IDS } from '$lib/server/chat/agents';

/**
 * Gemini rifiuta un intero toolset quando una function declaration porta un enum con valori
 * non-stringa: "Invalid value at 'tools[0].function_declarations[N].parameters...enum[0]'
 * (TYPE_STRING), true". `z.literal(true)` viene convertito ESATTAMENTE così — e il difetto
 * misurato in produzione locale (28/8/2026) è stato un intero turno del Content Creator morto
 * sullo schema, prima di chiamare il modello. Il test percorre gli schema di ogni tool montato
 * per ogni agente e non perdona nessun enum non-stringa.
 */
type Zodish = { _def?: Record<string, unknown>; shape?: Record<string, unknown>; element?: unknown };

function scan(v: unknown, path: string, hits: string[]): void {
  if (!v || typeof v !== 'object') return;
  const node = v as Zodish;
  const def = node._def;
  if (def && Array.isArray(def.values)) {
    const bad = (def.values as unknown[]).filter((x) => typeof x !== 'string');
    if (bad.length) hits.push(`${path} values=${JSON.stringify(def.values)}`);
  }
  if (def?.innerType) scan(def.innerType, `${path}.inner`, hits);
  if (def?.schema) scan(def.schema, `${path}.wrap`, hits);
  if (Array.isArray(def?.options)) {
    (def.options as unknown[]).forEach((o, i) => scan(o, `${path}.opt${i}`, hits));
  }
  if (node.shape) {
    for (const [k, sub] of Object.entries(node.shape)) scan(sub, `${path}.${k}`, hits);
  }
  if (node.element) scan(node.element, `${path}[]`, hits);
}

describe('nessuno schema toolporta enum non-stringa (Gemini rifiuta il toolset intero)', () => {
  for (const agent of AGENT_IDS) {
    it(`il toolset di ${agent} è valido`, () => {
      const kit = createTestSupabase({});
      const tools = createChatTools({
        supabase: kit.client as never,
        brandId: 'b1',
        userId: 'u1',
        threadId: 't1',
        agent,
        locale: 'it'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any) as Record<string, unknown>;

      const hits: string[] = [];
      for (const [name, t] of Object.entries(tools)) {
        const schema = (t as Record<string, unknown>).inputSchema ?? (t as Record<string, unknown>).parameters;
        scan(schema, `${name}`, hits);
      }
      expect(hits).toEqual([]);
    });
  }
});
