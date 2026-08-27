/**
 * TikTok's own auto-captions, turned into a transcript and a hook.
 *
 * WHY THIS EXISTS. Asking Gemini to watch a clip costs a multimodal call and the better part of a
 * minute; TikTok has often already transcribed the video itself and hands the WebVTT over in the
 * same response we have already paid for. Measured: 322 bytes, HTTP 200, 0.77s, no auth.
 *
 * The captions are TIMESTAMPED, which is the whole reason they are worth having. A flat transcript
 * answers "what was said"; timestamps answer "what was said in the first three seconds", and that
 * is the hook — the single most predictive thing in short-form, and the thing we would otherwise be
 * paying a video model to read back to us.
 *
 * Coverage is a minority and must be treated as one: measured at 8/30 on profile histories and
 * 2/20 on hashtag search, the rest carrying `no_caption_reason: 3` (TikTok simply never generated
 * any). So this does not replace the judge. It takes the easy work off it and leaves the work that
 * needs eyes — and where both exist, TikTok's transcript is an independent check on what the judge
 * claims to have heard.
 *
 * The caption URL is signed and carries its own `expire`: fetch it in the run that read it, never
 * store the link for later.
 */

/** One caption line with the window it occupies. */
export type Cue = { start: number; end: number; text: string };

export type Transcript = {
  /** Every cue joined, deduplicated of the repeats TikTok's ASR produces. */
  text: string;
  cues: Cue[];
  lang: string | null;
};

/** The window that counts as the hook. Three seconds is the industry's own scroll-stop test. */
export const HOOK_WINDOW_S = 3;

/** WebVTT timestamps come as HH:MM:SS.mmm or MM:SS.mmm. */
export function parseTimestamp(raw: string): number | null {
  const m = raw.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return null;
  const [, h, mm, ss, ms] = m;
  return Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms.padEnd(3, '0')) / 1000;
}

/**
 * Parse WebVTT into cues.
 *
 * Deliberately lenient: the file comes from a CDN, not from us, and a malformed block must cost its
 * own line rather than the whole transcript. Anything that is not a well-formed cue is skipped.
 */
export function parseVtt(raw: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = String(raw ?? '')
    .replace(/\r/g, '')
    .split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    const arrowAt = lines.findIndex((l) => l.includes('-->'));
    if (arrowAt < 0) continue;
    const [from, to] = lines[arrowAt].split('-->');
    const start = parseTimestamp((from ?? '').split(/\s+/).filter(Boolean).pop() ?? '');
    const end = parseTimestamp((to ?? '').trim().split(/\s+/)[0] ?? '');
    if (start == null || end == null) continue;
    const text = lines
      .slice(arrowAt + 1)
      .join(' ')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    cues.push({ start, end, text });
  }
  return cues;
}

/**
 * Join cues into readable text.
 *
 * TikTok's ASR repeats a line across consecutive cues while a phrase is still being spoken, so a
 * naive join produces "guardate guardate guardate guardate". Consecutive duplicates collapse.
 */
export function cuesToText(cues: Cue[]): string {
  const out: string[] = [];
  for (const c of cues) {
    const t = c.text.trim();
    if (!t) continue;
    if (out.length && out[out.length - 1].toLowerCase() === t.toLowerCase()) continue;
    out.push(t);
  }
  return out.join(' ').trim();
}

/**
 * What was actually said in the opening.
 *
 * A cue that STARTS inside the window counts, even if it runs past it: the viewer heard the
 * beginning of that sentence while deciding whether to stay, and cutting mid-sentence would report
 * a hook nobody experienced.
 */
export function hookText(cues: Cue[], windowS = HOOK_WINDOW_S): string {
  return cuesToText(cues.filter((c) => c.start < windowS));
}

/** Downloading the caption file. Bounded, and never throws — a missing transcript is not an error. */
export const TRANSCRIPT_TIMEOUT_MS = 15_000;
export const MAX_TRANSCRIPT_BYTES = 512 * 1024;

export type TranscriptFetch =
  | { ok: true; transcript: Transcript }
  | { ok: false; reason: 'no_url' | 'http_error' | 'too_large' | 'empty' | 'fetch_failed' };

export async function fetchTranscript(
  url: string | null | undefined,
  lang?: string | null
): Promise<TranscriptFetch> {
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, reason: 'no_url' };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TRANSCRIPT_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, reason: 'http_error' };
    const size = Number(res.headers.get('content-length') ?? '0');
    if (size > MAX_TRANSCRIPT_BYTES) return { ok: false, reason: 'too_large' };
    const raw = await res.text();
    if (raw.length > MAX_TRANSCRIPT_BYTES) return { ok: false, reason: 'too_large' };
    const cues = parseVtt(raw);
    const text = cuesToText(cues);
    if (!text) return { ok: false, reason: 'empty' };
    return { ok: true, transcript: { text, cues, lang: lang ?? null } };
  } catch {
    return { ok: false, reason: 'fetch_failed' };
  }
}

/**
 * The columns a transcript writes.
 *
 * `transcript_source` is not decoration. A TikTok auto-caption and a Gemini transcription are
 * different instruments with different error profiles, and a column that mixes them without saying
 * which is which cannot be used to check one against the other — nor to notice that a finding rests
 * entirely on the cheaper one.
 */
export function transcriptColumns(t: Transcript, source: 'captions' | 'gemini'): Record<string, unknown> {
  return {
    transcript: t.text.slice(0, 20_000),
    transcript_source: source,
    transcript_lang: t.lang,
    hook_spoken: hookText(t.cues).slice(0, 500) || null
  };
}
