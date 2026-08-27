import { describe, expect, it } from 'vitest';
import { KIE_TIMEOUT_MS, shouldRetryKie } from './kie';

/**
 * QUANDO SI RIPROVA UNA CHIAMATA KIE, E QUANDO NO.
 *
 * Non è una preferenza: sono due specie di fallimento misurate su 60 giorni di `ai_calls`.
 * Il 524 di kie arriva dal bordo Cloudflare dopo ~125s (tre campioni: 125034, 125034, 125037ms) e
 * riprovarlo significherebbe quattro minuti d'attesa per due fallimenti. Gli `HTTP 500` e i
 * `Server exception` invece tornano in 1,5-17s: sono singhiozzi, e l'unica cosa che li rendeva
 * fatali era che nessuno riprovava.
 *
 * (File a parte da `kie.test.ts`, che mocka l'intero modulo per provare il ripiego su Gemini.)
 */
describe('shouldRetryKie', () => {
  it('retries the fast failures that were measured in production', () => {
    for (const ms of [1499, 1616, 3949, 4413, 4746, 11017, 17408]) {
      expect(shouldRetryKie(ms), `${ms}ms`).toBe(true);
    }
  });

  it('never retries a call that already burned the timeout', () => {
    expect(shouldRetryKie(KIE_TIMEOUT_MS)).toBe(false);
    // I tre 524 reali, che oggi non arrivano nemmeno più fin qui: il timeout taglia prima.
    for (const ms of [125034, 125037]) expect(shouldRetryKie(ms), `${ms}ms`).toBe(false);
  });

  it("cuts before kie's own edge gives up, so the wait is ours and not theirs", () => {
    expect(KIE_TIMEOUT_MS).toBeLessThan(125_000);
    // …ma sopra il p90 dei successi misurati (78s), o taglieremmo lavoro buono.
    expect(KIE_TIMEOUT_MS).toBeGreaterThan(78_197);
  });
});
