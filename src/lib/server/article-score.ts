// Deterministic SEO/quality score for a blog article — no AI call, just analysis of the article's
// markdown + meta. Mirrors the checklist SEO tools show (structure, links, stats, alt text, meta,
// schema…) so the user keeps article quality under control. Pure function → cheap to run on load.
//
// COVERAGE-GATED (see `coverage.ts`). This scorer used to tell two lies that the four-verdict model
// removes:
//   - `alt` was scored FAILED on an article with no images at all — a question that does not apply,
//     costing 10 points. It is now `na`, out of the calculation entirely.
//   - `plagiarism` and `jsonld` were hardcoded PASSED because nothing ever checked them — unknowns
//     promoted to passes, inflating every article by 11 points. They are now `unknown` unless the
//     caller supplies the answer, and an unknown costs coverage, never score.
// The consequence is that `score` can be `null`: under 60% inspected weight we publish findings and
// say the evidence is insufficient, rather than a number that is a guess wearing a scorecard.

import { gradeWithCoverage, type CoverageSignal, type ScoreBand, type SignalVerdict } from './coverage';

export type ArticleForScore = {
  bodyMd: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  status?: string | null;
  /**
   * Whether the rendered page actually carries Article JSON-LD. The markdown cannot know — schema is
   * emitted by the blog renderer — so `null`/undefined means UNKNOWN, not "fine".
   */
  hasJsonLd?: boolean | null;
  /** Result of a real plagiarism check, when one has run. `null` means nobody looked. */
  plagiarismClean?: boolean | null;
};

export type ScoreCheck = {
  key: string;
  label: string;
  /** Kept for the existing UI. `true` only for a real pass — an unknown is not an `ok`. */
  ok: boolean;
  weight: number;
  verdict: SignalVerdict;
  note?: string;
};

export type ArticleScore = {
  /** 0-100 over the INSPECTED weight, or `null` when coverage is too thin to grade. */
  score: number | null;
  /** Share of applicable weight actually inspected, 0-100. Always shown next to the score. */
  coverage: number;
  tier: 'full' | 'provisional' | 'ungraded';
  band: ScoreBand | null;
  /** One line ready to print: score, denominator, and what was not inspected. */
  label: string;
  /** Labels of the checks nobody could answer. Named, never summarised away. */
  unknown: string[];
  checks: ScoreCheck[];
  metrics: { wordCount: number; keywords: number; images: number; internalLinks: number; externalLinks: number };
};

const STOP = new Set(
  'the a an and or of to in for on with your you our we is are how what why when come cosa perche gli una uno del della delle dei nel nei alla dai per con che non più sono'.split(
    ' '
  )
);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export function scoreArticle(a: ArticleForScore, brandHost?: string | null): ArticleScore {
  const md = a.bodyMd ?? '';
  const bh = hostOf(brandHost?.startsWith('http') ? brandHost : `https://${brandHost ?? ''}`) ?? (brandHost ?? '').replace(/^www\./, '').toLowerCase();

  // Images ![alt](url) — capture alt to check alt-text presence.
  const images = [...md.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
  const imageUrls = new Set(images.map((m) => m[2]));

  // Links [text](url), excluding image URLs and in-page anchors.
  const links = [...md.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
    .map((m) => m[1])
    .filter((u) => !u.startsWith('#') && !u.startsWith('data:') && !imageUrls.has(u));
  let internal = 0;
  let external = 0;
  for (const u of links) {
    if (u.startsWith('/')) {
      internal++;
      continue;
    }
    const h = hostOf(u);
    if (!h) continue;
    if (bh && (h === bh || h.endsWith('.' + bh))) internal++;
    else external++;
  }

  // Word count: strip code fences, links and markdown punctuation, then count word-like tokens.
  const text = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#>*_`~]/g, ' ');
  const wordCount = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

  // Semantic keyword proxy: distinct significant terms across H2/H3 headings.
  const headings = [...md.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1]);
  const kw = new Set<string>();
  for (const h of headings) for (const w of h.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w.length > 3 && !STOP.has(w)) kw.add(w);
  const keywords = kw.size;

  const h2 = (md.match(/^##\s+/gm) || []).length;
  const trimmed = md.trim();
  const hasIntro = trimmed.length > 0 && !/^#{1,6}\s/.test(trimmed);
  const hasStats = /\b\d+([.,]\d+)?\s?%|\b\d{2,}\b/.test(text);
  const allAlt = images.length > 0 && images.every((m) => m[1].trim().length > 0);

  const mt = (a.metaTitle ?? '').trim();
  const mdesc = (a.metaDescription ?? '').trim();
  const metaOk = mt.length > 0 && mt.length <= 60 && mdesc.length >= 50 && mdesc.length <= 160;

  const bool = (ok: boolean): SignalVerdict => (ok ? 'pass' : 'fail');
  /** `null`/undefined = nobody looked. An unknown costs coverage, never score. */
  const tri = (v: boolean | null | undefined): SignalVerdict => (v === null || v === undefined ? 'unknown' : bool(v));

  const signals: (CoverageSignal & { note?: string })[] = [
    { key: 'structure', label: 'Struttura ottimale', weight: 14, verdict: bool(h2 >= 2 && hasIntro) },
    { key: 'sources', label: 'Fonti citate', weight: 9, verdict: bool(external >= 2) },
    { key: 'internal', label: 'Link interni', weight: 9, verdict: bool(internal >= 1) },
    { key: 'external', label: 'Link esterni', weight: 7, verdict: bool(external >= 1) },
    { key: 'stats', label: 'Dati e statistiche', weight: 8, verdict: bool(hasStats) },
    {
      key: 'plagiarism',
      label: 'Controllo plagio superato',
      weight: 6,
      verdict: tri(a.plagiarismClean),
      note: a.plagiarismClean === null || a.plagiarismClean === undefined ? 'nessun controllo eseguito' : undefined
    },
    // An article with no images has no alt text to get wrong. That is not a failure, it is a
    // question that does not apply — and scoring it as a failure cost 10 points for nothing.
    images.length === 0
      ? { key: 'alt', label: 'Alt text immagini', weight: 10, verdict: 'na' as SignalVerdict, note: 'articolo senza immagini' }
      : { key: 'alt', label: 'Alt text immagini', weight: 10, verdict: bool(allAlt) },
    { key: 'keywords', label: 'Keyword semantiche', weight: 9, verdict: bool(keywords >= 4) },
    { key: 'meta', label: 'Meta tag ottimizzati', weight: 12, verdict: bool(metaOk) },
    {
      key: 'jsonld',
      label: 'Schema JSON-LD',
      weight: 5,
      verdict: tri(a.hasJsonLd),
      note: a.hasJsonLd === null || a.hasJsonLd === undefined ? 'lo emette il renderer, non il markdown' : undefined
    },
    { key: 'words', label: 'Lunghezza adeguata (1000+)', weight: 11, verdict: bool(wordCount >= 1000) }
  ]; // weights sum to 100

  const graded = gradeWithCoverage(signals);
  const checks: ScoreCheck[] = signals.map((s) => ({
    key: s.key,
    label: s.label,
    ok: s.verdict === 'pass',
    weight: s.weight,
    verdict: s.verdict,
    ...(s.note ? { note: s.note } : {})
  }));

  return {
    score: graded.score,
    coverage: graded.coverage,
    tier: graded.tier,
    band: graded.band,
    label: graded.label,
    unknown: graded.unknown,
    checks,
    metrics: { wordCount, keywords, images: images.length, internalLinks: internal, externalLinks: external }
  };
}
