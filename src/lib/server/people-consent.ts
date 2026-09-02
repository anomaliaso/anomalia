export type PersonKind = 'real' | 'ai';

export type ConsentAttestation = 'owner_attested' | 'none';

export type PersonConsentColumns = {
  consent: true;
  consent_at?: string;
  consent_source: 'owner_attested' | 'ai_generated';
};

export const CONSENT_NOT_ATTESTED = 'Confirm you have this person’s consent before adding them.';

export function personConsentColumns(
  kind: PersonKind,
  attestation: ConsentAttestation
): PersonConsentColumns | null {
  if (kind === 'ai') {
    return { consent: true, consent_source: 'ai_generated' };
  }

  if (attestation !== 'owner_attested') {
    return null;
  }

  return { consent: true, consent_at: new Date().toISOString(), consent_source: 'owner_attested' };
}
