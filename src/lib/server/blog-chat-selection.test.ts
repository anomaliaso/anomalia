import { describe, expect, it } from 'vitest';
import { replaceSelectedPassage } from './blog-chat';

describe('replaceSelectedPassage', () => {
  it('replaces the first exact occurrence', () => {
    const body = 'Alpha\n\nHello world\n\nHello world again';
    expect(replaceSelectedPassage(body, 'Hello world', 'Ciao mondo')).toBe(
      'Alpha\n\nCiao mondo\n\nHello world again'
    );
  });

  it('matches across whitespace differences', () => {
    const body = 'Intro\n\nfoo   bar\nbaz\n\nOutro';
    expect(replaceSelectedPassage(body, 'foo bar baz', 'qux')).toBe('Intro\n\nqux\n\nOutro');
  });

  it('returns null when the selection is missing', () => {
    expect(replaceSelectedPassage('only this', 'missing', 'x')).toBeNull();
  });
});
