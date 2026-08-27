<script lang="ts">
	import { tick } from 'svelte';
	import { _ } from 'svelte-i18n';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Square from '@lucide/svelte/icons/square';
	import X from '@lucide/svelte/icons/x';
	import Plus from '@lucide/svelte/icons/plus';
	import ImagePlus from '@lucide/svelte/icons/image-plus';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Film from '@lucide/svelte/icons/film';
	import PromptHistoryDrawer from '$lib/components/PromptHistoryDrawer.svelte';
	import {
		CHAT_VIDEO_ACCEPT,
		downscaleImageFile,
		isChatVideoFile,
		uploadChatVideo
	} from '$lib/chat-attachments';
	import { RASTER_IMAGE_ACCEPT, isRasterImageSource } from '$lib/raster-image';
	import type {
		ComposerMenu,
		GridItem,
		MotionAspectRatio,
		MotionDurationPreset,
		MotionMp4Quality,
		PickedAd,
		PromptHistoryEntry
	} from './motion-video-model';
	import { MAX_ADS, MAX_UPLOADS } from './motion-video-model';
	import MotionVideoSettings from './MotionVideoSettings.svelte';

	interface Props {
		loading: boolean;
		can4k: boolean;
		brandSlug: string;
		prefKey: string;
		selectedIds: string[];
		selectedItems: GridItem[];
		remakeAspects: MotionAspectRatio[];
		history: PromptHistoryEntry[];
		onSend: () => void;
		onStop: () => void;
		onToggleSelect: (id: string) => void;
		onClearSelection: () => void;
		onRemake: (aspect: MotionAspectRatio) => void;
		onError: (message: string) => void;
		input?: string;
		menu?: ComposerMenu;
		uploads?: string[];
		pickedAds?: PickedAd[];
		videoRefs?: string[];
		historyOpen?: boolean;
		aspect?: MotionAspectRatio;
		duration?: MotionDurationPreset;
		quality?: MotionMp4Quality;
	}

	let {
		loading,
		can4k,
		brandSlug,
		prefKey,
		selectedIds,
		selectedItems,
		remakeAspects,
		history,
		onSend,
		onStop,
		onToggleSelect,
		onClearSelection,
		onRemake,
		onError,
		input = $bindable(''),
		menu = $bindable<ComposerMenu>('none'),
		uploads = $bindable<string[]>([]),
		pickedAds = $bindable<PickedAd[]>([]),
		videoRefs = $bindable<string[]>([]),
		historyOpen = $bindable(false),
		aspect = $bindable<MotionAspectRatio>('1:1'),
		duration = $bindable<MotionDurationPreset>('auto'),
		quality = $bindable<MotionMp4Quality>('2k')
	}: Props = $props();

	let composerRoot = $state<HTMLFormElement | undefined>(undefined);
	let inputEl = $state<HTMLTextAreaElement | undefined>(undefined);
	let fileEl: HTMLInputElement | null = $state(null);
	let storedAds = $state<PickedAd[] | null>(null);
	let adsLoading = $state(false);

	const canSend = $derived(
		!loading &&
			(!!input.trim() || uploads.length > 0 || pickedAds.length > 0 || videoRefs.length > 0)
	);
	const historyDrawerEntries = $derived(
		history.map((entry) => ({
			id: entry.id,
			prompt: entry.prompt,
			at: entry.at,
			meta:
				entry.selectedCount > 0
					? $_('app.motionVideo.historySelected', { values: { n: entry.selectedCount } })
					: undefined
		}))
	);

	$effect(() => {
		const closeMenus = (e: MouseEvent) => {
			if (!composerRoot?.contains(e.target as Node)) menu = 'none';
		};
		document.addEventListener('mousedown', closeMenus);
		return () => document.removeEventListener('mousedown', closeMenus);
	});

	function reusePrompt(entry: PromptHistoryEntry) {
		input = entry.prompt;
		historyOpen = false;
		void tick().then(() => inputEl?.focus());
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			onSend();
		}
	}

	async function onPickFiles(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		const files = Array.from(el.files ?? []).filter(
			(f) => isRasterImageSource({ mime: f.type, filename: f.name }) || isChatVideoFile(f)
		);
		el.value = '';
		menu = 'none';
		for (const f of files.slice(0, MAX_UPLOADS - uploads.length)) {
			try {
				// A reference clip goes to Storage; its URL rides in the prompt, where the agent
				// attaches it as a real file part the model can actually watch.
				if (isChatVideoFile(f)) {
					videoRefs = [...videoRefs, await uploadChatVideo(f, brandSlug)];
				} else {
					uploads = [...uploads, await downscaleImageFile(f)];
				}
			} catch (err) {
				onError(
					(err as Error)?.message === 'video_too_large'
						? $_('chat.attach.videoTooLarge')
						: $_('chat.attach.uploadFailed')
				);
			}
		}
	}

	async function openAdsPicker() {
		menu = 'ads';
		if (storedAds) return;
		adsLoading = true;
		try {
			const res = await fetch(`/app/${brandSlug}/media-refs`);
			if (res.ok) {
				const json = (await res.json()) as { ads?: PickedAd[] };
				storedAds = Array.isArray(json.ads) ? json.ads : [];
			} else {
				storedAds = [];
			}
		} catch {
			storedAds = [];
		} finally {
			adsLoading = false;
		}
	}

	function toggleAd(ad: PickedAd) {
		const idx = pickedAds.findIndex((a) => a.id === ad.id);
		if (idx >= 0) {
			pickedAds = pickedAds.filter((_, i) => i !== idx);
			return;
		}
		if (pickedAds.length >= MAX_ADS) return;
		pickedAds = [...pickedAds, ad];
	}
</script>

<form
	bind:this={composerRoot}
	class="ch-shell"
	onsubmit={(e) => {
		e.preventDefault();
		onSend();
	}}
>
	<div class="ch-box">
		{#if selectedItems.length || uploads.length || pickedAds.length || videoRefs.length}
			<div class="mv-ref-strip">
				{#each selectedItems as s (s.id)}
					<div class="mv-ref-chip">
						{#if s.preview_url}
							<video src={s.preview_url} muted playsinline></video>
						{:else}
							<span class="mv-ref-fallback"><Film size={14} /></span>
						{/if}
						<span class="mv-ref-label">{s.title}</span>
						<button type="button" class="mv-ref-x" onclick={() => onToggleSelect(s.id)}>
							<X size={12} />
						</button>
					</div>
				{/each}
				{#each videoRefs as url, i (`vid-${i}`)}
					<div class="mv-ref-chip">
						<video src={url} muted playsinline></video>
						<span class="mv-ref-label">{$_('app.motionVideo.referenceClip')}</span>
						<button
							type="button"
							class="mv-ref-x"
							onclick={() => (videoRefs = videoRefs.filter((_, j) => j !== i))}
							aria-label={$_('chat.attach.remove')}
						>
							<X size={12} />
						</button>
					</div>
				{/each}
				{#each uploads as url, i (`up-${i}`)}
					<div class="mv-ref-chip">
						<img src={url} alt="" />
						<button
							type="button"
							class="mv-ref-x"
							aria-label={$_('chat.attach.remove')}
							onclick={() => (uploads = uploads.filter((_, idx) => idx !== i))}
						>
							<X size={12} />
						</button>
					</div>
				{/each}
				{#each pickedAds as ad (ad.id)}
					<div class="mv-ref-chip">
						<img src={ad.thumbnailUrl} alt={ad.pageName} />
						<span class="mv-ref-label">{ad.pageName}</span>
						<button
							type="button"
							class="mv-ref-x"
							aria-label={$_('chat.attach.remove')}
							onclick={() => (pickedAds = pickedAds.filter((a) => a.id !== ad.id))}
						>
							<X size={12} />
						</button>
					</div>
				{/each}
				{#if selectedItems.length}
					<button type="button" class="mv-clear-refs" onclick={onClearSelection}>
						{$_('app.motionVideo.clearSelection')}
					</button>
				{/if}
			</div>
		{/if}

		{#if remakeAspects.length}
			<div class="mv-remake-row">
				{#each remakeAspects as a}
					<button
						type="button"
						class="mv-remake-btn"
						disabled={loading}
						onclick={() => onRemake(a)}
					>
						{$_('app.motionVideo.remakeIn', { values: { aspect: a } })}
					</button>
				{/each}
			</div>
		{/if}

		<div class="ch-body">
			<textarea
				class="ch-input"
				bind:this={inputEl}
				bind:value={input}
				placeholder={selectedIds.length
					? $_('app.motionVideo.placeholderEdit')
					: $_('app.motionVideo.placeholder')}
				rows="1"
				disabled={loading}
				onkeydown={onKeydown}
			></textarea>

			<div class="ch-left">
				<input
					bind:this={fileEl}
					type="file"
					accept={`${RASTER_IMAGE_ACCEPT},${CHAT_VIDEO_ACCEPT}`}
					multiple
					hidden
					onchange={onPickFiles}
				/>
				<div class="ch-menu-wrap">
					<button
						type="button"
						class="ch-tool"
						class:on={menu === 'plus' || menu === 'ads'}
						onclick={() => (menu = menu === 'plus' ? 'none' : 'plus')}
						disabled={loading}
						aria-label={$_('chat.attach.add')}
						title={$_('chat.attach.add')}
					>
						<Plus size={16} strokeWidth={2.2} />
					</button>

					{#if menu === 'plus'}
						<div class="ch-dropdown">
							<button
								type="button"
								class="ch-dd-item"
								onclick={() => fileEl?.click()}
								disabled={uploads.length >= MAX_UPLOADS}
							>
								<ImagePlus class="size-4" />
								<span>{$_('chat.attach.photo')}</span>
							</button>
							<button type="button" class="ch-dd-item" onclick={() => void openAdsPicker()}>
								<Megaphone class="size-4" />
								<span>{$_('app.motionVideo.attachAds')}</span>
							</button>
						</div>
					{/if}

					{#if menu === 'ads'}
						<div class="ch-picker ch-picker-wide">
							<button type="button" class="ch-dd-back" onclick={() => (menu = 'plus')}>
								← {$_('app.motionVideo.attachAds')}
							</button>
							{#if adsLoading}
								<div class="ch-empty">{$_('chat.attach.loading')}</div>
							{:else if storedAds?.length}
								<div class="ch-grid">
									{#each storedAds as ad (ad.id)}
										<button
											type="button"
											class="ch-cell"
											class:on={pickedAds.some((a) => a.id === ad.id)}
											style={`background-image:url(${ad.thumbnailUrl})`}
											title={ad.pageName}
											onclick={() => toggleAd(ad)}
										></button>
									{/each}
								</div>
							{:else}
								<div class="ch-empty">
									{$_('app.motionVideo.attachAdsEmpty')}
									<a class="mv-ads-link" href={`/app/${brandSlug}/ads/library`}>
										{$_('app.motionVideo.attachAdsEmptyLink')}
									</a>
								</div>
							{/if}
						</div>
					{/if}
				</div>
				<MotionVideoSettings
					{loading}
					{can4k}
					{brandSlug}
					{prefKey}
					bind:menu
					bind:aspect
					bind:duration
					bind:quality
				/>
				{#if selectedIds.length}
					<span class="mv-selected-count"
						>{$_('app.motionVideo.selected', { values: { n: selectedIds.length } })}</span
					>
				{/if}
			</div>
			<div class="ch-right">
				{#if loading}
					<button type="button" class="ch-send ch-stop" onclick={onStop} aria-label={$_('chat.stop')}>
						<Square size={14} fill="currentColor" />
					</button>
				{:else}
					<button type="submit" class="ch-send" disabled={!canSend} aria-label="Send">
						<ArrowUp size={17} strokeWidth={2.2} />
					</button>
				{/if}
			</div>
		</div>
	</div>
</form>

<PromptHistoryDrawer
	open={historyOpen}
	title={$_('app.motionVideo.historyTitle')}
	empty={$_('app.motionVideo.historyEmpty')}
	reuseLabel={$_('app.motionVideo.reusePrompt')}
	entries={historyDrawerEntries}
	onclose={() => (historyOpen = false)}
	onreuse={(row) => {
		const entry = history.find((h) => h.id === row.id);
		if (entry) reusePrompt(entry);
		else {
			input = row.prompt;
			historyOpen = false;
			void tick().then(() => inputEl?.focus());
		}
	}}
/>

<style>
	.ch-shell {
		max-width: none;
		width: 100%;
		margin: 0 auto;
	}
	.ch-box {
		position: relative;
		background: color-mix(in srgb, var(--paper) 94%, transparent);
		border: 1px solid var(--line);
		border-radius: 22px;
		padding: 12px 14px 10px;
		box-shadow: 0 6px 28px rgba(0, 0, 0, 0.1);
		backdrop-filter: blur(14px);
		transition: border-color 0.15s ease;
	}
	.ch-box:focus-within {
		border-color: var(--accent);
	}
	.ch-body {
		display: grid;
		grid-template-columns: 1fr auto;
		grid-template-areas:
			'input input'
			'left send';
		column-gap: 8px;
		row-gap: 8px;
		align-items: end;
	}
	.ch-input {
		grid-area: input;
		width: 100%;
		border: none;
		outline: none;
		resize: none;
		background: none;
		font: inherit;
		font-size: 14.5px;
		line-height: 1.5;
		color: var(--ink);
		min-height: 44px;
		max-height: 200px;
		box-sizing: border-box;
		padding: 0;
	}
	.ch-input::placeholder {
		color: var(--ink-faint);
	}
	.ch-left {
		grid-area: left;
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		min-height: 36px;
		flex-wrap: wrap;
	}
	.ch-menu-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.ch-tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 32px;
		min-width: 32px;
		padding: 0 8px;
		border: none;
		border-radius: 10px;
		background: transparent;
		color: var(--ink-soft);
		cursor: pointer;
	}
	.ch-tool:hover:not(:disabled) {
		background: var(--paper-2);
		color: var(--ink);
	}
	.ch-tool.on {
		background: var(--paper-2);
		color: var(--accent);
	}
	.ch-tool:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.ch-dropdown {
		position: absolute;
		left: 0;
		bottom: calc(100% + 8px);
		z-index: 40;
		min-width: 240px;
		max-width: min(320px, 80vw);
		padding: 6px;
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 14px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
	}
	.ch-dd-back {
		display: block;
		width: 100%;
		padding: 8px 10px;
		margin-bottom: 4px;
		border: none;
		border-radius: 10px;
		background: transparent;
		color: var(--ink-soft);
		font-size: 12px;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}
	.ch-dd-back:hover {
		background: var(--paper-2);
		color: var(--ink);
	}
	.ch-dd-item {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 9px 10px;
		border: none;
		border-radius: 10px;
		background: transparent;
		color: var(--ink);
		font-size: 13px;
		text-align: left;
		cursor: pointer;
	}
	.ch-dd-item:hover {
		background: var(--paper-2);
	}
	.ch-dd-item:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.ch-dd-item :global(svg) {
		flex-shrink: 0;
		color: var(--ink-soft);
	}
	.ch-picker {
		position: absolute;
		left: 0;
		bottom: calc(100% + 8px);
		z-index: 40;
		width: min(300px, 80vw);
		max-height: 280px;
		overflow-y: auto;
		padding: 10px;
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 14px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
	}
	.ch-picker-wide {
		width: min(360px, 92vw);
		max-height: 420px;
	}
	.ch-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 6px;
	}
	.ch-cell {
		aspect-ratio: 1;
		border-radius: 8px;
		border: 2px solid transparent;
		background-size: cover;
		background-position: center;
		cursor: pointer;
		padding: 0;
	}
	.ch-cell.on {
		border-color: var(--accent);
	}
	.ch-empty {
		font-size: 12.5px;
		color: var(--ink-soft);
		padding: 12px 4px;
		line-height: 1.4;
	}
	.mv-ads-link {
		display: inline-block;
		margin-top: 8px;
		color: var(--accent);
		text-decoration: none;
		font-weight: 600;
	}
	.mv-ads-link:hover {
		text-decoration: underline;
	}
	.ch-right {
		grid-area: send;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-shrink: 0;
	}
	.mv-selected-count {
		font-size: 12px;
		color: var(--ink-faint);
	}
	.ch-send {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: none;
		background: var(--accent);
		color: #fff;
		display: grid;
		place-items: center;
		cursor: pointer;
		transition: transform 0.12s ease;
	}
	.ch-send:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.ch-send:not(:disabled):hover {
		transform: scale(1.05);
	}
	.ch-send.ch-stop {
		background: #ef4444;
	}
	.mv-ref-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
		margin-bottom: 10px;
	}
	.mv-ref-chip {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 6px 4px 4px;
		border-radius: 10px;
		background: var(--paper-2);
		border: 1px solid var(--line);
		color: var(--ink);
		font-size: 12px;
		max-width: 180px;
	}
	.mv-ref-chip video,
	.mv-ref-chip img,
	.mv-ref-fallback {
		width: 28px;
		height: 28px;
		border-radius: 6px;
		object-fit: cover;
		background: #18181b;
		display: grid;
		place-items: center;
		color: #a1a1aa;
		flex-shrink: 0;
	}
	.mv-ref-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mv-ref-x {
		border: 0;
		background: transparent;
		padding: 2px;
		cursor: pointer;
		color: var(--ink-soft);
	}
	.mv-clear-refs {
		border: 0;
		background: transparent;
		font-size: 12px;
		color: var(--ink-faint);
		cursor: pointer;
		text-decoration: underline;
	}
	.mv-remake-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 10px;
	}
	.mv-remake-btn {
		border: 1px solid var(--line);
		background: var(--paper-2);
		color: var(--ink);
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		padding: 6px 10px;
		border-radius: 999px;
		cursor: pointer;
	}
	.mv-remake-btn:hover:not(:disabled) {
		border-color: var(--ink-soft);
	}
	.mv-remake-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
