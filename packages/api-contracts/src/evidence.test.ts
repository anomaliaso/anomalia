import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_ARTIFACTS_MAX,
  EVIDENCE_CITATIONS_MAX,
  EVIDENCE_RUNS_MAX,
  GET_EVIDENCE_RUN,
  LIST_EVIDENCE_ARTIFACTS,
  LIST_EVIDENCE_RUNS
} from './evidence';
import { BRAND_ENDPOINTS } from './index';

const EVIDENCE_TOOLS = [LIST_EVIDENCE_RUNS, GET_EVIDENCE_RUN, LIST_EVIDENCE_ARTIFACTS];

describe('il contratto delle prove SEO/GEO', () => {
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

  it.each([
    ['list_evidence_runs', LIST_EVIDENCE_RUNS, EVIDENCE_RUNS_MAX],
    ['get_evidence_run', GET_EVIDENCE_RUN, EVIDENCE_CITATIONS_MAX],
    ['list_evidence_artifacts', LIST_EVIDENCE_ARTIFACTS, EVIDENCE_ARTIFACTS_MAX]
  ] as const)('%s dichiara un tetto e rifiuta chi lo supera', (_tool, endpoint, max) => {
    expect(endpoint.input.safeParse({ limit: max }).success).toBe(true);
    expect(endpoint.input.safeParse({ limit: max + 1 }).success).toBe(false);
    expect(endpoint.input.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('legge i limiti dalla query string, dove arrivano come stringhe', () => {
    const parsed = LIST_EVIDENCE_RUNS.input.safeParse({ limit: '5', offset: '10' });
    expect(parsed.success && parsed.data).toEqual({ limit: 5, offset: 10 });
  });

  it('rifiuta un parametro che non dichiara invece di scartarlo in silenzio', () => {
    for (const endpoint of EVIDENCE_TOOLS) {
      expect(endpoint.input.safeParse({ campo_che_non_esiste: 'x' }).success, endpoint.tool).toBe(false);
    }
  });

  it('una citazione porta con sé istante, motore, domanda, verdetto e domini citati', () => {
    const ok = GET_EVIDENCE_RUN.output.safeParse({
      run: null,
      citations: {
        total: 1,
        offset: 0,
        limit: 50,
        items: [
          {
            observed_at: '2026-08-10T08:00:00Z',
            engine: 'gemini',
            query: 'miglior crm per agenzie',
            brand_mentioned: true,
            rank: 2,
            competitors: ['altro-brand'],
            source_domains: ['esempio.it'],
            error: null
          }
        ]
      }
    });
    expect(ok.success).toBe(true);
    expect(
      GET_EVIDENCE_RUN.output.safeParse({
        run: null,
        citations: { total: 1, offset: 0, limit: 50, items: [{ engine: 'gemini', query: 'x' }] }
      }).success
    ).toBe(false);
  });

  it('un artefatto promette il corpo del fix, non solo il suo titolo', () => {
    const withoutBody = {
      id: 'a1',
      surface: 'geo',
      kind: 'faq',
      title: 'FAQ',
      format: 'markdown',
      status: 'draft',
      target_path: null,
      source_finding: 'no-llms-txt',
      created_at: '2026-08-10T08:00:00Z'
    };
    expect(LIST_EVIDENCE_ARTIFACTS.output.safeParse({ artifacts: [withoutBody] }).success).toBe(false);
    expect(
      LIST_EVIDENCE_ARTIFACTS.output.safeParse({ artifacts: [{ ...withoutBody, body: '## FAQ' }] }).success
    ).toBe(true);
  });
});
