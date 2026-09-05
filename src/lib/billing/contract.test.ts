import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * IL TEST-GUARDIA: contract.ts deve restare importabile dal client (pagine/component che
 * costruiscono un upsell UI, non solo dal server). Legge il file come TESTO e fallisce se ci
 * trova un import server-only.
 */
const source = readFileSync(fileURLToPath(new URL('./contract.ts', import.meta.url)), 'utf-8');

describe('billing/contract.ts — resta client-safe', () => {
  it('non importa nulla da $lib/server', () => {
    expect(source).not.toMatch(/\$lib\/server/);
  });

  it('non importa $env (né dynamic né static, né private né public)', () => {
    expect(source).not.toMatch(/\$env\//);
  });

  it('non importa Supabase o Stripe direttamente', () => {
    expect(source).not.toMatch(/supabase|stripe/i);
  });
});
