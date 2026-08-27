import { describe, it, expect } from 'vitest';
import { ownerIdFromMediaUrl } from './publish';

// This regex gates the approve-time upscale: return null and the clip silently publishes at draft
// resolution, so a wrong match is invisible rather than loud. Worth pinning to real URL shapes.
describe('ownerIdFromMediaUrl', () => {
  const UID = '3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607';

  it('recovers the owner from a generated clip URL', () => {
    expect(ownerIdFromMediaUrl(`https://x.supabase.co/storage/v1/object/public/media/${UID}/generated/abc.mp4`)).toBe(UID);
  });

  it('works with a query string appended', () => {
    expect(ownerIdFromMediaUrl(`https://x.supabase.co/storage/v1/object/public/media/${UID}/generated/abc.mp4?t=1`)).toBe(UID);
  });

  it('recovers it from other media prefixes too (library uploads)', () => {
    expect(ownerIdFromMediaUrl(`https://x.supabase.co/storage/v1/object/public/media/${UID}/library/p.jpg`)).toBe(UID);
  });

  it('returns null when there is no media path or no uuid segment', () => {
    expect(ownerIdFromMediaUrl(null)).toBeNull();
    expect(ownerIdFromMediaUrl(undefined)).toBeNull();
    expect(ownerIdFromMediaUrl('')).toBeNull();
    expect(ownerIdFromMediaUrl('https://cdn.example.com/some/external/video.mp4')).toBeNull();
    // A media URL whose first segment is not a uuid (legacy/hand-made paths) must not match.
    expect(ownerIdFromMediaUrl('https://x.supabase.co/storage/v1/object/public/media/uploads/a.mp4')).toBeNull();
  });

  it('does not mistake a uuid living outside the media bucket', () => {
    expect(ownerIdFromMediaUrl(`https://x.supabase.co/storage/v1/object/public/avatars/${UID}/a.png`)).toBeNull();
  });
});
