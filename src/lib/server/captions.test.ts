import { describe, it, expect } from 'vitest';
import { alignCues, fitCue, speechWindow, buildAss, type Cue } from './captions';

// These are the two bugs that actually shipped in the prototype, so they get the tests.

describe('fitCue', () => {
  it('splits on a CHARACTER budget — counting words let long ones run off screen', () => {
    const lines = fitCue({ start: 0, end: 3, text: 'immagini finte hashtag a caso' });
    expect(lines.every((l) => l.text.length <= 14)).toBe(true);
  });

  it('shares the phrase timing across its lines, leaving no gap or overlap', () => {
    const lines = fitCue({ start: 2, end: 5, text: 'uno due tre quattro cinque sei' });
    expect(lines[0].start).toBe(2);
    expect(lines[lines.length - 1].end).toBeCloseTo(5, 5);
    for (let i = 1; i < lines.length; i++) expect(lines[i].start).toBeCloseTo(lines[i - 1].end, 5);
  });

  it('uppercases and drops an empty phrase', () => {
    expect(fitCue({ start: 0, end: 1, text: 'ciao' })[0].text).toBe('CIAO');
    expect(fitCue({ start: 0, end: 1, text: '   ' })).toEqual([]);
  });
});

describe('speechWindow', () => {
  it('reads the trailing silence as the end of speech', () => {
    // Real silencedetect output from a generated clip: speech runs to 14.12s of a 15s file.
    const log = 'silence_start: 8.45\nsilence_end: 8.89\nsilence_start: 14.11\n';
    expect(speechWindow(log, 15)).toEqual([0, 14.11]);
  });

  it('a clip that opens with silence starts at the first silence_end, not at 0', () => {
    const log = 'silence_start: 0.0\nsilence_end: 1.2\nsilence_start: 13.0\n';
    expect(speechWindow(log, 15)).toEqual([1.2, 13]);
  });

  it('no silence at all → the whole clip is speech', () => {
    expect(speechWindow('', 15)).toEqual([0, 15]);
  });
});

describe('alignCues', () => {
  // The failure this exists to prevent: Gemini reported a clip's speech ending at 12.55s when the
  // waveform said 14.12s. That is not an offset — it is a SCALE error, so the drift grows along the
  // clip: nearly nothing at the start, ~1.5s ahead by the end.
  it('rescales a compressed transcript onto the measured speech window', () => {
    const raw: Cue[] = [
      { start: 0, end: 1, text: 'A' },
      { start: 6, end: 7, text: 'B' },
      { start: 11.55, end: 12.55, text: 'C' }
    ];
    const out = alignCues(raw, [0, 14.12], 15, 0);
    expect(out[out.length - 1].end).toBeCloseTo(14.12, 2);
    // The middle cue stretches proportionally, not by a constant.
    expect(out[1].start).toBeCloseTo(6 * (14.12 / 12.55), 2);
  });

  it('applies the read-ahead lead so cues never land after the word', () => {
    // Transcript span already equals the speech window, so the rescale is the identity and only
    // the lead moves the cue. (With a SINGLE cue the rescale always stretches it to fill the whole
    // window, which would mask the lead entirely.)
    const raw: Cue[] = [
      { start: 0, end: 1, text: 'A' },
      { start: 5, end: 6, text: 'B' }
    ];
    const out = alignCues(raw, [0, 6], 15, 0.15);
    expect(out[1].start).toBeCloseTo(4.85, 2);
    expect(out[1].end).toBeCloseTo(5.85, 2);
  });

  it('never emits a negative start or runs past the clip', () => {
    const out = alignCues([{ start: 0, end: 20, text: 'X' }], [0, 15], 15, 0.5);
    expect(out[0].start).toBeGreaterThanOrEqual(0);
    expect(out[0].end).toBeLessThanOrEqual(15);
  });

  it('an empty transcript yields no cues rather than throwing', () => {
    expect(alignCues([], [0, 15], 15)).toEqual([]);
  });
});

describe('buildAss', () => {
  it('wraps rather than overflowing — WrapStyle 2 is what pushed text off both edges', () => {
    expect(buildAss([{ start: 0, end: 1, text: 'CIAO' }])).toContain('WrapStyle: 0');
  });

  it('keeps a cue on one Dialogue line even if the text arrives with newlines', () => {
    const ass = buildAss([{ start: 0, end: 1, text: 'DUE\nRIGHE' }]);
    expect(ass.trim().split('\n').filter((l) => l.startsWith('Dialogue')).length).toBe(1);
  });

  it('honours the brand font when one is supplied', () => {
    expect(buildAss([{ start: 0, end: 1, text: 'X' }], 'Space Grotesk')).toContain('Space Grotesk');
  });
});
