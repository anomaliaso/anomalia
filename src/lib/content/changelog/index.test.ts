import { describe, expect, test } from 'vitest';
import { changelogEntries } from './index';

describe('changelog pubblico', () => {
  test('le entry arrivano dalla più recente', () => {
    const ts = changelogEntries.map((entry) => Date.parse(entry.date));
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]).toBeLessThanOrEqual(ts[i - 1]);
    }
  });

  test('ogni entry ha un titolo e almeno una riga', () => {
    for (const entry of changelogEntries) {
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.items.length).toBeGreaterThan(0);
    }
  });
});
