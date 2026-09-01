import { describe, expect, test } from 'vitest';
import { changelogEntries } from './index';

describe('changelog pubblico', () => {
  test('le entry arrivano dalla più recente', () => {
    const ts = changelogEntries.map((entry) => Date.parse(entry.date));
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]).toBeLessThanOrEqual(ts[i - 1]);
    }
  });

  // Il nome del file è la verità: `YYYY-MM-DD-slug.ts`. Una data scritta a mano che non lo
  // rispecchia sposta la entry nel tempo senza che nessuno se ne accorga — e se cade nello stesso
  // giorno di una ISO, l'ordine si rovescia.
  test('ogni data è ISO e coincide con quella del nome del file', () => {
    const files = import.meta.glob('./2*.ts', { eager: true }) as Record<
      string,
      { default: { date: string } }
    >;
    for (const [path, mod] of Object.entries(files)) {
      if (path.endsWith('.test.ts')) continue;
      expect(mod.default.date, path).toBe(path.slice('./'.length, './'.length + 10));
    }
  });

  test('ogni entry ha un titolo e almeno una riga', () => {
    for (const entry of changelogEntries) {
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.items.length).toBeGreaterThan(0);
    }
  });
});
