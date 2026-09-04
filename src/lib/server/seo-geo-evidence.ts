import type { SupabaseClient } from '@supabase/supabase-js';
import {
  EVIDENCE_ARTIFACTS_DEFAULT,
  EVIDENCE_CITATIONS_DEFAULT,
  EVIDENCE_RUNS_DEFAULT,
  type EvidenceArtifactRow,
  type EvidenceCitationRow,
  type EvidenceRunDetail,
  type EvidenceRunIndexRow
} from '@anomalia/api-contracts';

// Reads over what the audits already measured. Nothing here writes, and nothing reshapes an
// observation: `tech`, `search`, `backlinks` and `ai_overview` leave exactly as they were stored.

const RUNS_TABLE = 'brand_geo_audits';
const ARTIFACTS_TABLE = 'brand_geo_artifacts';
const SEO_SOURCE_PREFIX = 'seo:';

const INDEX_COLUMNS = 'id, created_at, tech_score, tech, share_of_voice, citations';
const RUN_COLUMNS = `${INDEX_COLUMNS}, search, backlinks, ai_overview`;
const ARTIFACT_COLUMNS = 'id, kind, title, format, body, status, target_path, source_finding, created_at';

type Json = Record<string, unknown> | null;

type AuditRow = {
  id: string;
  created_at: string;
  tech_score: number | null;
  tech: Json;
  share_of_voice: number | null;
  citations: unknown;
  search?: Json;
  backlinks?: Json;
  ai_overview?: Json;
};

type StoredCitation = {
  engine?: string;
  prompt?: string;
  brandMentioned?: boolean;
  rank?: number | null;
  competitors?: string[];
  sources?: string[];
  error?: string | null;
};

type StoredArtifact = {
  id: string;
  kind: string;
  title: string;
  format: string;
  body: string | null;
  status: string;
  target_path: string | null;
  source_finding: string | null;
  created_at: string;
};

type Citability = { score?: number | null; bindingConstraint?: { label?: string | null } | null };

export type EvidencePage = { limit?: number; offset?: number };

function lengthOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function citabilityOf(tech: Json): Citability | null {
  return ((tech ?? {}) as { citability?: Citability }).citability ?? null;
}

export function surfaceOfArtifact(sourceFinding: string | null): 'seo' | 'geo' {
  return (sourceFinding ?? '').startsWith(SEO_SOURCE_PREFIX) ? 'seo' : 'geo';
}

function toIndexRow(row: AuditRow): EvidenceRunIndexRow {
  const citability = citabilityOf(row.tech);

  return {
    id: row.id,
    at: row.created_at,
    tech_score: row.tech_score ?? null,
    share_of_voice: row.share_of_voice ?? null,
    citability_score: citability?.score ?? null,
    binding_constraint: citability?.bindingConstraint?.label ?? null,
    citation_count: lengthOf(row.citations),
    issue_count: lengthOf((row.tech ?? {}).issues)
  };
}

function toRunDetail(row: AuditRow): EvidenceRunDetail {
  return {
    id: row.id,
    at: row.created_at,
    tech_score: row.tech_score ?? null,
    share_of_voice: row.share_of_voice ?? null,
    tech: row.tech ?? null,
    search: row.search ?? null,
    backlinks: row.backlinks ?? null,
    ai_overview: row.ai_overview ?? null
  };
}

function toCitation(stored: StoredCitation, observedAt: string): EvidenceCitationRow {
  return {
    observed_at: observedAt,
    engine: stored.engine ?? '',
    query: stored.prompt ?? '',
    brand_mentioned: stored.brandMentioned === true,
    rank: stored.rank ?? null,
    competitors: stored.competitors ?? [],
    source_domains: stored.sources ?? [],
    error: stored.error ?? null
  };
}

function toArtifact(stored: StoredArtifact): EvidenceArtifactRow {
  return {
    id: stored.id,
    surface: surfaceOfArtifact(stored.source_finding),
    kind: stored.kind,
    title: stored.title,
    format: stored.format,
    status: stored.status,
    target_path: stored.target_path ?? null,
    source_finding: stored.source_finding ?? null,
    created_at: stored.created_at,
    body: stored.body ?? ''
  };
}

export async function listEvidenceRuns(
  supabase: SupabaseClient,
  brandId: string,
  page: EvidencePage = {}
): Promise<{ runs: EvidenceRunIndexRow[] }> {
  const limit = page.limit ?? EVIDENCE_RUNS_DEFAULT;
  const offset = page.offset ?? 0;

  const { data } = await supabase
    .from(RUNS_TABLE)
    .select(INDEX_COLUMNS)
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  return { runs: ((data ?? []) as AuditRow[]).map(toIndexRow) };
}

export async function getEvidenceRun(
  supabase: SupabaseClient,
  brandId: string,
  options: EvidencePage & { runId?: string } = {}
): Promise<{
  run: EvidenceRunDetail | null;
  citations: { total: number; offset: number; limit: number; items: EvidenceCitationRow[] };
}> {
  const limit = options.limit ?? EVIDENCE_CITATIONS_DEFAULT;
  const offset = options.offset ?? 0;

  let query = supabase.from(RUNS_TABLE).select(RUN_COLUMNS).eq('brand_id', brandId);
  if (options.runId) {
    query = query.eq('id', options.runId);
  }

  const { data } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();

  const row = (data ?? null) as AuditRow | null;
  const stored = (Array.isArray(row?.citations) ? row.citations : []) as StoredCitation[];
  const observedAt = row?.created_at ?? '';

  return {
    run: row ? toRunDetail(row) : null,
    citations: {
      total: stored.length,
      offset,
      limit,
      items: stored.slice(offset, offset + limit).map((citation) => toCitation(citation, observedAt))
    }
  };
}

export async function listEvidenceArtifacts(
  supabase: SupabaseClient,
  brandId: string,
  options: EvidencePage & { artifactId?: string; status?: string } = {}
): Promise<{ artifacts: EvidenceArtifactRow[] }> {
  const limit = options.limit ?? EVIDENCE_ARTIFACTS_DEFAULT;
  const offset = options.offset ?? 0;

  let query = supabase.from(ARTIFACTS_TABLE).select(ARTIFACT_COLUMNS).eq('brand_id', brandId);
  if (options.artifactId) {
    query = query.eq('id', options.artifactId);
  }
  if (options.status) {
    query = query.eq('status', options.status);
  }

  const { data } = await query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  return { artifacts: ((data ?? []) as StoredArtifact[]).map(toArtifact) };
}
