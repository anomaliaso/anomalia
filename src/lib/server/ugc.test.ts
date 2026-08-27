import { describe, it, expect } from 'vitest';
import {
  UGC_VISUAL_STYLE,
  UGC_COVER_MODEL,
  buildUgcCastPortraitPrompt,
  buildUgcProductStillPrompt,
  buildUgcFramePrompt,
  ugcSpokenLine,
  scriptFits,
  scriptWordBudget,
  scriptMinWords,
  looksLikeTelegramScript,
  pickUgcBehavioralBeats,
  UGC_BEHAVIORAL_BEATS
} from './ugc';

describe('UGC_COVER_MODEL', () => {
  it('uses Nano Banana Pro for UGC first frames', () => {
    expect(UGC_COVER_MODEL).toBe('gemini-3-pro-image-preview');
  });
});

describe('UGC_VISUAL_STYLE', () => {
  // MASTER UGC: shallow phone DOF + imperfect skin — never studio polish.
  it('asks for shallow DOF / TikTok vlog feel and forbids studio light', () => {
    expect(UGC_VISUAL_STYLE.toLowerCase()).toMatch(/shallow depth of field/);
    expect(UGC_VISUAL_STYLE.toLowerCase()).toMatch(/never studio|no .*studio/i);
    expect(UGC_VISUAL_STYLE.toLowerCase()).toMatch(/visible pores|under-eye/);
  });

  it('forbids on-image text — captions are burned afterwards, not generated', () => {
    expect(UGC_VISUAL_STYLE.toLowerCase()).toContain('no on-image text');
  });

  it('does not prescribe tidy or messy décor — setting stays neutral for the AI to choose', () => {
    const s = UGC_VISUAL_STYLE.toLowerCase();
    expect(s).not.toContain('setting:');
    expect(s).not.toContain('clutter');
    expect(s).not.toContain('unmade bed');
    expect(s).not.toContain('tidy');
    expect(s).not.toContain('uncluttered');
    expect(s).not.toContain('messy');
  });
});

describe('buildUgcFramePrompt', () => {
  it('always describes a person mid-sentence — an empty scene gives i2v nothing to animate', () => {
    const p = buildUgcFramePrompt();
    expect(p).toMatch(/mid-sentence/i);
    expect(p).toMatch(/arm's length/i);
    expect(p).toMatch(/front.camera selfie/i);
  });

  it('follows MASTER first-frame stack: pores, eyes off lens, named light, shallow DOF', () => {
    const p = buildUgcFramePrompt();
    expect(p).toMatch(/eyes off lens/i);
    expect(p).toMatch(/visible pores|under-eye/i);
    expect(p).toMatch(/shallow depth of field/i);
    expect(p).toMatch(/never "good lighting"|never 'good lighting'/i);
    expect(p).not.toMatch(/looking straight into the lens/i);
    expect(p).not.toMatch(/beautiful young woman|well made-up|polished makeup/i);
  });

  it('defers to the attached reference photos when the brand has a person for this post', () => {
    expect(buildUgcFramePrompt({ person: 'Andrea' })).toMatch(/reference photos/i);
    expect(buildUgcFramePrompt({})).not.toMatch(/reference photos/i);
  });

  it('a product is HELD casually, never presented — presenting is the advert tell', () => {
    const p = buildUgcFramePrompt({ product: 'Anomalia' });
    expect(p).toMatch(/holding Anomalia/);
    expect(p).toMatch(/not presenting it to camera/i);
  });

  it('matches an expressive PAIN MOMENT face to the hook so the first frame agrees with the audio', () => {
    const p = buildUgcFramePrompt({ hook: 'Stai buttando soldi.' });
    expect(p).toContain('Stai buttando soldi.');
    expect(p).toMatch(/PAIN MOMENT|brows knit|lean in/i);
  });

  it("renders the apostrophe in arm's length rather than the placeholder", () => {
    expect(buildUgcFramePrompt()).toContain("arm's length");
    expect(buildUgcFramePrompt()).not.toContain('arm/s');
  });

  it('never asks for on-screen text', () => {
    expect(buildUgcFramePrompt({ hook: 'x', product: 'y', person: 'z' })).toMatch(/No text, no captions/);
  });

  it('omits setting when the caller did not choose one — no default décor style', () => {
    const bare = buildUgcFramePrompt().toLowerCase();
    expect(bare).not.toMatch(/shot in:/);
    expect(bare).not.toContain('clutter');
    expect(bare).not.toContain('tidy');
    expect(bare).not.toContain('uncluttered');
  });

  it('passes through a caller-provided setting verbatim without tidy/messy coaching', () => {
    const p = buildUgcFramePrompt({ setting: 'sunlit kitchen counter' });
    expect(p).toContain('Shot in: sunlit kitchen counter.');
    expect(p.toLowerCase()).not.toContain('no clutter');
    expect(p.toLowerCase()).not.toContain('tidy');
  });
});

describe('script budget', () => {
  const script = {
    hook: 'Se paghi un social media manager, stai buttando via i tuoi soldi.',
    body: "Ho chiuso con l'agenzia. Adesso è un'AI che mi scrive i post, li disegna e li pubblica.",
    cta: 'Provala e poi vieni a dirmi che mi sbaglio.'
  };

  it('budgets ~3.3 words/sec with headroom — fast natural spoken sentences', () => {
    expect(scriptWordBudget(15)).toBe(45); // floor(15 * 3.3 * 0.92)
    expect(scriptWordBudget(6)).toBe(18);
    expect(scriptMinWords(15)).toBe(32); // floor(45 * 0.72)
  });

  it('flags telegram / headline fragments as sparse spoken scripts', () => {
    expect(
      looksLikeTelegramScript({
        hook: 'Calendar chaos?',
        body: 'Resolve it.',
        cta: 'Try Anomalia.'
      })
    ).toBe(true);
    expect(looksLikeTelegramScript(script)).toBe(false);
  });

  it('flags a script that will not fit, so the CTA is shortened while WRITING not after', () => {
    expect(scriptFits(script, 6)).toBe(false);
    expect(scriptFits({ hook: 'Basta.', body: 'Ci pensa Anomalia.', cta: 'Provala.' }, 6)).toBe(true);
  });

  it('joins hook, body and cta in order into the spoken line', () => {
    const line = ugcSpokenLine(script, 15);
    expect(line.startsWith('Se paghi')).toBe(true);
  });

  it('truncates on a word boundary, never mid-word', () => {
    const line = ugcSpokenLine(script, 3);
    expect(script.hook.startsWith(line) || line.startsWith('Se paghi')).toBe(true);
    expect(line.split(/\s+/).every((w) => w.length > 0)).toBe(true);
  });
});

describe('behavioral beats', () => {
  it('picks 2–3 stable MASTER beats and varies count by seed', () => {
    const a = pickUgcBehavioralBeats('Andrea|kitchen|hook');
    const b = pickUgcBehavioralBeats('Andrea|kitchen|hook');
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(a.length).toBeLessThanOrEqual(3);
    for (const beat of a) expect(UGC_BEHAVIORAL_BEATS).toContain(beat);
    // Explicit n still respected.
    expect(pickUgcBehavioralBeats('x', 3)).toHaveLength(3);
  });

  it('lists the full MASTER set for prompt fallbacks', () => {
    expect(UGC_BEHAVIORAL_BEATS).toEqual([
      'glance away',
      'lean back',
      'shrug',
      'adjust phone grip',
      'react to a sound',
      'half-laugh at own sentence'
    ]);
  });
});

describe('casting prompts — la coerenza è una proprietà delle immagini, non del testo', () => {
	it('the portrait exists to lock an identity, and commits to one when none is given', () => {
		const p = buildUgcCastPortraitPrompt({ setting: 'a lived-in kitchen' });
		expect(p).toMatch(/LOCK an identity/i);
		expect(p).toMatch(/invent a concrete look and COMMIT/i);
		expect(p).toMatch(/lived-in kitchen/);
		expect(p).toMatch(/visible pores/i);
		expect(p).toMatch(/No text, no logo/i);
	});

	it('uses the attached photos when the brand already has a talent', () => {
		const p = buildUgcCastPortraitPrompt({ person: 'Andrea' });
		expect(p).toMatch(/attached reference photos/i);
		expect(p).not.toMatch(/invent a concrete look/i);
	});

	it('the product still is a reference, not a packshot', () => {
		const p = buildUgcProductStillPrompt('Anomalia Card', { setting: 'a desk' });
		expect(p).toContain('Anomalia Card');
		expect(p).toMatch(/keep the object IDENTICAL/i);
		expect(p).toMatch(/No hands, no person/i);
		expect(p).toMatch(/no packshot styling/i);
	});
});
