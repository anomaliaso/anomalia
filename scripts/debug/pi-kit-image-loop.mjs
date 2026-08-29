/**
 * LOOP DI RIPRODUZIONE — immagini in chat sul percorso kit (pi) + ordine degli eventi di fine turno.
 *
 * Monte un server OpenAI-compatibile finto (stream SSE senza `finish_reason`, lo stesso difetto
 * misurato su glm/openrouter) e fa girare l'harness pi REALE (patch compresa) contro di esso.
 * Rosso quando:
 *   (a) le parti immagine del messaggio utente NON arrivano nel body della richiesta, oppure
 *   (b) il turno si chiude senza un `finish-step` prima del `finish` terminale
 *       ("received terminal finish with unclosed step content").
 *
 * Uso: node scripts/debug/pi-kit-image-loop.mjs [--no-image] [--with-finish-reason]
 */
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HarnessAgent } from '@ai-sdk/harness/agent';
import { createPi } from '@ai-sdk/harness-pi';
import { createJustBashSandbox } from '@ai-sdk/sandbox-just-bash';

const args = new Set(process.argv.slice(2));
const SEND_IMAGE = !args.has('--no-image');
const SEND_FINISH_REASON = args.has('--with-finish-reason');
// S5: il turno termina normalmente ma l'ultimo messaggio contiene una tool call che nessuno
// esegue (finish_reason 'stop', non 'tool_calls'): message_end aggiunge l'id ai pending,
// turn_end non chiude lo step e l'adattatore emette il finish terminale → crash harness.
const ORPHAN_TOOLCALL = args.has('--orphan-toolcall');
// S6: errore di stream DOPO una tool call → pi-agent-core emette turn_end con il messaggio
// che contiene ancora la tool call (stopReason 'error', nessun tool-result) → pending non
// svuotato, step aperto, finish terminale → crash "unclosed step content". La forma del crash
// di produzione (glm su openrouter, run c0c11b3d).
const ERROR_AFTER_TOOLCALL = args.has('--error-after-toolcall');
// S2: glm-like — provider 'openrouter' senza finish_reason: attiva supportsFinishReason=false
// del patch pi-ai e riproduce il crash "unclosed step content" visto in produzione.
const GLM_MODE = args.has('--glm');
// S3: OpenRouter VERO (chiave da .env), modello reale di produzione. Nessun server finto.
const REAL_MODE = args.has('--real');
const PROVIDER_KEY = REAL_MODE ? 'openrouter' : GLM_MODE ? 'openrouter' : 'fake';

const PORT = 8899 + Math.floor(Math.random() * 100);
let lastRequestBody = null;

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      lastRequestBody = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const sse = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      sse({ id: '1', object: 'chat.completion.chunk', model: 'fake-model', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
      // glm-style: reasoning prima del testo, come si vede in produzione su openrouter.
      sse({ id: '2', object: 'chat.completion.chunk', model: 'fake-model', choices: [{ index: 0, delta: { reasoning_content: 'the user attached something' }, finish_reason: null }] });
      sse({ id: '3', object: 'chat.completion.chunk', model: 'fake-model', choices: [{ index: 0, delta: { content: 'I received ' + (JSON.stringify(lastRequestBody.messages.at(-1).content).includes('image_url') ? 'AN IMAGE' : 'TEXT ONLY') }, finish_reason: null }] });
      if (ORPHAN_TOOLCALL) {
        sse({ id: '5', object: 'chat.completion.chunk', model: 'fake-model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_orphan', type: 'function', function: { name: 'nonexistent_tool', arguments: '{}' } }] }, finish_reason: null }] });
        sse({ id: '6', object: 'chat.completion.chunk', model: 'fake-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      } else if (ERROR_AFTER_TOOLCALL) {
        sse({ id: '5', object: 'chat.completion.chunk', model: 'fake-model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_orphan', type: 'function', function: { name: 'nonexistent_tool', arguments: '{}' } }] }, finish_reason: null }] });
        if (args.has('--socket-cut')) {
          // Troncamento AL SOCKET, senza frame d'errore: pi-ai marca il messaggio
          // 'aborted' → l'agent-loop termina NORMALMENTE (turn_end → agent_end) con la
          // tool call mai eseguita → step aperto al finish terminale.
          setTimeout(() => res.destroy(), 20);
          return;
        }
        // Errore del provider a metà stream, dopo la tool call.
        res.write(`data: ${JSON.stringify({ error: { message: 'upstream overloaded', code: 500 } })}\n\n`);
        res.end();
        return;
      } else {
        sse({ id: '4', object: 'chat.completion.chunk', model: 'fake-model', choices: [{ index: 0, delta: {}, finish_reason: SEND_FINISH_REASON ? 'stop' : null }] });
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
    return;
  }
  res.writeHead(404).end();
});

await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));

const agentDir = mkdtempSync(join(tmpdir(), 'pi-loop-'));
const REAL_MODEL = process.env.OPENROUTER_REAL_MODEL || 'z-ai/glm-5.3-flash';
writeFileSync(
  join(agentDir, 'models.json'),
  JSON.stringify({
    providers: {
      [PROVIDER_KEY]: {
        baseUrl: REAL_MODE ? 'https://openrouter.ai/api/v1' : `http://127.0.0.1:${PORT}/v1`,
        api: 'openai-completions',
        apiKey: REAL_MODE ? process.env.OPENROUTER_API_KEY : 'test-key',
        models: [{ id: REAL_MODE ? REAL_MODEL : 'fake-model', input: ['text', 'image'] }]
      }
    }
  })
);

const harness = createPi({ agentDir, model: `${PROVIDER_KEY}/${REAL_MODE ? REAL_MODEL : 'fake-model'}` });
const agent = new HarnessAgent({
  harness,
  sandbox: createJustBashSandbox(),
  instructions: 'You are a test agent.',
  tools: {},
  stopWhen: []
});

const session = await agent.createSession({ sessionId: 'loop-session' });

const IMAGE_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// La forma che produce MESSAGESFROMROW su un redo: l'URL remoto come OGGETTO URL
// (attachmentParts fa `new URL(url)`), non una stringa.
const IMAGE_REMOTE_URL = process.env.LOOP_IMAGE_URL
  ?? 'https://kszazivzwievqixcnanp.supabase.co/storage/v1/object/public/media/bd58d38a-b6ce-4e17-a909-1a334f8bf09f/chat/35572eac-2294-4878-92c3-e6a5c0769220.jpeg';
const imagePart = REAL_MODE ? { type: 'image', image: new URL(IMAGE_REMOTE_URL) } : { type: 'image', image: IMAGE_1PX };
const messages = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Cosa vede nella img?' },
      ...(SEND_IMAGE ? [imagePart] : [])
    ]
  }
];

const events = [];
const modelText = [];
const partErrors = [];

// Copia di stripProviderRefs (src/lib/agent/bridge/provider-refs.ts) — il passo che runKitTurn
// fa su OGNI messaggio prima di passarli all'harness. --strip lo applica al loop.
function stripProviderRefs(value) {
  if (Array.isArray(value)) return value.map(stripProviderRefs);
  if (value instanceof URL) return value.toString();
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'providerOptions' || k === 'providerMetadata') continue;
      out[k] = stripProviderRefs(v);
    }
    return out;
  }
  return value;
}
const APPLY_STRIP = args.has('--strip');
// S4: abort a metà stream (Stop dell'utente / watchdog del silenzio). Il pi adapter deve
// chiudere lo step aperto PRIMA dell'evento di errore, o l'harness muore con
// "received terminal finish with unclosed step content".
const ABORT_MODE = args.has('--abort');
const abortController = new AbortController();

// Intercetta il body HTTP reale inviato al provider (solo modalità --real).
let wireBody = null;
const origFetch = globalThis.fetch;
if (REAL_MODE) {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    if (url.includes('/chat/completions') && init?.body) {
      try { wireBody = JSON.parse(String(init.body)); } catch { /* lascia passare */ }
    }
    return origFetch(input, init);
  };
}

let textDeltasSeen = 0;
const result = await agent.stream({
  session,
  messages: APPLY_STRIP ? stripProviderRefs(messages) : messages,
  abortSignal: ABORT_MODE ? abortController.signal : undefined
});
for await (const part of result.fullStream) {
  events.push(part.type);
  if (part.type === 'text-delta') {
    modelText.push(part.delta ?? part.textDelta ?? part.text ?? '');
    // Abort DOPO il primo contenuto: lo step è aperto e pieno, come nel crash di produzione.
    textDeltasSeen += 1;
    if (ABORT_MODE && textDeltasSeen === 3 && !abortController.signal.aborted) {
      console.log('  [loop] abort a metà stream (contenuto aperto)');
      abortController.abort(new Error('user stop'));
    }
  }
  if (part.type === 'error') {
    partErrors.push(part.error?.message ?? String(part.error));
    console.log('  [event error]', part.error?.message ?? part.error);
  }
}

const hadFinishStep = events.includes('finish-step');
const hadFinish = events.includes('finish');
const finishOrderOk = hadFinish && events.indexOf('finish-step') < events.indexOf('finish');
const lastMsg = lastRequestBody?.messages?.at(-1);
const providerSawImage = JSON.stringify(lastMsg?.content ?? '').includes('image_url');
const modelSawImage = (lastRequestBody && JSON.stringify(lastRequestBody)) ? undefined : null;

console.log('--- VERDETTO ---');
console.log('risposta del modello:', modelText.join('').slice(0, 400) || '(vuota)');
console.log('eventi:', events.join(' '));
if (REAL_MODE) {
  const lastWire = wireBody?.messages?.at(-1);
  console.log('body HTTP → provider, ultimo messaggio:', lastWire ? JSON.stringify(lastWire.content).slice(0, 300) : 'NON CATTURATO');
}
console.log('provider ha ricevuto una parte immagine:', providerSawImage ? 'SÌ' : 'NO — il modello vede solo testo/URL');
console.log('finish-step prima di finish:', finishOrderOk ? 'SÌ' : 'NO — turno muore con unclosed step content');

let failed = false;
if (ABORT_MODE || ERROR_AFTER_TOOLCALL) {
  const sawUnclosedStep = partErrors.join(' ').includes('unclosed step content');
  if (sawUnclosedStep) {
    console.log('RED: il crash "unclosed step content" è riprodotto');
    failed = true;
  } else {
    console.log('GREEN: nessun crash "unclosed step content" — il turno si chiude con un evento terminale pulito');
  }
  if (!REAL_MODE) server.close();
  process.exit(failed ? 1 : 0);
}
if (SEND_IMAGE && REAL_MODE && !/image|foto|immagine|pixel|photo/i.test(modelText.join(''))) {
  console.log('RED: il modello non riferisce di avere ricevuto un\'immagine');
  failed = true;
}
if (SEND_IMAGE && !REAL_MODE && !providerSawImage) { console.log('RED: le immagini non raggiungono il provider'); failed = true; }
if (!finishOrderOk) { console.log('RED: ordine finish-step/finish violato'); failed = true; }
if (!failed) console.log('GREEN: immagini consegnate e turno chiuso correttamente');

if (!REAL_MODE) server.close();
process.exit(failed ? 1 : 0);
