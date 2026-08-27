import { describe, it, expect } from 'vitest';
import { trimScriptToBudget, isUgcTalkingSeed } from './ugc-script-review';
import { buildUgcShotBrief, formatUgcShotBrief } from './ugc';
import { deadSpaceWindow } from './video-edit';
import { shotBriefPromptFromBreakdown, type UgcBreakdownResult } from './video-breakdown';
import { buildVideoPrompt } from './video';

describe('trimScriptToBudget', () => {
  it('keeps the hook and prefers dropping agitate over the solution tail', () => {
    const out = trimScriptToBudget(
      {
        hook: 'Se paghi un social media manager stai buttando soldi',
        body: 'Ho chiuso con l agenzia e adesso un AI scrive disegna e pubblica tutto da solo ogni giorno',
        cta: 'Provala e poi vieni a dirmi che mi sbaglio davvero'
      },
      6 // ~18 words at 3.3 w/s with headroom
    );
    expect(out.hook.startsWith('Se paghi')).toBe(true);
    const words = [out.hook, out.body, out.cta].join(' ').trim().split(/\s+/).filter(Boolean);
    expect(words.length).toBeLessThanOrEqual(18);
  });

  it('PAS trim keeps the solution pivot when the body must shrink', () => {
    const out = trimScriptToBudget(
      {
        hook: 'I was writing captions at midnight again',
        body: 'Burning evenings on the calendar felt embarrassing then Anomalia drafted visuals and copy for me',
        cta: 'Anyway try it and tell me I am wrong'
      },
      10
    );
    expect(out.hook).toMatch(/captions at midnight/i);
    expect(out.body.toLowerCase()).toMatch(/anomalia/);
    const words = [out.hook, out.body, out.cta].join(' ').trim().split(/\s+/).filter(Boolean);
    expect(words.length).toBeLessThanOrEqual(scriptWordBudgetFor(10));
  });
});

function scriptWordBudgetFor(seconds: number) {
  return Math.max(1, Math.floor(seconds * 3.3 * 0.92));
}

describe('isUgcTalkingSeed', () => {
  it('defaults video seeds to talking UGC unless ugc is explicitly false', () => {
    expect(isUgcTalkingSeed({ format: 'video' })).toBe(true);
    expect(isUgcTalkingSeed({ format: 'video', ugc: true })).toBe(true);
    expect(isUgcTalkingSeed({ format: 'video', ugc: false })).toBe(false);
    expect(isUgcTalkingSeed({ format: 'single_image' })).toBe(false);
  });
});

describe('UgcShotBrief', () => {
  it('serializes Hook→Problem→Demo→Proof→CTA block prompt for Seedance UGC', () => {
    const brief = buildUgcShotBrief({
      person: 'Andrea',
      setting: 'sunlit kitchen',
      product: 'Anomalia',
      hook: 'Stai buttando soldi',
      desire: 'live comfortably',
      seconds: 15
    });
    const text = formatUgcShotBrief(brief, { script: 'Stai buttando soldi. Anomalia fa il resto.', product: 'Anomalia' });
    expect(text).toMatch(/^REFERENCES:/m);
    expect(text).toMatch(/^CAMERA:/m);
    expect(text).toMatch(/^STAGES:/m);
    expect(text).toMatch(/^GLOBAL STYLE:/m);
    expect(text).toMatch(/^POSITIVE LOCKS \(must NOT happen\):/m);
    // Le direttive Seedance 2.5 (docs/43): recitazione sotto tono, fisica monotòna, chiusura
    // sulla persona. Sono le tre che tolgono il sapore di spot, e sono in blocchi propri.
    expect(text).toMatch(/^ACTING:/m);
    expect(text).toMatch(/half a beat late/i);
    expect(text).toMatch(/^PHYSICS:/m);
    expect(text).toMatch(/never becomes whole again/i);
    expect(text).toMatch(/^ENDING:/m);
    expect(text).toMatch(/no product packshot/i);
    expect(text).toMatch(/exactly five fingers/i);
    expect(text).toMatch(/24fps/);
    expect(text).toMatch(/hunting autofocus|micro-shakes|uneven light/i);
    expect(text).toContain('Andrea');
    expect(text).toContain('Anomalia');
    expect(text).toMatch(/PAIN MOMENT|desire under/i);
    expect(brief.behavioralBeats.length).toBeGreaterThanOrEqual(2);
    expect(brief.behavioralBeats.length).toBeLessThanOrEqual(3);
    expect(brief.timeline.length).toBe(5);
    expect(brief.timeline[0].end).toBeLessThan(brief.timeline[4].start);
    expect(brief.timeline[0].action).toMatch(/HOOK|PAIN MOMENT|brows knit/i);
    expect(brief.timeline[1].action).toMatch(/PROBLEM/i);
    expect(brief.timeline[2].action).toMatch(/DEMO/i);
    expect(brief.timeline[3].action).toMatch(/PROOF|relief/i);
    expect(brief.timeline[4].action).toMatch(/CTA/i);
    expect(brief.timeline[0].end).toBeCloseTo(2.3, 0); // ~15% of 15s
    expect(brief.timeline[2].end).toBeCloseTo(9, 0); // ~60% of 15s
    expect(brief.timeline[3].end).toBeCloseTo(12, 0); // ~80% of 15s
    for (const beat of brief.behavioralBeats) {
      expect(text).toContain(beat);
    }
  });
});

describe('UgcShotBrief with a named format', () => {
  it('replaces the PAS arc with the format timeline and names it in STAGES', () => {
    const brief = buildUgcShotBrief({
      person: 'Andrea',
      setting: 'a parked car',
      product: 'Anomalia',
      hook: 'Ho comprato questa cosa',
      hookVisual: 'a taped cardboard box lands on the passenger seat',
      format: 'unboxing',
      seconds: 15
    });
    expect(brief.format).toBe('unboxing');
    expect(brief.timeline.map((b) => b.action).join('\n')).toMatch(/ARRIVAL[\s\S]*FIRST USE[\s\S]*VERDICT/);
    // The whole clip is covered, the last beat still finishes the sentence.
    expect(brief.timeline[0]!.start).toBe(0);
    expect(brief.timeline.at(-1)!.end).toBe(15);
    expect(brief.timeline.at(-1)!.action).toMatch(/never cut mid-word/);
    // The visual action leads the first beat — the frame has to earn the second.
    expect(brief.timeline[0]!.action).toMatch(/taped cardboard box/);

    const text = formatUgcShotBrief(brief, { script: 'Ho comprato questa cosa.', product: 'Anomalia' });
    expect(text).toMatch(/FORMAT unboxing/);
    // Unboxing is one of the two formats where the product IS the opening shot.
    expect(text).toMatch(/The product IS the opening shot/);
    expect(text).toMatch(/in hand from the first frame/);
  });

  it('keeps the product out of the opening on every other format', () => {
    const brief = buildUgcShotBrief({ product: 'Anomalia', format: 'comparison', seconds: 15 });
    expect(brief.subject).toMatch(/later casually holding/);
    const text = formatUgcShotBrief(brief, {});
    expect(text).toMatch(/Product must NOT lead the hook/);
  });

  it('leaves the default PAS arc untouched when no format is given', () => {
    const brief = buildUgcShotBrief({ seconds: 15 });
    expect(brief.format).toBeUndefined();
    expect(brief.timeline.length).toBe(5);
    expect(brief.timeline[0]!.action).toMatch(/HOOK/);
    expect(formatUgcShotBrief(brief, {})).toMatch(/Hook → Problem → Demo → Proof → CTA/);
  });
});

describe('buildUgcStoryboardFrames', () => {
  it('returns 5 storyboard still prompts with hook before product', async () => {
    const { buildUgcStoryboardFrames } = await import('./ugc');
    const frames = buildUgcStoryboardFrames({
      person: 'Andrea',
      product: 'Anomalia',
      hook: 'Midnight captions again',
      desire: 'be liked and respected'
    });
    expect(frames.map((f) => f.beat)).toEqual(['hook', 'problem', 'demo', 'proof', 'cta']);
    expect(frames[0]!.prompt).toMatch(/Product NOT visible|NOT visible yet/i);
    expect(frames[0]!.prompt).toMatch(/desire under it/i);
    expect(frames[2]!.prompt).toMatch(/Anomalia|DEMO/i);
  });
});

describe('buildUgcStoryboardFrames with a format', () => {
  it('storyboards the format own beats, not the PAS ones', async () => {
    const { buildUgcStoryboardFrames } = await import('./ugc');
    const frames = buildUgcStoryboardFrames({
      person: 'Andrea',
      product: 'Anomalia',
      format: 'testimonial',
      seconds: 15
    });
    expect(frames.map((f) => f.beat)).toEqual([
      'skeptic',
      'before',
      'discovery',
      'result',
      'recommend'
    ]);
    for (const f of frames) {
      expect(f.atPct).toBeGreaterThan(0);
      expect(f.atPct).toBeLessThanOrEqual(100);
    }
  });
});

describe('deadSpaceWindow', () => {
  it('trims a silent head and a silent tail', () => {
    // Mild dead space that still clears MIN_TRIM but keeps ≥85% of the take.
    const log = 'silence_start: 0.0\nsilence_end: 0.55\nsilence_start: 14.2\n';
    const win = deadSpaceWindow(log, 15, 0.12);
    expect(win).not.toBeNull();
    expect(win!.start).toBeCloseTo(0.43, 2);
    expect(win!.end).toBeCloseTo(14.32, 2);
    expect(win!.trimHead).toBeGreaterThan(0.3);
    expect(win!.trimTail).toBeGreaterThan(0.3);
  });

  it('returns null when there is nothing worth cutting', () => {
    expect(deadSpaceWindow('', 15)).toBeNull();
    expect(deadSpaceWindow('silence_start: 14.8\n', 15, 0.12)).toBeNull();
  });

  it('refuses a trim that would keep less than ~85% of the clip (false mid-speech silence)', () => {
    // Speech falsely detected as ending at ~3.5s on a 15s take.
    const log = 'silence_start: 0.0\nsilence_end: 0.3\nsilence_start: 3.5\n';
    expect(deadSpaceWindow(log, 15, 0.12)).toBeNull();
  });
});

describe('shotBriefPromptFromBreakdown', () => {
  it('locks our spoken line over the reference dialogue', () => {
    const breakdown: UgcBreakdownResult = {
      brief: {
        subject: 'woman in a parked car',
        camera: 'handheld selfie 9:16',
        audio: 'phone mic, no music',
        behavioralBeats: ['glance away', 'shrug'],
        timeline: [{ start: 0, end: 3, action: 'leans in' }]
      },
      prompt: 'subject: woman in a parked car\ncamera: handheld selfie 9:16\naudio: phone mic, no music\nbehavioral_beats (MUST do these 2–3 on camera, vary per video): glance away • shrug\ntimeline:\n- 0-3 leans in',
      dialogueSummary: 'original pitch',
      durationSeconds: 15
    };
    const p = shotBriefPromptFromBreakdown(breakdown, { script: 'ciao a tutti', product: 'Anomalia' });
    expect(p).toContain('ciao a tutti');
    expect(p).toContain('Anomalia');
    expect(p).toMatch(/every word of the spoken line still finishes|finish every word/i);
    expect(p).toContain('subject: woman');
  });
});

describe('buildVideoPrompt — structured shot brief', () => {
  it('prefers an explicit shotBrief over the default timeline block', () => {
    const p = buildVideoPrompt('a man', {
      hasCover: true,
      ugc: true,
      script: 'ciao',
      shotBrief: 'subject: custom person\ncamera: custom cam\naudio: custom audio\ntimeline:\n- 0-2 custom beat'
    });
    expect(p).toContain('custom person');
    expect(p).toContain('custom beat');
    expect(p).toContain('"ciao"');
  });
});

describe('shot boundaries follow the format, not a habit', () => {
	it('numbers the shots and declares a hard cut where the scene really changes', () => {
		const brief = buildUgcShotBrief({ format: 'unboxing', seconds: 15, product: 'Anomalia' });
		const text = formatUgcShotBrief(brief, {});
		expect(text).toMatch(/SHOT 1 \(0-1\.5s\)/);
		expect(text).toContain('Hard cut.');
		expect(text).toMatch(/Every shot boundary below is a HARD CUT/);
	});

	it('forbids cuts on a single-take talking head — the opposite rule, said out loud', () => {
		const brief = buildUgcShotBrief({ format: 'testimonial', seconds: 15 });
		const text = formatUgcShotBrief(brief, {});
		expect(text).toMatch(/ONE CONTINUOUS TAKE/);
		expect(text).not.toContain('Hard cut.');
	});

	it('describes what every attached reference controls', () => {
		const brief = buildUgcShotBrief({ format: 'comparison', seconds: 15 });
		const text = formatUgcShotBrief(brief, {
			references: ['is the speaker: face, hair, build and wardrobe come from here.', 'is a later moment of the same clip.']
		});
		expect(text).toContain('@Image 1 is the speaker');
		expect(text).toContain('@Image 2 is a later moment');
	});
});
