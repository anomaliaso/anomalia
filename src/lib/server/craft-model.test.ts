import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * La fabbrica che decide su cosa gira una resa — motion video e clip UGC, due cose che
 * SOPRAVVIVONO alla cancellazione del framework.
 *
 * Prima chiedeva il modello di ripiego a `$lib/agent/bridge/adapters`: cinque righe dentro un
 * file da 514 che importa la chat e il sandbox. Queste tre prove tengono la scaletta — forzato,
 * centralino, default — e il test qui sotto tiene l'import fuori da `$lib/agent`.
 */

const { llmApiKey } = vi.hoisted(() => ({ llmApiKey: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));

vi.mock('$lib/server/llm', () => ({
  llmApiKey,
  llmDefaultModel: () => 'gemini-3.7-flash',
  llmModelForPicker: () => 'anthropic/claude-opus-5',
  llmLanguageModel: (id?: string) => ({ modelId: id })
}));

import { craftAgentModel } from './craft-model';

beforeEach(() => {
  vi.clearAllMocks();
  llmApiKey.mockReturnValue('key');
});

describe('craftAgentModel', () => {
  it('la scappatoia del mestiere vince su tutto', () => {
    expect(craftAgentModel({ envModel: '  kie/grok-4-6  ' })).toMatchObject({
      modelId: 'kie/grok-4-6',
      provider: 'llm'
    });
  });

  it('senza scappatoia prende quello che serve il centralino', () => {
    expect(craftAgentModel({ envModel: undefined })).toMatchObject({
      modelId: 'anthropic/claude-opus-5',
      provider: 'llm'
    });
  });

  it('senza chiave il centralino non serve niente e resta il default dichiarato', () => {
    llmApiKey.mockReturnValue(undefined);
    expect(craftAgentModel({ envModel: undefined })).toMatchObject({
      modelId: 'gemini-3.7-flash',
      provider: 'llm'
    });
  });

  it('una scappatoia fatta di soli spazi non conta come scelta', () => {
    expect(craftAgentModel({ envModel: '   ' })).toMatchObject({ modelId: 'anthropic/claude-opus-5' });
  });
});

describe('da dove prende il modello', () => {
  it('non importa più da $lib/agent', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/lib/server/craft-model.ts'), 'utf8');
    expect(src).not.toMatch(/from '\$lib\/agent\//);
  });
});
