<script lang="ts">
	import { _ } from 'svelte-i18n';
	import Film from '@lucide/svelte/icons/film';
	import Check from '@lucide/svelte/icons/check';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import VideoScoreRing from '$lib/components/VideoScoreRing.svelte';
	import type { GridItem } from './motion-video-model';

	interface Props {
		items: GridItem[];
		selectedIds: string[];
		loading: boolean;
		blurred: boolean;
		brandSlug: string;
		onToggleSelect: (id: string) => void;
		onRemove: (id: string) => void;
		onOpen: (item: GridItem) => void;
	}

	let {
		items = $bindable([]),
		selectedIds,
		loading,
		blurred,
		brandSlug,
		onToggleSelect,
		onRemove,
		onOpen
	}: Props = $props();

	/**
	 * The row's width/height describe the TSX canvas, which can already be a new aspect while
	 * preview_url still points at the previously encoded MP4 — the tile then crops the clip. The
	 * file's own dimensions are the truth for the cell.
	 */
	function syncTileRatio(id: string, el: HTMLVideoElement) {
		const { videoWidth: w, videoHeight: h } = el;
		if (!w || !h) return;
		items = items.map((i) =>
			i.id === id && (i.width !== w || i.height !== h) ? { ...i, width: w, height: h } : i
		);
	}
</script>

<div class="mv-grid-wrap" class:blurred={blurred}>
	{#if items.length === 0 && !loading}
		<div class="mv-empty">
			<Film size={28} strokeWidth={1.5} />
			<h2>{$_('app.motionVideo.emptyTitle')}</h2>
			<p>{$_('app.motionVideo.emptyBody')}</p>
		</div>
	{:else}
		<div class="mv-masonry">
			{#each items as item (item.id)}
				{@const selected = selectedIds.includes(item.id)}
				<div
					class="mv-tile"
					class:selected
					class:rendering={item.rendering}
					class:tall={(item.height || 1080) > (item.width || 1080)}
					class:wide={(item.width || 1080) > (item.height || 1080)}
					style={`aspect-ratio: ${item.width || 1080} / ${item.height || 1080}`}
				>
					<button
						type="button"
						class="mv-tile-open"
						onclick={() => {
							if (item.preview_url) onOpen(item);
						}}
						title={item.title}
					>
						{#if item.rendering}
							<div class="mv-tile-pending">
								<span class="mv-spin"></span>
								<span>{$_('app.motionVideo.rendering')}</span>
							</div>
						{:else if item.preview_url}
							<video
								src={item.preview_url}
								muted
								playsinline
								loop
								autoplay
								onloadedmetadata={(e) => syncTileRatio(item.id, e.currentTarget)}
							></video>
							<span class="mv-badge">video</span>
							<VideoScoreRing
								url={item.preview_url}
								brandSlug={brandSlug}
								size={28}
								corner="br"
							/>
						{:else}
							<div class="mv-tile-pending">
								<Film size={22} strokeWidth={1.5} />
								<span>{item.title}</span>
							</div>
						{/if}
					</button>
					<button
						type="button"
						class="mv-select-dot"
						class:on={selected}
						onclick={(e) => {
							e.stopPropagation();
							onToggleSelect(item.id);
						}}
						aria-pressed={selected}
						title={selected
							? $_('app.motionVideo.deselect')
							: $_('app.motionVideo.select')}
					>
						{#if selected}
							<Check size={12} strokeWidth={3} />
						{/if}
					</button>
					<button
						type="button"
						class="mv-tile-del"
						onclick={(e) => {
							e.stopPropagation();
							onRemove(item.id);
						}}
						aria-label="Delete"
					>
						<Trash2 size={13} />
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.mv-grid-wrap {
		flex: 1;
		overflow-y: auto;
		padding: 8px 12px calc(var(--mv-composer-clearance, 200px) + 8px);
		width: 100%;
		box-sizing: border-box;
		transition:
			filter 0.25s ease,
			opacity 0.25s ease;
	}
	.mv-grid-wrap.blurred {
		filter: blur(6px);
		opacity: 0.45;
		pointer-events: none;
	}
	.mv-empty {
		max-width: 420px;
		margin: 12vh auto 0;
		text-align: center;
		color: var(--ink-soft, #71717a);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
	}
	.mv-empty h2 {
		margin: 0;
		font-size: 1.15rem;
		color: var(--ink, #18181b);
		font-weight: 600;
	}
	.mv-empty p {
		margin: 0;
		font-size: 14px;
		line-height: 1.5;
	}
	.mv-masonry {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 12px;
		align-items: start;
		width: 100%;
	}
	@media (max-width: 1400px) {
		.mv-masonry {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	@media (max-width: 1100px) {
		.mv-masonry {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	@media (max-width: 780px) {
		.mv-masonry {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 640px) {
		.mv-tile.wide {
			grid-column: 1 / -1;
		}
	}
	.mv-tile {
		position: relative;
		border-radius: 12px;
		overflow: hidden;
		background: #0a0a0a;
		aspect-ratio: 1 / 1;
		outline: 2px solid transparent;
		transition: outline-color 0.15s ease;
	}
	.mv-tile.selected {
		outline-color: var(--accent, #c485fe);
	}
	.mv-tile-open {
		display: block;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
	}
	.mv-tile video {
		width: 100%;
		height: 100%;
		/* contain, never cover: a clip must never be cropped to fit the cell */
		object-fit: contain;
		display: block;
	}
	.mv-badge {
		position: absolute;
		left: 8px;
		bottom: 8px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		padding: 3px 7px;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
	}
	.mv-select-dot {
		position: absolute;
		top: 8px;
		left: 8px;
		width: 22px;
		height: 22px;
		border-radius: 999px;
		border: 1.5px solid rgba(255, 255, 255, 0.85);
		background: rgba(0, 0, 0, 0.25);
		color: #fff;
		display: grid;
		place-items: center;
		padding: 0;
		cursor: pointer;
	}
	.mv-select-dot.on {
		background: var(--accent, #c485fe);
		border-color: var(--accent, #c485fe);
		color: #1a1024;
	}
	.mv-tile-del {
		position: absolute;
		top: 8px;
		right: 8px;
		width: 26px;
		height: 26px;
		border-radius: 8px;
		border: 0;
		background: rgba(0, 0, 0, 0.45);
		color: #fff;
		display: grid;
		place-items: center;
		opacity: 0;
		cursor: pointer;
	}
	.mv-tile:hover .mv-tile-del {
		opacity: 1;
	}
	.mv-tile-pending {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: #a1a1aa;
		font-size: 12px;
		padding: 12px;
		text-align: center;
	}
	.mv-spin {
		width: 18px;
		height: 18px;
		border: 2px solid rgba(255, 255, 255, 0.2);
		border-top-color: #fff;
		border-radius: 999px;
		animation: mv-spin 0.8s linear infinite;
	}
	@keyframes mv-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
