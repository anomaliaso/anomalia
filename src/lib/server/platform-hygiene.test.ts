import { describe, expect, it } from 'vitest';
import {
  assertHashtagPrefs,
  assertRedditCraft,
  knownSubredditsBlock,
  stripDisallowedHashtags,
  winningHookLines,
  winningPatternsBlock,
  reachChasingHashtags,
  stripReachChasingHashtags
} from './platform-hygiene';

describe('platform-hygiene', () => {
  it('allows any tags when no prefs set', () => {
    expect(assertHashtagPrefs('Hello #random', 'instagram', {})).toEqual({ ok: true });
  });

  it('rejects tags outside the approved set', () => {
    const prefs = { platformHashtags: { instagram: ['#Brand', '#Ok'] } };
    const r = assertHashtagPrefs('Ship it #Brand #Nope', 'instagram', prefs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.bad).toContain('#nope');
  });

  it('strips disallowed hashtags', () => {
    const prefs = { platformHashtags: { instagram: ['#ok'] } };
    expect(stripDisallowedHashtags('Hi #ok #bad', 'instagram', prefs)).toBe('Hi #ok');
  });

  it('requires reddit subreddit + title', () => {
    expect(assertRedditCraft({ caption: 'body' }).ok).toBe(false);
    expect(
      assertRedditCraft({ subreddit: 'SaaS', title: 'Honest take', caption: 'Useful body' }).ok
    ).toBe(true);
  });

  it('flags self-promo + URL on reddit', () => {
    const r = assertRedditCraft({
      subreddit: 'SaaS',
      title: 'Tool',
      caption: 'Check us out https://example.com/waitlist'
    });
    expect(r.ok).toBe(false);
  });

  it('formats winning patterns and hooks', () => {
    const posts = [
      { content: 'We shipped ugly v1. Here is what broke.', platform: 'linkedin', metrics: { likes: 40, engagementRate: 4.2 } },
      { content: 'Three steps to publish weekly.', platform: 'instagram', metrics: { likes: 20 } }
    ];
    const block = winningPatternsBlock(posts, { digest: 'Founder candor wins.', limit: 2 });
    expect(block).toContain('WINNING PATTERNS');
    expect(block).toContain('Founder candor');
    expect(winningHookLines(posts, 2)[0]).toContain('shipped ugly');
    expect(knownSubredditsBlock(['SaaS', 'microsaas'])).toContain('r/SaaS');
  });
});

describe('reach-chasing hashtags', () => {
  it('finds the tags that exist only to chase reach', () => {
    expect(reachChasingHashtags('Nuovo post #viral #fyp #studioarchitettura')).toEqual(['#viral', '#fyp']);
  });

  it('leaves a broad but legitimate category tag alone', () => {
    // #marketing is broad; that is not the same as reach-chasing, and deleting it would remove
    // real work.
    expect(reachChasingHashtags('#marketing #preventivi #b2b')).toEqual([]);
  });

  it('is case- and hash-insensitive', () => {
    expect(reachChasingHashtags('#ViRaL #ForYou')).toEqual(['#viral', '#foryou']);
  });

  it('strips them and tidies the spacing', () => {
    expect(stripReachChasingHashtags('Testo del post #viral #studioarchitettura #fyp')).toBe(
      'Testo del post #studioarchitettura'
    );
  });

  it('returns the caption untouched when there is nothing to strip', () => {
    const caption = 'Testo del post #studioarchitettura';
    expect(stripReachChasingHashtags(caption)).toBe(caption);
  });

  it('handles an empty or missing caption', () => {
    expect(stripReachChasingHashtags('')).toBe('');
    expect(reachChasingHashtags('')).toEqual([]);
  });
});
