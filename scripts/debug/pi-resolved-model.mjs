/**
 * Cosa risolve pi per il modello di produzione? Stampa id/provider/input del modello
 * che l'harness usa davvero, con e senza refresh della rete.
 *
 * Uso: node scripts/debug/pi-resolved-model.mjs [agentDir]
 */
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argDir = process.argv[2];
const agentDir = argDir ?? mkdtempSync(join(tmpdir(), 'pi-resolve-'));
if (!argDir) {
  writeFileSync(
    join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        openrouter: {
          baseUrl: 'https://openrouter.ai/api/v1',
          api: 'openai-completions',
          apiKey: 'test-key',
          models: [{ id: 'z-ai/glm-5.3-flash', input: ['text', 'image'] }]
        }
      }
    })
  );
}
console.log('models.json:', readFileSync(join(agentDir, 'models.json'), 'utf8').slice(0, 300));
if (existsSync(join(agentDir, 'models-store.json'))) {
  const s = readFileSync(join(agentDir, 'models-store.json'), 'utf8');
  console.log('models-store.json (refreshed catalog, primi 400):', s.slice(0, 400));
}

for (const offline of [true, false]) {
  process.env.PI_OFFLINE = offline ? '1' : '';
  const runtime = await ModelRuntime.create({ modelsPath: join(agentDir, 'models.json') });
  const all = runtime.getModels('openrouter');
  const m = all.find((x) => x.id === 'z-ai/glm-5.3-flash');
  console.log(`offline=${offline} → modello trovato:`, m ? `${m.provider}/${m.id} input=${JSON.stringify(m.input)} api=${m.api} baseUrl=${m.baseUrl}` : 'ASSENTE');
}
