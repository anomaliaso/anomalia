import { describe, expect, it } from 'vitest';
import { HOOK_WINDOW_S, cuesToText, hookText, parseTimestamp, parseVtt, transcriptColumns } from './market-transcript';

// The real thing, byte for byte, off TikTok's CDN.
const REAL = `WEBVTT

00:00:00.040 --> 00:00:01.960
ah bello buonasera

00:00:04.360 --> 00:00:06.720
questo è il numero 1 raga è il numero 1

00:00:07.000 --> 00:00:08.320
guardate che roba ha portato
`;

describe('parseTimestamp', () => {
  it('reads the HH:MM:SS.mmm form TikTok emits', () => {
    expect(parseTimestamp('00:00:01.960')).toBeCloseTo(1.96);
    expect(parseTimestamp('01:02:03.500')).toBeCloseTo(3723.5);
  });

  it('reads the shorter MM:SS.mmm form', () => {
    expect(parseTimestamp('02:03.250')).toBeCloseTo(123.25);
  });

  it('accepts a comma decimal, which SRT-flavoured files use', () => {
    expect(parseTimestamp('00:00:01,500')).toBeCloseTo(1.5);
  });

  it('returns null on junk rather than a plausible-looking zero', () => {
    // A zero would put every malformed cue inside the hook window and quietly corrupt the hook.
    expect(parseTimestamp('banana')).toBeNull();
    expect(parseTimestamp('')).toBeNull();
  });
});

describe('parseVtt', () => {
  it('parses the file we actually downloaded', () => {
    const cues = parseVtt(REAL);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({ start: 0.04, end: 1.96, text: 'ah bello buonasera' });
  });

  it('skips a malformed block instead of losing the file', () => {
    // The file comes from a CDN, not from us. One bad block must cost its own line, nothing more.
    const cues = parseVtt(`WEBVTT\n\nnonsense\n\n00:00:01.000 --> 00:00:02.000\nvalida`);
    expect(cues.map((c) => c.text)).toEqual(['valida']);
  });

  it('strips the inline tags TikTok sometimes inserts', () => {
    expect(parseVtt(`WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<c.blue>ciao</c>`)[0].text).toBe('ciao');
  });

  it('joins a cue that wraps onto two lines', () => {
    expect(parseVtt(`WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nprima\nseconda`)[0].text).toBe('prima seconda');
  });

  it('survives an empty or absent file', () => {
    expect(parseVtt('')).toEqual([]);
    expect(parseVtt(undefined as unknown as string)).toEqual([]);
  });
});

describe('cuesToText', () => {
  it('collapses the consecutive repeats ASR produces', () => {
    // TikTok repeats a line across cues while the phrase is still being spoken; a naive join gives
    // "guardate guardate guardate guardate", which reads as a stylistic choice that never happened.
    const cues = [
      { start: 0, end: 1, text: 'guardate' },
      { start: 1, end: 2, text: 'guardate' },
      { start: 2, end: 3, text: 'che roba' }
    ];
    expect(cuesToText(cues)).toBe('guardate che roba');
  });

  it('keeps a repeat that is genuinely separated', () => {
    const cues = [
      { start: 0, end: 1, text: 'no' },
      { start: 1, end: 2, text: 'davvero' },
      { start: 2, end: 3, text: 'no' }
    ];
    expect(cuesToText(cues)).toBe('no davvero no');
  });
});

describe('hookText', () => {
  it('returns what was said in the opening seconds', () => {
    expect(hookText(parseVtt(REAL))).toBe('ah bello buonasera');
  });

  it('keeps a cue that starts inside the window but runs past it', () => {
    // The viewer heard that sentence begin while deciding whether to stay. Cutting it at the
    // boundary would report a hook nobody actually experienced.
    const cues = [{ start: 2.5, end: 9, text: 'una frase lunga che sfora' }];
    expect(hookText(cues)).toBe('una frase lunga che sfora');
  });

  it('excludes a cue that starts after the window', () => {
    expect(hookText(parseVtt(REAL))).not.toContain('numero 1');
  });

  it('is empty for a silent opening rather than borrowing a later line', () => {
    expect(hookText([{ start: 10, end: 12, text: 'tardi' }])).toBe('');
  });

  it('uses the three-second scroll-stop window', () => {
    expect(HOOK_WINDOW_S).toBe(3);
  });
});

describe('transcriptColumns', () => {
  const t = { text: 'ciao', cues: parseVtt(REAL), lang: 'it' };

  it('records WHICH instrument produced the transcript', () => {
    // A TikTok auto-caption and a Gemini transcription have different error profiles. Without this
    // column a finding cannot be re-checked on the expensive half, nor can anyone notice that it
    // rests entirely on the cheap one.
    expect(transcriptColumns(t, 'captions').transcript_source).toBe('captions');
    expect(transcriptColumns(t, 'gemini').transcript_source).toBe('gemini');
  });

  it('materialises the hook, which is the column the grouping happens on', () => {
    expect(transcriptColumns(t, 'captions').hook_spoken).toBe('ah bello buonasera');
  });

  it('leaves the hook null rather than empty when the opening is silent', () => {
    expect(transcriptColumns({ text: 'x', cues: [], lang: null }, 'captions').hook_spoken).toBeNull();
  });
});
