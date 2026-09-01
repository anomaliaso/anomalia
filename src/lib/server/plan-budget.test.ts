import { describe, expect, it } from 'vitest';
import { PRODUCTION_MARGIN, productionCredits, weeklyCredits } from './plan-budget';

// I crediti di ogni piano erano tre numeri scritti a mano, con margini che nessuno aveva scelto:
// 28% su Go, 38% su Starter, 47% su Pro. Ora derivano dal prezzo e da un margine dichiarato, così
// cambiare il listino non lascia indietro il budget.
describe('productionCredits', () => {
  it('lascia il margine dichiarato su ogni piano', () => {
    expect(productionCredits('starter')).toBe(Math.round(89 * (1 - PRODUCTION_MARGIN.standard) * 100));
    expect(productionCredits('pro')).toBe(Math.round(225 * (1 - PRODUCTION_MARGIN.standard) * 100));
  });

  it('Go ha il margine più basso: è il piano di ingresso', () => {
    expect(PRODUCTION_MARGIN.go).toBeLessThan(PRODUCTION_MARGIN.standard);
    expect(productionCredits('go')).toBe(Math.round(29 * (1 - PRODUCTION_MARGIN.go) * 100));
  });

  it('un piano più caro porta più budget', () => {
    expect(productionCredits('pro')).toBeGreaterThan(productionCredits('starter'));
    expect(productionCredits('starter')).toBeGreaterThan(productionCredits('go'));
  });

  it('un piano sconosciuto non regala budget', () => {
    expect(productionCredits('inventato')).toBe(0);
    expect(productionCredits(null)).toBe(0);
  });
});

// Il pezzo che chiudeva il cerchio: quanti post fare in una settimana non è un numero scritto da
// nessuna parte — è quello che i crediti di quella settimana permettono, e lo decide chi pianifica
// guardando il listino. Qui si dice solo quanti crediti tocca a una settimana.
describe('weeklyCredits', () => {
  it('divide il budget del mese sulle settimane del ciclo', () => {
    expect(weeklyCredits('pro', 4)).toBe(Math.floor(productionCredits('pro') / 4));
  });

  it('un batch più lungo porta con sé più budget', () => {
    expect(weeklyCredits('pro', 4) * 2).toBeCloseTo(weeklyCredits('pro', 2), -1);
  });

  it('quello che resta davvero vince sulla quota teorica', () => {
    expect(weeklyCredits('pro', 4, 300)).toBe(300);
  });

  it('non scende sotto zero', () => {
    expect(weeklyCredits('go', 4, -50)).toBe(0);
  });
});
