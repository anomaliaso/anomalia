import { MOTION_CRAFT_SPECS, MOTION_FALLBACK_SANS } from '$lib/motion-video/craft';

/** Brand-kit helpers for motion video — palette, type, logo. Safe for client + server. */

export function kitColorHexes(colors: unknown, max = 6): string[] {
	if (!Array.isArray(colors)) return [];
	const out: string[] = [];
	for (const c of colors) {
		if (typeof c === 'string' && c.trim()) {
			out.push(c.trim());
			continue;
		}
		if (c && typeof c === 'object' && typeof (c as { hex?: unknown }).hex === 'string') {
			const hex = (c as { hex: string }).hex.trim();
			if (hex) out.push(hex);
		}
	}
	return out.slice(0, max);
}

export function kitFontNames(fonts: unknown, max = 3): string[] {
	if (!Array.isArray(fonts)) return [];
	const out: string[] = [];
	for (const f of fonts) {
		if (typeof f === 'string' && f.trim()) {
			out.push(f.trim());
			continue;
		}
		if (f && typeof f === 'object') {
			const name =
				(f as { name?: unknown }).name ?? (f as { family?: unknown }).family;
			if (typeof name === 'string' && name.trim()) out.push(name.trim());
		}
	}
	return out.slice(0, max);
}

/** First real mark URL — skip og-image banners. */
export function kitLogoUrl(logos: unknown, faviconUrl?: string | null): string | null {
	if (Array.isArray(logos)) {
		for (const l of logos) {
			if (typeof l === 'string' && l.trim()) return l.trim();
			if (l && typeof l === 'object') {
				const url = (l as { url?: unknown }).url;
				const type = (l as { type?: unknown }).type;
				if (typeof url === 'string' && url.trim() && type !== 'og-image') return url.trim();
			}
		}
	}
	const fav = typeof faviconUrl === 'string' ? faviconUrl.trim() : '';
	return fav || null;
}

export function fontFamiliesInSource(source: string): string[] {
	const found = new Set<string>();
	const re = /(?:fontFamily|displayFont|bodyFont)\s*[:=]\s*['"]([^'"]+)['"]/g;
	for (const m of source.matchAll(re)) {
		const name = m[1]?.trim();
		if (name) found.add(name);
	}
	return [...found];
}

export function formatMotionBrandBrief(opts: {
	brandName: string;
	colors: string[];
	fonts: string[];
	logoUrl: string | null;
	visualStyle?: string | null;
	graphicStyle?: string | null;
	playbook?: string | null;
}): string {
	const lines: string[] = [`Brand: ${opts.brandName}`];
	if (opts.colors.length) {
		lines.push(
			`Colour palette — use ONLY these (backgrounds, type, shapes, CTAs): ${opts.colors.join(', ')}. Never invent an off-brand scheme.`
		);
	}
	if (opts.fonts.length) {
		const display = opts.fonts[0];
		const body = opts.fonts[1] ?? opts.fonts[0];
		lines.push(
			`Typography: headlines/display = ${display}; body/UI = ${body}. Set style.fontFamily to these exact names. Do NOT import @remotion/google-fonts (blocked) — the renderer loads the families.`
		);
	} else {
		lines.push(
			`Typography: no brand font on file — use a minimal clean sans-serif (${MOTION_FALLBACK_SANS}) for headlines, UI, and CTA. Never invent a serif or decorative family.`
		);
	}
	if (opts.logoUrl) {
		lines.push(
			`Logo file (use remotion <Img src={logoUrl} /> with this exact URL — never redraw the mark with shapes or type): ${opts.logoUrl}`
		);
	} else {
		lines.push('No logo file. Use the brand name as type, not a fake wordmark.');
	}
	const visual = opts.visualStyle?.trim();
	if (visual) lines.push(`Visual style:\n${visual}`);
	const graphic = opts.graphicStyle?.trim();
	if (graphic) lines.push(`Graphic style:\n${graphic}`);
	const playbook = opts.playbook?.trim();
	if (playbook) lines.push(playbook);
	lines.push(
		'Motion language: kinetic type + brand colour, few words, high contrast. Not a filmed scene. Logo small, never stretched, keep clear space.'
	);
	lines.push(MOTION_CRAFT_SPECS);
	return lines.join('\n');
}

/** Playbook appendix folded into brand_kit.ai_context. */
export function extractVisualPlaybook(aiContext: unknown): string {
	const m = String(aiContext ?? '').match(/WHAT WORKS VISUALLY[^\n]*\n[\s\S]*?(?=\n\n|$)/);
	return m ? m[0].trim() : '';
}
