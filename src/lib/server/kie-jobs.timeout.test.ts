import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * UN TASK SCADUTO NON È UN TASK FALLITO, e trattarli allo stesso modo costa due volte.
 *
 * `pollKieTask` restituiva `undefined` per entrambi: kie ha rifiutato il lavoro, oppure kie lo sta
 * ancora facendo e noi abbiamo smesso di guardare. Il chiamante non poteva distinguerli, quindi
 * ritentava — aprendo un task NUOVO mentre il primo continuava a renderizzare. kie fattura tutti e
 * due. E il costo si scrive solo dal ramo `success`, quindi il task abbandonato non lascia nessuna
 * riga: invisibile da noi, addebitato da loro. È la differenza che si vede fra il loro cruscotto e
 * i nostri numeri.
 *
 * Il test guarda UNA cosa: quante volte si è chiamato createTask. Se dopo una scadenza ne compare
 * un secondo, stiamo pagando due volte lo stesso lavoro.
 */

const CREATE = 'https://api.kie.ai/api/v1/jobs/createTask';
const INFO = 'https://api.kie.ai/api/v1/jobs/recordInfo';

let created: number;
let infoCalls: string[];
let states: string[];

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

beforeEach(() => {
  created = 0;
  infoCalls = [];
  states = [];
  vi.stubEnv('KIE_API_KEY', 'test-key');

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith(CREATE)) {
        created += 1;
        return jsonResponse({ data: { taskId: `task-${created}` } });
      }

      if (url.startsWith(INFO)) {
        const taskId = new URL(url).searchParams.get('taskId') ?? '';
        infoCalls.push(taskId);
        const state = states.shift() ?? 'waiting';
        if (state === 'success') {
          return jsonResponse({
            data: {
              state: 'success',
              resultJson: JSON.stringify({ resultUrls: ['https://cdn.test/img.png'] }),
              creditsConsumed: 12
            }
          });
        }
        return jsonResponse({ data: { state } });
      }

      // Il download del risultato.
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' }
      });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('pollKieTask distingue scaduto da fallito', () => {
  it('uno SCADUTO si riconosce, e porta con sé il taskId da riprendere', async () => {
    const { pollKieTask } = await import('./kie-jobs');
    states = ['waiting'];

    // Un solo giro: la finestra è più corta dell'intervallo, quindi scade subito.
    const out = await pollKieTask('task-1', 1, undefined, 'test', 1);

    expect(out).toEqual({ status: 'timeout', taskId: 'task-1' });
  });

  it('un RIFIUTATO si riconosce, e dice perché', async () => {
    const { pollKieTask } = await import('./kie-jobs');
    states = ['fail'];

    const out = await pollKieTask('task-1', 10_000, undefined, 'test', 1);

    expect(out).toMatchObject({ status: 'failed', taskId: 'task-1' });
  });

  it('un RIUSCITO porta url, taskId e i crediti che kie ha addebitato', async () => {
    const { pollKieTask } = await import('./kie-jobs');
    states = ['success'];

    const out = await pollKieTask('task-1', 10_000, undefined, 'test', 1);

    expect(out).toMatchObject({
      status: 'done',
      taskId: 'task-1',
      url: 'https://cdn.test/img.png',
      credits: 12
    });
  });
});

describe('generateImageOnKie riprende invece di riaprire', () => {
  const req = {
    model: 'gemini-3.1-flash-lite-image',
    contents: [{ role: 'user', parts: [{ text: 'un banco di lavoro in noce' }] }],
    config: { responseModalities: ['TEXT', 'IMAGE'] }
  };

  it('riprende il task scaduto invece di aprirne un altro', async () => {
    const { generateImageOnKie } = await import('./kie-jobs');
    states = ['success'];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await generateImageOnKie(req as any, { resumeTaskId: 'task-scaduto' });

    // Il fatto che conta: nessun task nuovo. Il lavoro che kie sta già facendo è quello che si aspetta.
    expect(created).toBe(0);
    expect(infoCalls).toEqual(['task-scaduto']);
    expect(out.dataUrl).toBeTruthy();
  });

  it('senza un task da riprendere ne apre uno, come sempre', async () => {
    const { generateImageOnKie } = await import('./kie-jobs');
    states = ['success'];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await generateImageOnKie(req as any, {});

    expect(created).toBe(1);
  });

  it('una scadenza lascia una riga: paghiamo senza sapere quanto, e si deve vedere', async () => {
    const logged: Array<Record<string, unknown>> = [];
    vi.doMock('$lib/server/ai-log', () => ({
      logAiCall: (e: Record<string, unknown>) => logged.push(e),
      withBrandContext: <T,>(_b: string, fn: () => T) => fn(),
      getBrandContext: () => undefined
    }));
    vi.resetModules();

    const { generateImageOnKie } = await import('./kie-jobs');
    states = ['waiting'];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await generateImageOnKie({ model: 'm', contents: [{ role: 'user', parts: [{ text: 'x' }] }] } as any, {
      timeoutMs: 1
    });

    const row = logged.at(-1)!;
    expect(row.provider).toBe('kie');
    expect(row.ok).toBe(false);
    // Il costo NON si inventa: kie lo addebita, noi non sappiamo quanto finche' il task non finisce.
    expect(row.flatCostUsd).toBeUndefined();
    expect(String(row.error)).toContain('task-1');
    expect(String(row.error)).toContain('scaduto');

    vi.doUnmock('$lib/server/ai-log');
    vi.resetModules();
  });

  it('una scadenza restituisce il taskId da riprendere, non un fallimento muto', async () => {
    const { generateImageOnKie } = await import('./kie-jobs');
    states = ['waiting'];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await generateImageOnKie(req as any, { timeoutMs: 1 });

    expect(out.dataUrl).toBeUndefined();
    expect(out.timedOutTaskId).toBe('task-1');
  });
});
