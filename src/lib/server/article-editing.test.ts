import { describe, it, expect } from 'vitest';
import { articleEditRefusal, articleScheduleChange } from './article-editing';

describe('la tabella che dice cosa uno stato permette', () => {
  it.each(['draft', 'planned', 'approved'])('%s si modifica', (status) => {
    expect(articleEditRefusal(status)).toBeNull();
  });

  it('published non si modifica: quello che è live non cambia di nascosto', () => {
    expect(articleEditRefusal('published')).toBe('article_published');
  });

  it('uno stato che la tabella non conosce è trattato come un draft, non come un published', () => {
    expect(articleEditRefusal('qualcosa_di_nuovo')).toBeNull();
  });

  it('datare un draft lo porta ad approved, che è l unico stato che auto-pubblica', () => {
    expect(articleScheduleChange('draft', '2030-05-16T07:00:00.000Z')).toEqual({
      ok: true,
      patch: { scheduled_for: '2030-05-16T07:00:00.000Z', status: 'approved' }
    });
  });

  it('spostare un planned muove solo lo slot: il segnaposto non diventa auto-pubblicabile', () => {
    expect(articleScheduleChange('planned', '2030-05-16T07:00:00.000Z')).toEqual({
      ok: true,
      patch: { scheduled_for: '2030-05-16T07:00:00.000Z' }
    });
  });

  it('togliere la data a un approved lo riporta a draft', () => {
    expect(articleScheduleChange('approved', null)).toEqual({
      ok: true,
      patch: { scheduled_for: null, status: 'draft' }
    });
  });

  it('un planned senza slot non verrebbe mai scritto: rifiutato', () => {
    expect(articleScheduleChange('planned', null)).toEqual({ ok: false, reason: 'planned_needs_slot' });
  });

  it.each([
    ['datandolo', '2030-05-16T07:00:00.000Z'],
    ['togliendogli la data', null]
  ])('un published non si tocca nemmeno %s', (_label, when) => {
    expect(articleScheduleChange('published', when)).toEqual({ ok: false, reason: 'article_published' });
  });
});
