/**
 * Is this a public object URL on OUR Supabase Storage?
 *
 * A chat attachment URL is both handed to the model and fetched server-side, then republished into
 * the public `media` bucket — so an arbitrary URL here is an SSRF that also exfiltrates the response.
 * The check is origin + path prefix on purpose: a substring test like
 * `url.includes('/storage/v1/object/public/')` is satisfied by
 * `https://evil.example/storage/v1/object/public/media/x.mp4`.
 */
export function isOwnStorageUrl(raw: string, supabaseUrl: string): boolean {
	try {
		const u = new URL(raw);
		const base = new URL(supabaseUrl);
		return (
			u.protocol === 'https:' &&
			u.origin === base.origin &&
			u.pathname.startsWith('/storage/v1/object/public/')
		);
	} catch {
		return false;
	}
}
