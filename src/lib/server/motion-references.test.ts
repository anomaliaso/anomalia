import { describe, expect, it } from 'vitest';
import {
  finalizeSpec,
  formatMotionReferenceSpec,
  formatReferenceCandidates,
  stripUrls,
  type MotionReferenceCard
} from './motion-references';

const CARD: MotionReferenceCard = {
  id: 'x-twitter-cerebras-2089870131291943228-cerebras-fastest-ai-got-faster',
  slug: 'cerebras-the-fastest-ai-just-got-faster-2026-08-19',
  reference_url: 'https://posts.design/cerebras-the-fastest-ai-just-got-faster-2026-08-19',
  source_url: 'https://x.com/cerebras/status/2089870131291943228',
  title: 'Cerebras: The Fastest AI Just Got Faster',
  brand: 'Cerebras',
  handle: 'cerebras',
  category: 'product update',
  style_tags: ['announcement card', 'minimal'],
  post_text: 'The Fastest AI Just Got Faster. Meet CS-4.',
  captured_at: '2026-08-19',
  is_video: true
};

describe('stripUrls', () => {
  it('removes the media path a model might quote back', () => {
    expect(
      stripUrls('The card sits over /media/posts/x-twitter-cerebras-2089-clip-detail.mp4 for 2s')
    ).toBe('The card sits over for 2s');
  });

  it('removes absolute URLs and bare posts.design references', () => {
    expect(stripUrls('see https://posts.design/foo and posts.design/bar')).toBe('see and');
  });

  it('leaves ordinary prose alone', () => {
    expect(stripUrls('Two colours: ink on paper, accent on the CTA.')).toBe(
      'Two colours: ink on paper, accent on the CTA.'
    );
  });
});

describe('finalizeSpec', () => {
  it('shapes a raw model object and scrubs URLs out of every field', () => {
    const spec = finalizeSpec(
      {
        format: 'announcement card push',
        duration_s: 6.44,
        aspect: '16:9',
        beats: [
          { at_s: 0, on_screen: 'logo at https://posts.design/x.webp', motion: 'scales in' },
          { at_s: '2.5', on_screen: 'one number', motion: 'slides up' },
          { at_s: 4, on_screen: '', motion: '' }
        ],
        transitions: ['slide with overlap', ''],
        easing: 'overshoot then micro-settle',
        summary: 'One number, held.'
      },
      6
    );
    expect(spec.duration_s).toBe(6.4);
    expect(spec.beats).toHaveLength(2);
    expect(spec.beats[0].on_screen).toBe('logo at');
    // Unlabelled defaults to out_of_reach: an optimistic default is the failure this field prevents.
    expect(spec.beats[0].buildable).toBe('out_of_reach');
    expect(spec.beats[1].at_s).toBe(2.5);
    expect(spec.transitions).toEqual(['slide with overlap']);
  });

  it('falls back to the measured clip length when the model does not give one', () => {
    expect(finalizeSpec({ format: 'x' }, 8.27).duration_s).toBe(8.3);
    expect(finalizeSpec({ duration_s: -3 }, 5).duration_s).toBe(5);
  });

  it('never returns an unnamed empty spec', () => {
    const spec = finalizeSpec({}, 0);
    expect(spec.format).toBe('unnamed format');
    expect(spec.beats).toEqual([]);
    expect(spec.aspect).toBe('unknown');
  });
});

describe('formatMotionReferenceSpec', () => {
  const spec = finalizeSpec(
    {
      format: 'announcement card push',
      duration_s: 6,
      aspect: '16:9',
      beats: [
        { at_s: 0, on_screen: 'wordmark', motion: 'scales in with settle', buildable: 'tsx' },
        { at_s: 2, on_screen: 'metric card', motion: 'slides up', buildable: 'asset', needs: 'a product screenshot' },
        { at_s: 4, on_screen: 'chip rotating in 3D', motion: 'orbit', buildable: 'out_of_reach', needs: '3D render' }
      ],
      transitions: ['iris that completes into the next scene'],
      easing: 'overshoot then micro-settle',
      type_density: 'four words at once, 12% of canvas height',
      palette: 'two colours: ground and one accent on the number',
      logo_role: 'small, bottom-left, last 1.5s',
      ui_elements: ['rounded metric card'],
      sound_off: 'holds — the number carries it',
      adapt: ['Keep the three beats, swap the number for the brand’s own proof point'],
      summary: 'One number, held long enough to read.'
    },
    6
  );

  it('leads with attribution and closes with the adaptation rule', () => {
    const text = formatMotionReferenceSpec(CARD, spec);
    expect(text.split('\n')[0]).toContain('Cerebras');
    expect(text).toContain('https://posts.design/cerebras-the-fastest-ai-just-got-faster-2026-08-19');
    expect(text).toContain('https://x.com/cerebras/status/2089870131291943228');
    expect(text).toContain('USE THE STRUCTURE, NOT THE ARTWORK');
  });

  it('tells the engineer to refit the length and keep our craft floor', () => {
    const text = formatMotionReferenceSpec(CARD, spec);
    expect(text).toContain('This reference runs 6s');
    expect(text).toContain('DEFAULT CRAFT STILL WINS');
  });

  it('counts what is actually reachable, and says so', () => {
    const text = formatMotionReferenceSpec(CARD, spec);
    expect(text).toContain('1 beat(s) in code, 1 with one generated still each, 1 out of reach');
    expect(text).not.toContain('NOTHING here is reachable');
  });

  it('tells the agent to walk away from a reference it cannot build at all', () => {
    const unreachable = finalizeSpec(
      {
        format: '3D hardware film',
        duration_s: 30,
        beats: [{ at_s: 0, on_screen: 'server hall', motion: 'camera dolly', buildable: 'out_of_reach' }]
      },
      30
    );
    expect(formatMotionReferenceSpec(CARD, unreachable)).toContain('NOTHING here is reachable');
  });

  it('carries the beats, timings and mechanism the engineer has to rebuild', () => {
    const text = formatMotionReferenceSpec(CARD, spec);
    expect(text).toContain('0s [code] — wordmark | scales in with settle');
    expect(text).toContain('[code + 1 still]');
    expect(text).toContain('[OUT OF REACH]');
    expect(text).toContain('(needs: 3D render)');
    expect(text).toContain('iris that completes');
    expect(text).toContain('two colours');
  });

  it('holds up when the reference is barely identified', () => {
    const bare = formatMotionReferenceSpec(
      { ...CARD, brand: null, handle: null, source_url: null, post_text: null, style_tags: [] },
      spec
    );
    expect(bare).toContain('unknown brand');
    expect(bare).not.toContain('undefined');
    expect(bare).not.toContain('null');
  });
});


describe('formatReferenceCandidates', () => {
  it('lists the shortlist with the ids the study tool takes', () => {
    const block = formatReferenceCandidates([
      CARD,
      { ...CARD, id: 'x-twitter-openrouter-1-joining-stripe', brand: 'OpenRouter', is_video: false, style_tags: [] }
    ]);
    expect(block).toContain('WALL CANDIDATES FOR THIS BRIEF');
    expect(block).toContain(CARD.id);
    expect(block).toContain('x-twitter-openrouter-1-joining-stripe');
    expect(block).toContain('MOVES');
    expect(block).toContain('still');
  });

  it('closes with the instruction that makes the agent act on it', () => {
    // The first version of the wall shipped as tools plus one soft paragraph and was ignored on
    // the very first real brief. The candidate block exists to remove the decision to go looking.
    expect(formatReferenceCandidates([CARD])).toContain('BEFORE you write the composition');
  });

  it('is empty when the wall gave nothing — the prompt must not carry a dangling header', () => {
    expect(formatReferenceCandidates([])).toBe('');
    expect(formatReferenceCandidates([{ ...CARD, title: null, brand: null }])).toBe('');
  });
});
