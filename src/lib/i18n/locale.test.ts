import { describe, expect, it } from 'vitest';
import {
  bilingualNoticeLocale,
  chatReplyLanguageBlock,
  DEFAULT_LOCALE,
  localeLanguageName,
  pickLocale
} from './locale';

describe('pickLocale', () => {
  it('defaults to English when Accept-Language is missing — never Italian', () => {
    expect(pickLocale('/app/amazon-in', null, null)).toBe('en');
    expect(pickLocale('/app/amazon-in', null, '')).toBe(DEFAULT_LOCALE);
    expect(pickLocale('/app/amazon-in', null, '*')).toBe('en');
  });

  it('treats en-IN as English, and Hindi-only as English (unsupported → default)', () => {
    expect(pickLocale('/app/x', null, 'en-IN,en;q=0.9')).toBe('en');
    expect(pickLocale('/app/x', null, 'hi-IN,hi;q=0.9')).toBe('en');
  });

  it('honours Italian only when it is actually chosen', () => {
    expect(pickLocale('/it/pricing', null, 'en')).toBe('it');
    expect(pickLocale('/app/x', 'it', 'en-IN')).toBe('it');
    expect(pickLocale('/app/x', null, 'it-IT,it;q=0.9,en;q=0.8')).toBe('it');
  });
});

describe('bilingualNoticeLocale', () => {
  it('maps anything that is not Italian to English — the old includes(en)?en:it did the reverse', () => {
    expect(bilingualNoticeLocale('en-IN')).toBe('en');
    expect(bilingualNoticeLocale('hi')).toBe('en');
    expect(bilingualNoticeLocale('es')).toBe('en');
    expect(bilingualNoticeLocale(null)).toBe('en');
    expect(bilingualNoticeLocale('')).toBe('en');
    expect(bilingualNoticeLocale('it')).toBe('it');
    expect(bilingualNoticeLocale('it-IT')).toBe('it');
  });
});

describe('chatReplyLanguageBlock', () => {
  it('pins replies to the user message, with dashboard locale only as fallback', () => {
    const en = chatReplyLanguageBlock('en');
    expect(en).toContain('REPLY LANGUAGE — ABSOLUTE RULE');
    expect(en).toContain("language of the user's latest message");
    expect(en).toContain('English message gets an English reply');
    expect(en).toContain('Dashboard locale (English) is only a fallback');
    expect(localeLanguageName('fr')).toBe('French');
  });
});
