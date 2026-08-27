/**
 * Burned-in captions for generated clips.
 *
 * Why we burn our own rather than let the video model do it: asked to speak, the model reaches for
 * subtitles on its own and GARBLES the letters, and the garbling drifts frame to frame. So the
 * video prompt forbids on-screen text entirely (see buildVideoPrompt) and the words are composited
 * here, where the font is the brand's and the spelling is ours.
 *
 * Why ffmpeg and not Remotion — which this repo already ships: `renderMediaOnWeb` only runs in a
 * browser, and the autopilot publishes from a cron with no browser anywhere. ffmpeg + libass runs
 * server-side in the same function that renders the clip, so captions work on EVERY path.
 *
 * TIMING is two sources combined, because neither is sufficient alone:
 *   - Gemini transcribes the real audio and knows WHICH words were actually said (the model
 *     improvises and drops words, so the script we wrote is not authoritative).
 *   - Its timeline drifts, though: on one measured clip it packed 14.1s of speech into 12.55s, so
 *     captions ran progressively earlier until they were 1.5s ahead at the end.
 *   - ffmpeg's silencedetect is deterministic DSP and knows exactly WHERE sound is.
 * So the model supplies word order and relative timing, and the waveform supplies the anchors the
 * whole thing is rescaled onto.
 */
import { GEMINI_MAX_OUTPUT_TOKENS } from '$lib/server/ai-output-limits';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { env } from '$env/dynamic/private';
import { loggedGemini } from '$lib/server/ai-log';
import { geminiFlash, googleGenaiClient } from '$lib/server/gemini';
import { ensureFfmpegPath } from '$lib/server/ffmpeg-bin';

// 720px wide at font size 54 fits ~14 uppercase characters. Chunking by CHARACTER rather than word
// count is what keeps long words inside the frame — counting words let three long ones run off
// both edges.
const MAX_CHARS = 14;
// A cue shown exactly ON the word reads as late: the eye needs a beat to land on the text before
// the ear gets the word. Pull every cue forward by this much.
const LEAD_SECONDS = 0.15;
const NOISE_FLOOR = '-35dB';
// Shorter gaps are breaths inside a phrase, not phrase boundaries.
const MIN_PAUSE = 0.4;

function ffLog(bin: string, args: string[]): string {
  // ffmpeg writes its whole report to stderr and still exits 0, so probes must read stderr
  // unconditionally — reading it only on failure yields an empty log and every clip looks like one
  // uninterrupted speech segment.
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return r.stderr ?? '';
}

function ffRun(bin: string, args: string[]): void {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  // Never let a failed burn pass silently: without this the caller ships the UNCAPTIONED clip
  // believing it has captions, which is indistinguishable from the feature not being wired at all.
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr ?? '').slice(-300)}`);
}

function probeDuration(bin: string, file: string): number {
  const m = ffLog(bin, ['-hide_banner', '-i', file]).match(/Duration: (\d+):(\d+):([0-9.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

/** First and last instant of actual speech, from the waveform. */
export function speechWindow(log: string, duration: number): [number, number] {
  const marks = [...log.matchAll(/silence_(start|end): ([0-9.]+)/g)].map(
    (m) => [m[1], Number(m[2])] as [string, number]
  );
  const first = marks[0]?.[0] === 'start' && marks[0][1] < 0.2 ? (marks[1]?.[1] ?? 0) : 0;
  const trailing = [...marks].reverse().find(([k]) => k === 'start');
  const last = trailing ? trailing[1] : duration;
  return [first, Math.max(first + 1, last)];
}

export type Cue = { start: number; end: number; text: string };

/** Split a transcribed phrase into lines that physically fit, sharing its time slice. */
export function fitCue(cue: Cue): Cue[] {
  const words = cue.text.replace(/\s+/g, ' ').trim().toUpperCase().split(' ').filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && `${cur} ${w}`.length > MAX_CHARS) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  const span = (cue.end - cue.start) / lines.length;
  return lines.map((text, i) => ({ text, start: cue.start + i * span, end: cue.start + (i + 1) * span }));
}

/**
 * Rescale a drifting transcript onto the measured speech window, then apply the read-ahead lead.
 * Pure + exported: this is the correction that makes or breaks sync, so it is tested directly.
 */
export function alignCues(raw: Cue[], speech: [number, number], duration: number, lead = LEAD_SECONDS): Cue[] {
  if (!raw.length) return [];
  const [speechStart, speechEnd] = speech;
  const gemStart = raw[0].start;
  const gemEnd = raw[raw.length - 1].end;
  const scale = gemEnd > gemStart ? (speechEnd - speechStart) / (gemEnd - gemStart) : 1;
  const remap = (t: number) => speechStart + (t - gemStart) * scale;
  return raw
    .map((c) => ({
      text: c.text,
      start: Math.max(0, remap(c.start) - lead),
      end: Math.min(duration, Math.max(0.1, remap(c.end) - lead))
    }))
    .filter((c) => c.end > c.start && c.start < duration);
}

const toAssTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.max(0, s % 60);
  return `0:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
};

/**
 * ASS stylesheet. WrapStyle 0 wraps rather than letting a long line run off screen (WrapStyle 2,
 * "never wrap", is what pushed text past both edges in the first cut). MarginV 320 clears the
 * platform UI: Instagram's bottom overlay reaches higher than TikTok's, so it is sized for the
 * worse case.
 */
export function buildAss(cues: Cue[], fontName = 'Arial Black'): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Body,${fontName},54,&H00FFFFFF,&H00000000,&H00000000,-1,0,1,5,2,2,70,70,320,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  return (
    header +
    cues
      .map((c) => `Dialogue: 0,${toAssTime(c.start)},${toAssTime(c.end)},Body,,0,0,0,,${c.text.replace(/[\r\n]+/g, ' ')}`)
      .join('\n')
  );
}

async function transcribe(mp3: Buffer): Promise<Cue[]> {
  const key = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!key) return [];
  const ai = googleGenaiClient();
  const res = await loggedGemini('captions.transcribe', () =>
    ai.models.generateContent({
      model: geminiFlash(),
      config: { maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS },
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'audio/mp3', data: mp3.toString('base64') } },
            {
              text: `Transcribe the speech in this audio. Split it into SHORT phrases of at most 4 words each.
Return ONLY a JSON array, no prose, no markdown fence: [{"start": <seconds>, "end": <seconds>, "text": "<phrase>"}]
Timings must be precise to a tenth of a second and must match when each phrase is actually spoken.
Transcribe what is ACTUALLY said, not what you expect. Do not include pauses, filler, or anything not spoken.`
            }
          ]
        }
      ]
    })
  );
  const text = (res.text ?? '').trim();
  const open = text.indexOf('[');
  const close = text.lastIndexOf(']');
  if (open < 0 || close <= open) return [];
  try {
    const parsed = JSON.parse(text.slice(open, close + 1));
    return Array.isArray(parsed)
      ? parsed
          .map((c: { start?: unknown; end?: unknown; text?: unknown }) => ({
            start: Number(c.start),
            end: Number(c.end),
            text: String(c.text ?? '')
          }))
          .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.text.trim())
      : [];
  } catch {
    return [];
  }
}

/**
 * Burn captions into an mp4, returning the new bytes.
 *
 * BEST-EFFORT by contract, exactly like renderVideo: on any failure — no ffmpeg, no Gemini key,
 * silent clip, unparseable transcript — it returns the ORIGINAL bytes. A clip without captions is a
 * worse post; a clip that failed to publish is no post at all.
 */
export async function burnCaptions(mp4: Buffer, opts: { fontName?: string } = {}): Promise<Buffer<ArrayBufferLike>> {
  const ffmpegPath = await ensureFfmpegPath();
  if (!ffmpegPath) return mp4;
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'cap-'));
    const src = join(dir, 'in.mp4');
    const mp3 = join(dir, 'a.mp3');
    const ass = join(dir, 'c.ass');
    const out = join(dir, 'out.mp4');
    writeFileSync(src, mp4);

    const duration = probeDuration(ffmpegPath, src);
    if (!duration) return mp4;

    // Mono 16k is all the transcriber needs and keeps the inline audio payload small.
    ffRun(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', mp3]);
    const raw = await transcribe(readFileSync(mp3));
    if (!raw.length) return mp4; // silent b-roll, or transcription unavailable

    const speech = speechWindow(
      ffLog(ffmpegPath, ['-hide_banner', '-i', src, '-af', `silencedetect=n=${NOISE_FLOOR}:d=${MIN_PAUSE}`, '-f', 'null', '-']),
      duration
    );
    const cues = alignCues(raw.flatMap(fitCue), speech, duration);
    if (!cues.length) return mp4;

    writeFileSync(ass, buildAss(cues, opts.fontName));
    // The subtitles filter takes a path; keep it simple by running with the temp dir as cwd so the
    // filename needs no escaping (ASS paths inside a filtergraph are notoriously fiddly to quote).
    const r = spawnSync(
      ffmpegPath,
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', 'in.mp4', '-vf', 'subtitles=c.ass', '-c:a', 'copy', 'out.mp4'],
      { cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    );
    if (r.status !== 0) return mp4;
    return readFileSync(out);
  } catch {
    return mp4;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}
