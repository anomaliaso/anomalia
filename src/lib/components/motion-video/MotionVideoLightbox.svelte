<script lang="ts">
	import VideoReviewPanel from '$lib/components/VideoReviewPanel.svelte';
	import X from '@lucide/svelte/icons/x';
	import type { GridItem } from './motion-video-model';

	interface Props {
		item: GridItem;
		brandSlug: string;
		onClose: () => void;
	}

	let { item, brandSlug, onClose }: Props = $props();

	function portalLightbox(node: HTMLElement) {
		document.body.appendChild(node);
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return {
			destroy() {
				document.body.style.overflow = prev;
				node.remove();
			}
		};
	}
</script>

{#if item.preview_url}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="mv-lightbox"
		role="dialog"
		aria-modal="true"
		aria-label={item.title}
		use:portalLightbox
		onclick={onClose}
	>
		<button
			type="button"
			class="mv-lightbox-close"
			onclick={(e) => {
				e.stopPropagation();
				onClose();
			}}
			aria-label="Close"
		>
			<X size={20} strokeWidth={2.2} />
		</button>
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			src={item.preview_url}
			controls
			autoplay
			playsinline
			onclick={(e) => e.stopPropagation()}
		></video>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="mv-lightbox-review" onclick={(e) => e.stopPropagation()}>
			<VideoReviewPanel
				url={item.preview_url}
				brandSlug={brandSlug}
				defaultStandard="ads"
				caption={item.title}
			/>
		</div>
	</div>
{/if}

<style>
	.mv-lightbox {
		position: fixed;
		inset: 0;
		z-index: 10050;
		background: rgba(0, 0, 0, 0.78);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		padding: max(56px, calc(env(safe-area-inset-top, 0px) + 52px))
			max(24px, env(safe-area-inset-right, 0px)) max(24px, env(safe-area-inset-bottom, 0px));
		overflow: auto;
	}
	.mv-lightbox-close {
		position: absolute;
		top: max(12px, env(safe-area-inset-top, 0px));
		right: max(12px, env(safe-area-inset-right, 0px));
		width: 40px;
		height: 40px;
		border: 0;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.12);
		color: #fff;
		display: grid;
		place-items: center;
		cursor: pointer;
	}
	.mv-lightbox video {
		max-width: min(900px, 100%);
		max-height: min(70vh, calc(100dvh - 96px));
		border-radius: 12px;
		background: #000;
	}
	.mv-lightbox-review {
		width: min(900px, 100%);
		max-height: min(40vh, 360px);
		overflow: auto;
		border-radius: 12px;
		background: var(--paper);
	}
</style>
