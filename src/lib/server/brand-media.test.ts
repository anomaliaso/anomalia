import { describe, expect, it } from 'vitest';
import {
  pickLibraryAssetForBrief,
  formatMediaLibraryPromptSection,
  formatMediaDigest,
  formatMediaUsageBit,
  type BrandMediaRow
} from './brand-media';

function row(partial: Partial<BrandMediaRow> & { id: string }): BrandMediaRow {
  return {
    brand_id: 'b',
    user_id: 'u',
    kind: 'image',
    storage_path: 'p',
    url: 'p',
    source: 'upload',
    source_ref: null,
    mime: 'image/jpeg',
    width: 1000,
    height: 1000,
    bytes: 1000,
    file_name: 'a.jpg',
    title: null,
    description: null,
    tags: [],
    subjects: [],
    colors: [],
    mood: null,
    media_kind: 'photo',
    suggested_use: null,
    when_to_use: null,
    how_to_use: null,
    where_to_use: null,
    catalog_status: 'ready',
    catalog_error: null,
    cataloged_at: null,
    duration_seconds: null,
    times_used: 0,
    last_used_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...partial
  };
}

describe('pickLibraryAssetForBrief', () => {
  it('picks the asset whose catalog overlaps the brief', () => {
    const rows = [
      row({ id: '1', title: 'Office desk', tags: ['workspace'], description: 'clean desk setup' }),
      row({ id: '2', title: 'Summer picnic', tags: ['outdoor', 'food'], description: 'friends at a picnic' })
    ];
    const picked = pickLibraryAssetForBrief(rows, 'Post about our summer picnic with friends outdoors');
    expect(picked?.id).toBe('2');
  });

  it('skips already-used ids', () => {
    const rows = [
      row({ id: '1', title: 'Picnic', tags: ['picnic'] }),
      row({ id: '2', title: 'Desk', tags: ['desk'] })
    ];
    const picked = pickLibraryAssetForBrief(rows, 'picnic outdoors', new Set(['1']));
    expect(picked?.id).toBe('2');
  });

  it('returns null when nothing available', () => {
    expect(pickLibraryAssetForBrief([], 'anything')).toBeNull();
  });

  it('prefers an unused asset over a heavily reused catalog match', () => {
    const rows = [
      row({
        id: '1',
        title: 'Picnic',
        tags: ['picnic'],
        times_used: 8,
        last_used_at: new Date().toISOString()
      }),
      row({ id: '2', title: 'Picnic', tags: ['picnic'], times_used: 0, last_used_at: null })
    ];
    expect(pickLibraryAssetForBrief(rows, 'picnic outdoors')?.id).toBe('2');
  });
});

describe('formatMediaLibraryPromptSection', () => {
  it('tells the model to generate when the library is empty', () => {
    const block = formatMediaLibraryPromptSection([]);
    expect(block).toContain('MEDIA LIBRARY');
    expect(block).toContain('(empty)');
    expect(block).toContain('generate_image');
    expect(block).not.toContain('use_library_image then');
  });

  it('lists ready assets and requires library-first reuse', () => {
    const block = formatMediaLibraryPromptSection([
      row({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'Hero product', tags: ['product'] })
    ]);
    expect(block).toContain('MEDIA FIRST');
    expect(block).toContain('read_media');
    expect(block).toContain('use_library_image');
    expect(block).toContain('Hero product');
    expect(block).toContain('generate_image only when nothing fits');
    expect(block).toContain('ROTATE');
    expect(block).toContain('unused');
  });
});

describe('formatMediaDigest usage', () => {
  it('marks unused assets and lists used counts', () => {
    expect(formatMediaUsageBit({ times_used: 0, last_used_at: null })).toBe(' unused');
    expect(formatMediaUsageBit({ times_used: 3, last_used_at: '2026-08-01T12:00:00Z' })).toBe(
      ' used=3 last=2026-08-01'
    );
    const digest = formatMediaDigest([
      row({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'Fresh', times_used: 0 }),
      row({
        id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
        title: 'Worn',
        times_used: 4,
        last_used_at: '2026-07-01T00:00:00Z'
      })
    ]);
    expect(digest.indexOf('Fresh')).toBeLessThan(digest.indexOf('Worn'));
    expect(digest).toContain('unused');
    expect(digest).toContain('used=4 last=2026-07-01');
  });
});
