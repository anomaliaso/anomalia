import { describe, it, expect } from 'vitest';
import { addedOn, kindFor, labelOf, ofKind, shapeOf, type MediaRow } from './media-kind';

const ROME = 'Europe/Rome';

function media(over: Partial<MediaRow> = {}): MediaRow {
  return {
    id: 'm1',
    kind: 'image',
    mime: 'image/png',
    width: null,
    height: null,
    title: null,
    description: null,
    tags: null,
    signed_url: null,
    created_at: '2026-09-01T08:00:00Z',
    ...over
  };
}

describe('il filtro per tipo viene dalla URL e non si fida', () => {
  it('accetta un tipo conosciuto', () => {
    expect(kindFor('video')).toBe('video');
  });

  it('riporta ad all un tipo inventato', () => {
    expect(kindFor('drop table brand_media')).toBe('all');
  });

  it('riporta ad all quando manca', () => {
    expect(kindFor(null)).toBe('all');
  });
});

describe('la libreria mostrata e quella filtrata, non tutta', () => {
  const library = [media({ id: 'a' }), media({ id: 'b', kind: 'video' }), media({ id: 'c' })];

  it('un tipo tiene solo il suo', () => {
    expect(ofKind(library, 'video').map((m) => m.id)).toEqual(['b']);
  });

  it('all non toglie niente', () => {
    expect(ofKind(library, 'all')).toHaveLength(3);
  });

  it('un tipo senza elementi non inventa una griglia', () => {
    expect(ofKind([media({ kind: 'video' })], 'image')).toEqual([]);
  });
});

describe('come si chiama un asset che non ha un nome', () => {
  it('il titolo vince', () => {
    expect(labelOf(media({ title: 'Menu autunno' }))).toBe('Menu autunno');
  });

  it('un titolo di soli spazi non diventa una riga vuota', () => {
    expect(labelOf(media({ title: '   ', mime: 'image/webp' }))).toBe('image/webp');
  });

  it('senza titolo e senza mime resta il tipo', () => {
    expect(labelOf(media({ title: null, mime: null, kind: 'video' }))).toBe('video');
  });
});

describe('le misure si mostrano solo se ci sono davvero', () => {
  it('con entrambe le misure', () => {
    expect(shapeOf(media({ width: 1080, height: 1350 }))).toBe('1080×1350');
  });

  it('con una sola misura non si inventa la seconda', () => {
    expect(shapeOf(media({ width: 1080, height: null }))).toBeNull();
  });
});

describe('la data mostrata e quella del brand, non quella del server', () => {
  it('le 23:30 UTC del 31 agosto sono il 1 settembre a Roma', () => {
    expect(addedOn(media({ created_at: '2026-08-31T23:30:00Z' }), ROME)).toContain('1 Sep');
  });
});
