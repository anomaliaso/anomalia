import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_APP_URL: 'https://anomalia.so' } }));

import { mediaUrl, MEDIA_SHORT_CODE_RE } from './media-url';

const MIGRATION = 'supabase/migrations/20260905090000_brand_media_short_code.sql';

describe('mediaUrl', () => {
  it('builds the short absolute link', () => {
    expect(mediaUrl('K7BX2MQ4')).toBe('https://anomalia.so/a/K7BX2MQ4');
  });

  it('has no link to give when the row has no code', () => {
    expect(mediaUrl(null)).toBeNull();
  });
});

describe('the short-code alphabet', () => {
  // The generator lives in SQL and the validator in TypeScript, and nothing but this test makes
  // them agree. Diverge and the symptom is a 404 on a link that the database considers perfectly
  // valid — in someone else's browser, hours later.
  it('is exactly the one the migration generates from', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const alphabet = sql.match(/_alphabet constant text := '([^']+)'/)?.[1];

    expect(alphabet).toBeTruthy();
    for (const char of alphabet!) {
      expect(char.repeat(8)).toMatch(MEDIA_SHORT_CODE_RE);
    }
  });

  // Public access means the code IS the credential: 8 chars over 32 symbols ≈ 1.1e12. Shortening
  // it is a security change, not a cosmetic one, so it fails here first.
  it('is 8 characters over 32 symbols', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const alphabet = sql.match(/_alphabet constant text := '([^']+)'/)?.[1];

    expect(alphabet).toHaveLength(32);
    expect(sql).toMatch(/for _i in 1\.\.8 loop/);
    expect('K7BX2MQ'.repeat(1)).not.toMatch(MEDIA_SHORT_CODE_RE);
  });

  it('refuses the characters that get misread when a link is retyped', () => {
    expect('IIIIIIII').not.toMatch(MEDIA_SHORT_CODE_RE);
    expect('OOOOOOOO').not.toMatch(MEDIA_SHORT_CODE_RE);
    expect('00000000').not.toMatch(MEDIA_SHORT_CODE_RE);
    expect('11111111').not.toMatch(MEDIA_SHORT_CODE_RE);
  });
});
