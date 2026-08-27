/**
 * Voice dictation for the chat composer.
 *
 * The browser records with MediaRecorder and posts the clip to `/app/{brand}/chat/transcribe`,
 * which runs it through Gemini. Nothing is persisted: the blob lives in memory for exactly one
 * request, and the mic tracks are stopped the moment the take ends (so the tab's recording
 * indicator goes away instead of lingering).
 *
 * The recording is re-encoded to WAV before it leaves the browser. MediaRecorder gives us
 * Opus-in-WebM on Chrome and Firefox, which Gemini does NOT accept as audio (its list is
 * wav/mp3/aiff/aac/ogg/flac), so the take is decoded through the Web Audio API and written out
 * as 16 kHz mono PCM — the sample rate speech models want anyway, and one format for every
 * browser instead of a per-browser container matrix.
 */

/** What we hand to the model: mono, 16 kHz, 16-bit — 32 KB of payload per second of speech. */
const WAV_SAMPLE_RATE = 16_000;

/** Hard stop for one dictation, so a forgotten mic can't grow past the request-body limit. */
export const MAX_RECORDING_MS = 120_000;

/** Vercel caps a function body around 4.5 MB; two minutes of 16 kHz mono PCM is 3.84 MB. */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/** Below this the take is silence or a mis-click — not worth a model call. */
const MIN_AUDIO_BYTES = 1_200;

const PREFERRED_MIME = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4', // Safari
  'audio/ogg;codecs=opus',
  'audio/ogg'
];

export type SpeechErrorCode = 'unsupported' | 'denied' | 'tooLong' | 'failed';

export class SpeechInputError extends Error {
  code: SpeechErrorCode;
  constructor(code: SpeechErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SpeechInputError';
    this.code = code;
  }
}

/** First container this browser can actually encode. `undefined` → let MediaRecorder decide. */
export function pickAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return PREFERRED_MIME.find((t) => MediaRecorder.isTypeSupported?.(t));
}

/** getUserMedia is https/localhost only, so this is false on an insecure origin by design. */
export function isSpeechInputSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export type VoiceRecorder = {
  /** Ends the take and resolves with the audio — `null` when nothing usable was captured. */
  stop: () => Promise<Blob | null>;
  /** Drops the take: no blob, no transcription, mic released. */
  cancel: () => void;
};

/** Ask for the mic and start recording. Throws `SpeechInputError` before anything is captured. */
export async function startRecording(): Promise<VoiceRecorder> {
  if (!isSpeechInputSupported()) throw new SpeechInputError('unsupported');

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }
    });
  } catch (e) {
    const name = (e as { name?: string } | null)?.name ?? '';
    // A dismissed prompt and a blocked site both land here; both are "grant the mic", not a bug.
    throw new SpeechInputError(
      name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError'
        ? 'denied'
        : 'failed',
      e instanceof Error ? e.message : undefined
    );
  }

  const mimeType = pickAudioMimeType();
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : undefined);
  } catch (e) {
    for (const t of stream.getTracks()) t.stop();
    throw new SpeechInputError('failed', e instanceof Error ? e.message : undefined);
  }

  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data?.size) chunks.push(e.data);
  };
  const release = () => {
    for (const t of stream.getTracks()) t.stop();
  };

  let settled = false;
  rec.start();

  return {
    stop: () =>
      new Promise<Blob | null>((resolve) => {
        if (settled || rec.state === 'inactive') {
          release();
          resolve(null);
          return;
        }
        settled = true;
        rec.onstop = () => {
          release();
          const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
          resolve(blob.size >= MIN_AUDIO_BYTES ? blob : null);
        };
        rec.stop();
      }),
    cancel: () => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      rec.onstop = release;
      if (rec.state === 'inactive') release();
      else rec.stop();
    }
  };
}

function audioContextClass(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

/** Average the channels: a stereo mic carries no information a transcriber can use. */
function downmix(buffer: AudioBuffer): Float32Array {
  const first = buffer.getChannelData(0);
  if (buffer.numberOfChannels === 1) return first;
  const out = new Float32Array(first.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += channel[i] / buffer.numberOfChannels;
  }
  return out;
}

/** Fallback for browsers that ignore the AudioContext sampleRate hint and decode at their own. */
function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const at = i * ratio;
    const lo = Math.floor(at);
    const hi = Math.min(lo + 1, samples.length - 1);
    out[i] = samples[lo] + (samples[hi] - samples[lo]) * (at - lo);
  }
  return out;
}

/** Canonical 44-byte RIFF header + 16-bit little-endian PCM. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

/**
 * Turn whatever the browser recorded into the one format the transcriber takes.
 *
 * Asking for a 16 kHz context makes `decodeAudioData` resample for us; `resample` only earns its
 * keep on a browser that hands back its own rate anyway.
 */
export async function toWav(blob: Blob): Promise<Blob> {
  const Ctx = audioContextClass();
  if (!Ctx) throw new SpeechInputError('unsupported');
  const bytes = await blob.arrayBuffer();

  let ctx: AudioContext;
  try {
    ctx = new Ctx({ sampleRate: WAV_SAMPLE_RATE });
  } catch {
    ctx = new Ctx();
  }
  try {
    const decoded = await ctx.decodeAudioData(bytes);
    const mono = downmix(decoded);
    return encodeWav(resample(mono, decoded.sampleRate, WAV_SAMPLE_RATE), WAV_SAMPLE_RATE);
  } catch (e) {
    if (e instanceof SpeechInputError) throw e;
    throw new SpeechInputError('failed', e instanceof Error ? e.message : undefined);
  } finally {
    void ctx.close().catch(() => {});
  }
}

/**
 * Send one take to the server and get the spoken text back.
 *
 * Multipart, not JSON: base64 would inflate the clip by a third for no reason.
 */
export async function transcribeAudio(
  blob: Blob,
  brandSlug: string,
  signal?: AbortSignal
): Promise<string> {
  const wav = await toWav(blob);
  if (wav.size > MAX_AUDIO_BYTES) throw new SpeechInputError('tooLong');

  const form = new FormData();
  form.append('audio', wav, 'dictation.wav');

  let res: Response;
  try {
    res = await fetch(`/app/${encodeURIComponent(brandSlug)}/chat/transcribe`, {
      method: 'POST',
      body: form,
      signal
    });
  } catch (e) {
    if ((e as { name?: string } | null)?.name === 'AbortError') throw e;
    throw new SpeechInputError('failed', e instanceof Error ? e.message : undefined);
  }

  if (!res.ok) {
    const detail = await res
      .json()
      .then((d: { error?: unknown }) => (typeof d?.error === 'string' ? d.error : ''))
      .catch(() => '');
    throw new SpeechInputError(res.status === 413 ? 'tooLong' : 'failed', detail || undefined);
  }

  const data = (await res.json().catch(() => ({}))) as { text?: unknown };
  return typeof data.text === 'string' ? data.text.trim() : '';
}

/** Merge a fresh transcription into whatever is already typed, without gluing words together. */
export function appendTranscript(current: string, text: string): string {
  const add = text.trim();
  if (!add) return current;
  const base = current.replace(/\s+$/, '');
  return base ? `${base} ${add}` : add;
}
