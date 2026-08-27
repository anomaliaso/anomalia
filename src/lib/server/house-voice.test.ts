import { describe, expect, it } from 'vitest';
import { houseVoiceFor, type ContentPrefs } from './content-preview';

describe('houseVoiceFor', () => {
  it('leads with brand personality when set', () => {
    const prefs: ContentPrefs = { personality: 'Warm, precise, founder-led.' };
    const out = houseVoiceFor(prefs);
    expect(out).toContain('BRAND PERSONALITY');
    expect(out).toContain('Warm, precise, founder-led.');
    expect(out).not.toContain('world-weary');
  });

  it('falls back to dry house voice when personality is absent', () => {
    const out = houseVoiceFor({});
    expect(out).toContain('HOUSE VOICE');
    expect(out).toContain('world-weary');
  });
});
