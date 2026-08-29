import { describe, expect, it } from 'vitest';
import { planForPrompt } from './editorial-plan';
import { leadsBriefForPrompt } from './strategy-agent-reads';

describe('strategy agent reads', () => {
  it('planForPrompt includes week themes for editorial plan tool output', () => {
    const json = planForPrompt({
      strategy: 'Test strategy',
      voice: { mood: 'Bold', tone: 'Direct', goal: 'awareness', personality: 'Founder-led' },
      cadence: '3/week',
      platform_mix: [{ platform: 'instagram', share: '2/week', role: 'visual' }],
      gtm: null,
      weeks: [
        {
          index: 0,
          week_start: null,
          theme: 'Week one',
          focus: 'Launch',
          content_mix: [{ type: 'educational', count: 3 }],
          rationale: 'Start strong',
          brief: null,
          products: null,
          status: 'planned'
        }
      ]
    });
    expect(json).toContain('Week one');
    expect(json).toContain('3/week');
  });

  it('leadsBriefForPrompt formats open threads', () => {
    const brief = leadsBriefForPrompt([
      {
        title: 'Best tool for social automation?',
        url: 'https://reddit.com/r/saas/comments/abc',
        snippet: 'Looking for something that plans and posts automatically…',
        relevance: 'high',
        status: 'suggested'
      }
    ]);
    expect(brief).toContain('LEADS');
    expect(brief).toContain('reddit');
    expect(brief).toContain('social automation');
  });

  it('leadsBriefForPrompt returns empty when no rows', () => {
    expect(leadsBriefForPrompt([])).toBe('');
  });


});
