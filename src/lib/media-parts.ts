/**
 * A media URL sitting in a prompt (or in a turn's attachment list) is invisible to the model — it
 * is just text, and the model will happily claim it "watched the reference" it never saw. These
 * helpers turn those URLs into the multimodal content parts a user turn should actually carry, so
 * every agent gets real vision over remote images and video.
 */

const URL_RE = /https?:\/\/[^\s"'<>()[\]]+/gi;
const IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|avif|bmp)(?:[?#]|$)/i;
const VIDEO_EXT = /\.(?:mp4|mov|webm|m4v)(?:[?#]|$)/i;

const VIDEO_MEDIA_TYPE: Record<string, string> = {
	mp4: 'video/mp4',
	m4v: 'video/mp4',
	mov: 'video/quicktime',
	webm: 'video/webm'
};

export type MediaPart =
	| { type: 'image'; image: URL | string }
	| { type: 'file'; mediaType: string; data: URL };

const DATA_IMAGE = /^data:image\//i;
const DATA_VIDEO = /^data:video\/(mp4|quicktime|webm)/i;

/**
 * Parts for an explicit attachment list — device uploads and library picks, which are already
 * known to be media. Classifying these by file extension the way text scanning does was wrong:
 * a `data:image/jpeg;base64,…` upload and an extensionless signed URL both have no extension, so
 * every one of them was silently dropped and the model answered about a photo it never saw.
 * Anything not recognisable as video is treated as an image, which is the long-standing behaviour.
 */
export function attachmentParts(urls: string[], limit = 16): MediaPart[] {
	const parts: MediaPart[] = [];
	for (const raw of urls) {
		if (parts.length >= limit) break;
		const url = clean(raw);
		if (!url) continue;
		if (DATA_IMAGE.test(url)) {
			parts.push({ type: 'image', image: url });
			continue;
		}
		if (DATA_VIDEO.test(url)) continue; // inline video upload is not a path we produce
		if (!/^https?:\/\//i.test(url)) continue;
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			continue;
		}
		if (isVideoUrl(url)) {
			const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() ?? 'mp4';
			parts.push({ type: 'file', mediaType: VIDEO_MEDIA_TYPE[ext] ?? 'video/mp4', data: parsed });
		} else {
			parts.push({ type: 'image', image: parsed });
		}
	}
	return parts;
}

/** Drop video parts for a model that cannot watch one (most non-Gemini providers throw on them). */
export function withoutVideo(parts: MediaPart[]): MediaPart[] {
	return parts.filter((p) => p.type === 'image');
}

function clean(url: string): string {
	return url.replace(/[.,;:!?]+$/, '');
}

export function isImageUrl(url: string): boolean {
	return IMAGE_EXT.test(clean(url));
}

export function isVideoUrl(url: string): boolean {
	return VIDEO_EXT.test(clean(url));
}

/** Image + video URLs pasted anywhere in a block of text, in order, deduped. */
export function mediaUrlsIn(text: string): string[] {
	return [...new Set((text.match(URL_RE) ?? []).map(clean))].filter(
		(u) => isImageUrl(u) || isVideoUrl(u)
	);
}

/**
 * Content parts for the given URLs. Anything that is not a recognisable image or video is dropped —
 * the model cannot do anything with a link it can't open.
 *
 * ponytail: no size check, so a huge remote video fails loudly at the provider instead of being
 * skipped. Add a HEAD content-length gate here if that turns into a common dead end.
 */
export function mediaPartsFor(urls: string[], limit = 4): MediaPart[] {
	const parts: MediaPart[] = [];
	for (const raw of urls) {
		if (parts.length >= limit) break;
		const url = clean(raw);
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			continue;
		}
		if (isImageUrl(url)) {
			parts.push({ type: 'image', image: parsed });
		} else if (isVideoUrl(url)) {
			const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() ?? 'mp4';
			parts.push({ type: 'file', mediaType: VIDEO_MEDIA_TYPE[ext] ?? 'video/mp4', data: parsed });
		}
	}
	return parts;
}

/** Media parts for a user turn: URLs pasted in the text plus any stored attachment URLs. */
export function userTurnMediaParts(text: string, attachmentUrls: string[] = []): MediaPart[] {
	return mediaPartsFor([...attachmentUrls, ...mediaUrlsIn(text)]);
}

/** null for a data: URL image — it carries its own bytes, so there is nothing to reach. */
function partUrl(part: MediaPart): URL | null {
	if (part.type === 'file') return part.data;
	return typeof part.image === 'string' ? null : part.image;
}

/**
 * Drop parts we cannot actually fetch. The provider downloads these URLs itself, so a link that
 * 403s a server (hotlink protection is common on media CDNs) would fail the whole turn instead of
 * the model simply saying it could not open the reference.
 */
export async function reachableMediaParts(parts: MediaPart[]): Promise<MediaPart[]> {
	const checked = await Promise.all(
		parts.map(async (part) => {
			const url = partUrl(part);
			if (!url) return part;
			const ok = await fetch(url, {
				method: 'GET',
				headers: { Range: 'bytes=0-0' },
				signal: AbortSignal.timeout(5000)
			})
				.then((r) => r.ok || r.status === 206)
				.catch(() => false);
			return ok ? part : null;
		})
	);
	return checked.filter((p): p is MediaPart => p !== null);
}

/** Async `userTurnMediaParts` — same parts, minus anything that will not load. */
export async function resolveUserTurnMediaParts(
	text: string,
	attachmentUrls: string[] = []
): Promise<MediaPart[]> {
	return reachableMediaParts(userTurnMediaParts(text, attachmentUrls));
}
