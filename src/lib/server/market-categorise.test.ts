import { describe, expect, it } from 'vitest';
import {
  BATCH_SIZE,
  CATEGORIES,
  CONTENT_FORMS,
  batches,
  catalogable,
  itemText,
  reconcile,
  type CatalogueItem
} from './market-categorise';

const item = (over: Partial<CatalogueItem> = {}): CatalogueItem => ({
  id: 'a',
  caption: 'Hai 3 tavoli vuoti il martedì?',
  ...over
});

describe('itemText', () => {
  it('puts the transcript before the caption — the caption is copy ABOUT the video', () => {
    const t = itemText(item({ spoken: 'Ti spiego come riempire il martedì sera' }));
    expect(t.indexOf('SPOKEN')).toBeLessThan(t.indexOf('CAPTION'));
  });

  it('reads a post with no transcript from its caption alone', () => {
    expect(itemText(item())).toContain('Hai 3 tavoli vuoti');
  });

  it('returns nothing when there is nothing to read', () => {
    // A silent clip with no caption and no analysis must NOT be catalogued from its platform:
    // that would be guessing, and a guessed label pollutes the bucket it lands in.
    expect(itemText(item({ caption: '   ' }))).toBe('');
  });

  it('carries the id so the model can key its answers back', () => {
    expect(itemText(item({ id: 'xyz' }))).toContain('[xyz]');
  });

  it('truncates a rambling field so it cannot crowd out the rest of the batch', () => {
    const t = itemText(item({ caption: 'x'.repeat(5000) }));
    expect(t.length).toBeLessThan(1200);
  });
});

describe('catalogable', () => {
  it('drops what cannot be read and keeps what can', () => {
    expect(catalogable([item({ id: 'ok' }), item({ id: 'nope', caption: null })]).map((i) => i.id)).toEqual(['ok']);
  });
});

describe('batches', () => {
  it('splits into chunks of at most BATCH_SIZE', () => {
    const all = Array.from({ length: 45 }, (_, i) => i);
    const out = batches(all);
    expect(out).toHaveLength(3);
    expect(out[0]).toHaveLength(BATCH_SIZE);
    expect(out.flat()).toEqual(all);
  });

  it('handles an empty list without producing an empty batch', () => {
    expect(batches([])).toEqual([]);
  });
});

describe('reconcile', () => {
  const items = [item({ id: 'a' }), item({ id: 'b' })];
  const good = { id: 'a', category: 'food', content_form: 'tutorial', topic: 'riempire il martedì' };

  it('keeps a well-formed answer', () => {
    expect(reconcile(items, { items: [good] })).toEqual([
      { id: 'a', category: 'food', content_form: 'tutorial', topic: 'riempire il martedì' }
    ]);
  });

  it('drops an id we never sent — a hallucinated row would label somebody else post', () => {
    expect(reconcile(items, { items: [{ ...good, id: 'zzz' }] })).toEqual([]);
  });

  it('drops a category outside the fixed list', () => {
    // The list is fixed BECAUSE the point is grouping. An invented value silently becomes its own
    // bucket of one, and a bucket of one correlates with nothing.
    expect(reconcile(items, { items: [{ ...good, category: 'ristorazione' }] })).toEqual([]);
  });

  it('drops a content_form outside the fixed list', () => {
    expect(reconcile(items, { items: [{ ...good, content_form: 'vlog' }] })).toEqual([]);
  });

  it('keeps only the first answer when the model repeats an id', () => {
    const dup = reconcile(items, { items: [good, { ...good, topic: 'altro' }] });
    expect(dup).toHaveLength(1);
    expect(dup[0].topic).toBe('riempire il martedì');
  });

  it('survives a malformed response instead of throwing', () => {
    expect(reconcile(items, null)).toEqual([]);
    expect(reconcile(items, { items: 'nope' })).toEqual([]);
  });

  it('caps the free-text topic', () => {
    expect(reconcile(items, { items: [{ ...good, topic: 'y'.repeat(400) }] })[0].topic).toHaveLength(120);
  });
});

describe('the two fixed lists', () => {
  it('offer an escape hatch, so nothing is forced into a wrong bucket', () => {
    expect(CATEGORIES).toContain('other');
    expect(CONTENT_FORMS).toContain('other');
  });

  it('separate what the content is ABOUT from how it is BUILT', () => {
    // The second axis is the one that transfers: "before/after beats talking head" is actionable in
    // every vertical, "food does well" is not actionable anywhere.
    expect(CONTENT_FORMS).toContain('before_after');
    expect(CONTENT_FORMS).toContain('talking_head');
    // 'other' is the one deliberate overlap: both axes need an escape hatch.
    const forms = CONTENT_FORMS.filter((f) => f !== 'other');
    for (const form of forms) expect(CATEGORIES).not.toContain(form as never);
  });

  it('covers static formats too, not just video', () => {
    expect(CONTENT_FORMS).toContain('photo_carousel');
    expect(CONTENT_FORMS).toContain('text_post');
  });
});
