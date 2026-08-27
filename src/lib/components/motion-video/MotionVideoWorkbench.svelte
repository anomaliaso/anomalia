<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { _ } from 'svelte-i18n';
	import { invalidateAll } from '$app/navigation';
	import PageHead from '$lib/components/PageHead.svelte';
	import UpgradeLink from '$lib/components/UpgradeLink.svelte';
	import PromptHistoryButton from '$lib/components/PromptHistoryButton.svelte';
	import {
		applyChatStreamEvent,
		emptyStreamState,
		readSseEvents,
		type ChatStreamState,
		type StreamToolCallState
	} from '$lib/chat-stream-events';
	import { compileMotionSource } from '$lib/motion-video/compile';
	import { parseMotionToolHits, type MotionSourceHit } from '$lib/motion-video/tool-output';
	import {
		motionAspectFromSize,
		motionRemakeTitle,
		motionSizeForAspect,
		otherMotionAspects,
		type MotionVideoListItem,
		type MotionVideoRow
	} from '$lib/motion-video/source';
	import { hasMotionVideo4k } from '$lib/plans';
	import { followDesignerJobChain } from '$lib/designer-job-follow';
	import MotionVideoGrid from './MotionVideoGrid.svelte';
	import MotionVideoLiveOverlay from './MotionVideoLiveOverlay.svelte';
	import MotionVideoLightbox from './MotionVideoLightbox.svelte';
	import MotionVideoComposer from './MotionVideoComposer.svelte';
	import type {
		ComposerMenu,
		GridItem,
		MotionAspectRatio,
		MotionDurationPreset,
		MotionMp4Quality,
		PickedAd,
		PromptHistoryEntry
	} from './motion-video-model';
	import { fetchVideo, isAbortError, renderSignal } from './motion-video-model';

	let {
		brandSlug,
		brandName,
		videos: initialVideos,
		prompts: initialPrompts = [],
		apiBase,
		brandPlan = null
	}: Props = $props();

	interface Props {
		brandSlug: string;
		brandName: string;
		videos: MotionVideoListItem[];
		prompts?: Array<{
			id: string;
			prompt: string;
			selected_count: number;
			created_at: string;
		}>;
		apiBase: string;
		brandPlan?: string | null;
	}

	let items = $state<GridItem[]>(initialVideos);
	let selectedIds = $state<string[]>([]);
	let history = $state<PromptHistoryEntry[]>([]);
	let historyOpen = $state(false);
	let input = $state('');
	let loading = $state(false);
	let errorMsg = $state<string | null>(null);
	/** Crediti finiti: il messaggio dice "upgrade" ma non c'era niente da cliccare. */
	let errorExhausted = $state(false);
	let streamBuf = $state('');
	let streamToolCalls = $state<StreamToolCallState[]>([]);
	let streamReasoning = $state('');
	let abort: AbortController | null = null;
	/** Hide the live panel; an in-flight MP4 encode may still finish on the tile. */
	let liveDismissed = $state(false);
	let liveMinimized = $state(false);
	/** Reference clips uploaded this turn — public Storage URLs. */
	let videoRefs = $state<string[]>([]);
	/** Bumped to drop an in-flight send() (Stop, a newer prompt, or dismiss while streaming). */
	let runId = 0;
	/** True while the SSE reader is open — closing the panel then also cancels the turn. */
	let streamOpen = false;
	let composerEl: HTMLDivElement | null = $state(null);
	let composerClearance = $state(200);
	let lightbox: GridItem | null = $state(null);
	let menu = $state<ComposerMenu>('none');
	let aspect = $state<MotionAspectRatio>('1:1');
	let duration = $state<MotionDurationPreset>('auto');
	let quality = $state<MotionMp4Quality>('2k');
	const prefKey = $derived(`mv-prefs:${brandSlug}`);
	const can4k = $derived(hasMotionVideo4k(brandPlan));
	let uploads = $state<string[]>([]);
	let pickedAds = $state<PickedAd[]>([]);

	$effect(() => {
		const incoming = initialVideos;
		const renderingIds = untrack(
			() => new Set(items.filter((i) => i.rendering && !i.preview_url).map((i) => i.id))
		);
		items = incoming.map((v) => ({
			...v,
			rendering: renderingIds.has(v.id) && !v.preview_url
		}));
	});

	$effect(() => {
		history = initialPrompts.map((r) => ({
			id: r.id,
			prompt: r.prompt,
			at: new Date(r.created_at).getTime(),
			selectedCount: r.selected_count ?? 0
		}));
	});

	$effect(() => {
		if (!composerEl || typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(() => {
			composerClearance = Math.ceil(composerEl!.getBoundingClientRect().height) + 24;
		});
		ro.observe(composerEl);
		return () => ro.disconnect();
	});

	const liveRunning = $derived(
		!liveDismissed && (loading || !!streamBuf || streamToolCalls.length > 0 || !!streamReasoning)
	);
	const liveOpen = $derived(liveRunning && !liveMinimized);
	const selectedItems = $derived(items.filter((i) => selectedIds.includes(i.id)));
	const remakeAspects = $derived(
		selectedItems.length === 1
			? otherMotionAspects(motionAspectFromSize(selectedItems[0].width, selectedItems[0].height))
			: []
	);

	function toggleSelect(id: string) {
		if (selectedIds.includes(id)) {
			selectedIds = selectedIds.filter((x) => x !== id);
		} else if (selectedIds.length < 6) {
			selectedIds = [...selectedIds, id];
			const item = items.find((i) => i.id === id);
			if (item) aspect = motionAspectFromSize(item.width, item.height);
		}
	}

	function clearSelection() {
		selectedIds = [];
	}

	function clearLivePanel() {
		streamBuf = '';
		streamToolCalls = [];
		streamReasoning = '';
		liveDismissed = true;
		liveMinimized = false;
	}

	/**
	 * Clicking the backdrop used to cancel the turn — losing minutes of work for anyone who just
	 * wanted the grid back. A run in flight collapses to the snippet instead; only Stop cancels.
	 */
	function dismissLive() {
		if (loading) {
			liveMinimized = true;
			return;
		}
		closeLive();
	}

	/** Actually end the panel (and the turn behind it). */
	function closeLive() {
		if (streamOpen) runId += 1;
		abort?.abort();
		loading = false;
		clearLivePanel();
	}

	/** Stop the request and hide the panel, including any follow-up persist/render. */
	function stop() {
		runId += 1;
		abort?.abort();
		loading = false;
		clearLivePanel();
	}

	type SourceHit = MotionSourceHit;

	async function remakeIn(target: MotionAspectRatio) {
		if (loading || selectedItems.length !== 1) return;
		const item = selectedItems[0];
		loading = true;
		errorMsg = null;
		errorExhausted = false;
		let startedSend = false;
		try {
			const full = await fetchVideo(apiBase, item.id);
			if (!full?.source) {
				errorMsg = $_('app.motionVideo.chatError');
				return;
			}
			const size = motionSizeForAspect(target);
			const title = motionRemakeTitle(full.title, target);
			const saveRes = await fetch(apiBase, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'save',
					id: null,
					title,
					source: full.source,
					fps: full.fps,
					durationInFrames: full.duration_in_frames,
					width: full.width,
					height: full.height,
					previewUrl: full.preview_url || null
				})
			});
			if (!saveRes.ok) {
				errorMsg = await saveRes.text();
				return;
			}
			const saved = (await saveRes.json()) as { video: MotionVideoRow };
			const row = saved.video;
			items = [
				{
					id: row.id,
					title: row.title,
					preview_url: row.preview_url,
					fps: row.fps,
					duration_in_frames: row.duration_in_frames,
					width: row.width,
					height: row.height,
					updated_at: row.updated_at,
					created_at: row.created_at
				},
				...items.filter((i) => i.id !== row.id)
			];
			selectedIds = [row.id];
			aspect = target;
			startedSend = true;
			await send({
				prompt: $_('app.motionVideo.remakePrompt', {
					values: { aspect: target, width: size.width, height: size.height }
				}),
				selectedIds: [row.id],
				aspectRatio: target,
				reflowAspect: true,
				duration: 'auto',
				omitAttachments: true,
				resumeLoading: true
			});
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : $_('app.motionVideo.chatError');
		} finally {
			if (!startedSend) loading = false;
		}
	}

	async function persistAndRender(opts: {
		id?: string | null;
		title: string;
		source: string;
		isStale?: () => boolean;
	}): Promise<MotionVideoRow | null> {
		if (opts.isStale?.()) return null;
		let compiled;
		try {
			compiled = compileMotionSource(opts.source);
		} catch (e) {
			if (opts.isStale?.()) return null;
			errorMsg = e instanceof Error ? e.message : $_('app.motionVideo.compileFailed');
			return null;
		}

		const saveRes = await fetch(apiBase, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				action: 'save',
				id: opts.id ?? null,
				title: opts.title,
				source: opts.source,
				fps: compiled.fps,
				durationInFrames: compiled.durationInFrames,
				width: compiled.width,
				height: compiled.height
			})
		});
		if (opts.isStale?.()) return null;
		if (!saveRes.ok) {
			errorMsg = await saveRes.text();
			return null;
		}
		const saved = (await saveRes.json()) as { video: MotionVideoRow };
		const row = saved.video;

		// Optimistic tile while encoding
		items = [
			{
				id: row.id,
				title: row.title,
				preview_url: row.preview_url,
				fps: row.fps,
				duration_in_frames: row.duration_in_frames,
				width: row.width,
				height: row.height,
				updated_at: row.updated_at,
				created_at: row.created_at,
				rendering: true
			},
			...items.filter((i) => i.id !== row.id)
		];

		try {
			const wantedQuality = can4k && quality === '4k' ? '4k' : '2k';

			/**
			 * L'MP4 lo rende SEMPRE il server, mai più questo browser.
			 *
			 * Prima ci si andava solo quando la composizione aveva audio, perché l'encoder del
			 * browser scarta i `<Audio>` remoti e il file usciva muto. Ma quell'encoder è anche il
			 * motivo per cui la scheda si chiudeva: comprime un video 1080 sovracampionato mentre
			 * la stessa pagina tiene in memoria l'audio decodificato del Player. Spostarlo di là
			 * toglie il carico dal browser E lascia l'audio alla sua qualità piena, invece di
			 * degradarlo per farlo stare in una scheda.
			 *
			 * Costa: ogni render è una VM e dei crediti, anche per un video muto che prima usciva
			 * gratis. È il prezzo di un file che esce sempre uguale, con il suono che deve avere,
			 * su qualunque macchina lo si chieda.
			 */
			// Il segnale porta due cose insieme: il tetto oltre il quale la funzione è persa (o la
			// tessera girerebbe per sempre) e lo Stop dell'utente.
			const sig = renderSignal(abort?.signal);
			let res: Response;
			try {
				res = await fetch(`${apiBase}/render`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ source: opts.source, videoId: row.id, quality: wantedQuality }),
					signal: sig.signal
				});
			} finally {
				sig.done();
			}
			// Crediti finiti e deployment senza VM sono due "non si può", non due errori grezzi:
			// prima arrivavano in pagina come testo del server, in inglese.
			if (res.status === 402 || res.status === 503) {
				items = items.map((i) => (i.id === row.id ? { ...i, rendering: false } : i));
				if (!opts.isStale?.()) {
					errorExhausted = res.status === 402;
					errorMsg = $_(
						res.status === 402
							? 'app.motionVideo.creditsExhausted'
							: 'app.motionVideo.renderUnavailable'
					);
				}
				return row;
			}
			if (!res.ok) throw new Error(await res.text());
			const out = (await res.json()) as { url: string };
			if (opts.isStale?.()) {
				items = items.map((i) => (i.id === row.id ? { ...i, rendering: false } : i));
				return row;
			}
			items = items.map((i) =>
				i.id === row.id ? { ...i, preview_url: out.url, rendering: false } : i
			);
			return { ...row, preview_url: out.url };
		} catch (e) {
			items = items.map((i) => (i.id === row.id ? { ...i, rendering: false } : i));
			if (opts.isStale?.() || isAbortError(e)) return row;
			errorMsg = e instanceof Error ? e.message : $_('app.motionVideo.renderFailed');
			return row;
		}
	}

	async function qcAndApply(id: string, rewritten: string[] = [], attempt = 0) {
		streamBuf = $_('app.motionVideo.reviewing');
		streamToolCalls = [];
		streamReasoning = '';
		const res = await fetch(apiBase, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'qc', id, apply: true, rewritten }),
			signal: abort?.signal
		});
		if (!res.ok) {
			console.warn('[motion-video] qc http', res.status);
			return;
		}
		const json = (await res.json()) as {
			ok?: boolean;
			applied?: boolean;
			craft?: { overall: number; verdict: string } | null;
			review?: { overall: number; verdict: string } | null;
			rewrite_from?: 'craft' | 'ads';
			id?: string;
			title?: string;
			source?: string;
			error?: string;
		};
		if (json.craft && json.review) {
			streamBuf = $_('app.motionVideo.qcScoreDual', {
				values: {
					craft: json.craft.overall,
					craftVerdict: json.craft.verdict,
					ads: json.review.overall,
					adsVerdict: json.review.verdict
				}
			});
		} else if (json.craft) {
			streamBuf = $_('app.motionVideo.qcScoreCraft', {
				values: { overall: json.craft.overall, verdict: json.craft.verdict }
			});
		} else if (json.review) {
			streamBuf = $_('app.motionVideo.qcScore', {
				values: { overall: json.review.overall, verdict: json.review.verdict }
			});
		}
		if (json.error === 'credits_exhausted') {
			errorExhausted = true;
			errorMsg = $_('app.motionVideo.creditsExhausted');
			return;
		}
		if (json.error === 'qc_apply_noop' && attempt < 1) {
			await qcAndApply(id, rewritten, attempt + 1);
			return;
		}
		if (!json.applied || !json.source) return;
		// Three QC passes now: craft, reference fidelity, sellability. One rewrite each, at most.
		if (rewritten.length >= 3) return;
		streamBuf = $_('app.motionVideo.applyingQc');
		const current = items.find((i) => i.id === id);
		const rendered = await persistAndRender({
			id: json.id ?? id,
			title: json.title || current?.title || `${brandName} motion`,
			source: json.source
		});
		const nextId = rendered?.id ?? json.id ?? id;
		const from = json.rewrite_from;
		const nextRewritten = from && !rewritten.includes(from) ? [...rewritten, from] : rewritten;
		if (rendered?.preview_url) {
			streamBuf = $_('app.motionVideo.remakingQc');
			await qcAndApply(nextId, nextRewritten);
		}
	}

	async function persistRenderAndQc(opts: {
		id?: string | null;
		title: string;
		source: string;
		isStale?: () => boolean;
	}): Promise<MotionVideoRow | null> {
		const row = await persistAndRender(opts);
		if (!row?.preview_url || opts.isStale?.()) return row;
		await qcAndApply(row.id);
		const latest = items.find((i) => i.id === row.id);
		if (!latest?.preview_url) return row;
		return {
			...row,
			preview_url: latest.preview_url,
			title: latest.title,
			updated_at: latest.updated_at
		};
	}

	async function send(opts?: {
		prompt?: string;
		selectedIds?: string[];
		aspectRatio?: MotionAspectRatio;
		reflowAspect?: boolean;
		duration?: MotionDurationPreset;
		omitAttachments?: boolean;
		resumeLoading?: boolean;
	}) {
		const typed =
			(opts?.prompt ?? input).trim() ||
			(uploads.length || pickedAds.length || videoRefs.length
				? $_('app.motionVideo.attachDefaultPrompt')
				: '');
		// omitAttachments covers the internal re-sends (aspect remake, QC): those must not silently
		// re-attach a clip the user believes is spent.
		const clips = opts?.omitAttachments ? [] : videoRefs;
		const prompt = clips.length
			? `${typed}\n\n${$_('app.motionVideo.referenceClips')}\n${clips.join('\n')}`
			: typed;
		// The clip belongs to the turn that sent it. Clearing only on success left it attached to
		// every later send after a failed run, including ones that asked for no attachments.
		if (clips.length) videoRefs = [];
		if (!prompt || (loading && !opts?.resumeLoading)) return;

		const chatIds = opts?.selectedIds ?? selectedIds;
		const chatAspect =
			opts?.aspectRatio ??
			(chatIds[0]
				? motionAspectFromSize(
						items.find((i) => i.id === chatIds[0])?.width || 1080,
						items.find((i) => i.id === chatIds[0])?.height || 1080
					)
				: aspect);
		const reflowAspect = opts?.reflowAspect === true;
		const chatDuration = opts?.duration ?? duration;

		const payloadUploads = opts?.omitAttachments ? [] : [...uploads];
		const payloadAds = opts?.omitAttachments
			? []
			: pickedAds.map((a) => ({
					id: a.id,
					pageName: a.pageName,
					body: a.body,
					thumbnailUrl: a.thumbnailUrl,
					libraryUrl: a.libraryUrl
				}));

		const id = ++runId;
		const isStale = () => id !== runId;

		loading = true;
		liveDismissed = false;
		liveMinimized = false;
		streamOpen = true;
		errorMsg = null;
		errorExhausted = false;
		streamBuf = '';
		streamToolCalls = [];
		streamReasoning = '';
		input = '';
		menu = 'none';
		abort = new AbortController();

		history = [
			{
				id: crypto.randomUUID(),
				prompt,
				at: Date.now(),
				selectedCount: chatIds.length
			},
			...history
		].slice(0, 80);

		const hits: SourceHit[] = [];
		const titles = new Map<string, string>();
		const mutatedIds = new Set<string>();
		const beforeIds = new Set(items.map((i) => i.id));
		const state: ChatStreamState = emptyStreamState();
		let designerJobId: string | null = null;

		try {
			try {
			const res = await fetch(apiBase, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'chat',
					prompt,
					selectedIds: chatIds,
					aspectRatio: chatAspect,
					duration: chatDuration,
					reflowAspect,
					uploads: payloadUploads,
					ads: payloadAds
				}),
				signal: abort.signal
			});
			if (isStale()) return;
			if (!res.ok) {
				if (res.status === 402) throw new Error('credits_exhausted');
				throw new Error((await res.text()) || `HTTP ${res.status}`);
			}

			const promptIdFromServer = res.headers.get('X-Motion-Video-Prompt-Id');
			if (promptIdFromServer) {
				history = history.map((h, i) => (i === 0 ? { ...h, id: promptIdFromServer } : h));
			}
			designerJobId = res.headers.get('X-Designer-Job-Id');

			const reader = res.body!.getReader();
			const cancelReader = () => {
				void reader.cancel().catch(() => {});
			};
			abort.signal.addEventListener('abort', cancelReader, { once: true });
			if (abort.signal.aborted) {
				cancelReader();
				return;
			}
			const decoder = new TextDecoder();
			let sseBuf = '';

			while (true) {
				if (isStale()) {
					cancelReader();
					return;
				}
				const { done, value } = await reader.read();
				if (done) break;
				sseBuf += decoder.decode(value, { stream: true });
				const { events, rest } = readSseEvents(sseBuf);
				sseBuf = rest;
				for (const evt of events) {
					applyChatStreamEvent(state, evt);
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const e = evt as any;
					if (e?.type === 'tool-output-available' && e.output != null && e.preliminary !== true) {
						const toolName = String(
							e.toolName ??
								state.tools.find((t) => t.toolCallId === String(e.toolCallId ?? ''))?.toolName ??
								''
						);
						for (const hit of parseMotionToolHits(e.output, toolName)) {
							if (hit.title) {
								const key = hit.videoId ?? '__create__';
								titles.set(key, hit.title);
							}
							if (hit.source) hits.push(hit);
							if (hit.videoId) mutatedIds.add(hit.videoId);
						}
					}
				}
				streamBuf = state.text;
				streamToolCalls = state.tools;
				streamReasoning = state.reasoning;
				if (state.failed) throw new Error($_('app.motionVideo.chatError'));
			}
			} catch (e) {
				if ((e as Error)?.name === 'AbortError' || abort?.signal.aborted) throw e;
				if (!designerJobId) throw e;
				console.warn('[motion-video] live SSE dropped; following designer job', e);
			}

			if (designerJobId && abort && !abort.signal.aborted && !isStale()) {
				const followed = await followDesignerJobChain({
					brandSlug,
					jobId: designerJobId,
					seed: {
						text: state.text,
						tools: [...state.tools],
						reasoning: state.reasoning,
						failed: state.failed
					},
					signal: abort.signal,
					onState: (s) => {
						streamBuf = s.text;
						streamToolCalls = s.tools;
						streamReasoning = s.reasoning;
					},
					onMediaTick: () => void invalidateAll()
				});
				state.text = followed.state.text;
				state.tools = followed.state.tools;
				state.reasoning = followed.state.reasoning;
				streamBuf = state.text;
				streamToolCalls = state.tools;
				streamReasoning = state.reasoning;
			}

			streamOpen = false;
			if (isStale()) return;

			// Latest source per target (legacy tool output that still echoes TSX)
			const byKey = new Map<string, SourceHit>();
			for (const h of hits) {
				const key = h.videoId ?? (h.mode === 'edit' ? h.videoId : null) ?? '__create__';
				byKey.set(key, h);
			}

			const renderedIds = new Set<string>();
			for (const [key, hit] of byKey) {
				if (isStale()) return;
				if (!hit.source) continue;
				const title =
					titles.get(key) ||
					(hit.videoId ? titles.get(hit.videoId) : null) ||
					(hit.videoId ? items.find((i) => i.id === hit.videoId)?.title : null) ||
					hit.title ||
					`${brandName} motion`;
				const saved = await persistRenderAndQc({
					id: hit.videoId ?? null,
					title,
					source: hit.source,
					isStale
				});
				if (saved?.id) renderedIds.add(saved.id);
				else if (hit.videoId) renderedIds.add(hit.videoId);
			}

			if (isStale()) return;
			await invalidateAll().catch(() => {});
			await tick();
			if (isStale()) return;

			const idsToRender = new Set<string>(mutatedIds);
			for (const id of chatIds) idsToRender.add(id);
			for (const i of items) {
				if (!beforeIds.has(i.id)) idsToRender.add(i.id);
			}
			for (const h of byKey.values()) {
				if (h.videoId) idsToRender.add(h.videoId);
			}
			for (const rid of renderedIds) idsToRender.delete(rid);

			for (const videoId of idsToRender) {
				if (isStale()) return;
				const full = await fetchVideo(apiBase, videoId);
				if (!full?.source) continue;
				await persistRenderAndQc({
					id: full.id,
					title: full.title,
					source: full.source,
					isStale
				});
			}

			if (isStale()) return;
			const createdOrUpdated = items.some(
				(i) =>
					!beforeIds.has(i.id) ||
					mutatedIds.has(i.id) ||
					[...byKey.values()].some((h) => h.videoId === i.id)
			);
			if (byKey.size === 0 && mutatedIds.size === 0 && !createdOrUpdated) {
				errorMsg = $_('app.motionVideo.noOutput');
				console.warn('[motion-video] chat finished with no source', {
					tools: state.tools.map((t) => t.toolName),
					textLen: state.text.length
				});
			} else {
				uploads = [];
				pickedAds = [];
			}
		} catch (e) {
			if (!isAbortError(e) && !isStale()) {
				errorExhausted = e instanceof Error && e.message === 'credits_exhausted';
				errorMsg =
					e instanceof Error && e.message === 'credits_exhausted'
						? $_('app.motionVideo.creditsExhausted')
						: e instanceof Error
							? e.message
							: $_('app.motionVideo.chatError');
				console.error('[motion-video]', e);
			}
		} finally {
			streamOpen = false;
			if (id === runId) {
				abort = null;
				loading = false;
				streamToolCalls = [];
				streamReasoning = '';
				streamBuf = '';
			}
		}
	}

	async function removeItem(id: string) {
		const res = await fetch(apiBase, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'delete', id })
		});
		if (!res.ok) {
			errorMsg = await res.text();
			return;
		}
		items = items.filter((i) => i.id !== id);
		selectedIds = selectedIds.filter((x) => x !== id);
		if (lightbox?.id === id) lightbox = null;
	}

	function onWindowKey(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (lightbox) {
			e.preventDefault();
			lightbox = null;
			return;
		}
		if (liveOpen) {
			e.preventDefault();
			dismissLive();
		}
	}

	onDestroy(() => {
		runId += 1;
		abort?.abort();
	});
</script>

<svelte:window onkeydown={onWindowKey} />

<svelte:head>
	<title>Anomalia — {$_('app.hub.designer.motionVideo')}</title>
</svelte:head>

<div class="mv-page" style={`--mv-composer-clearance: ${composerClearance}px`}>
	<PageHead
		title={$_('app.hub.designer.motionVideo')}
		subtitle={$_('app.hub.overview.designer.motionVideoDesc')}
	>
		{#snippet actions()}
			<PromptHistoryButton
				label={$_('app.motionVideo.history')}
				onclick={() => (historyOpen = true)}
			/>
		{/snippet}
	</PageHead>

	<div class="mv-stage">
		<MotionVideoGrid
			bind:items
			{selectedIds}
			{loading}
			blurred={liveOpen}
			{brandSlug}
			onToggleSelect={toggleSelect}
			onRemove={(id) => void removeItem(id)}
			onOpen={(item) => (lightbox = item)}
		/>

		<MotionVideoLiveOverlay
			running={liveRunning}
			minimized={liveMinimized}
			{loading}
			{streamBuf}
			{streamToolCalls}
			{streamReasoning}
			onDismiss={dismissLive}
			onClose={closeLive}
			onExpand={() => (liveMinimized = false)}
		/>
	</div>

	{#if errorMsg}
		<p class="mv-error">{errorMsg}{#if errorExhausted}{' '}<UpgradeLink />{/if}</p>
	{/if}

	<div class="mv-composer" bind:this={composerEl}>
		<MotionVideoComposer
			{loading}
			{can4k}
			{brandSlug}
			{prefKey}
			{selectedIds}
			{selectedItems}
			{remakeAspects}
			{history}
			bind:input
			bind:menu
			bind:uploads
			bind:pickedAds
			bind:videoRefs
			bind:historyOpen
			onSend={() => void send()}
			onStop={stop}
			onToggleSelect={toggleSelect}
			onClearSelection={clearSelection}
			onRemake={(a) => void remakeIn(a)}
			onError={(message) => (errorMsg = message)}
			bind:aspect
			bind:duration
			bind:quality
		/>
	</div>
</div>

{#if lightbox}
	<MotionVideoLightbox item={lightbox} {brandSlug} onClose={() => (lightbox = null)} />
{/if}


<style>
	.mv-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		position: relative;
	}
	.mv-stage {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		width: 100%;
	}
	.mv-error {
		position: absolute;
		left: 50%;
		bottom: calc(var(--mv-composer-clearance, 200px) + 8px);
		transform: translateX(-50%);
		z-index: 12;
		margin: 0;
		padding: 8px 12px;
		border-radius: 10px;
		background: color-mix(in srgb, #dc2626 12%, var(--paper));
		color: #dc2626;
		font-size: 13px;
		max-width: min(520px, calc(100% - 24px));
	}
	.mv-composer {
		position: absolute;
		left: 50%;
		bottom: 16px;
		transform: translateX(-50%);
		z-index: 30;
		width: min(820px, calc(100% - 24px));
		padding: 0;
		pointer-events: none;
		background: none;
	}
	.mv-composer :global(.ch-shell),
	.mv-composer :global(.ch-box) {
		pointer-events: auto;
	}
</style>
