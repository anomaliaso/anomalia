import { describe, expect, it, vi } from 'vitest';

// Senza questo, il test leggeva il .env dello sviluppatore: con WEEK_PLANNER_AGENT_ENABLED=false
// in locale falliva sempre, e quello che verificava non era il default ma la macchina.
vi.mock('$env/dynamic/private', () => ({ env: {} }));
import { MAX_WEEK_PLANNER_DRAFTS, MAX_WEEK_PLANNER_RESEARCH, mergeSeeds, normalizeSeeds, weekPlannerAgentEnabled } from './week-planner-agent';
import { consumeDraftBudget, createStrategyBudget } from './strategy-agent';

describe('week planner agent', () => {
  it('is enabled by default (opt-out via WEEK_PLANNER_AGENT_ENABLED=false)', () => {
    expect(weekPlannerAgentEnabled()).toBe(true);
  });

  it('rejects draft_seeds beyond the per-run cap', () => {
    const budget = createStrategyBudget({ drafts: MAX_WEEK_PLANNER_DRAFTS });
    for (let i = 0; i < MAX_WEEK_PLANNER_DRAFTS; i++) {
      expect(consumeDraftBudget(budget).ok).toBe(true);
    }
    expect(consumeDraftBudget(budget).ok).toBe(false);
  });
});

// Il planner non è mai uscito sul web: i suoi tool leggono solo dentro il brand. Così una battuta
// che nomina un modulo, una norma o un messaggio d'errore lo INVENTA, e sembra pure verificabile.
// Il tetto esiste perché ogni ricerca costa: senza, un agente curioso brucia il budget del batch.
describe('tetto alle ricerche', () => {
  it('conta le ricerche e si ferma al tetto', () => {
    let used = 0;
    const allow = () => (used++ < MAX_WEEK_PLANNER_RESEARCH);
    const results = Array.from({ length: MAX_WEEK_PLANNER_RESEARCH + 2 }, allow);
    expect(results.filter(Boolean)).toHaveLength(MAX_WEEK_PLANNER_RESEARCH);
    expect(results[MAX_WEEK_PLANNER_RESEARCH]).toBe(false);
  });

  // Il tetto deve reggere il protocollo narrativo — cerca i racconti, scegline uno, approfondisci
  // QUELLO — e restare comunque un tetto: ogni chiamata costa e il budget è del batch, non suo.
  it('regge il protocollo senza diventare illimitato', () => {
    const CERCA = 1, SCEGLI = 1, APPROFONDISCI = 3;
    expect(MAX_WEEK_PLANNER_RESEARCH).toBeGreaterThanOrEqual(CERCA + SCEGLI + APPROFONDISCI);
    expect(MAX_WEEK_PLANNER_RESEARCH).toBeLessThanOrEqual(40);
  });
});

// I tool dell'agente prendono i seed come oggetti liberi, e il modello li RIMANDA: quello che non
// gli è stato descritto lo lascia indietro. Descritto solo `beats`, ha restituito seed senza
// angolo, pillar, giorno e ora — righe di piano vuote e un produttore senza niente da eseguire.
describe('mergeSeeds', () => {
  const drafted = [
    { platform: 'instagram', angle: 'la delega a se stessi', pillar: 'burocrazia', day: 'Monday', time: '09:00' },
    { platform: 'instagram', angle: 'il badge', pillar: 'lavoro', day: 'Thursday', time: '18:00' }
  ];

  it('tiene i campi che il modello non ha rimandato', () => {
    const out = mergeSeeds(drafted, [{ beats: [{ shows: 'a', who: 'b', thinks: 'c' }] }, {}]);
    expect(out[0].angle).toBe('la delega a se stessi');
    expect(out[0].day).toBe('Monday');
    expect(out[0].beats).toHaveLength(1);
    expect(out[1].angle).toBe('il badge');
  });

  it('lascia vincere quello che il modello manda davvero', () => {
    const out = mergeSeeds(drafted, [{ angle: 'angolo riscritto' }]);
    expect(out[0].angle).toBe('angolo riscritto');
    expect(out[0].pillar).toBe('burocrazia');
  });

  it('accetta un seed in più rispetto alla bozza', () => {
    const out = mergeSeeds(drafted, [{}, {}, { platform: 'instagram', angle: 'terzo' }]);
    expect(out).toHaveLength(3);
    expect(out[2].angle).toBe('terzo');
  });

  it('senza bozza restituisce quello che è arrivato', () => {
    const out = mergeSeeds([], [{ angle: 'solo questo' }]);
    expect(out).toEqual([{ angle: 'solo questo' }]);
  });
});

describe('la settimana che il modello scrive', () => {
	it('arriva contata da uno e viene riportata a zero, come la vuole tutto il resto', () => {
		const seeds = normalizeSeeds([
			{ title: "L'albo pretorio", week: 1 },
			{ title: 'La busta paga', week: 2 }
		]);
		expect(seeds.map((s) => s.week)).toEqual([0, 1]);
	});

	it('non inventa una settimana per chi non la porta', () => {
		expect(normalizeSeeds([{ title: 'senza settimana' }])[0].week).toBeUndefined();
	});
});
