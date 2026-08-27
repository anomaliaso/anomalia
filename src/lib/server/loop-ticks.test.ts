import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_RUN_MS,
  DEFAULT_MIN_RUN_MS,
  DEFAULT_RESERVE_MS,
  DEFAULT_WALL_MS,
  nextRunBudgetMs
} from './loop-ticks';

describe('nextRunBudgetMs', () => {
  it('gives the first brand the per-run ceiling, not the whole window', () => {
    // Un solo brand non deve poter prendersi 280s: il tetto per run esiste perché un agente
    // impantanato non si mangi il tick di tutti gli altri.
    expect(nextRunBudgetMs({ elapsedMs: 0 })).toBe(DEFAULT_MAX_RUN_MS);
  });

  it('shrinks the budget as the window is consumed', () => {
    // 300s - 20s di riserva - 200s spesi = 80s: meno del tetto, quindi è il residuo a decidere.
    expect(nextRunBudgetMs({ elapsedMs: 200_000 })).toBe(80_000);
  });

  it('refuses to start a run that cannot finish', () => {
    // 300 - 20 - 250 = 30s: sotto il minimo. Meglio `no_budget` (che è un dato) che un run
    // ucciso da Vercel a metà — che è il bug che questa funzione esiste per non riavere.
    expect(nextRunBudgetMs({ elapsedMs: 250_000 })).toBeNull();
  });

  it('returns exactly the minimum at the boundary, and null one millisecond later', () => {
    const atFloor = DEFAULT_WALL_MS - DEFAULT_RESERVE_MS - DEFAULT_MIN_RUN_MS;
    expect(nextRunBudgetMs({ elapsedMs: atFloor })).toBe(DEFAULT_MIN_RUN_MS);
    expect(nextRunBudgetMs({ elapsedMs: atFloor + 1 })).toBeNull();
  });

  it('never returns a budget once the window is blown', () => {
    expect(nextRunBudgetMs({ elapsedMs: DEFAULT_WALL_MS })).toBeNull();
    expect(nextRunBudgetMs({ elapsedMs: DEFAULT_WALL_MS * 10 })).toBeNull();
  });

  it('treats a negative or non-finite elapsed as zero rather than inventing extra window', () => {
    expect(nextRunBudgetMs({ elapsedMs: -5_000 })).toBe(DEFAULT_MAX_RUN_MS);
    expect(nextRunBudgetMs({ elapsedMs: Number.NaN })).toBe(DEFAULT_MAX_RUN_MS);
  });

  it('honours caller overrides for shorter windows', () => {
    // Un tick con maxDuration=60 non eredita le costanti dei 300s — e deve abbassare ANCHE il
    // minimo: una finestra corta con il floor di default rifiuta ogni run (che è la direzione
    // sicura in cui sbagliare, ma non è quello che il chiamante voleva).
    const short = { wallMs: 60_000, reserveMs: 5_000, maxRunMs: 30_000, minRunMs: 10_000 };
    expect(nextRunBudgetMs({ elapsedMs: 0, ...short })).toBe(30_000);
    expect(nextRunBudgetMs({ elapsedMs: 30_000, ...short })).toBe(25_000);
    expect(nextRunBudgetMs({ elapsedMs: 50_000, ...short })).toBeNull();
    // Senza minRunMs, gli stessi 25s residui non bastano al floor di default: null.
    expect(nextRunBudgetMs({ elapsedMs: 30_000, wallMs: 60_000, reserveMs: 5_000, maxRunMs: 30_000 })).toBeNull();
  });

  it('lets a caller lower the floor when its runs are genuinely short', () => {
    // 300 - 20 - 285 = -5 → null a qualunque soglia: la riserva non è negoziabile.
    expect(nextRunBudgetMs({ elapsedMs: 285_000, minRunMs: 1_000 })).toBeNull();
    // Ma con 265s spesi restano 15s: rifiutati col minimo di default, accettati se il chiamante
    // dichiara che i suoi run durano meno.
    expect(nextRunBudgetMs({ elapsedMs: 265_000 })).toBeNull();
    expect(nextRunBudgetMs({ elapsedMs: 265_000, minRunMs: 10_000 })).toBe(15_000);
  });
});
