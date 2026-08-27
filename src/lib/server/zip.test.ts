import { describe, expect, it } from 'vitest';
import { buildZip, safeZipName } from './zip';

describe('buildZip', () => {
  it('builds a readable store-only zip', () => {
    const data = new TextEncoder().encode('hello media');
    const zip = buildZip([{ name: 'a/hello.txt', data }]);
    // Local file header signature
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
    // End of central directory signature somewhere near the end
    const endSig = [0x50, 0x4b, 0x05, 0x06];
    let found = false;
    for (let i = zip.length - 22; i >= 0; i--) {
      if (endSig.every((b, j) => zip[i + j] === b)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
    // Payload still present
    expect(new TextDecoder().decode(zip)).toContain('hello media');
  });

  it('sanitizes names', () => {
    expect(safeZipName('../../evil/name?.jpg')).toBe('name_.jpg');
  });
});
