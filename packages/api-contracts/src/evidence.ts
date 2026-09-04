import { z } from 'zod';
import type { BrandEndpoint } from './index';

export const EVIDENCE_RUNS_DEFAULT = 12;
export const EVIDENCE_RUNS_MAX = 24;
export const EVIDENCE_CITATIONS_DEFAULT = 50;
export const EVIDENCE_CITATIONS_MAX = 200;
export const EVIDENCE_ARTIFACTS_DEFAULT = 3;
export const EVIDENCE_ARTIFACTS_MAX = 10;

export const EVIDENCE_ARTIFACT_STATUSES = ['draft', 'accepted', 'dismissed'] as const;
export const EVIDENCE_ARTIFACT_SURFACES = ['seo', 'geo'] as const;

const offset = z.coerce.number().int().min(0).optional().describe('Rows to skip, oldest-last order');
const limitUpTo = (max: number, fallback: number) =>
  z.coerce.number().int().min(1).max(max).optional().describe(`How many to return, ${fallback} by default, ${max} at most`);

const StoredEvidence = z.record(z.string(), z.unknown()).nullable();

const RunIndexRow = z.object({
  id: z.string(),
  at: z.string(),
  tech_score: z.number().nullable(),
  share_of_voice: z.number().nullable(),
  citability_score: z.number().nullable(),
  binding_constraint: z.string().nullable(),
  citation_count: z.number(),
  issue_count: z.number()
});

const CitationRow = z.object({
  observed_at: z.string().describe('When the probe was run — the audit instant, not the read instant'),
  engine: z.string().describe('The answer engine that produced this verdict'),
  query: z.string().describe('The question that was asked, verbatim'),
  brand_mentioned: z.boolean(),
  rank: z.number().nullable().describe('1-based position among the brands the answer named; null when absent'),
  competitors: z.array(z.string()),
  source_domains: z
    .array(z.string())
    .describe('Hostnames the grounded answer cited. The full URL is not retained at collection time'),
  error: z.string().nullable().describe('Set when the probe failed — not a genuine "not mentioned"')
});

const RunDetail = z.object({
  id: z.string(),
  at: z.string(),
  tech_score: z.number().nullable(),
  share_of_voice: z.number().nullable(),
  tech: StoredEvidence,
  search: StoredEvidence,
  backlinks: StoredEvidence,
  ai_overview: StoredEvidence
});

const ArtifactRow = z.object({
  id: z.string(),
  surface: z.enum(EVIDENCE_ARTIFACT_SURFACES),
  kind: z.string(),
  title: z.string(),
  format: z.string(),
  status: z.string(),
  target_path: z.string().nullable(),
  source_finding: z.string().nullable(),
  created_at: z.string(),
  body: z.string()
});

export type EvidenceRunIndexRow = z.infer<typeof RunIndexRow>;
export type EvidenceCitationRow = z.infer<typeof CitationRow>;
export type EvidenceRunDetail = z.infer<typeof RunDetail>;
export type EvidenceArtifactRow = z.infer<typeof ArtifactRow>;

const IMMUTABLE = 'Reads stored evidence. It calls no model, spends no credits and writes nothing.';

export const LIST_EVIDENCE_RUNS = {
  tool: 'list_evidence_runs',
  title: 'List SEO/GEO audit runs',
  description:
    'Every SEO/GEO audit Anomalia has run for this brand, newest first, one line each: when it ran, ' +
    'the scores it measured and how much it observed. Use an id from here to open one run with ' +
    `get_evidence_run instead of running a new audit. ${IMMUTABLE}`,
  method: 'GET',
  pathUnderBrand: '/evidence/runs',
  input: z
    .object({ limit: limitUpTo(EVIDENCE_RUNS_MAX, EVIDENCE_RUNS_DEFAULT), offset })
    .strict(),
  output: z.object({ runs: z.array(RunIndexRow) }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const GET_EVIDENCE_RUN = {
  tool: 'get_evidence_run',
  title: 'Open one SEO/GEO audit run',
  description:
    'One audit run exactly as it was recorded: technical observations, search and backlink figures, ' +
    'AI Overview sampling, and the citation probes behind its share of voice — each probe carrying ' +
    'its engine, the question asked, the verdict and the cited domains. Without run_id the newest ' +
    `run is returned, never an older one that happens to hold more data. ${IMMUTABLE}`,
  method: 'GET',
  pathUnderBrand: '/evidence/run',
  input: z
    .object({
      run_id: z.string().min(1).optional().describe('An id from list_evidence_runs; omit for the newest run'),
      limit: limitUpTo(EVIDENCE_CITATIONS_MAX, EVIDENCE_CITATIONS_DEFAULT),
      offset
    })
    .strict(),
  output: z.object({
    run: RunDetail.nullable(),
    citations: z.object({
      total: z.number(),
      offset: z.number(),
      limit: z.number(),
      items: z.array(CitationRow)
    })
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const LIST_EVIDENCE_ARTIFACTS = {
  tool: 'list_evidence_artifacts',
  title: 'Read generated fixes',
  description:
    'The fixes and assets Anomalia generated from its audits — FAQ blocks, structured data, llms.txt, ' +
    'landing copy — with the body verbatim, ready to publish. Ask for one artifact_id when you know ' +
    `which fix you want: bodies are long, so few come back per call. ${IMMUTABLE}`,
  method: 'GET',
  pathUnderBrand: '/evidence/artifacts',
  input: z
    .object({
      artifact_id: z.string().min(1).optional().describe('Return only this artifact'),
      status: z.enum(EVIDENCE_ARTIFACT_STATUSES).optional().describe('Drafts are the fixes not yet acted on'),
      limit: limitUpTo(EVIDENCE_ARTIFACTS_MAX, EVIDENCE_ARTIFACTS_DEFAULT),
      offset
    })
    .strict(),
  output: z.object({ artifacts: z.array(ArtifactRow) }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;
