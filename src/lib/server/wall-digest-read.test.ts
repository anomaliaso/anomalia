import { describe, it, expect, vi } from 'vitest';
import { WALL_DIGEST_VERSION } from './wall-digest';

const downloads = { count: 0 };

vi.mock('$lib/server/supabase-admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        download: async () => {
          downloads.count += 1;
          return {
            data: {
              text: async () =>
                JSON.stringify({
                  kind: 'design',
                  version: WALL_DIGEST_VERSION,
                  generatedAt: new Date().toISOString(),
                  itemCount: 12,
                  text: 'one oversized headline, 3-5 words'
                })
            },
            error: null
          };
        }
      })
    }
  })
}));

const { designWallDigestSection } = await import('./wall-digest');

describe('il pavimento del design si scarica una volta per processo', () => {
  it('non ripete il download a ogni post del batch', async () => {
    const sections = await Promise.all(Array.from({ length: 8 }, () => designWallDigestSection()));

    expect(downloads.count).toBe(1);
    for (const section of sections) {
      expect(section).toContain('AMBIENT DESIGN FLOOR');
    }
  });
});
