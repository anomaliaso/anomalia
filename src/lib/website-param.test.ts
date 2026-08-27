import { describe, expect, it } from 'vitest';
import { sanitizeWebsiteParam } from './website-param';

describe('sanitizeWebsiteParam', () => {
  it('accepts bare hosts and http(s) urls', () => {
    expect(sanitizeWebsiteParam('acme.com')).toBe('acme.com');
    expect(sanitizeWebsiteParam('https://acme.com/path')).toBe('https://acme.com/path');
    expect(sanitizeWebsiteParam('  www.studio.so  ')).toBe('www.studio.so');
  });

  it('rejects empty, schemes other than http(s), and junk', () => {
    expect(sanitizeWebsiteParam('')).toBe('');
    expect(sanitizeWebsiteParam(null)).toBe('');
    expect(sanitizeWebsiteParam('javascript:alert(1)')).toBe('');
    expect(sanitizeWebsiteParam('not a url')).toBe('');
    expect(sanitizeWebsiteParam('localhost')).toBe('');
  });
});
