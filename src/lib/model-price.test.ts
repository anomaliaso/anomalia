import { describe, it, expect } from 'vitest';
import { usdPerMillion } from './model-price';

describe('prezzo per milione di token', () => {
  /**
   * VISTO nel menu: «GPT-5.6 Luna 1050k · $0.19999999999999998/$1.2 per 1M». Il prezzo arriva dal
   * gateway come dollari per TOKEN e diventa per milione con una moltiplicazione: il binario non
   * ha 0.2, e il menu mostrava diciassette cifre di errore di arrotondamento.
   */
  it('non mostra la coda binaria di una moltiplicazione', () => {
    expect(usdPerMillion(0.19999999999999998)).toBe('$0.2');
    expect(usdPerMillion(0.696)).toBe('$0.696');
  });

  it('tiene le cifre che contano sui modelli economici', () => {
    expect(usdPerMillion(0.075)).toBe('$0.075');
    expect(usdPerMillion(0.0006)).toBe('$0.001');
  });

  it('sui modelli cari basta il centesimo', () => {
    expect(usdPerMillion(5)).toBe('$5');
    expect(usdPerMillion(25)).toBe('$25');
    expect(usdPerMillion(3.7500001)).toBe('$3.75');
  });

  it('gratis è gratis, non "$0.000"', () => {
    expect(usdPerMillion(0)).toBe('free');
  });
});
