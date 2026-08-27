import { describe, expect, it } from 'vitest';
import { clipEventData, createRecorder } from './agent-sessions';
import { noteSecret } from './redact';

/** Un orologio finto: `new Date()` dentro un test rende gli assert dipendenti da quando girano. */
function clock() {
  let t = 1_700_000_000_000;
  return () => (t += 1000);
}

describe('createRecorder', () => {
  it('tiene ordine, tipo ed esito di ogni evento', () => {
    const r = createRecorder(clock());
    r.event('sandbox_exec', { cmd: 'python3' }, { ms: 120, ok: true });
    r.event('sandbox_browse', { url: 'https://example.com' }, { ok: false });

    const events = r.events();
    expect(events.map((e) => e.kind)).toEqual(['sandbox_exec', 'sandbox_browse']);
    expect(events[0].ok).toBe(true);
    expect(events[0].ms).toBe(120);
    expect(events[1].ok).toBe(false);
    expect(r.count()).toBe(2);
  });

  /**
   * Qui dentro passa lo stdout dei comandi: un `pip install` verboso o un `cat` accidentale su un
   * CSV riempiono la riga. Meglio una traccia potata che una tabella che diventa il posto più
   * pesante del database.
   */
  it('tronca i campi lunghi invece di ingoiare un CSV intero', () => {
    const r = createRecorder(clock());
    r.event('sandbox_exec', { stdout: 'x'.repeat(10_000) });
    const stdout = String(r.events()[0].data?.stdout ?? '');
    expect(stdout.length).toBeLessThan(5_000);
    // E dice quanto ha tolto: una troncatura silenziosa si legge come output completo.
    expect(stdout).toContain('…[+');
  });

  it('sopra il tetto smette di accumulare e conta gli scartati', () => {
    const r = createRecorder(clock());
    for (let i = 0; i < 400; i++) r.event('log', { line: `riga ${i}` });
    expect(r.count()).toBe(300);
    expect(r.dropped()).toBe(100);
  });

  it('un evento senza dati resta valido: non tutti hanno un payload', () => {
    const r = createRecorder(clock());
    r.event('start');
    expect(r.events()[0].data).toEqual({});
    expect(r.events()[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('clipEventData', () => {
  it('lascia stare i valori non testuali', () => {
    const out = clipEventData({ exit_code: 0, ok: true, nothing: null });
    expect(out).toEqual({ exit_code: 0, ok: true, nothing: null });
  });

  it('limita gli array lunghi: 500 argomenti non spiegano più di 50', () => {
    const out = clipEventData({ args: Array.from({ length: 500 }, (_, i) => String(i)) });
    expect((out.args as string[]).length).toBe(50);
  });

  it('non lancia su un oggetto annidato grosso', () => {
    const big = { nested: { deep: 'y'.repeat(20_000) } };
    expect(() => clipEventData(big)).not.toThrow();
  });
});

/**
 * I SEGRETI SI TOLGONO ALLA SCRITTURA, ed è il recorder a farlo — prima del taglio.
 *
 * Il tentativo precedente (`redactEventSecrets(events, secrets)`) girava a vuoto: il registro dei
 * valori arrivava sempre vuoto e la funzione usciva dal suo primo `if`. Adesso il valore noto è
 * per BRAND (`redact.ts`) e la redazione sta dentro `event()`, cioè prima che `clipEventData`
 * possa lasciare a mezz'aria il moncone di un token.
 */
describe('redazione alla scrittura', () => {
	const TOK = 'gho_INVENTATO0000aaaaBBBBccccDDDD1111';

	it('toglie il valore esatto dagli input annidati, non solo dal testo in chiaro', () => {
		noteSecret('b-nested', TOK);
		const rec = createRecorder(Date.now, 'b-nested');
		rec.event('tool_call', { tool: 'sandbox_exec', input: { cmd: `curl -H "auth: ${TOK}"` } });
		const j = JSON.stringify(rec.events());
		expect(j).not.toContain('gho_INVE');
		// E non ha cancellato il resto: una redazione che oscura tutto non è una difesa, è un guasto.
		expect(j).toContain('sandbox_exec');
	});

	it('un evento senza payload non diventa un payload finto', () => {
		const rec = createRecorder(Date.now, 'b-none');
		rec.event('turn_start');
		// `clipEventData(undefined)` rende `{}` da sempre: quel che conta è che NON diventi
		// `{redacted:true}`, cioè una bugia su un dato che non è mai esistito.
		expect(rec.events()[0].data).toEqual({});
	});

	it('un brand senza valori coniati passa comunque dagli strati per forma', () => {
		const rec = createRecorder(Date.now, 'b-vuoto');
		rec.event('tool_call', { tool: 'x', input: { k: 'ghp_AAAAAAAAAAAAAAAAAAAAAAAA' } });
		expect(JSON.stringify(rec.events())).not.toContain('ghp_AAAA');
	});
});
