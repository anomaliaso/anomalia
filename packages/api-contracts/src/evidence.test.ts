import { describe, expect, it } from 'vitest';
import {
  AUDIT_CITATIONS_MAX,
  GET_AUDIT_FINDINGS_READ,
  LIST_AUDIT_CITATIONS_READ,
  LIST_WEB_AUDITS_READ,
  LIST_WEB_FIXES_READ,
  WEB_AUDITS_MAX,
  WEB_FIXES_MAX
} from './evidence';

const EVIDENCE_READS = [
  LIST_WEB_AUDITS_READ,
  GET_AUDIT_FINDINGS_READ,
  LIST_AUDIT_CITATIONS_READ,
  LIST_WEB_FIXES_READ
];

describe('il contratto delle prove del web', () => {
  it.each([
    ['gli audit', LIST_WEB_AUDITS_READ, WEB_AUDITS_MAX],
    ['le citazioni', LIST_AUDIT_CITATIONS_READ, AUDIT_CITATIONS_MAX],
    ['i fix', LIST_WEB_FIXES_READ, WEB_FIXES_MAX]
  ] as const)('%s dichiarano un tetto e rifiutano chi lo supera', (_lista, endpoint, max) => {
    expect(endpoint.input.safeParse({ limit: max }).success).toBe(true);
    expect(endpoint.input.safeParse({ limit: max + 1 }).success).toBe(false);
    expect(endpoint.input.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('un audit solo non ha bisogno di un tetto: non è una lista', () => {
    expect(GET_AUDIT_FINDINGS_READ.input.safeParse({ limit: 5 }).success).toBe(false);
    expect(GET_AUDIT_FINDINGS_READ.input.safeParse({ audit_id: 'audit-1' }).success).toBe(true);
  });

  it('legge i limiti dalla query string, dove arrivano come stringhe', () => {
    const parsed = LIST_WEB_AUDITS_READ.input.safeParse({ limit: '5', offset: '10' });
    expect(parsed.success && parsed.data).toEqual({ limit: 5, offset: 10 });
  });

  it('rifiuta un parametro che non dichiara invece di scartarlo in silenzio', () => {
    for (const { input } of EVIDENCE_READS) {
      expect(input.safeParse({ campo_che_non_esiste: 'x' }).success).toBe(false);
    }
  });
});
