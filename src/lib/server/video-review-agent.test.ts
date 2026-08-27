import { describe, expect, it } from 'vitest';
import {
  extractCreativeScript,
  inferCreativeKind,
  onScreenFromGraphic
} from './creative-script';
import { CREATIVE_JUDGE_DOCTRINE } from './video-review-doctrine';
import { buildVideoReviewAgentSystem, formatPriorScoresDigest, VIDEO_REVIEW_AGENT_TOOL_NAMES } from './video-review-agent';

describe('creative script extract', () => {
  it('reads on-screen copy from a typographic graphic spec', () => {
    const lines = onScreenFromGraphic({
      blocks: [
        { type: 'kicker', text: 'PER I FOUNDER' },
        { type: 'headline', text: 'Smetti di indovinare le calorie' },
        { type: 'list', items: ['Scatta', 'Leggi', 'Basta'] },
        { type: 'stat', value: '90%', label: 'accuratezza' },
        { type: 'footer', brand: 'Sona' }
      ]
    });
    expect(lines).toContain('PER I FOUNDER');
    expect(lines).toContain('Smetti di indovinare le calorie');
    expect(lines).toContain('Scatta');
    expect(lines).toContain('90%');
    expect(lines).toContain('Sona');
  });

  it('reads on-screen copy from HTML graphic source', () => {
    const lines = onScreenFromGraphic(
      '<div class="canvas"><style>.x{color:red}</style><div class="headline">Stop guessing</div></div>'
    );
    expect(lines.some((l) => l.includes('Stop guessing'))).toBe(true);
  });

  it('marks carousels and videos', () => {
    expect(inferCreativeKind({ mediaUrls: ['a.png', 'b.png'] })).toBe('carousel');
    expect(inferCreativeKind({ mediaUrl: 'https://x/c.mp4' })).toBe('video');
    expect(inferCreativeKind({ hasGraphic: true })).toBe('graphic');
  });

  it('keeps spoken, on-screen and caption distinct', () => {
    const s = extractCreativeScript({
      caption: 'Prova Sona oggi',
      spoken: 'Non sei in sovrappeso perché mangi troppo',
      graphicSpec: { blocks: [{ type: 'headline', text: 'Stop guessing' }] }
    });
    expect(s.kind).toBe('graphic');
    expect(s.spoken).toMatch(/sovrappeso/);
    expect(s.onScreen).toBe('Stop guessing');
    expect(s.caption).toMatch(/Prova Sona/);
  });
});

describe('judge doctrine', () => {
  it('names the three operator sources and the five-beat structure', () => {
    expect(CREATIVE_JUDGE_DOCTRINE).toMatch(/fekdaoui/);
    expect(CREATIVE_JUDGE_DOCTRINE).toMatch(/beechinour/);
    expect(CREATIVE_JUDGE_DOCTRINE).toMatch(/sleepclip/);
    expect(CREATIVE_JUDGE_DOCTRINE).toMatch(/Hook → Problem → Demo → Proof → CTA/);
    expect(CREATIVE_JUDGE_DOCTRINE).toMatch(/script is the product|Start with the script/i);
  });

  it('is injected into the agent system prompt with brand tools', () => {
    const system = buildVideoReviewAgentSystem({
      standard: 'organic',
      duration: 14,
      brandName: 'Sona',
      language: 'Italian',
      category: 'health'
    });
    expect(system).toMatch(/read_brand_studio/);
    expect(system).toMatch(/read_knowledge/);
    expect(system).toMatch(/read_media/);
    expect(system).toMatch(/read_prior_scores/);
    expect(system).toMatch(/script_spoken/);
    expect(system).toContain(CREATIVE_JUDGE_DOCTRINE.slice(0, 80));
  });
});

describe('prior scores digest includes scripts', () => {
  it('shows spoken / on-screen next to the vote', () => {
    const d = formatPriorScoresDigest([
      {
        overall: 7.2,
        verdict: 'fix',
        standard: 'organic',
        weakest: 'scroll_stop',
        summary: 'Hook names the product.',
        spoken: 'Meet Sona, the calorie app',
        onScreen: 'SONA'
      }
    ]);
    expect(d).toMatch(/7\.2\/10/);
    expect(d).toMatch(/Meet Sona/);
    expect(d).toMatch(/SONA/);
  });
});

describe('agent tool catalogue', () => {
  it('includes brand studio, knowledge and media', () => {
    expect(VIDEO_REVIEW_AGENT_TOOL_NAMES).toEqual(
      expect.arrayContaining(['read_brand_studio', 'read_knowledge', 'read_media', 'submit_review'])
    );
  });
});
