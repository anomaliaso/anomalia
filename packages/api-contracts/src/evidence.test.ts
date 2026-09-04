import { describe, expect, it } from 'vitest';
import {
  AUDIT_CITATIONS_MAX,
  GET_AUDIT_FINDINGS,
  LIST_AUDIT_CITATIONS,
  LIST_WEB_AUDITS,
  LIST_WEB_FIXES,
  WEB_AUDITS_MAX,
  WEB_FIXES_MAX
} from './evidence';
import { BRAND_ENDPOINTS } from './index';

const EVIDENCE_TOOLS = [LIST_WEB_AUDITS, GET_AUDIT_FINDINGS, LIST_AUDIT_CITATIONS, LIST_WEB_FIXES];

describe('il contratto delle prove del web', () => {
  it('espone solo letture: una prova non si modifica passando da qui', () => {
    for (const endpoint of EVIDENCE_TOOLS) {
      expect(endpoint.method, endpoint.tool).toBe('GET');
      expect(endpoint.destructive, endpoint.tool).toBe(false);
    }
  });

  it('è registrato, o il tool MCP non nasce', () => {
    for (const endpoint of EVIDENCE_TOOLS) {
      expect(BRAND_ENDPOINTS, endpoint.tool).toContain(endpoint);
    }
  });

  it('sta tutto sotto /web, invece di aggiungersi alla pila piatta di sigle', () => {
    for (const endpoint of EVIDENCE_TOOLS) {
      expect(endpoint.pathUnderBrand.startsWith('/web/'), endpoint.tool).toBe(true);
    }
  });

  it.each([
    ['list_web_audits', LIST_WEB_AUDITS, WEB_AUDITS_MAX],
    ['list_audit_citations', LIST_AUDIT_CITATIONS, AUDIT_CITATIONS_MAX],
    ['list_web_fixes', LIST_WEB_FIXES, WEB_FIXES_MAX]
  ] as const)('%s dichiara un tetto e rifiuta chi lo supera', (_tool, endpoint, max) => {
    expect(endpoint.input.safeParse({ limit: max }).success).toBe(true);
    expect(endpoint.input.safeParse({ limit: max + 1 }).success).toBe(false);
    expect(endpoint.input.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('un audit solo non ha bisogno di un tetto: non è una lista', () => {
    expect(GET_AUDIT_FINDINGS.input.safeParse({ limit: 5 }).success).toBe(false);
    expect(GET_AUDIT_FINDINGS.input.safeParse({ audit_id: 'audit-1' }).success).toBe(true);
  });

  it('legge i limiti dalla query string, dove arrivano come stringhe', () => {
    const parsed = LIST_WEB_AUDITS.input.safeParse({ limit: '5', offset: '10' });
    expect(parsed.success && parsed.data).toEqual({ limit: 5, offset: 10 });
  });

  it('rifiuta un parametro che non dichiara invece di scartarlo in silenzio', () => {
    for (const endpoint of EVIDENCE_TOOLS) {
      expect(endpoint.input.safeParse({ campo_che_non_esiste: 'x' }).success, endpoint.tool).toBe(false);
    }
  });

  it('una citazione porta con sé istante, motore, domanda, verdetto e domini citati', () => {
    const ok = LIST_AUDIT_CITATIONS.output.safeParse({
      audit_id: 'audit-1',
      observed_at: '2026-08-10T08:00:00Z',
      total: 1,
      offset: 0,
      limit: 50,
      citations: [
        {
          observed_at: '2026-08-10T08:00:00Z',
          answer_engine: 'gemini',
          question: 'miglior crm per agenzie',
          brand_mentioned: true,
          rank: 2,
          competitors: ['altro-brand'],
          source_domains: ['esempio.it'],
          error: null
        }
      ]
    });
    expect(ok.success).toBe(true);
    expect(
      LIST_AUDIT_CITATIONS.output.safeParse({
        audit_id: null,
        observed_at: null,
        total: 1,
        offset: 0,
        limit: 50,
        citations: [{ answer_engine: 'gemini', question: 'x' }]
      }).success
    ).toBe(false);
  });

  it('un fix promette il corpo, non solo il suo titolo', () => {
    const withoutBody = {
      id: 'fix-1',
      surface: 'geo',
      kind: 'faq',
      title: 'FAQ',
      format: 'markdown',
      status: 'draft',
      target_path: null,
      answers_finding: 'no-llms-txt',
      created_at: '2026-08-10T08:00:00Z'
    };
    expect(LIST_WEB_FIXES.output.safeParse({ fixes: [withoutBody] }).success).toBe(false);
    expect(LIST_WEB_FIXES.output.safeParse({ fixes: [{ ...withoutBody, body: '## FAQ' }] }).success).toBe(true);
  });
});
