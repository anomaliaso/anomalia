import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import PlatformMixBars from './components/PlatformMixBars.svelte';
import { platformMixRows } from './platform-mix';

describe('platformMixRows', () => {
  it('keeps empty shares unknown instead of inventing equal percentages', () => {
    expect(
      platformMixRows([
        { platform: 'instagram', share: '', role: '' },
        { platform: 'tiktok', share: '', role: '' },
        { platform: 'linkedin', share: '', role: '' },
        { platform: 'x', share: '', role: '' }
      ])
    ).toEqual([
      { key: 'instagram', role: '', share: '', percent: null },
      { key: 'tiktok', role: '', share: '', percent: null },
      { key: 'linkedin', role: '', share: '', percent: null },
      { key: 'x', role: '', share: '', percent: null }
    ]);
  });

  it('does not render an invented percentage for empty shares', () => {
    const { body } = render(PlatformMixBars, {
      props: {
        mix: [
          { platform: 'instagram', share: '', role: '' },
          { platform: 'tiktok', share: '', role: '' },
          { platform: 'linkedin', share: '', role: '' },
          { platform: 'x', share: '', role: '' }
        ]
      }
    });

    expect(body).not.toContain('25%');
  });

  it('normalizes complete cadence shares', () => {
    expect(
      platformMixRows([
        { platform: 'instagram', share: '2/week', role: '' },
        { platform: 'tiktok', share: '1/week', role: '' }
      ]).map((row) => row.percent)
    ).toEqual([67, 33]);
  });
});
