import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Il registro è l'unico posto dove il costo diventa visibile, quindi il test lo guarda da lì.
const logged: Array<Record<string, unknown>> = [];
vi.mock(import('$lib/server/ai-log'), async (importOriginal) => ({
  ...(await importOriginal()),
  logAiCall: (e: Record<string, unknown>) => {
    logged.push(e);
  }
}));

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** La richiesta come `buildImageRequest` la produce davvero: testo + parti inline. */
function geminiRequest(parts: Array<Record<string, unknown>>, aspectRatio = '4:5') {
  return {
    model: 'gemini-3-pro-image-preview',
    contents: [{ parts }],
    config: { imageConfig: { aspectRatio } }
  };
}

describe('buildKieImageInput', () => {
  it('accetta solo i rapporti d\'aspetto dell\'enum di kie, e ripiega su 1:1', async () => {
    const { buildKieImageInput } = await import('./kie-jobs');
    // I quattro che il prodotto usa davvero passano intatti.
    for (const ar of ['1:1', '4:5', '9:16', '16:9']) {
      expect(buildKieImageInput({ prompt: 'x', aspectRatio: ar }).aspect_ratio).toBe(ar);
    }
    // 99:1 su kie è un 500 alla submit: qui diventa un render valido invece di un render perso.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(buildKieImageInput({ prompt: 'x', aspectRatio: '99:1' }).aspect_ratio).toBe('1:1');
    expect(buildKieImageInput({ prompt: 'x', aspectRatio: '3:1' }).aspect_ratio).toBe('1:1');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('la risoluzione è maiuscola: "2k" non deve mai finire nel payload', async () => {
    const { buildKieImageInput } = await import('./kie-jobs');
    expect(buildKieImageInput({ prompt: 'x', resolution: '2K' }).resolution).toBe('2K');
    // Il default (1K, o quello che dice KIE_IMAGE_RESOLUTION) è comunque nella forma maiuscola:
    // `"2k"` torna 500, e un env scritto a mano è esattamente da dove arriverebbe.
    expect(String(buildKieImageInput({ prompt: 'x' }).resolution)).toMatch(/^[124]K$/);
  });

  it('i riferimenti sono URL in image_input, al massimo 8', async () => {
    const { buildKieImageInput, KIE_IMAGE_INPUT_MAX } = await import('./kie-jobs');
    expect(KIE_IMAGE_INPUT_MAX).toBe(8);
    expect(buildKieImageInput({ prompt: 'x' }).image_input).toBeUndefined();
    const many = Array.from({ length: 10 }, (_, i) => `https://ref/${i}.png`);
    expect(buildKieImageInput({ prompt: 'x', refUrls: many }).image_input).toHaveLength(
      KIE_IMAGE_INPUT_MAX
    );
  });

  // Un riferimento perso all'upload fa fallire il render apposta ("non è un dettaglio: è la foto del
  // prodotto vero"). Perderlo per aritmetica costava esattamente lo stesso e non lasciava traccia.
  it('quando ne arrivano più di 8 lo dice, invece di scartarli in silenzio', async () => {
    const { buildKieImageInput } = await import('./kie-jobs');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    buildKieImageInput({ prompt: 'x', refUrls: Array.from({ length: 8 }, (_, i) => `https://ref/${i}.png`) });
    expect(warn).not.toHaveBeenCalled();
    buildKieImageInput({ prompt: 'x', refUrls: Array.from({ length: 11 }, (_, i) => `https://ref/${i}.png`) });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('3 scartati');
    warn.mockRestore();
  });
});

describe('kieImageModel', () => {
  it('mappa gli id Gemini sui gemelli kie', async () => {
    const { kieImageModel } = await import('./kie-jobs');
    expect(kieImageModel('gemini-3-pro-image-preview')).toBe('nano-banana-pro');
    expect(kieImageModel('gemini-3.1-flash-image')).toBe('nano-banana-2');
    expect(kieImageModel(undefined)).toBe('nano-banana-2');
  });
});

describe('generateImageOnKie', () => {
  let calls: Array<{ url: string; body?: unknown }> = [];

  beforeEach(() => {
    logged.length = 0;
    calls = [];
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('file-base64-upload')) {
        return new Response(JSON.stringify({ data: { downloadUrl: `https://tempfile.kie/${calls.length}.png` } }), {
          status: 200
        });
      }
      if (url.includes('createTask')) {
        return new Response(JSON.stringify({ code: 200, data: { taskId: 'task_1' } }), { status: 200 });
      }
      if (url.includes('recordInfo')) {
        return new Response(
          JSON.stringify({
            data: {
              state: 'success',
              // Misurato: camelCase, e SOLO sul poll.
              creditsConsumed: 18,
              resultJson: JSON.stringify({ resultUrls: ['https://tempfile.kie/out.png'] })
            }
          }),
          { status: 200 }
        );
      }
      // il download del risultato
      return new Response(Buffer.from(PNG_B64, 'base64'), {
        status: 200,
        headers: { 'content-type': 'image/png' }
      });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('passa ogni riferimento inline dal ponte base64→URL prima di mandare il job', async () => {
    const { generateImageOnKie } = await import('./kie-jobs');
    const req = geminiRequest([
      { text: 'un prodotto su lino chiaro' },
      { inlineData: { mimeType: 'image/png', data: PNG_B64 } },
      { inlineData: { mimeType: 'image/jpeg', data: PNG_B64 } }
    ]);
    const out = await generateImageOnKie(req);

    // Due riferimenti inline = due giri di ponte, uno per immagine.
    const uploads = calls.filter((c) => c.url.includes('file-base64-upload'));
    expect(uploads).toHaveLength(2);
    // Il ponte riceve un data URL, e un NOME UNIVOCO: due render in parallelo con lo stesso nome
    // si sovrascriverebbero il riferimento a vicenda.
    const bodies = uploads.map((u) => u.body as { base64Data: string; fileName: string });
    expect(bodies[0].base64Data.startsWith('data:image/png;base64,')).toBe(true);
    expect(bodies[1].base64Data.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(bodies[0].fileName).not.toBe(bodies[1].fileName);

    // Il job riceve URL, mai base64: un data URL in image_input torna 500.
    const submit = calls.find((c) => c.url.includes('createTask'))!.body as {
      model: string;
      input: { image_input: string[]; aspect_ratio: string; resolution: string };
    };
    expect(submit.model).toBe('nano-banana-pro');
    expect(submit.input.image_input).toEqual(['https://tempfile.kie/1.png', 'https://tempfile.kie/2.png']);
    expect(submit.input.image_input.every((u) => u.startsWith('https://'))).toBe(true);
    expect(submit.input.aspect_ratio).toBe('4:5');
    expect(submit.input.resolution).toMatch(/^[124]K$/);

    // L'URL di kie vive 24h: quello che esce di qui è già un data URL scaricato.
    expect(out?.startsWith('data:image/png;base64,')).toBe(true);
    expect(out).not.toContain('tempfile.kie');
  });

  it('senza riferimenti non tocca il ponte', async () => {
    const { generateImageOnKie } = await import('./kie-jobs');
    await generateImageOnKie(geminiRequest([{ text: 'solo testo' }], '1:1'));
    expect(calls.filter((c) => c.url.includes('file-base64-upload'))).toHaveLength(0);
  });

  it('il costo viene da creditsConsumed, non da una tariffa a listino', async () => {
    const { generateImageOnKie } = await import('./kie-jobs');
    await generateImageOnKie(geminiRequest([{ text: 'x' }]));
    const entry = logged.at(-1)!;
    expect(entry.provider).toBe('kie');
    expect(entry.model).toBe('nano-banana-pro');
    expect(entry.providerCredits).toBe(18);
    // 18 crediti × $0.005 = $0.09. Il listino Google per lo stesso render è $0.1344: se qui
    // comparisse quel numero, staremmo fatturando 1.5× il dovuto senza che nulla dia errore.
    expect(entry.flatCostUsd).toBe(0.09);
  });

  it('senza crediti sul poll il costo resta nullo, mai stimato', async () => {
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input);
      if (url.includes('createTask')) return new Response(JSON.stringify({ data: { taskId: 't' } }), { status: 200 });
      if (url.includes('recordInfo')) {
        return new Response(
          JSON.stringify({
            data: { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://tempfile.kie/o.png'] }) }
          }),
          { status: 200 }
        );
      }
      return new Response(Buffer.from(PNG_B64, 'base64'), { status: 200, headers: { 'content-type': 'image/png' } });
    });
    const { generateImageOnKie, kieFlatCostUsd } = await import('./kie-jobs');
    await generateImageOnKie(geminiRequest([{ text: 'x' }]));
    const entry = logged.at(-1)!;
    expect(entry.flatCostUsd).toBeUndefined();
    expect(kieFlatCostUsd(undefined)).toBeUndefined();
    expect(kieFlatCostUsd(0.62)).toBe(0.0031); // la voce: 0.62 crediti misurati per 4.4s
  });

  it('un riferimento che non sale è un fallimento, non un render senza il prodotto', async () => {
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input);
      if (url.includes('file-base64-upload')) return new Response('nope', { status: 500 });
      throw new Error(`non doveva chiamare ${url}`);
    });
    const { generateImageOnKie } = await import('./kie-jobs');
    const out = await generateImageOnKie(
      geminiRequest([{ text: 'x' }, { inlineData: { mimeType: 'image/png', data: PNG_B64 } }])
    );
    expect(out).toBeUndefined();
    expect(logged.at(-1)).toMatchObject({ ok: false, provider: 'kie' });
  });
});

describe('generateSpeechOnKie', () => {
  it('la direzione di recitazione sta in sample_context, mai nel testo da leggere', async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const wav = Buffer.from('RIFF....WAVEfmt ', 'ascii');
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('createTask')) return new Response(JSON.stringify({ data: { taskId: 't' } }), { status: 200 });
      if (url.includes('recordInfo')) {
        return new Response(
          JSON.stringify({
            data: {
              state: 'success',
              creditsConsumed: 0.62,
              resultJson: JSON.stringify({ resultUrls: ['https://file.kie/voice.wav'] })
            }
          }),
          { status: 200 }
        );
      }
      return new Response(wav, { status: 200 });
    });
    const { generateSpeechOnKie } = await import('./kie-jobs');
    const out = await generateSpeechOnKie({
      lines: ['Prima riga.', 'Seconda riga.'],
      direction: 'Read this aloud, calm and matter-of-fact. Pause for a full beat between paragraphs.',
      voiceName: 'Kore',
      languageCode: 'it-IT'
    });

    const submit = calls.find((c) => c.url.includes('createTask'))!.body as {
      model: string;
      input: {
        sample_context: string;
        speakers: Array<{ speaker_id: string; voice_name: string; accent: string; style?: string }>;
        dialogue_turns: Array<{ speaker_id: string; text: string }>;
      };
    };
    expect(submit.model).toContain('tts');
    // Una battuta per riga: fra un turno e l'altro il modello lascia ~270ms, sopra la soglia di default di 180ms di findGaps (minSilenceMs) — è così che il taglio per riga continua a funzionare.
    expect(submit.input.dialogue_turns.map((t) => t.text)).toEqual(['Prima riga.', 'Seconda riga.']);
    // L'istruzione NON deve stare nel testo: lì verrebbe letta ad alta voce.
    expect(submit.input.dialogue_turns.some((t) => /Read this aloud/.test(t.text))).toBe(false);
    expect(submit.input.sample_context).toContain('Read this aloud');
    expect(submit.input.sample_context).toContain('it-IT');
    // `style` su kie è un enum di sei valori: passarci una frase torna 422.
    expect(submit.input.speakers[0].style).toBeUndefined();
    expect(submit.input.speakers[0]).toMatchObject({ speaker_id: 'Speaker 1', voice_name: 'Kore', accent: 'Neutral' });

    expect(out?.credits).toBe(0.62);
    expect(out?.wav.equals(wav)).toBe(true);
    vi.unstubAllGlobals();
  });
});
