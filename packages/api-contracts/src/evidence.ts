import { z } from 'zod';
import type { BrandEndpoint } from './index';

export const WEB_AUDITS_DEFAULT = 12;
export const WEB_AUDITS_MAX = 24;
export const AUDIT_CITATIONS_DEFAULT = 50;
export const AUDIT_CITATIONS_MAX = 200;
export const WEB_FIXES_DEFAULT = 3;
export const WEB_FIXES_MAX = 10;

export const WEB_FIX_STATUSES = ['draft', 'accepted', 'dismissed'] as const;
export const WEB_FIX_SURFACES = ['seo', 'geo'] as const;

const auditId = z
  .string()
  .min(1)
  .optional()
  .describe('An id from list_web_audits; omit for the most recent audit');

const offset = z.coerce.number().int().min(0).optional().describe('How many rows to skip');
const limitUpTo = (max: number, fallback: number) =>
  z.coerce
    .number()
    .int()
    .min(1)
    .max(max)
    .optional()
    .describe(`How many to return, ${fallback} by default, ${max} at most`);

const AsRecorded = z.record(z.string(), z.unknown()).nullable();

const AuditIndexRow = z.object({
  id: z.string(),
  at: z.string(),
  tech_score: z.number().nullable(),
  share_of_voice: z.number().nullable(),
  citability_score: z.number().nullable(),
  binding_constraint: z.string().nullable(),
  citation_count: z.number(),
  finding_count: z.number()
});

const AuditFindings = z.object({
  id: z.string(),
  at: z.string(),
  tech_score: z.number().nullable(),
  share_of_voice: z.number().nullable(),
  technical: AsRecorded.describe('What the crawler observed, exactly as recorded'),
  search: AsRecorded.describe('Search performance figures, exactly as recorded'),
  backlinks: AsRecorded.describe('Backlink figures, exactly as recorded'),
  ai_overview: AsRecorded.describe('Google AI Overview sampling, exactly as recorded')
});

const CitationRow = z.object({
  observed_at: z.string().describe('When the probe ran — the audit instant, not the read instant'),
  answer_engine: z.string().describe('The engine that produced this verdict'),
  question: z.string().describe('What was asked, verbatim'),
  brand_mentioned: z.boolean(),
  rank: z.number().nullable().describe('1-based position among the brands named; null when absent'),
  competitors: z.array(z.string()).describe('The other brands the answer named'),
  source_domains: z
    .array(z.string())
    .describe('Hostnames the grounded answer cited. The full URL is not retained at collection time'),
  error: z.string().nullable().describe('Set when the probe failed — not a genuine "not mentioned"')
});

const FixRow = z.object({
  id: z.string(),
  surface: z.enum(WEB_FIX_SURFACES),
  kind: z.string(),
  title: z.string(),
  format: z.string(),
  status: z.string(),
  target_path: z.string().nullable(),
  answers_finding: z.string().nullable().describe('The audit finding, or plan initiative, this fix answers'),
  created_at: z.string(),
  body: z.string().describe('The fix itself, verbatim and complete')
});

export type WebAuditIndexRow = z.infer<typeof AuditIndexRow>;
export type WebAuditFindings = z.infer<typeof AuditFindings>;
export type AuditCitationRow = z.infer<typeof CitationRow>;
export type WebFixRow = z.infer<typeof FixRow>;

/**
 * La rotta REST resta e continua a validare con questo schema; il tool MCP non c'e' piu:
 * la lettura la serve `query`. Qui vive solo cio che serve alla rotta.
 */
export const LIST_WEB_AUDITS_READ = {
  output: z.object({ audits: z.array(AuditIndexRow) }),
  input: z.object({ limit: limitUpTo(WEB_AUDITS_MAX, WEB_AUDITS_DEFAULT), offset }).strict(),
  failures: []
} as const;

/**
 * La rotta REST resta e continua a validare con questo schema; il tool MCP non c'e' piu:
 * la lettura la serve `query`. Qui vive solo cio che serve alla rotta.
 */
export const GET_AUDIT_FINDINGS_READ = {
  output: z.object({ audit: AuditFindings.nullable() }),
  input: z.object({ audit_id: auditId }).strict(),
  failures: []
} as const;

/**
 * La rotta REST resta e continua a validare con questo schema; il tool MCP non c'e' piu:
 * la lettura la serve `query`. Qui vive solo cio che serve alla rotta.
 */
export const LIST_AUDIT_CITATIONS_READ = {
  output: z.object({
    audit_id: z.string().nullable(),
    observed_at: z.string().nullable(),
    total: z.number(),
    offset: z.number(),
    limit: z.number(),
    citations: z.array(CitationRow)
  }),
  input: z
    .object({
      audit_id: auditId,
      limit: limitUpTo(AUDIT_CITATIONS_MAX, AUDIT_CITATIONS_DEFAULT),
      offset
    })
    .strict(),
  failures: []
} as const;

/**
 * La rotta REST resta e continua a validare con questo schema; il tool MCP non c'e' piu:
 * la lettura la serve `query`. Qui vive solo cio che serve alla rotta.
 */
export const LIST_WEB_FIXES_READ = {
  output: z.object({ fixes: z.array(FixRow) }),
  input: z
    .object({
      fix_id: z.string().min(1).optional().describe('Return only this fix'),
      status: z.enum(WEB_FIX_STATUSES).optional().describe('Drafts are the fixes not yet acted on'),
      limit: limitUpTo(WEB_FIXES_MAX, WEB_FIXES_DEFAULT),
      offset
    })
    .strict(),
  failures: []
} as const;
