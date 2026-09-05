import { describe, expect, it } from 'vitest';
import { hostedImageType } from './weekly-recap';

// The weekly recap embeds a picture scraped off whatever page a trend links to, and used to store
// it under the content-type that remote server chose. Production still holds the result: an object
// named `.jpg` and served back as `image/svg+xml` from a public bucket — script, on our own URL,
// put there by a site we do not control.
describe('hostedImageType', () => {
  it('names the type itself for each raster format we host', () => {
    expect(hostedImageType('image/png')).toEqual({ ext: 'png', contentType: 'image/png' });
    expect(hostedImageType('image/webp')).toEqual({ ext: 'webp', contentType: 'image/webp' });
    expect(hostedImageType('image/jpeg')).toEqual({ ext: 'jpg', contentType: 'image/jpeg' });
  });

  it('refuses svg, whatever the remote server calls it', () => {
    expect(hostedImageType('image/svg+xml')).toBeNull();
  });

  it('refuses anything that is not an image', () => {
    expect(hostedImageType('text/html')).toBeNull();
    expect(hostedImageType('')).toBeNull();
  });

  // Storage matches its mime allowlist on the whole header, so a forwarded `;charset=` is refused
  // at upload. The parameter is the remote server's business, not ours: strip it and keep the type.
  it('drops the parameters a remote server tacks on', () => {
    expect(hostedImageType('image/png;charset=UTF-8')).toEqual({
      ext: 'png',
      contentType: 'image/png'
    });
    expect(hostedImageType('IMAGE/JPEG; q=0.9')).toEqual({ ext: 'jpg', contentType: 'image/jpeg' });
  });
});
