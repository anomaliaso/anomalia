import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

// L'host dello storage lo decide il test, non il `.env` di chi lo lancia: senza mock la suite è
// verde solo su una macchina con un progetto Supabase vero (`isOwnMediaUrl` pretende https) e
// rossa in CI, dove non c'è.
vi.mock('$env/static/public', async (originale) => ({
  ...((await originale()) as Record<string, string>),
  PUBLIC_SUPABASE_URL: 'https://test.supabase.co'
}));

// Il self-host legge l'URL a RUNTIME (`$env/dynamic/public`), perché l'immagine si costruisce una
// volta e il progetto Supabase lo sceglie chi la avvia. Il mock segue il codice: fermarsi a quello
// statico lascia `OWN_HOST` vuoto, e allora NIENTE è più «nostro» — le immagini tornano link.
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }
}));

import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import {
  normalizeMediaPayload,
  mediaFromToolCall,
  isShowableMediaUrl,
  splitTextMedia,
  showMediaUrls,
  MAX_CHAT_MEDIA
} from './chat-media';

const HOST = new URL(PUBLIC_SUPABASE_URL).origin;
const img = (n = 'a') => `${HOST}/storage/v1/object/public/media/u/${n}.png`;
const vid = (n = 'clip') => `${HOST}/storage/v1/object/public/media/u/${n}.mp4`;
const signed = `${HOST}/storage/v1/object/sign/brand-knowledge/u/b/artifacts/x.jpg?token=abc`;

describe('isShowableMediaUrl', () => {
  it('accepts our storage, public and signed', () => {
    expect(isShowableMediaUrl(img())).toBe(true);
    expect(isShowableMediaUrl(vid())).toBe(true);
    expect(isShowableMediaUrl(signed)).toBe(true);
  });

  it('refuses anything that is not ours — including a lookalike host and a plain http url', () => {
    expect(isShowableMediaUrl('https://evil.example.com/pixel.png')).toBe(false);
    expect(isShowableMediaUrl('https://other-project.supabase.co/storage/v1/object/public/media/a.png')).toBe(false);
    expect(isShowableMediaUrl(`${HOST.replace('https', 'http')}/storage/v1/object/public/media/a.png`)).toBe(false);
    // Nostro host ma non uno storage path: l'API del progetto non è un media.
    expect(isShowableMediaUrl(`${HOST}/rest/v1/posts?select=*`)).toBe(false);
    expect(isShowableMediaUrl('')).toBe(false);
    expect(isShowableMediaUrl(null)).toBe(false);
  });

  it('refuses markup dressed as an image (svg, html) even from our own storage', () => {
    expect(isShowableMediaUrl(`${HOST}/storage/v1/object/public/media/u/a.svg`)).toBe(false);
    expect(isShowableMediaUrl(`${HOST}/storage/v1/object/public/media/u/a.html`)).toBe(false);
    expect(isShowableMediaUrl(`${HOST}/storage/v1/object/public/media/u/a.pdf`)).toBe(false);
  });
});

describe('normalizeMediaPayload', () => {
  it('keeps photos and videos in the same block, with their captions', () => {
    const out = normalizeMediaPayload({
      media: [
        { url: vid(), caption: '  La clip generata  ' },
        { url: img('frame') }
      ]
    });
    expect(out).toEqual([
      { url: vid(), kind: 'video', caption: 'La clip generata' },
      { url: img('frame'), kind: 'image' }
    ]);
  });

  it('drops the rows that are not ours and returns null when nothing survives', () => {
    const out = normalizeMediaPayload({
      media: [{ url: 'https://evil.example.com/pixel.png' }, { url: img() }]
    });
    expect(out).toEqual([{ url: img(), kind: 'image' }]);
    expect(normalizeMediaPayload({ media: [{ url: 'https://evil.example.com/a.png' }] })).toBeNull();
    expect(normalizeMediaPayload({ posts: [{ id: 'p1' }] })).toBeNull();
    expect(normalizeMediaPayload(null)).toBeNull();
  });

  it('dedupes and caps the block', () => {
    const many = Array.from({ length: MAX_CHAT_MEDIA + 4 }, (_, i) => ({ url: img(`n${i}`) }));
    expect(normalizeMediaPayload({ media: [...many, { url: img('n0') }] })).toHaveLength(MAX_CHAT_MEDIA);
  });

  it('unwraps the kit ToolResult and the SDK content wrapper — that is how motion_stills arrives', () => {
    const payload = {
      shown_in_chat: true,
      artifacts: [{ id: 'a1', url: signed, title: 'Video · frame 30' }],
      media: [{ url: signed, caption: 'Video · frame 30' }]
    };
    const kit = { content: [{ type: 'text', text: JSON.stringify(payload) }, { type: 'image', mimeType: 'image/png', base64: 'xx' }] };
    const sdk = { type: 'content', value: [{ type: 'text', text: JSON.stringify(payload) }] };
    expect(normalizeMediaPayload(kit)).toEqual([{ url: signed, kind: 'image', caption: 'Video · frame 30' }]);
    expect(normalizeMediaPayload(sdk)).toEqual([{ url: signed, kind: 'image', caption: 'Video · frame 30' }]);
    expect(normalizeMediaPayload({ artifacts: payload.artifacts })).toEqual([
      { url: signed, kind: 'image', caption: 'Video · frame 30' }
    ]);
  });

  it('mediaFromToolCall prefers the persisted part, then the live output', () => {
    expect(mediaFromToolCall({ media: [{ url: img(), kind: 'image', caption: 'saved' }] })).toEqual([
      { url: img(), kind: 'image', caption: 'saved' }
    ]);
    expect(mediaFromToolCall({ output: { media: [{ url: img('live') }] } })).toEqual([
      { url: img('live'), kind: 'image' }
    ]);
    expect(mediaFromToolCall({ toolName: 'motion_stills', output: { posts: [] } })).toBeNull();
  });
});

describe('splitTextMedia', () => {
  // L'indirizzo esatto della segnalazione.
  const trailer = `${new URL(PUBLIC_SUPABASE_URL).origin}/storage/v1/object/public/media/22bf9fdc-1111-2222-3333-444455556666/motion/59933541-aaaa-bbbb-cccc-ddddeeeeffff.mp4`;
  const shot = `${new URL(PUBLIC_SUPABASE_URL).origin}/storage/v1/object/public/media/u/shot.png`;

  it('promotes a bare storage URL on its own line, and keeps the line that introduces it', () => {
    const out = splitTextMedia(`Link del trailer:\n${trailer}`);
    expect(out.text).toBe('Link del trailer:');
    expect(out.media).toEqual([{ url: trailer, kind: 'video' }]);
  });

  it('promotes images too, several of them, in order', () => {
    const out = splitTextMedia(`Ecco:\n${shot}\n${trailer}\nDimmi quale.`);
    expect(out.text).toBe('Ecco:\nDimmi quale.');
    expect(out.media?.map((m) => m.kind)).toEqual(['image', 'video']);
  });

  it('leaves a URL inside a sentence alone — that is a link, not a delivery', () => {
    const line = `L'ho salvato qui: ${trailer} e poi ho fatto altro.`;
    expect(splitTextMedia(line)).toEqual({ text: line, media: null });
  });

  it('never promotes what is not ours, and never markup dressed as media', () => {
    for (const url of [
      'https://evil.example.com/pixel.png',
      'https://other-project.supabase.co/storage/v1/object/public/media/a.mp4',
      `${new URL(PUBLIC_SUPABASE_URL).origin}/storage/v1/object/public/media/u/a.svg`
    ]) {
      expect(splitTextMedia(`Guarda:\n${url}`)).toEqual({ text: `Guarda:\n${url}`, media: null });
    }
  });

  it('does not show twice what show_media already carries — but still cleans the line', () => {
    const blocks = [
      { type: 'tools', calls: [{ toolName: 'show_media', output: { media: [{ url: trailer }] } }] }
    ];
    const skip = showMediaUrls(blocks);
    const out = splitTextMedia(`Link del trailer:\n${trailer}`, skip);
    expect(out.text).toBe('Link del trailer:');
    expect(out.media).toBeNull();
  });
});
