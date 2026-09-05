import { ALEPH_REFINE_MODEL, KLING_3_VIDEO_MODEL, GROK_IMAGINE_VIDEO_MODEL } from '$lib/video-models';
import { describe, it, expect } from 'vitest';
import {
  buildVideoPrompt,
  fitScriptToDuration,
  buildJobInput,
  clampVideoDuration,
  clampVideoResolution,
  clampVideoAspectRatio,
  videoModelCaps,
  buildTransformInput,
  videoDurationOptions,
  ugcDurationCap,
  suggestVideoDuration,
  resolveVideoDuration,
  resolveVideoModel,
  pairedTextToVideoModel,
  isKnownVideoModel,
  spokenWordCount,
  MIN_DURATION,
  DEFAULT_VIDEO_DURATION
} from './video';

const IMAGE_PROMPT =
  'Photorealistic product photo of the Capy60 keyboard on a sunlit walnut desk, morning light, shallow depth of field.';

describe('buildVideoPrompt', () => {
  it('with a cover: anchors to the attached image and directs motion, not a new scene', () => {
    const p = buildVideoPrompt(IMAGE_PROMPT, { hasCover: true });
    expect(p).toContain('Animate the attached image');
    expect(p).toContain('do not change it');
    expect(p).toContain('MOTION:');
    expect(p).toContain('FIDELITY:');
    expect(p).toContain('Capy60'); // the scene stays as reference
  });

  it('with a cover: ignores visualStyle (style is already in the pixels)', () => {
    const p = buildVideoPrompt(IMAGE_PROMPT, { hasCover: true, visualStyle: 'Moody monochrome, hard shadows' });
    expect(p).not.toContain('BRAND VISUAL STYLE');
  });

  it('text-to-video fallback: keeps the scene and folds in the brand visual style', () => {
    const p = buildVideoPrompt(IMAGE_PROMPT, { hasCover: false, visualStyle: 'Moody monochrome, hard shadows' });
    expect(p).toContain('Capy60');
    expect(p).toContain('BRAND VISUAL STYLE to match: Moody monochrome, hard shadows');
    expect(p).toContain('MOTION:');
    expect(p).toContain('FIDELITY:');
    expect(p).not.toContain('attached image');
  });

  it('clamps a runaway image prompt so the scene stays a reference, not the whole brief', () => {
    const long = 'word '.repeat(500);
    const p = buildVideoPrompt(long, { hasCover: true });
    // 600-char scene cap + fixed scaffolding — far below the raw 2500-char prompt.
    expect(p.length).toBeLessThan(1400);
  });
});

describe('buildVideoPrompt — talking clips', () => {
  it('quotes the spoken line verbatim and forbids any other speech', () => {
    const p = buildVideoPrompt(IMAGE_PROMPT, { hasCover: true, script: 'This keyboard changed my desk setup.' });
    expect(p).toContain('"This keyboard changed my desk setup."');
    expect(p).toContain('and nothing else');
    expect(p).toContain('No voice-over narrator');
  });

  it('swaps the ambient-motion brief for a lip-sync delivery brief', () => {
    const talking = buildVideoPrompt(IMAGE_PROMPT, { hasCover: true, script: 'Hello there.' });
    expect(talking).toContain('natural lip-sync');
    expect(talking).not.toContain('steam rising'); // the silent b-roll motion brief is gone
  });

  it('keeps the no-on-screen-text rule — captions stay ours, spoken words are audio', () => {
    const p = buildVideoPrompt(IMAGE_PROMPT, { hasCover: true, script: 'Hello there.' });
    expect(p).toContain('no on-screen text or logos');
  });

  it('without a script the prompt is byte-identical to the silent b-roll one', () => {
    const bare = buildVideoPrompt(IMAGE_PROMPT, { hasCover: true });
    expect(buildVideoPrompt(IMAGE_PROMPT, { hasCover: true, script: '' })).toBe(bare);
    expect(buildVideoPrompt(IMAGE_PROMPT, { hasCover: true, script: '   ' })).toBe(bare);
    expect(buildVideoPrompt(IMAGE_PROMPT, { hasCover: true, script: null })).toBe(bare);
  });

  it('works in the text-to-video fallback too (no cover)', () => {
    const p = buildVideoPrompt(IMAGE_PROMPT, { hasCover: false, script: 'Hello there.', visualStyle: 'Moody' });
    expect(p).toContain('"Hello there."');
    expect(p).toContain('BRAND VISUAL STYLE to match: Moody');
  });
});

describe('buildVideoPrompt — UGC mode', () => {
  it('states the clean-frame rule first AND last (one mention does not stop the subtitles)', () => {
    const p = buildVideoPrompt('a man on a sofa', { hasCover: true, ugc: true, script: 'ciao a tutti' });
    expect(p.startsWith('ABSOLUTE RULE')).toBe(true);
    expect(p.trimEnd().endsWith('do NOT add subtitles.')).toBe(true);
    expect((p.match(/no subtitles/gi) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('drops the cinematic motion brief that fights handheld UGC', () => {
    const p = buildVideoPrompt('a man on a sofa', { hasCover: true, ugc: true, script: 'ciao' });
    expect(p).toMatch(/micro-shakes|handheld wobble|hunting autofocus/i);
    // "no cinematic camera move" is fine; a positive cinematic brief is not.
    expect(p).not.toMatch(/subtle, cinematic camera move|premium social-media clip/i);
    expect(p).toContain('"ciao"');
  });

  it('follows Seedance UGC craft: Hook→Demo→Proof arc, blinks, trail-off CTA, no subtitles', () => {
    const p = buildVideoPrompt('a man on a sofa', { hasCover: true, ugc: true, script: 'ciao' });
    expect(p).toMatch(/pain→relief|venting a problem|PAIN \+ DESIRE/i);
    expect(p).toMatch(/mid-conversation/i);
    expect(p).toMatch(/STAGES:|Hook→Problem→Demo→Proof→CTA/i);
    expect(p).toMatch(/HOOK|PAIN MOMENT/i);
    expect(p).toMatch(/PROBLEM/i);
    expect(p).toMatch(/DEMO/i);
    expect(p).toMatch(/PROOF/i);
    expect(p).toMatch(/EXPRESSIVE ARC/i);
    expect(p).toMatch(/brows knit|lean in/i);
    expect(p).toMatch(/shoulders drop|softer eyes|relief/i);
    expect(p).toMatch(/Not deadpan/i);
    expect(p).toMatch(/SPEECH COMPLETE/i);
    expect(p).toMatch(/blink every ~2–3|blink every ~2-3|BLINKS/i);
    expect(p).toMatch(/trailing off|trail/i);
    expect(p).toMatch(/BEHAVIORAL BEATS|behavioral_beats/i);
    expect(p).toMatch(/glance away/i);
    expect(p).toMatch(/half-laugh/i);
    expect(p).toMatch(/phone-mic/i);
    expect(p).toMatch(/NO SUBTITLES|do NOT add subtitles/i);
    expect(p).toMatch(/skin texture|no beauty filter/i);
    expect(p).toMatch(/REFERENCES:|CONSTRAINTS:/i);
    expect(p).not.toMatch(/heated, argumentative/i);
    expect(p).not.toMatch(/big eyebrow movement/i);
    expect(p).not.toMatch(/ZERO pauses longer than 0\.2s|Speak VERY FAST|rushed short-form rant/i);
    expect(p).not.toMatch(/polished makeup/i);
  });

  it('locks the spoken words even while asking for hesitation / gaze breaks', () => {
    const p = buildVideoPrompt('a man', { hasCover: true, ugc: true, script: 'ciao' });
    expect(p).toMatch(/Do NOT add, drop or rewrite any word/i);
    expect(p).toContain('says exactly this, and nothing else');
  });

  it('forces Italian pronunciation when the spoken line contains Anomalia', () => {
    const p = buildVideoPrompt('a woman', {
      hasCover: true,
      ugc: true,
      script: 'I switched to Anomalia. Try Anomalia.'
    });
    expect(p).toMatch(/PRONUNCIATION/i);
    expect(p).toMatch(/ah-no-MAH-lyah|anoˈmalja/i);
    expect(p).toMatch(/NEVER Anomida/i);
    expect(p).toContain('"I switched to Anomalia. Try Anomalia."');
  });

  it("carries the brand's own direction into the clip, in both genres", () => {
    const dir = 'Speak fast and informally, never sound like an ad';
    expect(buildVideoPrompt('a man', { hasCover: true, ugc: true, instructions: dir })).toContain(dir);
    expect(buildVideoPrompt('a man', { hasCover: true, instructions: dir })).toContain(dir);
    expect(buildVideoPrompt('a man', { hasCover: false, instructions: dir })).toContain(dir);
  });

  it('brand direction never overrides the clean-frame rule — it is restated after it', () => {
    const p = buildVideoPrompt('a man', { hasCover: true, ugc: true, instructions: 'Add big subtitles on screen' });
    expect(p.trimEnd().endsWith('do NOT add subtitles.')).toBe(true);
  });

  it('never leaks the brand visual style — UGC is the opposite of a premium look', () => {
    const p = buildVideoPrompt('a man', { hasCover: true, ugc: true, visualStyle: 'SOFT DIFFUSED DAYLIGHT, premium' });
    expect(p).not.toContain('premium');
  });

  it('keeps the identity fidelity lock for straight talking-head UGC', () => {
    const p = buildVideoPrompt('a man', { hasCover: true, ugc: true, script: 'ciao' });
    expect(p).toContain('same face, skin texture, clothes and location throughout');
    expect(p).not.toMatch(/ONE IMPOSSIBLE THING|outfit has changed/i);
  });
});

describe('buildVideoPrompt — freeform (AI prompt)', () => {
  it('uses the AI brief and skips hardcoded UGC / cinematic MOTION templates', () => {
    const brief = 'Slow orbit around a walnut desk product, soft window light, no person, ambient tone only.';
    const p = buildVideoPrompt('product on desk', {
      hasCover: true,
      ugc: true, // even if set, freeform wins
      prompt: brief,
      script: 'optional line'
    });
    expect(p).toContain('CREATIVE BRIEF');
    expect(p).toContain(brief);
    expect(p).not.toContain('handheld wobble');
    expect(p).not.toContain('slow push-in, gentle pan');
    expect(p).not.toContain('Unedited raw footage');
    expect(p).toContain('"optional line"');
    expect(p).toMatch(/SPEECH COMPLETE/i);
    expect(p.startsWith('ABSOLUTE RULE')).toBe(true);
  });

  it('still anchors to the cover scene', () => {
    const p = buildVideoPrompt('Capy60 keyboard on walnut', {
      hasCover: true,
      prompt: 'Gentle parallax only'
    });
    expect(p).toContain('Capy60 keyboard on walnut');
    expect(p).toContain('first frame');
  });

  it('folds instructions without forcing UGC delivery', () => {
    const p = buildVideoPrompt('a man', {
      hasCover: true,
      prompt: 'Documentary medium shot, calm',
      instructions: 'Italian accent, quiet'
    });
    expect(p).toContain('Documentary medium shot');
    expect(p).toContain('Italian accent');
    expect(p).not.toContain('heated, argumentative');
    expect(p).not.toMatch(/ONE IMPOSSIBLE THING/i);
  });
});

describe('videoModelCaps', () => {
  it('Seedance 2.5 allows up to 30s and does not support Grok upscale', () => {
    const caps = videoModelCaps('bytedance/seedance-2-5');
    expect(caps.family).toBe('seedance-2-5');
    expect(caps.minDuration).toBe(4);
    expect(caps.maxDuration).toBe(30);
    expect(caps.supportsUpscale).toBe(false);
    expect(caps.generateAudio).toBe(true);
    expect(caps.ratios).toContain('adaptive');
    expect(caps.ratios).toContain('21:9');
  });

  it('Seedance 2 / fast / mini stay on the 15s ceiling', () => {
    for (const m of ['bytedance/seedance-2', 'bytedance/seedance-2-fast', 'bytedance/seedance-2-mini']) {
      const caps = videoModelCaps(m);
      expect(caps.family).toBe('seedance-2');
      expect(caps.maxDuration).toBe(15);
      expect(caps.minDuration).toBe(4);
      expect(caps.supportsUpscale).toBe(false);
      expect(caps.generateAudio).toBe(true);
    }
  });

  it('does not mis-classify Seedance 2.5 as Seedance 2', () => {
    // Regression: a naive /^bytedance\/seedance-2/ regex would give 2.5 the 15s ceiling.
    expect(videoModelCaps('bytedance/seedance-2-5').maxDuration).toBe(30);
    expect(videoModelCaps('bytedance/seedance-2').maxDuration).toBe(15);
  });

  it('Grok 1.5 and v1 share a 15s ceiling and support upscale', () => {
    expect(videoModelCaps('grok-imagine-video-1-5-preview')).toMatchObject({
      family: 'grok-1.5',
      minDuration: 1,
      maxDuration: 15,
      maxPromptChars: 4096,
      supportsUpscale: true,
      generateAudio: false
    });
    expect(videoModelCaps('grok-imagine/text-to-video')).toMatchObject({
      family: 'grok-v1',
      maxDuration: 15,
      supportsUpscale: true
    });
  });
});

describe('clampVideoDuration (model-aware)', () => {
  // Questo test asseriva il PAVIMENTO DI PRODOTTO a 10 secondi — «una clip troppo corta per reggere
  // una cta non e' un risparmio». Era una decisione difendibile e Andrea l'ha rovesciata: ha chiesto
  // 5 secondi e ne ha pagati 10, e i video si fatturano al secondo. Il minimo ora viene dal modello,
  // che e' un fatto pubblicato, non da una costante nostra.
  it('scende al minimo DEL MODELLO, che e un fatto e non una nostra preferenza', () => {
    expect(clampVideoDuration(3, 'grok-imagine-video-1-5-preview')).toBe(3);
    expect(clampVideoDuration(6, 'bytedance/seedance-2-5')).toBe(6);
    // Seedance 2 parte da 4: uno non e' ottenibile e diventa quattro, non dieci.
    expect(clampVideoDuration(1, 'bytedance/seedance-2')).toBe(4);
  });

  it('caps at the CHOSEN model ceiling — not a global constant', () => {
    expect(clampVideoDuration(13, 'grok-imagine-video-1-5-preview')).toBe(13);
    expect(clampVideoDuration(30, 'grok-imagine-video-1-5-preview')).toBe(15);
    expect(clampVideoDuration(30, 'bytedance/seedance-2')).toBe(15);
    expect(clampVideoDuration(30, 'bytedance/seedance-2-5')).toBe(30);
    expect(clampVideoDuration(20, 'bytedance/seedance-2-5')).toBe(20);
  });

  it('falls back to the default rather than 0 for junk input', () => {
    expect(clampVideoDuration('abc', 'bytedance/seedance-2-5')).toBe(DEFAULT_VIDEO_DURATION);
    expect(clampVideoDuration(undefined, 'grok-imagine-video-1-5-preview')).toBe(DEFAULT_VIDEO_DURATION);
  });

  it('the product floor is above Seedance/Grok provider floors, deliberately', () => {
    expect(MIN_DURATION).toBeGreaterThan(videoModelCaps('bytedance/seedance-2-5').minDuration);
    expect(MIN_DURATION).toBeGreaterThan(videoModelCaps('grok-imagine-video-1-5-preview').minDuration);
  });
});

describe('ugcDurationCap', () => {
  it('the ad flag never picks a model: 22s only on Seedance 2.5, organic ceiling elsewhere', () => {
    expect(ugcDurationCap('bytedance/seedance-2-5', { ugc: true, ugcAd: true })).toBe(22);
    expect(ugcDurationCap('grok-imagine-video-1-5-preview', { ugc: true, ugcAd: true })).toBe(15);
    expect(ugcDurationCap(null, { ugc: true, ugcAd: true })).toBe(15);
    expect(ugcDurationCap('bytedance/seedance-2-5', { ugc: true })).toBe(15);
    expect(ugcDurationCap('grok-imagine-video-1-5-preview', { ugc: false, ugcAd: true })).toBeNull();
  });
});

describe('videoDurationOptions', () => {
  it('Grok / Seedance 2 stop at 15s', () => {
    expect(videoDurationOptions('grok-imagine-video-1-5-preview')).toEqual([10, 13, 15]);
    expect(videoDurationOptions('bytedance/seedance-2')).toEqual([10, 13, 15]);
    expect(videoDurationOptions('bytedance/seedance-2-fast')).toEqual([10, 13, 15]);
  });

  it('Seedance 2.5 unlocks 20s, 22s (UGC ads), and 30s', () => {
    expect(videoDurationOptions('bytedance/seedance-2-5')).toEqual([10, 13, 15, 20, 22, 30]);
  });
});

describe('suggestVideoDuration / resolveVideoDuration', () => {
  it('empty script uses the product floor — not a hard-coded 13s default', () => {
    expect(suggestVideoDuration('', 'grok-imagine-video-1-5-preview')).toBe(MIN_DURATION);
    expect(suggestVideoDuration(null, 'bytedance/seedance-2-5')).toBe(MIN_DURATION);
  });

  it('sizes to the shortest rung that can hold every word (never undershoot)', () => {
    // maxWordsForDuration(10)=32, (13)=41, (15)=48 on 3.5 w/s × 0.92
    const ten = Array.from({ length: 32 }, (_, i) => `w${i}`).join(' ');
    const fifteen = Array.from({ length: 48 }, (_, i) => `w${i}`).join(' ');
    expect(suggestVideoDuration(ten, 'grok-imagine-video-1-5-preview')).toBe(10);
    expect(suggestVideoDuration(fifteen, 'grok-imagine-video-1-5-preview')).toBe(15);
    // 45 words is nearer to 13s raw, but 13s only holds 41 — must bump to 15.
    const fortyFive = Array.from({ length: 45 }, (_, i) => `w${i}`).join(' ');
    expect(suggestVideoDuration(fortyFive, 'bytedance/seedance-2-5')).toBe(15);
  });

  it('Seedance 2.5 can suggest 20s/30s for longer non-UGC scripts', () => {
    const long = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
    expect(suggestVideoDuration(long, 'bytedance/seedance-2-5')).toBe(30);
    expect(suggestVideoDuration(long, 'bytedance/seedance-2-5', { ugc: true })).toBe(15);
    expect(suggestVideoDuration(long, 'grok-imagine-video-1-5-preview')).toBe(15);
  });

  it('UGC ads lock to 22s on Seedance 2.5; other models stay at organic 15s', () => {
    const long = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
    expect(suggestVideoDuration(long, 'bytedance/seedance-2-5', { ugc: true, ugcAd: true })).toBe(22);
    expect(suggestVideoDuration('', 'bytedance/seedance-2-5', { ugc: true, ugcAd: true })).toBe(22);
    expect(resolveVideoDuration(30, long, 'bytedance/seedance-2-5', { ugc: true, ugcAd: true })).toBe(22);
    expect(resolveVideoDuration(undefined, undefined, 'bytedance/seedance-2-5', { ugc: true, ugcAd: true })).toBe(
      22
    );
    // Without Seedance 2.5 the ad flag cannot unlock 22s — organic ceiling.
    expect(suggestVideoDuration(long, 'bytedance/seedance-2', { ugc: true, ugcAd: true })).toBe(15);
    expect(suggestVideoDuration(long, 'grok-imagine-video-1-5-preview', { ugc: true, ugcAd: true })).toBe(15);
  });

  it('resolveVideoDuration grows too-short non-UGC durations; UGC stays ≤15s', () => {
    const long = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
    expect(resolveVideoDuration(10, long, 'bytedance/seedance-2-5')).toBe(30);
    expect(resolveVideoDuration(15, long, 'bytedance/seedance-2-5', { ugc: true })).toBe(15);
    expect(resolveVideoDuration(30, long, 'bytedance/seedance-2-5', { ugc: true })).toBe(15);
    const short = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
    expect(resolveVideoDuration(15, short, 'bytedance/seedance-2-5')).toBe(15);
    expect(resolveVideoDuration(undefined, long, 'bytedance/seedance-2-5')).toBe(30);
    expect(resolveVideoDuration(undefined, undefined, 'grok-imagine-video-1-5-preview')).toBe(
      DEFAULT_VIDEO_DURATION
    );
  });

  it('concise PAS (~42 words) fits a 15s UGC clip without losing the solution', () => {
    const pas =
      "I was still writing captions at midnight and nothing had posted. It was eating my evenings — then Anomalia drafted the visuals and the copy, I just tap approve. Anyway try it and tell me I'm wrong.";
    expect(resolveVideoDuration(15, pas, 'bytedance/seedance-2-5', { ugc: true })).toBe(15);
    const fitted = fitScriptToDuration(pas, 15);
    expect(fitted.toLowerCase()).toMatch(/anomalia/);
    expect(fitted.toLowerCase()).toMatch(/tell me i'm wrong|try it/);
    expect(spokenWordCount(fitted)).toBeLessThanOrEqual(48);
  });

  it('UGC ad scripts (~66 words) fit a 22s Seedance 2.5 clip', () => {
    // maxWordsForDuration(22)=70
    const ad = Array.from({ length: 66 }, (_, i) => `w${i}`).join(' ');
    expect(resolveVideoDuration(22, ad, 'bytedance/seedance-2-5', { ugc: true, ugcAd: true })).toBe(22);
    const fitted = fitScriptToDuration(ad, 22);
    expect(spokenWordCount(fitted)).toBeLessThanOrEqual(70);
  });
});

describe('resolveVideoModel reads the job, not one setting', () => {
  it('animates a cover with the animate model and writes from text with the clip model', () => {
    const prefs = { videoModel: 'bytedance/seedance-2', videoImageModel: 'kling/v3-turbo-image-to-video' };
    expect(resolveVideoModel({ prefs, hasCover: true })).toBe('kling/v3-turbo-image-to-video');
    expect(resolveVideoModel({ prefs, hasCover: false })).toBe('bytedance/seedance-2');
  });

  it('keeps using the clip model for both when no animate model was chosen', () => {
    // Every brand from before the split had one setting covering both directions.
    const prefs = { videoModel: 'bytedance/seedance-2-5' };
    expect(resolveVideoModel({ prefs, hasCover: true })).toBe('bytedance/seedance-2-5');
    expect(resolveVideoModel({ prefs, hasCover: false })).toBe('bytedance/seedance-2-5');
  });

  it('lets an explicit model from the tool beat both settings', () => {
    const prefs = { videoModel: 'bytedance/seedance-2', videoImageModel: 'bytedance/seedance-2-mini' };
    expect(resolveVideoModel({ model: 'bytedance/seedance-2-5', prefs, hasCover: true })).toBe('bytedance/seedance-2-5');
  });
});

describe('resolveVideoModel / pairedTextToVideoModel', () => {
  it('Seedance uses the same id for I2V and T2V', () => {
    expect(pairedTextToVideoModel('bytedance/seedance-2-5')).toBe('bytedance/seedance-2-5');
    expect(resolveVideoModel({ model: 'bytedance/seedance-2-5', hasCover: true })).toBe('bytedance/seedance-2-5');
    expect(resolveVideoModel({ model: 'bytedance/seedance-2-5', hasCover: false })).toBe('bytedance/seedance-2-5');
  });

  it('Grok I2V preference falls back to the paired T2V when there is no cover', () => {
    expect(resolveVideoModel({ model: 'grok-imagine-video-1-5-preview', hasCover: true })).toBe(
      'grok-imagine-video-1-5-preview'
    );
    expect(resolveVideoModel({ model: 'grok-imagine-video-1-5-preview', hasCover: false })).toBe(
      pairedTextToVideoModel('grok-imagine-video-1-5-preview')
    );
  });

  it('isKnownVideoModel accepts only the Settings / tool allow-list', () => {
    expect(isKnownVideoModel('bytedance/seedance-2-5')).toBe(true);
    expect(isKnownVideoModel('bytedance/seedance-2-mini')).toBe(true);
    expect(isKnownVideoModel('grok-imagine-video-1-5-preview')).toBe(true);
    expect(isKnownVideoModel('bytedance/seedance-1.5-pro')).toBe(false);
    expect(isKnownVideoModel('')).toBe(false);
  });
});

describe('clampVideoAspectRatio', () => {
  it('Seedance keeps ratios Grok would rewrite to 9:16', () => {
    expect(clampVideoAspectRatio('21:9', 'bytedance/seedance-2-5')).toBe('21:9');
    expect(clampVideoAspectRatio('4:3', 'bytedance/seedance-2')).toBe('4:3');
    expect(clampVideoAspectRatio('adaptive', 'bytedance/seedance-2-5')).toBe('adaptive');
    expect(clampVideoAspectRatio('21:9', 'grok-imagine-video-1-5-preview')).toBe('9:16');
  });
});

describe('fitScriptToDuration', () => {
  it('leaves a line that already fits untouched', () => {
    expect(fitScriptToDuration('Short and punchy line here', 6)).toBe('Short and punchy line here');
  });

  it('cuts an over-long line on a WORD boundary, never mid-word', () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const out = fitScriptToDuration(long, 6);
    expect(out.split(' ')).toHaveLength(19); // floor(6 * 3.5 * 0.92)
    expect(out.endsWith('word18')).toBe(true);
    expect(long.startsWith(out)).toBe(true); // a clean prefix, nothing severed
  });

  it('prefers a sentence boundary inside the keep window', () => {
    const words = [
      ...Array.from({ length: 12 }, (_, i) => `a${i}`),
      'done.',
      ...Array.from({ length: 30 }, (_, i) => `b${i}`)
    ];
    const out = fitScriptToDuration(words.join(' '), 6); // max 19 words
    expect(out.endsWith('done.')).toBe(true);
    expect(out.split(' ')).toHaveLength(13);
  });

  it('normalises whitespace and always keeps at least one word', () => {
    expect(fitScriptToDuration('  hello   there  ', 6)).toBe('hello there');
    expect(fitScriptToDuration('alpha beta gamma', 0)).toBe('alpha');
  });
});

describe('buildJobInput (per-model adapter)', () => {
  const base = { prompt: 'p', durationSeconds: 6, resolution: '480p', aspectRatio: '9:16' };

  it('grok clamps an over-limit prompt to the model cap — an over-long brief must not reach createTask', () => {
    const long = `${base.prompt.repeat(1)} ${'scene direction and product detail '.repeat(200)}`.trim();
    expect(long.length).toBeGreaterThan(videoModelCaps('grok-imagine-video-1-5-preview').maxPromptChars);
    const out = buildJobInput('grok-imagine-video-1-5-preview', { ...base, prompt: long });
    expect((out.prompt as string).length).toBeLessThanOrEqual(
      videoModelCaps('grok-imagine-video-1-5-preview').maxPromptChars
    );
  });

  it('grok i2v: image_urls array + STRING duration, no aspect_ratio (cover fixes it)', () => {
    const out = buildJobInput('grok-imagine/image-to-video', { ...base, imageUrl: 'https://x/c.jpg' });
    expect(out.image_urls).toEqual(['https://x/c.jpg']);
    expect(out.duration).toBe('6');
    expect(out.aspect_ratio).toBeUndefined();
    expect(out.first_frame_url).toBeUndefined();
  });

  it('grok t2v: no cover → aspect_ratio is sent instead', () => {
    const out = buildJobInput('grok-imagine/text-to-video', base);
    expect(out.aspect_ratio).toBe('9:16');
    expect(out.image_urls).toBeUndefined();
  });

  it('seedance 2: first_frame_url + INTEGER duration + explicit aspect_ratio even with a cover', () => {
    const out = buildJobInput('bytedance/seedance-2', { ...base, imageUrl: 'https://x/c.jpg' });
    expect(out.first_frame_url).toBe('https://x/c.jpg');
    expect(out.image_urls).toBeUndefined();
    expect(out.duration).toBe(6); // number, not '6'
    expect(out.aspect_ratio).toBe('9:16');
  });

  it('seedance 2 variants (fast/mini) take the same shape', () => {
    for (const m of ['bytedance/seedance-2-fast', 'bytedance/seedance-2-mini']) {
      const out = buildJobInput(m, { ...base, imageUrl: 'https://x/c.jpg' });
      expect(out.first_frame_url).toBe('https://x/c.jpg');
      expect(typeof out.duration).toBe('number');
    }
  });

  it('seedance 2.5 I2V forces aspect_ratio adaptive (kie 422 otherwise)', () => {
    const out = buildJobInput('bytedance/seedance-2-5', {
      ...base,
      durationSeconds: 30,
      imageUrl: 'https://x/c.jpg',
      aspectRatio: '21:9',
      hasScript: true
    });
    expect(out).toEqual({
      prompt: 'p',
      duration: 30,
      resolution: '480p',
      aspect_ratio: 'adaptive',
      generate_audio: true,
      first_frame_url: 'https://x/c.jpg'
    });
  });

  it('seedance 2.5 text-to-video: no first_frame_url when there is no cover', () => {
    const out = buildJobInput('bytedance/seedance-2-5', { ...base, durationSeconds: 20 });
    expect(out.first_frame_url).toBeUndefined();
    expect(out.image_urls).toBeUndefined();
    expect(out.duration).toBe(20);
    expect(out.aspect_ratio).toBe('9:16');
    expect(out.generate_audio).toBe(false);
  });

  it('seedance 2.5: first + last frame when no refs', () => {
    const out = buildJobInput('bytedance/seedance-2-5', {
      ...base,
      imageUrl: 'https://x/first.jpg',
      lastFrameUrl: 'https://x/last.jpg'
    });
    expect(out.first_frame_url).toBe('https://x/first.jpg');
    expect(out.last_frame_url).toBe('https://x/last.jpg');
    expect(out.aspect_ratio).toBe('adaptive');
    expect(out.reference_video_urls).toBeUndefined();
  });

  it('seedance 2.5: reference video/audio replace first/last frames (mutually exclusive)', () => {
    const out = buildJobInput('bytedance/seedance-2-5', {
      ...base,
      imageUrl: 'https://x/first.jpg',
      lastFrameUrl: 'https://x/last.jpg',
      referenceVideoUrls: ['https://x/ref.mp4'],
      referenceAudioUrls: ['https://x/ref.mp3']
    });
    expect(out.first_frame_url).toBeUndefined();
    expect(out.last_frame_url).toBeUndefined();
    expect(out.reference_video_urls).toEqual(['https://x/ref.mp4']);
    expect(out.reference_audio_urls).toEqual(['https://x/ref.mp3']);
  });

  it('seedance last_frame_url is omitted without a first frame', () => {
    const out = buildJobInput('bytedance/seedance-2-5', {
      ...base,
      lastFrameUrl: 'https://x/last.jpg'
    });
    expect(out.first_frame_url).toBeUndefined();
    expect(out.last_frame_url).toBeUndefined();
  });

  it('seedance audio is generated ONLY for a talking clip', () => {
    expect(buildJobInput('bytedance/seedance-2', base).generate_audio).toBe(false);
    expect(buildJobInput('bytedance/seedance-2', { ...base, hasScript: true }).generate_audio).toBe(true);
    expect(buildJobInput('bytedance/seedance-2-5', base).generate_audio).toBe(false);
    expect(buildJobInput('bytedance/seedance-2-5', { ...base, hasScript: true }).generate_audio).toBe(true);
  });

  it('grok 1.5-preview: image_urls + INTEGER duration — the string the v1 shape sends is rejected', () => {
    const out = buildJobInput('grok-imagine-video-1-5-preview', { ...base, imageUrl: 'https://x/c.jpg' });
    expect(out.image_urls).toEqual(['https://x/c.jpg']);
    expect(out.duration).toBe(6); // number, NOT '6' — the one field that differs from v1
    expect(out.aspect_ratio).toBeUndefined();
    expect(out.first_frame_url).toBeUndefined();
  });

  it('grok 1.5-preview without a cover still sends aspect_ratio', () => {
    const out = buildJobInput('grok-imagine-video-1-5-preview', base);
    expect(out.aspect_ratio).toBe('9:16');
    expect(out.image_urls).toBeUndefined();
  });

  // kie NON valida i campi sconosciuti: un `reference_video_url` al singolare, o un
  // `referenceVideoUrls` in camelCase, verrebbe ignorato in silenzio e la clip sbagliata pagata
  // lo stesso (~$1.80 a clip). Questi tre test bloccano il NOME dei campi, non solo il valore:
  // un typo futuro fallisce in CI invece che in produzione, a pagamento.
  it('seedance 2.5 multimodal: exactly the reference_* field names kie accepts', () => {
    const out = buildJobInput('bytedance/seedance-2-5', {
      ...base,
      referenceImageUrls: ['https://x/i.jpg'],
      referenceVideoUrls: ['https://x/v.mp4'],
      referenceAudioUrls: ['https://x/a.mp3'],
      hasScript: true
    });
    expect(Object.keys(out).sort()).toEqual([
      'aspect_ratio',
      'duration',
      'generate_audio',
      'prompt',
      'reference_audio_urls',
      'reference_image_urls',
      'reference_video_urls',
      'resolution'
    ]);
  });

  it('seedance 2.5 frames: exactly first_frame_url / last_frame_url', () => {
    const out = buildJobInput('bytedance/seedance-2-5', {
      ...base,
      imageUrl: 'https://x/f.jpg',
      lastFrameUrl: 'https://x/l.jpg'
    });
    expect(Object.keys(out).sort()).toEqual([
      'aspect_ratio',
      'duration',
      'first_frame_url',
      'generate_audio',
      'last_frame_url',
      'prompt',
      'resolution'
    ]);
  });

  it('seedance 2.5 text-to-video: no stray media field slips into the payload', () => {
    const out = buildJobInput('bytedance/seedance-2-5', base);
    expect(Object.keys(out).sort()).toEqual([
      'aspect_ratio',
      'duration',
      'generate_audio',
      'prompt',
      'resolution'
    ]);
  });

  it('an unknown model falls back to the grok shape rather than sending nothing', () => {
    const out = buildJobInput('some/new-model', { ...base, imageUrl: 'https://x/c.jpg' });
    expect(out.image_urls).toEqual(['https://x/c.jpg']);
  });
});

describe('clampVideoResolution', () => {
  it('accepts only what kie takes, and defaults to the cheap rung', () => {
    expect(clampVideoResolution('720p')).toBe('720p');
    expect(clampVideoResolution('480P')).toBe('480p');
    // 720p is double the price per second: anything unrecognised must fall to 480p, never up.
    for (const bad of ['1080p', '4k', '', null, undefined, 720]) expect(clampVideoResolution(bad)).toBe('480p');
  });
});

describe('buildTransformInput — i due mestieri con un video in ingresso', () => {
  it('parla il dialetto di Aleph per il refine, non quello dei job', () => {
    // Aleph vive fuori dall'API a job e ha i campi in camelCase. Mandargli `video_urls` sarebbe
    // un 200 con un corpo di rifiuto, cioè un giro di rete pagato che non torna nulla.
    const input = buildTransformInput(ALEPH_REFINE_MODEL, 'refine', {
      prompt: 'make it night',
      videoUrl: 'https://x/clip.mp4',
      aspectRatio: '9:16'
    });
    expect(input).toMatchObject({ prompt: 'make it night', videoUrl: 'https://x/clip.mp4', aspectRatio: '9:16' });
    expect(input.video_urls).toBeUndefined();
  });

  it('separa il soggetto dal video che detta il movimento', () => {
    // I due media NON sono intercambiabili: input_urls è l'immagine del soggetto, video_urls è la
    // clip da cui si prende il movimento. Scambiarli produce una clip plausibile e sbagliata.
    const input = buildTransformInput(KLING_3_VIDEO_MODEL, 'motion', {
      videoUrl: 'https://x/drive.mp4',
      imageUrl: 'https://x/subject.png',
      mode: 'pro'
    });
    expect(input).toMatchObject({
      input_urls: ['https://x/subject.png'],
      video_urls: ['https://x/drive.mp4'],
      mode: 'pro'
    });
  });

  it('riporta un rapporto che il modello non serve al più vicino che serve', () => {
    // 9:16 è il formato di un reel e Aleph ce l'ha; 4:5 no, e ripiegare su 1:1 riquadrerebbe in
    // silenzio ogni verticale. Vince il rapporto con la proporzione più vicina.
    expect(buildTransformInput(ALEPH_REFINE_MODEL, 'refine', { videoUrl: 'https://x/c.mp4', aspectRatio: '4:5' }).aspectRatio)
      .toBe('3:4');
  });

  it('rifiuta un modello che quel mestiere non lo fa', () => {
    expect(() => buildTransformInput(GROK_IMAGINE_VIDEO_MODEL, 'refine', { videoUrl: 'https://x/c.mp4' }))
      .toThrow(/refine/);
  });
});
