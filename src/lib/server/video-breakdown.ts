/**
 * Reverse-engineer a winning UGC clip into a Seedance shot brief.
 *
 * When a reference video already converted for a similar product, don't invent a vibe prompt —
 * break the clip down second-by-second (subject, camera, audio, performance) and use THAT as the
 * creative brief. The brand's own spoken script (hook/body/cta) replaces the original dialogue.
 *
 * BEST-EFFORT: returns null when ffmpeg/Gemini/key is missing or the model returns garbage.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { llmConfigured, llmStructured, llmVideoReviewerModel } from '$lib/server/llm';
import { ensureFfmpegPath } from '$lib/server/ffmpeg-bin';
// One fetcher, one size cap, one place that says why a clip was rejected.
import { fetchVideoBytes } from '$lib/server/video-fetch';
import { structured } from '$lib/server/research';
import {
  formatUgcShotBrief,
  pickUgcBehavioralBeats,
  type UgcShotBrief,
  type UgcShotBeat
} from '$lib/server/ugc';

const BREAKDOWN_SCHEMA = {
  type: 'object' as const,
  properties: {
    subject: {
      type: 'string' as const,
      description: 'Who/what is on camera — wardrobe, age band, framing of the person, setting.'
    },
    camera: {
      type: 'string' as const,
      description: 'Camera treatment: handheld selfie, chest-up, micro-shakes, 9:16, etc.'
    },
    audio: {
      type: 'string' as const,
      description: 'Audio bed: phone-mic, room tone, ambient events, music or lack of it.'
    },
    duration_seconds: {
      type: 'number' as const,
      description: 'Approximate clip length in seconds.'
    },
    beats: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          start: { type: 'number' as const, description: 'Beat start in seconds.' },
          end: { type: 'number' as const, description: 'Beat end in seconds.' },
          action: {
            type: 'string' as const,
            description: 'What happens visually / performatively in this beat (NOT the spoken words).'
          }
        },
        required: ['start', 'end', 'action']
      }
    },
    dialogue_summary: {
      type: 'string' as const,
      description: 'What they roughly said — for context only; will be replaced by our script.'
    }
  },
  required: ['subject', 'camera', 'audio', 'duration_seconds', 'beats', 'dialogue_summary']
};

function ffRun(bin: string, args: string[]): void {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr ?? '').slice(-300)}`);
}

function probeDuration(bin: string, file: string): number {
  const r = spawnSync(bin, ['-hide_banner', '-i', file], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const m = (r.stderr ?? '').match(/Duration: (\d+):(\d+):([0-9.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

/**
 * Pull a few stills + a mono audio bed from the reference so Gemini can see AND hear the take.
 * Returns data URLs / buffers; null on failure.
 */
async function extractReferenceMedia(
  mp4: Buffer
): Promise<{ frames: Array<{ mimeType: string; data: string }>; audioMp3?: Buffer; duration: number } | null> {
  const ffmpegPath = await ensureFfmpegPath();
  if (!ffmpegPath) return null;
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'ugc-brk-'));
    const src = join(dir, 'in.mp4');
    writeFileSync(src, mp4);
    const duration = probeDuration(ffmpegPath, src) || 15;
    // Three stills across the clip — opening / mid / close — enough for a shot brief without a
    // huge multimodal payload.
    const stamps = [0.3, Math.max(0.5, duration * 0.45), Math.max(1, duration - 0.4)];
    const frames: Array<{ mimeType: string; data: string }> = [];
    for (let i = 0; i < stamps.length; i++) {
      const out = join(dir, `f${i}.jpg`);
      ffRun(ffmpegPath, [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        stamps[i].toFixed(2),
        '-i',
        src,
        '-frames:v',
        '1',
        '-q:v',
        '4',
        out
      ]);
      frames.push({ mimeType: 'image/jpeg', data: readFileSync(out).toString('base64') });
    }
    const mp3 = join(dir, 'a.mp3');
    ffRun(ffmpegPath, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      src,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '64k',
      '-t',
      Math.min(30, duration).toFixed(2),
      mp3
    ]);
    return { frames, audioMp3: readFileSync(mp3), duration };
  } catch {
    return null;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

export type UgcBreakdownResult = {
  brief: UgcShotBrief;
  /** Ready-to-paste Seedance creative brief (subject/camera/audio/timeline). */
  prompt: string;
  dialogueSummary: string;
  durationSeconds: number;
};

/**
 * Analyze a public reference video URL into a structured UGC shot brief + Seedance prompt text.
 */
export async function breakdownReferenceVideo(url: string): Promise<UgcBreakdownResult | null> {
  if (!llmConfigured() || !url?.trim()) return null;

  const bytes = await fetchVideoBytes(url.trim());
  if (!bytes) return null;
  const media = await extractReferenceMedia(bytes);
  if (!media?.frames.length) return null;

  try {
    const prompt = `You are reverse-engineering a real UGC selfie video into a Seedance 2.5 shot brief.
The attached images are frames from the clip (opening / mid / close) and the audio is the spoken take.
Produce a 1:1 timestamped breakdown of EVERYTHING on screen and in the mix — subject, camera, audio, performance beats.
Do NOT invent a different scene. Do NOT polish. Capture imperfect presence (gaze breaks, blinks, grip adjusts) when visible.
duration_seconds should be ~${media.duration.toFixed(1)}.
beats must cover the whole clip second-by-second (3–8 beats). action describes VISUAL/performance only — dialogue goes in dialogue_summary.
Return JSON.`;
    const parsed = await llmStructured<Record<string, unknown>>({
      prompt,
      schema: BREAKDOWN_SCHEMA,
      images: media.frames.map((f) => ({ mediaType: f.mimeType, data: f.data })),
      file: media.audioMp3
        ? { mediaType: 'audio/mp3', data: media.audioMp3.toString('base64') }
        : undefined,
      model: llmVideoReviewerModel(),
      label: 'ugc.breakdown'
    });

    const beatsRaw = Array.isArray(parsed.beats) ? parsed.beats : [];
    const timeline: UgcShotBeat[] = beatsRaw
      .map((b: Record<string, unknown>) => ({
        start: Number(b.start) || 0,
        end: Number(b.end) || 0,
        action: String(b.action ?? '').replace(/\s+/g, ' ').trim()
      }))
      .filter((b: UgcShotBeat) => b.action && b.end >= b.start);

    const brief: UgcShotBrief = {
      subject: String(parsed.subject ?? '').replace(/\s+/g, ' ').trim(),
      camera: String(parsed.camera ?? '').replace(/\s+/g, ' ').trim(),
      audio: String(parsed.audio ?? '').replace(/\s+/g, ' ').trim(),
      behavioralBeats: pickUgcBehavioralBeats(
        `${parsed.subject ?? ''}|${parsed.camera ?? ''}|${parsed.dialogue_summary ?? ''}`
      ),
      timeline
    };
    if (!brief.subject || !brief.camera) return null;

    const durationSeconds = Number(parsed.duration_seconds) || media.duration;
    return {
      brief,
      prompt: formatUgcShotBrief(brief),
      dialogueSummary: String(parsed.dialogue_summary ?? '').trim(),
      durationSeconds
    };
  } catch (e) {
    console.error(`[breakdownReferenceVideo] failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Merge a breakdown with an optional brand spoken line into a freeform Seedance prompt.
 * Our dialogue replaces the reference's — the visual/performance brief stays.
 */
export function shotBriefPromptFromBreakdown(
  breakdown: UgcBreakdownResult,
  opts: { script?: string | null; product?: string | null } = {}
): string {
  const line = opts.script?.replace(/\s+/g, ' ').trim() ?? '';
  const product = opts.product?.trim()
    ? `\nPRODUCT GROUNDING: if a product appears, it must be ${opts.product.trim()} — held casually, never presented as an ad still.`
    : '';
  const speech = line
    ? `\nSPOKEN LINE — the person says exactly this, and nothing else (ignore the reference dialogue): "${line}"`
    : '';
  return `${breakdown.prompt}${product}${speech}\n\nALWAYS: keep the same face and real skin texture from the reference (no beauty filter), lips synced. Expressive PAS performance — PROBLEM = brows knit / lean in; SOLUTION = visible relief (shoulders drop, softer eyes); not deadpan the whole clip. Fast natural talk — blink every ~2–3 seconds (never a frozen stare); one micro pause / gaze break OK; CTA trails off in energy but every word of the spoken line still finishes — never cut mid-word. If the line contains "Anomalia", pronounce it Italian: ah-no-MAH-lyah (/anoˈmalja/) — never Anomida/Anonimita/anomaly. NO subtitles, captions, logos or watermarks — ever.`;
}

