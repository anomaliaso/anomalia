import { describe, expect, it } from 'vitest';
import { chatRateLimitMessage, type ChatRateUsage } from './rate-limits';
import { bilingualNoticeLocale } from '$lib/i18n/locale';

const usage = {
  used5h: 999,
  usedWeek: 999,
  limits: { fiveHour: 50, weekly: 400 },
  ok: false,
  blocked: '5h' as const,
  resetAt: new Date('2026-08-27T14:30:00Z')
};

// Il percorso che chiama `chatRateLimitMessage` passa da `bilingualNoticeLocale` prima:
// questi test fissano il patto insieme — `en-IN`, header mancante o `*` devono finire in
// inglese, mai italiano (amazon.in, 27/8/2026).
describe('chatRateLimitMessage — inglese per tutto ciò che non è davvero italiano', () => {
  it.each(['en', 'en-IN', undefined])('%s → inglese', (loc) => {
    const locale = bilingualNoticeLocale(loc);
    expect(locale).toBe('en');
    expect(chatRateLimitMessage(usage as ChatRateUsage, locale)).toMatch(/^You've hit the 5-hour chat limit \(50 credits\)\./);
    expect(chatRateLimitMessage(usage as ChatRateUsage, locale)).not.toContain('limite');
  });

  it('it / it-IT → italiano', () => {
    expect(chatRateLimitMessage(usage as ChatRateUsage, bilingualNoticeLocale('it-IT'))).toContain(
      "Hai raggiunto il limite chat delle ultime 5 ore"
    );
  });

  it('la finestra settimanale parla la stessa lingua', () => {
    const week = { ...usage, blocked: 'week' as const };
    expect(chatRateLimitMessage(week as ChatRateUsage, 'en')).toContain('weekly chat limit');
    expect(chatRateLimitMessage(week as ChatRateUsage, 'it')).toContain('limite chat settimanale');
  });
});
