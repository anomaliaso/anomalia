import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  appendTranscript,
  isSpeechInputSupported,
  MAX_AUDIO_BYTES,
  MAX_RECORDING_MS,
  pickAudioMimeType,
  SpeechInputError,
  toWav
} from './speech-to-text';

/** Stand-in for a decoded recording: `channels` frames of raw samples at `sampleRate`. */
function stubAudioContext(channels: number[][], sampleRate: number) {
  const decoded = {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0].length,
    duration: channels[0].length / sampleRate,
    getChannelData: (i: number) => Float32Array.from(channels[i])
  };
  vi.stubGlobal('window', {
    AudioContext: class {
      constructor(_opts?: { sampleRate?: number }) {}
      decodeAudioData = async () => decoded;
      close = async () => {};
    }
  });
}

async function wavBytes(blob: Blob) {
  return new DataView(await blob.arrayBuffer());
}

const ascii = (view: DataView, at: number, len: number) =>
  String.fromCharCode(...Array.from({ length: len }, (_, i) => view.getUint8(at + i)));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('appendTranscript', () => {
  it('fills an empty composer with the transcription', () => {
    expect(appendTranscript('', '  ciao a tutti  ')).toBe('ciao a tutti');
  });

  it('adds to what is already typed instead of replacing it', () => {
    expect(appendTranscript('Scrivi un post', 'sul lancio di domani')).toBe(
      'Scrivi un post sul lancio di domani'
    );
  });

  it('never glues two words together, whatever whitespace the box ends with', () => {
    expect(appendTranscript('Scrivi un post ', 'sul lancio')).toBe('Scrivi un post sul lancio');
    expect(appendTranscript('Scrivi un post\n', 'sul lancio')).toBe('Scrivi un post sul lancio');
  });

  it('leaves the composer untouched when nothing was said', () => {
    expect(appendTranscript('Scrivi un post', '   ')).toBe('Scrivi un post');
  });
});

describe('pickAudioMimeType', () => {
  it('is undefined without MediaRecorder, so the recorder falls back to the browser default', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    expect(pickAudioMimeType()).toBeUndefined();
  });

  it('prefers opus in webm when the browser can encode it', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (t: string) => t === 'audio/webm;codecs=opus' || t === 'audio/mp4'
    });
    expect(pickAudioMimeType()).toBe('audio/webm;codecs=opus');
  });

  it('falls back to the mp4 container Safari records in', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (t: string) => t === 'audio/mp4' });
    expect(pickAudioMimeType()).toBe('audio/mp4');
  });
});

describe('isSpeechInputSupported', () => {
  it('is false during SSR, where there is no window to record from', () => {
    expect(isSpeechInputSupported()).toBe(false);
  });

  it('is false when getUserMedia is missing — an insecure origin has no mic at all', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
    vi.stubGlobal('navigator', { mediaDevices: undefined });
    expect(isSpeechInputSupported()).toBe(false);
  });

  it('is true once both halves of the capture path exist', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => Promise.resolve(null) } });
    expect(isSpeechInputSupported()).toBe(true);
  });
});

describe('limits', () => {
  it('keeps a full-length take inside the serverless request-body cap', () => {
    // What actually goes over the wire is 16 kHz mono 16-bit PCM: 32 KB per second of speech.
    const bytes = (MAX_RECORDING_MS / 1000) * 16_000 * 2 + 44;
    expect(bytes).toBeLessThan(MAX_AUDIO_BYTES);
  });
});

describe('SpeechInputError', () => {
  it('carries the code the composer maps to a message', () => {
    const err = new SpeechInputError('denied');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('denied');
  });
});

describe('toWav', () => {
  it('refuses to run where there is no Web Audio API to decode with', async () => {
    vi.stubGlobal('window', {});
    await expect(toWav(new Blob([new Uint8Array(8)]))).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('writes a mono 16 kHz PCM header Gemini can read', async () => {
    stubAudioContext([[0, 0.5, -0.5, 1]], 16_000);
    const view = await wavBytes(await toWav(new Blob([new Uint8Array(8)])));

    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(4 * 2); // 4 frames, 2 bytes each
    expect(view.byteLength).toBe(44 + 4 * 2);
  });

  it('clamps samples instead of wrapping them around', async () => {
    stubAudioContext([[2, -2]], 16_000);
    const view = await wavBytes(await toWav(new Blob([new Uint8Array(8)])));
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  it('averages a stereo mic down to one channel', async () => {
    stubAudioContext([[1, 1], [0, 0]], 16_000);
    const view = await wavBytes(await toWav(new Blob([new Uint8Array(8)])));
    expect(view.getInt16(44, true)).toBe(Math.trunc(0.5 * 32767)); // full + silent = half
  });

  it('resamples when the browser decodes at its own rate instead of ours', async () => {
    stubAudioContext([Array.from({ length: 48_000 }, () => 0)], 48_000);
    const view = await wavBytes(await toWav(new Blob([new Uint8Array(8)])));
    // One second in, one second out — at 16 kHz, not the 48 kHz the context handed back.
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(16_000 * 2);
  });
});
