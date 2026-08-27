<script lang="ts">
	import { nearBottom } from '$lib/chat-scroll';
	import { _ } from 'svelte-i18n';
	import ChatLiveStatus from '$lib/components/ChatLiveStatus.svelte';
	import X from '@lucide/svelte/icons/x';
	import type { StreamToolCallState } from '$lib/chat-stream-events';

	interface Props {
		running: boolean;
		minimized: boolean;
		loading: boolean;
		streamBuf: string;
		streamToolCalls: StreamToolCallState[];
		streamReasoning: string;
		onDismiss: () => void;
		onClose: () => void;
		onExpand: () => void;
	}

	let {
		running,
		minimized,
		loading,
		streamBuf,
		streamToolCalls,
		streamReasoning,
		onDismiss,
		onClose,
		onExpand
	}: Props = $props();

	let overlayEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		streamBuf;
		streamToolCalls;
		streamReasoning;
		// Come nel Media Generator: si insegue il fondo solo se l'utente è già lì.
		const el = overlayEl;
		if (el && nearBottom(el)) el.scrollTo({ top: el.scrollHeight });
	});

	/** Last line the run emitted — what the collapsed snippet shows. */
	const liveHeadline = $derived(
		(streamBuf || streamReasoning || '').split('\n').filter(Boolean).at(-1) ||
			streamToolCalls.at(-1)?.toolName ||
			$_('app.motionVideo.rendering')
	);
</script>

{#if running && minimized}
	<button type="button" class="mv-snippet" onclick={onExpand}>
		{#if loading}<span class="mv-spin"></span>{/if}
		<span class="mv-snippet-text">{liveHeadline}</span>
	</button>
{:else if running}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="mv-overlay"
		aria-live="polite"
		onclick={onDismiss}
	>
		<div
			class="mv-overlay-panel"
			role="dialog"
			aria-modal="true"
			aria-label={$_('app.hub.designer.motionVideo')}
			onclick={(e) => e.stopPropagation()}
		>
			<button
				type="button"
				class="mv-overlay-close"
				onclick={onClose}
				aria-label={$_('app.motionVideo.closeLive')}
			>
				<X size={16} strokeWidth={2.2} />
			</button>
			<div class="mv-overlay-body" bind:this={overlayEl}>
				<ChatLiveStatus
					{loading}
					{streamBuf}
					{streamToolCalls}
					{streamReasoning}
					compact
				/>
			</div>
		</div>
	</div>
{/if}

<style>
	.mv-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding: 16px 12px calc(var(--mv-composer-clearance, 200px) + 12px);
		box-sizing: border-box;
		z-index: 5;
		cursor: pointer;
		background: color-mix(in srgb, var(--paper) 28%, transparent);
	}
	.mv-overlay-panel {
		pointer-events: auto;
		cursor: default;
		position: relative;
		display: flex;
		flex-direction: column;
		width: min(520px, 100%);
		max-height: 100%;
		overflow: hidden;
		border-radius: 14px;
		background: color-mix(in srgb, var(--paper) 88%, transparent);
		border: 1px solid var(--line);
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
		padding: 8px 8px 12px 12px;
		backdrop-filter: blur(10px);
	}
	.mv-overlay-body {
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		-webkit-overflow-scrolling: touch;
		padding-right: 28px;
	}
	.mv-overlay-close {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 1;
		width: 28px;
		height: 28px;
		border: 0;
		border-radius: 8px;
		background: color-mix(in srgb, var(--paper) 80%, transparent);
		color: var(--ink-soft, #6e6e73);
		display: grid;
		place-items: center;
		cursor: pointer;
	}
	.mv-overlay-close:hover {
		background: var(--paper-2, rgba(0, 0, 0, 0.06));
		color: var(--ink, #1d1d1f);
	}
	.mv-snippet {
		position: fixed;
		left: 16px;
		bottom: 16px;
		z-index: 40;
		max-width: min(420px, calc(100vw - 32px));
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		border-radius: 999px;
		border: 1px solid var(--line, rgba(0, 0, 0, 0.1));
		background: var(--paper, #fff);
		color: var(--ink, #18181b);
		font-size: 13px;
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
		cursor: pointer;
	}
	.mv-snippet-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
