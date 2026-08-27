import { describe, expect, it } from 'vitest';
import { countryOptions, countryFlag, parseCountries } from './countries';

describe('countries', () => {
  it('lists every ISO-2 code once, named and sorted', () => {
    const it_ = countryOptions('it');
    expect(it_.length).toBe(new Set(it_.map((c) => c.code)).size);
    expect(it_.length).toBeGreaterThan(240);
    expect(it_.find((c) => c.code === 'IT')?.name).toBe('Italia');
    expect(countryOptions('en').find((c) => c.code === 'IT')?.name).toBe('Italy');
    const names = it_.map((c) => c.name);
    expect([...names].sort((a, b) => a.localeCompare(b, 'it'))).toEqual(names);
  });

  it('makes flags and round-trips the stored string', () => {
    expect(countryFlag('IT')).toBe('🇮🇹');
    expect(parseCountries('IT, us  de,,x')).toEqual(['IT', 'US', 'DE']);
    expect(parseCountries('')).toEqual([]);
  });
});
