import { describe, it, expect } from 'vitest';
import { personConsentColumns } from './people-consent';

describe('personConsentColumns', () => {
  it('withholds the columns for a real person nobody attested for', () => {
    expect(personConsentColumns('real', 'none')).toBeNull();
  });

  it('stamps provenance and time when the owner attests for a real person', () => {
    const columns = personConsentColumns('real', 'owner_attested');

    expect(columns).toMatchObject({ consent: true, consent_source: 'owner_attested' });
    expect(Date.parse(columns!.consent_at!)).not.toBeNaN();
  });

  it('never gates an AI persona, and never stamps a time nobody attested at', () => {
    for (const attestation of ['none', 'owner_attested'] as const) {
      expect(personConsentColumns('ai', attestation)).toEqual({
        consent: true,
        consent_source: 'ai_generated'
      });
    }
  });
});
