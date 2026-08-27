import { describe, expect, it } from 'vitest';
import {
  PROOF_DISCIPLINE_RULE,
  hasNeedMarker,
  needMarkers,
  stripNeedMarkers,
  unattributedProof
} from './proof-discipline';

describe('need markers', () => {
  it('reads what the generator said it was missing', () => {
    expect(needMarkers('Recuperi [NEED: cifra di conversione] preventivi al mese.')).toEqual([
      'cifra di conversione'
    ]);
  });

  it('finds several, case-insensitively', () => {
    expect(needMarkers('[need: fonte] e [NEED: nome cliente]')).toHaveLength(2);
  });

  it('says no when there is none', () => {
    expect(hasNeedMarker('Un post normale.')).toBe(false);
    expect(needMarkers(null)).toEqual([]);
  });

  it('does not let a stray bracket swallow the caption', () => {
    expect(needMarkers(`[NEED: ${'x'.repeat(200)}`)).toEqual([]);
  });

  it('strips markers for a prose preview, tidying the spacing', () => {
    expect(stripNeedMarkers('Recuperi [NEED: cifra] preventivi.')).toBe('Recuperi preventivi.');
  });
});

describe('unattributedProof', () => {
  it('flags a percentage presented as measured with no source', () => {
    const p = unattributedProof('Il 68% dei preventivi si perde nelle prime 48 ore.');
    expect(p.map((x) => x.id)).toContain('unattributed_stat');
    expect(p[0].note).toContain('[NEED:');
  });

  it('clears the same claim once it says where it came from', () => {
    expect(unattributedProof('Secondo il nostro studio 2025, il 68% dei preventivi si perde.')).toEqual([]);
    expect(unattributedProof('Il 68% dei preventivi si perde, misurato su un campione di 240 studi.')).toEqual([]);
  });

  it('does not flag a product spec — that is a description, not a claim about the world', () => {
    expect(unattributedProof('15 slide, 3 formati, 29 euro al mese.')).toEqual([]);
    expect(unattributedProof('Il piano Pro costa 49 euro.')).toEqual([]);
  });

  it('flags a ranking superlative with nothing behind it', () => {
    expect(unattributedProof('Siamo il leader di mercato in Italia.').map((x) => x.id)).toContain(
      'unbacked_superlative'
    );
  });

  it('flags a quoted testimonial with nobody attached to it', () => {
    const p = unattributedProof('«Da quando lo usiamo non abbiamo più perso un preventivo, mai più.»');
    expect(p.map((x) => x.id)).toContain('anonymous_testimonial');
  });

  it('accepts a testimonial that names a real person', () => {
    const p = unattributedProof(
      '«Da quando lo usiamo non abbiamo più perso un preventivo, mai più.» — Marco Rossi, Rossi Architetti'
    );
    expect(p.map((x) => x.id)).not.toContain('anonymous_testimonial');
  });

  it('is quiet on an empty or plain caption', () => {
    expect(unattributedProof('')).toEqual([]);
    expect(unattributedProof('Abbiamo aperto il nuovo studio in centro.')).toEqual([]);
  });
});

describe('PROOF_DISCIPLINE_RULE', () => {
  it('forbids the placeholder loophole explicitly, because that is the one people use', () => {
    expect(PROOF_DISCIPLINE_RULE).toContain('nemmeno come segnaposto');
    expect(PROOF_DISCIPLINE_RULE).toContain('[NEED:');
    expect(PROOF_DISCIPLINE_RULE).toContain('superlativi');
  });
});
