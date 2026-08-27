<script lang="ts">
	import { PRESET_SLIDES, type StylePreset } from '$lib/design/presets';
	import { styleAssetSrcSet, styleAssetUrl } from '$lib/design/presets/urls';

	type Props = {
		preset: StylePreset;
		kind: (typeof PRESET_SLIDES)[number];
		idx: number;
		href: string;
		lang: 'it' | 'en';
		priority?: boolean;
		onStep: (dir: -1 | 1, e?: Event) => void;
	};

	let { preset, kind, idx, href, lang, priority = false, onStep }: Props = $props();

	const thumbSrc = $derived(styleAssetUrl(preset.slug, kind, 540));
	const thumbSrcSet = $derived(styleAssetSrcSet(preset.slug, kind));
</script>

<div class="sl-thumb">
	<img
		class="sl-thumb-still"
		src={thumbSrc}
		srcset={thumbSrcSet}
		sizes="(max-width: 720px) 360px, (max-width: 960px) 45vw, 30vw"
		alt={lang === 'it'
			? `Slide ${idx + 1} dello stile ${preset.name}`
			: `Slide ${idx + 1} of the ${preset.name} style`}
		width="540"
		height="720"
		loading={priority ? 'eager' : 'lazy'}
		decoding="async"
		fetchpriority={priority ? 'high' : 'auto'}
	/>
	<a class="sl-thumb-hit" {href} aria-label={preset.name}></a>
	<button
		type="button"
		class="sl-chev sl-chev-prev"
		aria-label={lang === 'it' ? 'Slide precedente' : 'Previous slide'}
		onclick={(e) => onStep(-1, e)}
	>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<polyline points="15 18 9 12 15 6" />
		</svg>
	</button>
	<button
		type="button"
		class="sl-chev sl-chev-next"
		aria-label={lang === 'it' ? 'Slide successiva' : 'Next slide'}
		onclick={(e) => onStep(1, e)}
	>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<polyline points="9 18 15 12 9 6" />
		</svg>
	</button>
	<span class="sl-counter" aria-hidden="true">
		{String(idx + 1).padStart(2, '0')}/{String(PRESET_SLIDES.length).padStart(2, '0')}
	</span>
</div>

<style>
	.sl-thumb {
		position: relative;
		aspect-ratio: 3 / 4;
		background: var(--paper-2);
		overflow: hidden;
		border-radius: 16px;
		border: 1px solid var(--line);
		margin-bottom: 4px;
	}
	.sl-thumb-still {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.sl-thumb-hit {
		position: absolute;
		inset: 0;
		z-index: 2;
	}
	.sl-chev {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		z-index: 3;
		width: 36px;
		height: 36px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: color-mix(in srgb, var(--paper) 92%, transparent);
		color: var(--ink);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0;
		opacity: 0;
		transition:
			opacity 0.2s var(--ease),
			background 0.2s var(--ease),
			transform 0.2s var(--ease);
	}
	.sl-chev svg {
		width: 16px;
		height: 16px;
	}
	.sl-chev-prev {
		left: 10px;
	}
	.sl-chev-next {
		right: 10px;
	}
	.sl-thumb:hover .sl-chev,
	.sl-thumb:focus-within .sl-chev {
		opacity: 1;
	}
	.sl-chev:hover {
		background: var(--paper);
		transform: translateY(-50%) scale(1.05);
	}
	.sl-chev:focus-visible {
		opacity: 1;
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.sl-counter {
		position: absolute;
		left: 12px;
		bottom: 12px;
		z-index: 3;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
		background: color-mix(in srgb, var(--paper) 90%, transparent);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 4px 9px;
		pointer-events: none;
	}

	@media (max-width: 720px) {
		.sl-chev {
			opacity: 1;
		}
	}
</style>
