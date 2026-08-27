<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { _ } from 'svelte-i18n';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import {
		MOTION_ASPECTS,
		MOTION_DURATION_PRESETS,
		formatMotionDurationPreset,
		parseMotionAspectRatio,
		parseMotionDuration,
		type MotionAspectRatio,
		type MotionDurationPreset
	} from '$lib/motion-video/source';
	import {
		MOTION_MP4_QUALITIES,
		parseMotionMp4Quality,
		type MotionMp4Quality
	} from '$lib/motion-video/mp4-render';
	import type { ComposerMenu } from './motion-video-model';

	interface Props {
		loading: boolean;
		can4k: boolean;
		brandSlug: string;
		prefKey: string;
		menu?: ComposerMenu;
		aspect?: MotionAspectRatio;
		duration?: MotionDurationPreset;
		quality?: MotionMp4Quality;
	}

	let {
		loading,
		can4k,
		brandSlug,
		prefKey,
		menu = $bindable<ComposerMenu>('none'),
		aspect = $bindable<MotionAspectRatio>('1:1'),
		duration = $bindable<MotionDurationPreset>('auto'),
		quality = $bindable<MotionMp4Quality>('2k')
	}: Props = $props();

	let prefsHydrated = $state(false);

	$effect(() => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(prefKey);
			if (raw) {
				const parsed = JSON.parse(raw) as {
					aspect?: unknown;
					quality?: unknown;
					duration?: unknown;
				};
				aspect = parseMotionAspectRatio(parsed.aspect);
				quality = parseMotionMp4Quality(parsed.quality);
				duration = parseMotionDuration(parsed.duration);
			}
		} catch {
			/* ignore */
		}
		prefsHydrated = true;
	});

	$effect(() => {
		if (!browser || !prefsHydrated) return;
		aspect;
		quality;
		duration;
		try {
			localStorage.setItem(prefKey, JSON.stringify({ aspect, quality, duration }));
		} catch {
			/* ignore quota */
		}
	});

	$effect(() => {
		if (!can4k && quality === '4k') quality = '2k';
	});
</script>

<div class="mg-dd-wrap">
	<button
		type="button"
		class="mg-dd-btn"
		class:on={menu === 'aspect'}
		disabled={loading}
		onclick={() => (menu = menu === 'aspect' ? 'none' : 'aspect')}
	>
		<span>{aspect}</span>
		<ChevronDown size={12} />
	</button>
	{#if menu === 'aspect'}
		<div class="mg-dd" role="listbox" aria-label={$_('app.motionVideo.aspect')}>
			{#each MOTION_ASPECTS as a}
				<button
					type="button"
					class="mg-dd-item"
					class:active={aspect === a}
					role="option"
					aria-selected={aspect === a}
					onclick={() => {
						aspect = a;
						menu = 'none';
					}}
				>
					<span>{a}</span>
					{#if aspect === a}<Check size={14} />{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
<div class="mg-dd-wrap">
	<button
		type="button"
		class="mg-dd-btn"
		class:on={menu === 'duration'}
		disabled={loading}
		onclick={() => (menu = menu === 'duration' ? 'none' : 'duration')}
		aria-label={$_('app.motionVideo.duration')}
	>
		<span
			>{duration === 'auto'
				? $_('app.motionVideo.durationAuto')
				: formatMotionDurationPreset(duration)}</span
		>
		<ChevronDown size={12} />
	</button>
	{#if menu === 'duration'}
		<div class="mg-dd" role="listbox" aria-label={$_('app.motionVideo.duration')}>
			{#each MOTION_DURATION_PRESETS as d}
				<button
					type="button"
					class="mg-dd-item"
					class:active={duration === d}
					role="option"
					aria-selected={duration === d}
					onclick={() => {
						duration = d;
						menu = 'none';
					}}
				>
					<span
						>{d === 'auto'
							? $_('app.motionVideo.durationAuto')
							: formatMotionDurationPreset(d)}</span
					>
					{#if duration === d}<Check size={14} />{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
<div class="mg-dd-wrap">
	<button
		type="button"
		class="mg-dd-btn"
		class:on={menu === 'quality'}
		disabled={loading}
		onclick={() => (menu = menu === 'quality' ? 'none' : 'quality')}
		aria-label={$_('app.motionVideo.quality')}
	>
		<span>{quality === '4k' ? $_('app.motionVideo.quality4k') : $_('app.motionVideo.quality2k')}</span>
		<ChevronDown size={12} />
	</button>
	{#if menu === 'quality'}
		<div class="mg-dd" role="listbox" aria-label={$_('app.motionVideo.quality')}>
			{#each MOTION_MP4_QUALITIES as q}
				{@const locked = q === '4k' && !can4k}
				<button
					type="button"
					class="mg-dd-item"
					class:active={quality === q}
					class:locked
					role="option"
					aria-selected={quality === q}
					title={q === '4k' ? $_('app.motionVideo.quality4kHint') : undefined}
					onclick={() => {
						if (locked) {
							menu = 'none';
							void goto(`/app/${brandSlug}/upgrade?plan=pro`);
							return;
						}
						quality = q;
						menu = 'none';
					}}
				>
					<span>{q === '4k' ? $_('app.motionVideo.quality4k') : $_('app.motionVideo.quality2k')}</span>
					<span class="mg-dd-meta">
						{#if q === '4k'}
							<span class="mv-pro">{$_('app.radar.proOnlyBadge')}</span>
						{/if}
						{#if !locked && quality === q}<Check size={14} />{/if}
					</span>
				</button>
			{/each}
			<!-- L'export costa: prima non lo diceva niente, e la prima notizia era il
			     saldo a zero. Sta qui perché è dove si sceglie quanto costa. -->
			<p class="mv-dd-note">{$_('app.motionVideo.renderCost')}</p>
		</div>
	{/if}
</div>

<style>
	.mg-dd-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.mg-dd-btn {
		appearance: none;
		border: 1px solid var(--line);
		background: var(--paper-2, #f5f5f7);
		color: var(--ink-soft);
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 28px;
		padding: 0 8px 0 10px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 650;
		letter-spacing: 0.01em;
		cursor: pointer;
		line-height: 1;
	}
	.mg-dd-btn.on,
	.mg-dd-btn:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
		color: var(--ink);
	}
	.mg-dd-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.mg-dd-btn :global(svg) {
		opacity: 0.7;
		flex-shrink: 0;
	}
	.mg-dd {
		position: absolute;
		left: 0;
		bottom: calc(100% + 8px);
		z-index: 30;
		min-width: 140px;
		padding: 6px;
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 14px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
	}
	.mg-dd-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		width: 100%;
		border: none;
		background: transparent;
		border-radius: 10px;
		padding: 8px 10px;
		font-size: 13px;
		color: var(--ink);
		cursor: pointer;
		text-align: left;
	}
	.mg-dd-item:hover,
	.mg-dd-item.active {
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}
	.mg-dd-item.locked {
		color: var(--ink-soft);
	}
	.mg-dd-meta {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.mv-dd-note {
		margin: 4px 0 0;
		padding: 6px 10px 2px;
		border-top: 1px solid var(--line);
		font-size: 11px;
		line-height: 1.35;
		color: var(--ink-soft);
	}
	.mv-pro {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		padding: 2px 6px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 16%, transparent);
		color: var(--accent, #c485fe);
	}
</style>
