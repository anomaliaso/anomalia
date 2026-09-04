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

const COSTS_NOTHING =
  'Reads what was already measured. It calls no model, spends no credits and writes nothing.';

export const LIST_WEB_AUDITS = {
  tool: 'list_web_audits',
  title: 'List web audits',
  description:
    "Every audit Anomalia has run on this brand's website and its visibility in AI answers, newest " +
    'first, one line each: when it ran, the scores it measured, and how much it observed. Take an id ' +
    `from here to open one audit instead of paying for a new one. ${COSTS_NOTHING}`,
  method: 'GET',
  pathUnderBrand: '/web/audits',
  input: z.object({ limit: limitUpTo(WEB_AUDITS_MAX, WEB_AUDITS_DEFAULT), offset }).strict(),
  output: z.object({ audits: z.array(AuditIndexRow) }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const GET_AUDIT_FINDINGS = {
  tool: 'get_audit_findings',
  title: 'Read one audit',
  description:
    'What one audit observed, exactly as it was recorded: the technical findings on the site, the ' +
    'search and backlink figures, and the Google AI Overview sampling. Without audit_id you get the ' +
    `most recent audit, never an older one that happens to hold more data. ${COSTS_NOTHING}`,
  method: 'GET',
  pathUnderBrand: '/web/audits/findings',
  input: z.object({ audit_id: auditId }).strict(),
  output: z.object({ audit: AuditFindings.nullable() }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const LIST_AUDIT_CITATIONS = {
  tool: 'list_audit_citations',
  title: 'List citation checks',
  description:
    'The questions Anomalia put to answer engines during one audit, and what came back: which engine, ' +
    'the question verbatim, whether the brand was named and in which position, the competitors named ' +
    'instead, and the domains the answer cited. This is the evidence behind the share-of-voice number. ' +
    `Without audit_id you get the most recent audit. ${COSTS_NOTHING}`,
  method: 'GET',
  pathUnderBrand: '/web/audits/citations',
  input: z
    .object({
      audit_id: auditId,
      limit: limitUpTo(AUDIT_CITATIONS_MAX, AUDIT_CITATIONS_DEFAULT),
      offset
    })
    .strict(),
  output: z.object({
    audit_id: z.string().nullable(),
    observed_at: z.string().nullable(),
    total: z.number(),
    offset: z.number(),
    limit: z.number(),
    citations: z.array(CitationRow)
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const LIST_WEB_FIXES = {
  tool: 'list_web_fixes',
  title: 'Read generated fixes',
  description:
    'The fixes Anomalia wrote from its audits — FAQ blocks, structured data, llms.txt, landing copy — ' +
    'with the body complete and ready to publish. Ask for one fix_id when you know which one you want: ' +
    `bodies are long, so few come back per call. ${COSTS_NOTHING}`,
  method: 'GET',
  pathUnderBrand: '/web/fixes',
  input: z
    .object({
      fix_id: z.string().min(1).optional().describe('Return only this fix'),
      status: z.enum(WEB_FIX_STATUSES).optional().describe('Drafts are the fixes not yet acted on'),
      limit: limitUpTo(WEB_FIXES_MAX, WEB_FIXES_DEFAULT),
      offset
    })
    .strict(),
  output: z.object({ fixes: z.array(FixRow) }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;
