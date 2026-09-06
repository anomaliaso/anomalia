import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/static/public', async (originale) => ({
  ...((await originale()) as Record<string, string>),
  PUBLIC_SUPABASE_URL: 'http://localhost:8000'
}));

vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_SUPABASE_URL: 'http://localhost:8000' } }));

import { isShowableMediaUrl } from './chat-media';

const SELF_HOSTED = 'http://localhost:8000';

describe('isOwnMediaUrl segue l origine configurata, non uno schema scritto a mano', () => {
  it('accetta lo storage di un self-host servito in http', () => {
    expect(isShowableMediaUrl(`${SELF_HOSTED}/storage/v1/object/public/media/u/a.png`)).toBe(true);
  });

  it('rifiuta un altro host anche quando l origine configurata e http', () => {
    expect(isShowableMediaUrl('http://evil.example.com/storage/v1/object/public/media/a.png')).toBe(false);
    expect(isShowableMediaUrl('https://localhost:8000/storage/v1/object/public/media/a.png')).toBe(false);
  });
});
