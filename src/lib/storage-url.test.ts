import { describe, expect, it } from 'vitest';
import { isOwnStorageUrl } from './storage-url';

const BASE = 'https://kszazivzwievqixcnanp.supabase.co';

describe('isOwnStorageUrl', () => {
	it('accepts a public object URL on our own project', () => {
		expect(isOwnStorageUrl(`${BASE}/storage/v1/object/public/media/u/clip.mp4`, BASE)).toBe(true);
	});

	it('rejects another host that merely contains the storage path', () => {
		// The substring check this replaced said yes to exactly this URL.
		expect(
			isOwnStorageUrl('https://evil.example/storage/v1/object/public/media/x.mp4', BASE)
		).toBe(false);
	});

	it('rejects a lookalike host and a subdomain of it', () => {
		expect(
			isOwnStorageUrl('https://kszazivzwievqixcnanp.supabase.co.evil.example/storage/v1/object/public/a', BASE)
		).toBe(false);
		expect(
			isOwnStorageUrl('https://evil.kszazivzwievqixcnanp.supabase.co/storage/v1/object/public/a', BASE)
		).toBe(false);
	});

	it('rejects our host on a non-public or unrelated path', () => {
		expect(isOwnStorageUrl(`${BASE}/storage/v1/object/sign/media/x.mp4`, BASE)).toBe(false);
		expect(isOwnStorageUrl(`${BASE}/rest/v1/brands`, BASE)).toBe(false);
	});

	it('rejects non-https and non-URL input', () => {
		expect(isOwnStorageUrl(BASE.replace('https', 'http') + '/storage/v1/object/public/a', BASE)).toBe(false);
		expect(isOwnStorageUrl('data:image/png;base64,AAAA', BASE)).toBe(false);
		expect(isOwnStorageUrl('not a url', BASE)).toBe(false);
		expect(isOwnStorageUrl('', BASE)).toBe(false);
	});
});
