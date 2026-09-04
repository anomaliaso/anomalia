import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AUDIT_CITATIONS_DEFAULT,
  WEB_AUDITS_DEFAULT,
  WEB_FIXES_DEFAULT,
  type AuditCitationRow,
  type WebAuditFindings,
  type WebAuditIndexRow,
  type WebFixRow
} from '@anomalia/api-contracts';

// Reads over what the audits already measured. Nothing here writes, and nothing reshapes an
// observation: `tech`, `search`, `backlinks` and `ai_overview` leave exactly as they were stored.

const AUDITS_TABLE = 'brand_geo_audits';
const FIXES_TABLE = 'brand_geo_artifacts';
const SEO_SOURCE_PREFIX = 'seo:';

const INDEX_COLUMNS = 'id, created_at, tech_score, tech, share_of_voice, citations';
const FINDINGS_COLUMNS = 'id, created_at, tech_score, tech, share_of_voice, search, backlinks, ai_overview';
const CITATIONS_COLUMNS = 'id, created_at, citations';
const FIX_COLUMNS = 'id, kind, title, format, body, status, target_path, source_finding, created_at';

type Json = Record<string, unknown> | null;

type AuditRow = {
  id: string;
  created_at: string;
  tech_score?: number | null;
  tech?: Json;
  share_of_voice?: number | null;
  citations?: unknown;
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

type StoredFix = {
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

export function surfaceOfFix(sourceFinding: string | null): 'seo' | 'geo' {
  return (sourceFinding ?? '').startsWith(SEO_SOURCE_PREFIX) ? 'seo' : 'geo';
}

function toIndexRow(row: AuditRow): WebAuditIndexRow {
  const citability = citabilityOf(row.tech ?? null);

  return {
    id: row.id,
    at: row.created_at,
    tech_score: row.tech_score ?? null,
    share_of_voice: row.share_of_voice ?? null,
    citability_score: citability?.score ?? null,
    binding_constraint: citability?.bindingConstraint?.label ?? null,
    citation_count: lengthOf(row.citations),
    finding_count: lengthOf((row.tech ?? {}).issues)
  };
}

function toFindings(row: AuditRow): WebAuditFindings {
  return {
    id: row.id,
    at: row.created_at,
    tech_score: row.tech_score ?? null,
    share_of_voice: row.share_of_voice ?? null,
    technical: row.tech ?? null,
    search: row.search ?? null,
    backlinks: row.backlinks ?? null,
    ai_overview: row.ai_overview ?? null
  };
}

function toCitation(stored: StoredCitation, observedAt: string): AuditCitationRow {
  return {
    observed_at: observedAt,
    answer_engine: stored.engine ?? '',
    question: stored.prompt ?? '',
    brand_mentioned: stored.brandMentioned === true,
    rank: stored.rank ?? null,
    competitors: stored.competitors ?? [],
    source_domains: stored.sources ?? [],
    error: stored.error ?? null
  };
}

function toFix(stored: StoredFix): WebFixRow {
  return {
    id: stored.id,
    surface: surfaceOfFix(stored.source_finding),
    kind: stored.kind,
    title: stored.title,
    format: stored.format,
    status: stored.status,
    target_path: stored.target_path ?? null,
    answers_finding: stored.source_finding ?? null,
    created_at: stored.created_at,
    body: stored.body ?? ''
  };
}

async function loadAudit(
  supabase: SupabaseClient,
  brandId: string,
  columns: string,
  auditId?: string
): Promise<AuditRow | null> {
  let query = supabase.from(AUDITS_TABLE).select(columns).eq('brand_id', brandId);
  if (auditId) {
    query = query.eq('id', auditId);
  }

  const { data } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();

  return (data ?? null) as AuditRow | null;
}

export async function listWebAudits(
  supabase: SupabaseClient,
  brandId: string,
  page: EvidencePage = {}
): Promise<{ audits: WebAuditIndexRow[] }> {
  const limit = page.limit ?? WEB_AUDITS_DEFAULT;
  const offset = page.offset ?? 0;

  const { data } = await supabase
    .from(AUDITS_TABLE)
    .select(INDEX_COLUMNS)
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  return { audits: ((data ?? []) as AuditRow[]).map(toIndexRow) };
}

export async function getAuditFindings(
  supabase: SupabaseClient,
  brandId: string,
  auditId?: string
): Promise<{ audit: WebAuditFindings | null }> {
  const row = await loadAudit(supabase, brandId, FINDINGS_COLUMNS, auditId);

  return { audit: row ? toFindings(row) : null };
}

export async function listAuditCitations(
  supabase: SupabaseClient,
  brandId: string,
  options: EvidencePage & { auditId?: string } = {}
): Promise<{
  audit_id: string | null;
  observed_at: string | null;
  total: number;
  offset: number;
  limit: number;
  citations: AuditCitationRow[];
}> {
  const limit = options.limit ?? AUDIT_CITATIONS_DEFAULT;
  const offset = options.offset ?? 0;

  const row = await loadAudit(supabase, brandId, CITATIONS_COLUMNS, options.auditId);
  const stored = (Array.isArray(row?.citations) ? row.citations : []) as StoredCitation[];
  const observedAt = row?.created_at ?? null;

  return {
    audit_id: row?.id ?? null,
    observed_at: observedAt,
    total: stored.length,
    offset,
    limit,
    citations: stored.slice(offset, offset + limit).map((citation) => toCitation(citation, observedAt ?? ''))
  };
}

export async function listWebFixes(
  supabase: SupabaseClient,
  brandId: string,
  options: EvidencePage & { fixId?: string; status?: string } = {}
): Promise<{ fixes: WebFixRow[] }> {
  const limit = options.limit ?? WEB_FIXES_DEFAULT;
  const offset = options.offset ?? 0;

  let query = supabase.from(FIXES_TABLE).select(FIX_COLUMNS).eq('brand_id', brandId);
  if (options.fixId) {
    query = query.eq('id', options.fixId);
  }
  if (options.status) {
    query = query.eq('status', options.status);
  }

  const { data } = await query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  return { fixes: ((data ?? []) as StoredFix[]).map(toFix) };
}
