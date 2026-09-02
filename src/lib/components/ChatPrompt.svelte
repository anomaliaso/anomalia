<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { onMount } from 'svelte';
  import { Plus, ImagePlus, ImageUp, Users, Images, ChevronRight, Terminal, Bot, Check, FileText, Plug, Cpu, Brain, Wand2, X } from '@lucide/svelte';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import { BUILTIN_AGENT_AVATARS } from '$lib/agent-avatars';
  import {
    CHAT_COMMANDS,
    CHAT_COMMAND_GROUPS,
    matchCommands,
    slashQuery,
    type ChatCommand
  } from '$lib/chat-commands';
  import { CHAT_MODES, isChatMode, type ChatMode } from '$lib/chat-modes';
  import { readChatDraft, writeChatDraft } from '$lib/chat-draft';
  import {
    CHAT_CUSTOM_MODELS,
    isCustomChatModel,
    type ChatTier
  } from '$lib/chat-tiers';
  import { defaultReasoningFor, reasoningLevelsFor, isValidForTier, type ChatReasoning } from '$lib/chat-reasoning';
  import type { AgentMeta } from '$lib/agent-icons';
  import {
    buildAttachmentsPayload,
    CHAT_VIDEO_ACCEPT,
    downscaleImageFile,
    isChatVideoFile,
    uploadChatVideo,
    previewThumbs,
    type ChatAttachmentPick,
    type ChatAttachmentsPayload,
  } from '$lib/chat-attachments';
  import { page } from '$app/stores';
  import { createSupabaseBrowserClient } from '$lib/supabase/client';
  import {
    CHAT_DOCUMENT_ACCEPT,
    MAX_CHAT_DOCS,
    MAX_CHAT_CONVERT_BYTES,
    chatConvertStoragePrefix,
    chatDocumentRefs,
    isConvertibleDocument,
    isImageOrMediaFile,
    isReadyChatDoc,
    type ChatDocument,
  } from '$lib/chat-documents';
  import { RASTER_IMAGE_ACCEPT, isRasterImageSource } from '$lib/raster-image';
  import {
    appendTranscript,
    isSpeechInputSupported,
    MAX_RECORDING_MS,
    SpeechInputError,
    startRecording,
    transcribeAudio,
    type SpeechErrorCode,
    type VoiceRecorder,
  } from '$lib/speech-to-text';
  import { materialPress } from '$lib/actions/material-press.js';

  const MAX_UPLOADS = 4;
  const MAX_ENTITY_PICKS = 3;
  const MODE_KEY = 'anomalia.chatMode';
  const supabase = createSupabaseBrowserClient();
  const brandId = $derived(String(($page.data as { brandId?: string }).brandId ?? ''));
  const userId = $derived(
    String(($page.data as { session?: { user?: { id?: string } } }).session?.user?.id ?? '')
  );
  const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

  type ChatSubmitMeta = {
    mode: ChatMode;
    tier: ChatTier | null;
    reasoning: ChatReasoning;
    command?: string;
    attachments?: ChatAttachmentsPayload;
    thumbs?: string[];
    documents?: ChatDocument[];
  };

  let {
    value = $bindable(''),
    placeholder = '',
    loading = false,
    /** Vero fra l'invio e la nascita del thread: la sessione non esiste ancora e `loading`
     * e` falso — senza questo stato il bottone resta muto e l'utente crede di non aver inviato. */
    sending = false,
    remoteBusy = false,
    brandSlug = '',
    /** Chiave sessionStorage per far sopravvivere il testo non inviato a un refresh. Vuota = off. */
    draftKey = '',
    mode = $bindable<ChatMode>('agent'),
    tier = $bindable<ChatTier>('fast'),
    reasoning = $bindable<ChatReasoning>(defaultReasoningFor(null)),
    onsubmit = (_text: string, _meta?: ChatSubmitMeta) => {},
    onstop = () => {},
    onkeydown = (_e: KeyboardEvent) => {},
    showHint = true,
    // Model-style agent selector (multi-agent chat). Only when agentOptions is provided.
    agentOptions = null,
    /** true quando il thread ha già dei messaggi: l'agente non si cambia più. */
    agentLocked = false,
    agent = null,
    onagentchange = (_id: string) => {},
    /** I modelli che il gateway serve adesso: il menu li mostra al posto di una lista fissa. */
    chatModels = [] as Array<{ id: string; label: string; contextLength: number; inputUsdPerM: number; outputUsdPerM: number }>,
    /** La scelta di modello è cambiata dal picker: chi possiede il thread la salva cross-device. */
    onmodelchange = (_choice: { tier: ChatTier | null; reasoning: ChatReasoning }) => {},
    // The user's own agents, from Custom agents. Picking one hands the thread its brief.
    customAgents = [],
    customAgent = null,
    oncustomagentchange = (_id: string | null) => {},
    /** Chat di gruppo: il picker sa fare anche una STANZA (2-4 membri nello stesso thread).
     * `roomAgents` sono le chiavi già scelte; la stanza nasce col primo messaggio. */
    roomEnabled = false,
    roomAgents = [],
    onroomchange = (_keys: string[]) => {},
    /** When false, hide SEO/blog slash-commands (paid Web hub). */
    webHubEnabled = true,
  }: {
    value?: string;
    placeholder?: string;
    loading?: boolean;
    sending?: boolean;
    /**
     * Il turno vive sul SERVER anche quando questa scheda non ne tiene lo stream: dopo un
     * reload, su un altro dispositivo, o a SSE caduta. `loading` li` e` falso, ma fermarlo deve
     * restare possibile — o l'utente guarda bruciare crediti senza un gesto per intervenire.
     */
    remoteBusy?: boolean;
    brandSlug?: string;
    draftKey?: string;
    mode?: ChatMode;
    tier?: ChatTier | null;
    reasoning?: ChatReasoning;
    onsubmit?: (text: string, meta?: ChatSubmitMeta) => void;
    onstop?: () => void;
    onkeydown?: (e: KeyboardEvent) => void;
    showHint?: boolean;
    agentOptions?: AgentMeta[] | null;
    agentLocked?: boolean;
    agent?: string | null;
    onagentchange?: (id: string) => void;
    chatModels?: Array<{ id: string; label: string; contextLength: number; inputUsdPerM: number; outputUsdPerM: number }>;
    onmodelchange?: (choice: { tier: ChatTier | null; reasoning: ChatReasoning }) => void;
    customAgents?: Array<{ id: string; name: string; face: string; color: string }>;
    customAgent?: string | null;
    oncustomagentchange?: (id: string | null) => void;
    roomEnabled?: boolean;
    roomAgents?: string[];
    onroomchange?: (keys: string[]) => void;
    webHubEnabled?: boolean;
  } = $props();

  const commandGroups = $derived(
    webHubEnabled
      ? CHAT_COMMAND_GROUPS
      : CHAT_COMMAND_GROUPS.filter((g) => g !== 'seo' && g !== 'blog')
  );
  /** Gli stessi comandi che il menu del `+` mostra: un piano senza Web hub non ne inventa altri. */
  const visibleCommands = $derived(
    CHAT_COMMANDS.filter((c) => commandGroups.includes(c.group))
  );

  let inputEl = $state<HTMLTextAreaElement>();
  let fileEl = $state<HTMLInputElement>();
  let docEl = $state<HTMLInputElement>();
  let importEl = $state<HTMLInputElement>();
  let hydrated = $state(false);
  let importStatus = $state<string | null>(null);
  let convertStatus = $state<string | null>(null);
  let rootEl = $state<HTMLFormElement>();
  let uploads = $state<string[]>([]);
  let uploadError = $state('');
  // Downscale in corso: l'invio con un allegato ancora in elaborazione lo lascia a terra
  // (il payload nasce senza l'immagine e il turno parte cieco). Conta i file in volo.
  let attaching = $state(0);
  let docs = $state<Array<ChatDocument & { converting?: boolean; error?: string }>>([]);
  let picks = $state<ChatAttachmentPick[]>([]);
  let pendingCommand = $state<string | undefined>(undefined);
  // Un custom model ha una chiave i18n; un modello del catalogo porta il suo nome dal gateway, e
  // inventargli una chiave significherebbe mostrarne il nome tecnico appena ne arriva uno nuovo.
  function tierLabel(t: ChatTier | null): string {
    if (!t) return $_('chat.tier.default');
    const model = chatModels.find((m) => m.id === t);
    if (model) return model.label;
    return (CHAT_CUSTOM_MODELS as readonly string[]).includes(t) ? $_('chat.tier.' + t) : t;
  }

  const K_TOKENS = 1000;
  function modelSub(m: { contextLength: number; inputUsdPerM: number; outputUsdPerM: number }): string {
    const ctx = m.contextLength ? `${Math.round(m.contextLength / K_TOKENS)}k` : '';
    const price = m.inputUsdPerM || m.outputUsdPerM ? `$${m.inputUsdPerM}/$${m.outputUsdPerM} per 1M` : '';
    return [ctx, price].filter(Boolean).join(' · ');
  }

  let menu = $state<'none' | 'plus' | 'commands' | 'mode' | 'agents' | 'tier' | 'reasoning' | 'picker'>('none');

  /**
   * IL MENU DEI COMANDI DENTRO LA CASELLA — si apre scrivendo `/`.
   * `slashDismissed`: chiuso con Escape (o × sul telefono) resta chiuso finché non si ricomincia
   * a scrivere il comando da capo, o sarebbe una lista che si riapre da sola.
   */
  let slashDismissed = $state(false);
  let slashIndex = $state(0);
  const slashQ = $derived(loading ? null : slashQuery(value));
  const slashMatches = $derived(slashQ === null ? [] : matchCommands(slashQ, visibleCommands));
  const slashOpen = $derived(slashQ !== null && !slashDismissed && slashMatches.length > 0);
  $effect(() => {
    // Ricomincia dall'alto a ogni query nuova, e riabilita il menu quando la casella si svuota.
    void slashQ;
    slashIndex = 0;
    if (slashQ === null) slashDismissed = false;
  });

  function closeSlash() {
    slashDismissed = true;
    requestAnimationFrame(() => inputEl?.focus());
  }

  /** Accetta il comando evidenziato: un prompt riempie la casella, un comando vero la prepara. */
  function pickSlash(cmd: ChatCommand) {
    slashDismissed = true;
    if (cmd.kind === 'command') {
      // `/goal ` con lo spazio: il cursore resta dove serve, davanti a quello che va scritto.
      value = `/${cmd.slash} `;
      pendingCommand = undefined;
    } else {
      pendingCommand = cmd.tool;
      value = $_('chat.commands.prompts.' + cmd.id);
    }
    requestAnimationFrame(() => {
      inputEl?.focus();
      const end = value.length;
      inputEl?.setSelectionRange(end, end);
    });
  }
  let pickerKind = $state<'talents' | 'people' | 'thumbs'>('thumbs');
  let mediaLoading = $state(false);
  let mediaRefs = $state<{
    brandImages: { id: string; url: string }[];
    postThumbs: { id: string; url: string }[];
    people: { id: string; name: string; role: string | null; url: string; urls: string[] }[];
    talents: { id: string; slug: string; name: string; url: string; urls: string[] }[];
  } | null>(null);

  const entityPickCount = $derived(
    picks.filter((p) => p.kind === 'person' || p.kind === 'talent').length
  );
  const singlePickCount = $derived(
    uploads.length + picks.filter((p) => p.kind === 'brand' || p.kind === 'thumb').length
  );
  const readyDocs = $derived(docs.filter(isReadyChatDoc));
  const convertingDocs = $derived(docs.some((d) => d.converting));
  const refCount = $derived(uploads.length + picks.length + readyDocs.length);
  const strip = $derived(previewThumbs(uploads, picks));
  const hasAttachments = $derived(refCount > 0);

  // Il mic sta dove sta l'invio e ci si scambia. Il supporto si sonda al mount, mai a livello di
  // modulo: MediaRecorder/getUserMedia non esistono in SSR, e getUserMedia manca del tutto su
  // origin insicura.
  let sttSupported = $state(false);
  let recorder: VoiceRecorder | null = null;
  let recording = $state(false);
  let transcribing = $state(false);
  let recordedMs = $state(0);
  let micError = $state('');
  let recTimer: ReturnType<typeof setInterval> | null = null;

  const canSend = $derived(!!value.trim() || hasAttachments);
  const attachReady = $derived(attaching === 0);
  const showMic = $derived(sttSupported && !!brandSlug && !canSend && !loading && !sending);

  /**
   * Un menu aperto si chiude toccando fuori. `pointerdown` e non `click`: si chiude appena il
   * dito tocca, prima che il tap diventi un click su quello che c'è sotto. In fase di bubbling,
   * così i bottoni dentro il menu tengono il loro handler.
   */
  onMount(() => {
    hydrated = true;
    const onPointerDown = (e: Event) => {
      if (menu === 'none' && !slashOpen) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-menu-root]')) return;
      menu = 'none';
      if (slashOpen) slashDismissed = true;
    };
    // Escape vale ovunque, non solo col cursore nella casella: dopo aver aperto il menu degli
    // agenti il fuoco è sul bottone, ed è lì che si preme Esc.
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (menu === 'none' && !slashOpen)) return;
      menu = 'none';
      if (slashOpen) slashDismissed = true;
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onEsc);
    sttSupported = isSpeechInputSupported();
    // Leaving the page mid-take must release the mic, or the tab keeps its recording indicator.
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onEsc);
      clearRecTimer();
      recorder?.cancel();
      recorder = null;
    };
  });

  function clearRecTimer() {
    if (recTimer) clearInterval(recTimer);
    recTimer = null;
  }

  function voiceErrorText(code: SpeechErrorCode | 'empty') {
    return $_(`chat.voice.error.${code}`);
  }

  function formatRecTime(ms: number): string {
    const total = Math.floor(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  async function startVoice() {
    if (recording || transcribing || loading) return;
    micError = '';
    let started: VoiceRecorder;
    try {
      started = await startRecording();
    } catch (e) {
      micError = e instanceof SpeechInputError ? voiceErrorText(e.code) : voiceErrorText('failed');
      return;
    }
    recorder = started;
    recording = true;
    recordedMs = 0;
    const startedAt = Date.now();
    recTimer = setInterval(() => {
      recordedMs = Date.now() - startedAt;
      // A take that runs into the ceiling is transcribed, not thrown away.
      if (recordedMs >= MAX_RECORDING_MS) void finishVoice();
    }, 250);
  }

  async function finishVoice() {
    const active = recorder;
    if (!active || !recording) return;
    clearRecTimer();
    recording = false;
    recorder = null;
    transcribing = true;
    try {
      const blob = await active.stop();
      if (!blob) {
        micError = voiceErrorText('empty');
        return;
      }
      const text = await transcribeAudio(blob, brandSlug);
      if (!text) {
        micError = voiceErrorText('empty');
        return;
      }
      // Dictation adds to what is already typed instead of replacing it.
      value = appendTranscript(value, text);
      inputEl?.focus();
    } catch (e) {
      micError = e instanceof SpeechInputError ? voiceErrorText(e.code) : voiceErrorText('failed');
    } finally {
      transcribing = false;
    }
  }

  function cancelVoice() {
    if (!recording) return;
    clearRecTimer();
    recorder?.cancel();
    recorder = null;
    recording = false;
    recordedMs = 0;
  }

  onMount(() => {
    try {
      const raw = localStorage.getItem(MODE_KEY);
      if (isChatMode(raw)) mode = raw;
    } catch {
      /* ignore */
    }
    // Default thinking is the penultimate level of the current model's own list.
    reasoning = defaultReasoningFor(tier);
  });

  $effect(() => {
    if (!isValidForTier(reasoning, tier)) reasoning = defaultReasoningFor(tier);
  });

  // Draft che sopravvive a un refresh (per thread, in sessionStorage). Ripristino UNA volta per
  // chiave e solo a casella vuota: un `value` già messo dal caller vince sempre. L'ORDINE conta —
  // questo effect sta PRIMA di quello di scrittura, o al mount il `value` vuoto cancellerebbe il
  // draft salvato.
  let draftRestoredFor = '';
  $effect(() => {
    if (!draftKey || draftKey === draftRestoredFor) return;
    draftRestoredFor = draftKey;
    if (!value) value = readChatDraft(draftKey);
  });
  // Scrittura a ogni battuta; `value` vuoto (i caller azzerano all'invio) rimuove la chiave.
  $effect(() => {
    if (draftKey) writeChatDraft(draftKey, value);
  });

  /**
   * A riposo la casella sta IN LINEA coi bottoni; al primo a capo torna a tutta larghezza su una
   * riga sua. Lo stato lo decide l'altezza VERA del contenuto, non il testo: `\n` non basta (una
   * riga lunga va a capo da sola) e contare i caratteri indovinerebbe. Perché `scrollHeight`
   * misuri il contenuto e non il riquadro, la casella NON ha `min-height` in CSS: l'altezza la
   * scrive solo questo effetto. Nessun remount fra i due stati, quindi il cursore resta dov'è.
   */
  let multiline = $state(false);
  $effect(() => {
    void value;
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    const line = parseFloat(getComputedStyle(inputEl).lineHeight) || 22;
    // A casella vuota si misura una riga e basta: il placeholder non è contenuto, ma su schermo
    // stretto va a capo e gonfia `scrollHeight` — il composer nasceva già a due righe sul telefono.
    const h = value ? inputEl.scrollHeight : line;
    multiline = h > line * 1.5;
    inputEl.style.height = `${Math.min(h, 200)}px`;
  });

  function setMode(m: ChatMode) {
    mode = m;
    menu = 'none';
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  }

  // Picking a model applies to the conversation in front of you; the default for a NEW chat is the
  // brand setting (Settings → Chat), not whatever this device happened to pick last.
  function setTier(t: ChatTier | null) {
    const nextReasoning = defaultReasoningFor(t);
    tier = t;
    reasoning = nextReasoning;
    menu = 'none';
    onmodelchange({ tier: t, reasoning: nextReasoning });
  }

  function setReasoning(level: ChatReasoning) {
    reasoning = level;
    menu = 'none';
    onmodelchange({ tier, reasoning: level });
  }

  function setAgent(id: string) {
    if (customAgent) oncustomagentchange(null);
    onagentchange(id);
    menu = 'none';
  }

  // Nessuna lista nuova e nessun secondo menu: lo STESSO picker passa da "scegli uno" a "scegli
  // chi c'è dentro". Niente bottone "avvia": la stanza nasce col primo messaggio.
  const ROOM_MAX = 4;
  let roomMode = $state(false);
  const inRoom = (key: string) => roomAgents.includes(key);
  function toggleRoom(key: string) {
    if (inRoom(key)) return onroomchange(roomAgents.filter((k) => k !== key));
    if (roomAgents.length >= ROOM_MAX) return;
    onroomchange([...roomAgents, key]);
  }
  function setRoomMode(on: boolean) {
    roomMode = on;
    // Uscire dal modo gruppo scioglie la stanza: lasciarla in memoria invisibile vorrebbe dire
    // creare una chat di gruppo credendo di aver scelto un agente solo.
    if (!on && roomAgents.length) onroomchange([]);
  }
  const roomNames = $derived(
    roomAgents.map((k) =>
      k.startsWith('custom:')
        ? (customAgents.find((a) => a.id === k.slice('custom:'.length))?.name ?? k)
        : $_(`chat.agents.${k}.label`)
    )
  );
  const roomReady = $derived(roomAgents.length >= 2);

  /** Picking a custom agent also swings the thread onto whatever hub agent it was built for. */
  function setCustomAgent(a: { id: string; agent?: string | null }) {
    oncustomagentchange(a.id);
    if (a.agent && a.agent !== agent) onagentchange(a.agent);
    menu = 'none';
  }

  const activeCustom = $derived(customAgents.find((a) => a.id === customAgent) ?? null);
  const activeAvatar = $derived(
    activeCustom
      ? { face: activeCustom.face, color: activeCustom.color }
      : (BUILTIN_AGENT_AVATARS[agent ?? 'auto'] ?? BUILTIN_AGENT_AVATARS.auto)
  );

  function closeMenus(e: MouseEvent) {
    if (!rootEl?.contains(e.target as Node)) menu = 'none';
  }

  onMount(() => {
    document.addEventListener('mousedown', closeMenus);
    return () => document.removeEventListener('mousedown', closeMenus);
  });

  function submitNow() {
    const text = value.trim();
    micError = '';
    // While a reply is generating, submit still works — the parent queues the message.
    // Un allegato ancora in elaborazione NON parte col messaggio: blocchiamo l'invio
    // anziché consegnare un turno cieco (la strip mostra il chip "in elaborazione").
    if ((!text && !hasAttachments) || convertingDocs || !attachReady) return;
    const attachments = buildAttachmentsPayload(uploads, picks);
    const command = pendingCommand;
    // The same thumbs the strip is showing — the chat puts them straight on the sent bubble
    // instead of leaving it bare until the server copy of the images comes back.
    const thumbs = attachments ? previewThumbs(uploads, picks).map((t) => t.url) : undefined;
    const documents = chatDocumentRefs(readyDocs);
    onsubmit(text, {
      mode,
      tier,
      reasoning,
      command,
      attachments,
      thumbs,
      ...(documents.length ? { documents } : {})
    });
    uploads = [];
    uploadError = '';
    picks = [];
    docs = [];
    pendingCommand = undefined;
    menu = 'none';
    slashDismissed = false;
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    submitNow();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (micError) micError = '';
    if (e.key === 'Escape' && recording) {
      e.preventDefault();
      cancelVoice();
      return;
    }
    // Il menu dei comandi ha la precedenza sui tasti che condivide con la casella: mentre è
    // aperto, Invio sceglie invece di inviare.
    if (slashOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        slashIndex = (slashIndex + step + slashMatches.length) % slashMatches.length;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const cmd = slashMatches[slashIndex];
        if (cmd) pickSlash(cmd);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSlash();
        return;
      }
    }
    // Qualunque altro Escape chiude il menu aperto.
    if (e.key === 'Escape' && menu !== 'none') {
      e.preventDefault();
      menu = 'none';
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitNow();
    }
    onkeydown(e);
  }

  async function onPickFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const all = Array.from(input.files ?? []);
    const files = all.filter(
      (f) => isRasterImageSource({ mime: f.type, filename: f.name }) || isChatVideoFile(f)
    );
    input.value = '';
    menu = 'none';
    for (const f of files.slice(0, MAX_UPLOADS - uploads.length)) {
      attaching += 1;
      try {
        // A clip goes to Storage and travels as a URL; an image still rides inline as a data URL.
        uploads = [
          ...uploads,
          isChatVideoFile(f) ? await uploadChatVideo(f, brandSlug) : await downscaleImageFile(f)
        ];
      } catch (err) {
        uploadError =
          (err as Error)?.message === 'video_too_large'
            ? $_('chat.attach.videoTooLarge')
            : $_('chat.attach.uploadFailed');
      } finally {
        attaching -= 1;
      }
    }
  }

  async function onPickDocs(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    menu = 'none';
    if (!brandSlug || !brandId || !userId) return;

    const room = MAX_CHAT_DOCS - docs.filter((d) => !d.error).length;
    for (const f of files.slice(0, Math.max(0, room))) {
      if (isImageOrMediaFile(f.type, f.name)) {
        convertStatus = $_('chat.attach.notMarkdown');
        setTimeout(() => (convertStatus = null), 4000);
        continue;
      }
      if (!isConvertibleDocument(f.type, f.name)) {
        convertStatus = $_('chat.attach.unsupported');
        setTimeout(() => (convertStatus = null), 4000);
        continue;
      }
      if (f.size > MAX_CHAT_CONVERT_BYTES) {
        convertStatus = $_('chat.attach.tooLarge');
        setTimeout(() => (convertStatus = null), 4000);
        continue;
      }

      const pending: ChatDocument & { converting?: boolean; error?: string } = {
        name: f.name,
        markdown: '',
        converting: true
      };
      docs = [...docs, pending];
      convertStatus = $_('chat.attach.converting');

      const path = `${chatConvertStoragePrefix(userId, brandId)}${crypto.randomUUID()}-${safeFileName(f.name)}`;
      let uploaded = false;
      try {
        const up = await supabase.storage.from('brand-knowledge').upload(path, f, {
          contentType: f.type || 'application/octet-stream',
          upsert: false
        });
        if (up.error) throw new Error(up.error.message);
        uploaded = true;

        const res = await fetch(`/app/${brandSlug}/chat/convert-file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path,
            fileName: f.name,
            mimeType: f.type,
            bytes: f.size
          })
        });
        const body = (await res.json().catch(() => ({}))) as {
          path?: string;
          title?: string | null;
          name?: string;
          message?: string;
        };
        if (!res.ok || !body.path) {
          docs = docs.map((d) =>
            d === pending || (d.converting && d.name === f.name && !d.markdown && !d.path)
              ? { ...d, converting: false, error: body.message || $_('chat.attach.convertFailed') }
              : d
          );
          convertStatus = body.message || $_('chat.attach.convertFailed');
          setTimeout(() => (convertStatus = null), 4000);
          continue;
        }
        docs = docs.map((d) =>
          d === pending || (d.converting && d.name === f.name && !d.markdown && !d.path)
            ? {
                name: body.name || f.name,
                title: body.title,
                markdown: '',
                path: body.path,
                converting: false
              }
            : d
        );
        convertStatus = null;
      } catch {
        docs = docs.map((d) =>
          d === pending || (d.converting && d.name === f.name && !d.markdown && !d.path)
            ? { ...d, converting: false, error: $_('chat.attach.convertFailed') }
            : d
        );
        convertStatus = $_('chat.attach.convertFailed');
        setTimeout(() => (convertStatus = null), 4000);
        if (uploaded) {
          await supabase.storage.from('brand-knowledge').remove([path]).catch(() => {});
        }
      }
    }
  }

  /**
   * Import into the Media generation history — NOT an attachment to this message. Reuses the same
   * downscale the attachment path uses, so a 12MP phone photo does not travel full size.
   */
  async function onImportFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter((f) =>
      isRasterImageSource({ mime: f.type, filename: f.name })
    );
    input.value = '';
    menu = 'none';
    if (!brandSlug || !files.length) return;

    let done = 0;
    for (const f of files.slice(0, MAX_UPLOADS)) {
      importStatus = $_('chat.attach.importing');
      try {
        const dataUrl = await downscaleImageFile(f, 1536, 0.9);
        const res = await fetch(`/app/${brandSlug}/media-generator/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, name: f.name })
        });
        if (res.ok) done++;
      } catch {
        /* counted as failed below */
      }
    }
    importStatus =
      done === 0
        ? $_('chat.attach.importFailed')
        : $_('chat.attach.imported', { values: { n: done } });
    setTimeout(() => (importStatus = null), 4000);
  }

  async function openPicker(kind: 'talents' | 'people' | 'thumbs') {
    if (!brandSlug) return;
    pickerKind = kind;
    menu = 'picker';
    if (mediaRefs) return;
    mediaLoading = true;
    try {
      const res = await fetch(`/app/${brandSlug}/media-refs`);
      mediaRefs = res.ok
        ? await res.json()
        : { brandImages: [], postThumbs: [], people: [], talents: [] };
    } catch {
      mediaRefs = { brandImages: [], postThumbs: [], people: [], talents: [] };
    } finally {
      mediaLoading = false;
    }
  }

  function togglePick(pick: ChatAttachmentPick) {
    const idx = picks.findIndex((p) => p.kind === pick.kind && p.id === pick.id);
    if (idx >= 0) {
      picks = picks.filter((_, i) => i !== idx);
      return;
    }
    const isEntity = pick.kind === 'person' || pick.kind === 'talent';
    if (isEntity) {
      if (entityPickCount >= MAX_ENTITY_PICKS) return;
    } else if (singlePickCount >= MAX_UPLOADS) {
      return;
    }
    picks = [...picks, pick];
  }

  function isPicked(kind: ChatAttachmentPick['kind'], id: string) {
    return picks.some((p) => p.kind === kind && p.id === id);
  }

  function removeStripItem(item: { uploadIndex?: number; pickIndex?: number }) {
    if (item.uploadIndex != null) {
      uploads = uploads.filter((_, i) => i !== item.uploadIndex);
      return;
    }
    if (item.pickIndex != null) {
      picks = picks.filter((_, i) => i !== item.pickIndex);
    }
  }

  function removeDoc(index: number) {
    docs = docs.filter((_, i) => i !== index);
  }

  function applyCommand(cmd: ChatCommand) {
    menu = 'none';
    // Un comando vero non è un suggerimento da affiancare a quello che c'è già: o parte lui, o non
    // è un comando.
    if (cmd.kind === 'command') {
      pickSlash(cmd);
      return;
    }
    pendingCommand = cmd.tool;
    const prompt = $_('chat.commands.prompts.' + cmd.id);
    value = value.trim() ? value : prompt;
    requestAnimationFrame(() => inputEl?.focus());
  }

  function groupLabel(g: ChatCommand['group']) {
    return $_('chat.commands.groups.' + g);
  }

  /** Focus the input — prompt chips in the composer hero hand a filled prompt to it. */
  export function focusPrompt() {
    requestAnimationFrame(() => inputEl?.focus());
  }
</script>

<div class="ch-shell" use:materialPress style="--material-press-fill: var(--paper-2)">
<form class="ch-box" bind:this={rootEl} onsubmit={handleSubmit}>
  {#if uploadError}
    <p class="ch-ref-err">{uploadError}</p>
  {/if}
  {#if micError}
    <p class="ch-ref-err" role="status" aria-live="polite">{micError}</p>
  {/if}
  {#if strip.length || docs.length || attaching > 0}
    <div class="ch-refs">
      {#each Array(attaching) as pend, pi (pi)}
        <div class="ch-ref ch-ref-busy" title={$_('chat.attach.processing')} aria-label={$_('chat.attach.processing')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M12 3a9 9 0 1 0 9 9" />
          </svg>
        </div>
      {/each}      {#each strip as item (item.key)}
        <div
          class="ch-ref"
          class:ch-ref-video={/\.(mp4|mov|webm)(\?|$)/i.test(item.url)}
          style={`background-image:url(${item.url})`}
        >
          <button
            type="button"
            class="ch-ref-x"
            onclick={() => removeStripItem(item)}
            aria-label={$_('chat.attach.remove')}
          >×</button>
        </div>
      {/each}
      {#each docs as doc, di (doc.name + '-' + di)}
        <div class="ch-doc" class:err={!!doc.error} class:busy={doc.converting} title={doc.error || doc.name}>
          <FileText class="size-3.5" strokeWidth={2} />
          <span class="ch-doc-name">{doc.name}</span>
          <button
            type="button"
            class="ch-ref-x"
            onclick={() => removeDoc(di)}
            aria-label={$_('chat.attach.remove')}
          >×</button>
        </div>
      {/each}
    </div>
  {/if}

  {#if slashOpen}
    <!-- Ancorato alla casella e non a un bottone: largo quanto il composer, quindi non deborda
         mai a destra e sul telefono resta sopra la tastiera. -->
    <div class="ch-slash" data-menu-root role="listbox" aria-label={$_('chat.commands.label')}>
      <div class="ch-slash-head">
        <span class="ch-slash-title">{$_('chat.commands.slashTitle')}</span>
        <button
          type="button"
          class="ch-slash-x"
          onclick={closeSlash}
          aria-label={$_('common.close')}
        >
          <X class="size-3.5" strokeWidth={2.4} />
        </button>
      </div>
      <div class="ch-slash-list">
        {#each slashMatches as cmd, i (cmd.id)}
          <button
            type="button"
            class="ch-slash-item"
            class:on={i === slashIndex}
            role="option"
            aria-selected={i === slashIndex}
            onclick={() => pickSlash(cmd)}
            onpointerenter={() => (slashIndex = i)}
          >
            <span class="ch-slash-key">/{cmd.slash}</span>
            <span class="ch-slash-lbl">{$_('chat.commands.items.' + cmd.id)}</span>
            {#if cmd.kind === 'command'}
              <span class="ch-slash-tag">{$_('chat.commands.slashTag')}</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="ch-body" class:ch-oneline={!multiline}>
    <textarea
      class="ch-input"
      bind:this={inputEl}
      bind:value
      onkeydown={handleKeydown}
      placeholder={placeholder || $_('chat.placeholder')}
      rows="1"
    ></textarea>
    <!-- Niente disabled={loading} sulla textarea: mentre la risposta streamma si può scrivere e
         inviare — il messaggio raggiunge il turno IN CORSO al prossimo step (mid-turn mailbox),
         o parte come turno successivo se arriva a lavoro finito. -->


    <div class="ch-left">
      <div class="ch-menu-wrap" data-menu-root>
        <button
          type="button"
          class="ch-tool"
          class:on={menu === 'plus' || menu === 'commands' || menu === 'mode' || menu === 'tier' || menu === 'picker'}
          onclick={() => (menu = menu === 'plus' ? 'none' : 'plus')}
          disabled={loading}
          aria-label={$_('chat.attach.add')}
          title={$_('chat.attach.add')}
        >
          <Plus class="size-4" strokeWidth={2.2} />
        </button>

        {#if menu === 'plus'}
          <div class="ch-dropdown">
            {#if brandSlug}
              <button
                type="button"
                class="ch-dd-item"
                onclick={() => fileEl?.click()}
                disabled={uploads.length >= MAX_UPLOADS}
              >
                <ImagePlus class="size-4" />
                <span>{$_('chat.attach.photo')}</span>
              </button>
              <button
                type="button"
                class="ch-dd-item"
                onclick={() => docEl?.click()}
                disabled={docs.filter((d) => !d.error).length >= MAX_CHAT_DOCS}
              >
                <FileText class="size-4" />
                <span>{$_('chat.attach.file')}</span>
              </button>
              <button type="button" class="ch-dd-item" onclick={() => openPicker('talents')}>
                <Users class="size-4" />
                <span>{$_('chat.attach.talents')}</span>
              </button>
              <button type="button" class="ch-dd-item" onclick={() => openPicker('people')}>
                <Users class="size-4" />
                <span>{$_('chat.attach.people')}</span>
              </button>
              <button type="button" class="ch-dd-item" onclick={() => openPicker('thumbs')}>
                <Images class="size-4" />
                <span>{$_('chat.attach.thumbs')}</span>
              </button>
              <button type="button" class="ch-dd-item" onclick={() => importEl?.click()}>
                <ImageUp class="size-4" />
                <span>{$_('chat.attach.importToMedia')}</span>
              </button>
              <div class="ch-dd-sep"></div>
            {/if}
            <button
              type="button"
              class="ch-dd-item ch-dd-nav"
              onclick={() => (menu = 'tier')}
              title={$_('chat.tier.' + tier + 'Hint')}
            >
              <Cpu class="size-4" />
              <span>{$_('chat.tier.label')}: {tierLabel(tier)}</span>
              <ChevronRight class="size-3.5 ch-dd-chevron" />
            </button>
            {#if reasoningLevelsFor(tier).length > 1}
              <!-- Il ragionamento è una preferenza rara: sta col modello dentro il `+` invece di
                   occupare la barra. -->
              <button
                type="button"
                class="ch-dd-item ch-dd-nav"
                onclick={() => (menu = 'reasoning')}
                title={$_('chat.reasoning.hint')}
              >
                <Brain class="size-4" />
                <span>{$_('chat.reasoning.label')}: {$_('chat.reasoning.' + reasoning)}</span>
                <ChevronRight class="size-3.5 ch-dd-chevron" />
              </button>
            {/if}
            <button type="button" class="ch-dd-item ch-dd-nav" onclick={() => (menu = 'commands')}>
              <Terminal class="size-4" />
              <span>{$_('chat.commands.label')}</span>
              <ChevronRight class="size-3.5 ch-dd-chevron" />
            </button>
            <button
              type="button"
              class="ch-dd-item ch-dd-nav"
              onclick={() => (menu = 'mode')}
              title={$_('chat.mode.' + mode + 'Hint')}
            >
              <Bot class="size-4" />
              <span>{$_('chat.mode.label')}: {$_('chat.mode.' + mode)}</span>
              <ChevronRight class="size-3.5 ch-dd-chevron" />
            </button>
            {#if brandSlug}
              <!-- L'UNICO ingresso ai connettori dal composer: sono una destinazione di
                   impostazioni, rara come Modello o Modalità, e quelle stanno tutte qui.
                   Un <a> vero e non un bottone che naviga: così l'interceptor della PageModal lo
                   apre in overlay su desktop, e su mobile resta un link. -->
              <a
                class="ch-dd-item"
                href={`/app/${brandSlug}/settings/connectors`}
                onclick={() => (menu = 'none')}
              >
                <Plug class="size-4" />
                <span>{$_('chat.connectors')}</span>
              </a>
              <a
                class="ch-dd-item"
                href={`/app/${brandSlug}/settings/video`}
                onclick={() => (menu = 'none')}
              >
                <Wand2 class="size-4" />
                <span>{$_('chat.mediaModels')}</span>
              </a>
            {/if}
          </div>
        {/if}

        {#if menu === 'commands'}
          <div class="ch-dropdown ch-commands">
            <button type="button" class="ch-dd-back" onclick={() => (menu = 'plus')}>
              ← {$_('chat.commands.label')}
            </button>
            {#each commandGroups as group (group)}
              {@const items = visibleCommands.filter((c) => c.group === group)}
              {#if items.length}
                <div class="ch-dd-group">{groupLabel(group)}</div>
                {#each items as cmd (cmd.id)}
                  <button type="button" class="ch-dd-item" onclick={() => applyCommand(cmd)}>
                    <span>{$_('chat.commands.items.' + cmd.id)}</span>
                  </button>
                {/each}
              {/if}
            {/each}
          </div>
        {/if}

        {#if menu === 'mode'}
          <div class="ch-dropdown">
            <button type="button" class="ch-dd-back" onclick={() => (menu = 'plus')}>
              ← {$_('chat.mode.label')}
            </button>
            {#each CHAT_MODES as m (m)}
              <button
                type="button"
                class="ch-dd-item ch-dd-item-stack"
                class:active={mode === m}
                onclick={() => setMode(m)}
              >
                <span class="ch-dd-title">{$_('chat.mode.' + m)}</span>
                <span class="ch-dd-sub">{$_('chat.mode.' + m + 'Hint')}</span>
              </button>
            {/each}
          </div>
        {/if}

        {#if menu === 'picker'}
          <div class="ch-picker">
            <button type="button" class="ch-dd-back" onclick={() => (menu = 'plus')}>
              ← {#if pickerKind === 'talents'}
                {$_('chat.attach.talents')}
              {:else if pickerKind === 'people'}
                {$_('chat.attach.people')}
              {:else}
                {$_('chat.attach.thumbs')}
              {/if}
            </button>
            {#if mediaLoading}
              <div class="ch-empty">{$_('chat.attach.loading')}</div>
            {:else if pickerKind === 'talents'}
              {#if mediaRefs?.talents?.length}
                <div class="ch-grid">
                  {#each mediaRefs.talents as talent (talent.id)}
                    <button
                      type="button"
                      class="ch-cell"
                      class:on={isPicked('talent', talent.id)}
                      style={`background-image:url(${talent.url})`}
                      title={`${talent.name} (${talent.urls.length})`}
                      onclick={() =>
                        togglePick({
                          kind: 'talent',
                          id: talent.id,
                          url: talent.url,
                          urls: talent.urls,
                          label: talent.name,
                        })}
                    ></button>
                  {/each}
                </div>
              {:else}
                <div class="ch-empty">{$_('chat.attach.emptyTalents')}</div>
              {/if}
            {:else if pickerKind === 'people'}
              {#if mediaRefs?.people?.length}
                <div class="ch-grid">
                  {#each mediaRefs.people as person (person.id)}
                    <button
                      type="button"
                      class="ch-cell"
                      class:on={isPicked('person', person.id)}
                      style={`background-image:url(${person.url})`}
                      title={`${person.name} (${person.urls.length})`}
                      onclick={() =>
                        togglePick({
                          kind: 'person',
                          id: person.id,
                          url: person.url,
                          urls: person.urls,
                          label: person.name,
                        })}
                    ></button>
                  {/each}
                </div>
              {:else}
                <div class="ch-empty">{$_('chat.attach.emptyPeople')}</div>
              {/if}
            {:else if mediaRefs && (mediaRefs.brandImages.length || mediaRefs.postThumbs.length)}
              {#if mediaRefs.brandImages.length}
                <div class="ch-grp">{$_('chat.attach.brandImages')}</div>
                <div class="ch-grid">
                  {#each mediaRefs.brandImages as bi (bi.id)}
                    <button
                      type="button"
                      class="ch-cell"
                      class:on={isPicked('brand', bi.id)}
                      style={`background-image:url(${bi.url})`}
                      onclick={() => togglePick({ kind: 'brand', id: bi.id, url: bi.url })}
                    ></button>
                  {/each}
                </div>
              {/if}
              {#if mediaRefs.postThumbs.length}
                <div class="ch-grp">{$_('chat.attach.postThumbs')}</div>
                <div class="ch-grid">
                  {#each mediaRefs.postThumbs as pt (pt.id)}
                    <button
                      type="button"
                      class="ch-cell"
                      class:on={isPicked('thumb', pt.id)}
                      style={`background-image:url(${pt.url})`}
                      onclick={() => togglePick({ kind: 'thumb', id: pt.id, url: pt.url })}
                    ></button>
                  {/each}
                </div>
              {/if}
            {:else}
              <div class="ch-empty">{$_('chat.attach.emptyThumbs')}</div>
            {/if}
          </div>
        {/if}

        {#if menu === 'tier'}
          <div class="ch-dropdown ch-tier-dd" role="listbox">
            <button type="button" class="ch-dd-back" onclick={() => (menu = 'plus')}>
              ← {$_('chat.tier.label')}
            </button>
            <button
              type="button"
              class="ch-dd-item ch-dd-item-stack"
              class:active={!tier}
              role="option"
              aria-selected={!tier}
              onclick={() => setTier(null)}
            >
              <span class="ch-dd-title">{$_('chat.tier.default')}</span>
              <span class="ch-dd-sub">{$_('chat.tier.defaultHint')}</span>
            </button>
            {#if chatModels.length}
              <div class="ch-dd-group">{$_('chat.tier.custom')}</div>
              {#each chatModels as m (m.id)}
                <button
                  type="button"
                  class="ch-dd-item ch-dd-item-stack"
                  class:active={tier === m.id}
                  role="option"
                  aria-selected={tier === m.id}
                  onclick={() => setTier(m.id)}
                >
                  <span class="ch-dd-title">{m.label}</span>
                  <span class="ch-dd-sub">{modelSub(m)}</span>
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      </div>

      <!-- Il selettore vive solo finché la chat non è partita: dopo il primo messaggio l'agente È
           l'identità del thread, e cambiarlo a metà produrrebbe un thread che si contraddice. -->
      {#if agentOptions && !agentLocked}
        <div class="ch-agent-wrap" data-menu-root>
          <button
            type="button"
            class="ch-agent-btn"
            class:on={menu === 'agents'}
            onclick={() => (menu = menu === 'agents' ? 'none' : 'agents')}
            disabled={loading}
            title={$_('chat.agents.pick')}
            aria-haspopup="listbox"
            aria-expanded={menu === 'agents'}
          >
            {#if roomReady}
              <Users size={16} />
            {:else}
              <AgentAvatar face={activeAvatar.face} color={activeAvatar.color} size={17} />
            {/if}
            <span class="ch-agent-btn-name"
              >{roomReady
                ? roomNames.join(', ')
                : activeCustom
                  ? activeCustom.name
                  : $_(`chat.agents.${agent ?? 'auto'}.label`)}</span
            >
            <svg class="ch-tier-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6" /></svg>
          </button>

          {#if menu === 'agents'}
            <div class="ch-dropdown ch-agents" role="listbox">
              {#if roomEnabled}
                <!-- L'unico ingresso alle chat di gruppo: acceso, le spunte diventano membri. -->
                <button
                  type="button"
                  class="ch-room-toggle"
                  class:on={roomMode}
                  aria-pressed={roomMode}
                  onclick={() => setRoomMode(!roomMode)}
                >
                  <Users size={14} />
                  <span class="ch-room-toggle-lbl">{$_('chat.agents.group')}</span>
                  {#if roomMode}<Check size={14} />{/if}
                </button>
                {#if roomMode}
                  <div class="ch-room-hint">
                    {roomAgents.length < 2
                      ? $_('chat.agents.groupPick')
                      : $_('chat.agents.groupHint')}
                  </div>
                {/if}
              {/if}
              <!-- In modo gruppo `auto` sparisce: Anomalia è l'assistente pieno, non un membro. -->
              {#each roomMode ? agentOptions.filter((a) => a.id !== 'auto') : agentOptions as a (a.id)}
                {@const av = BUILTIN_AGENT_AVATARS[a.id] ?? BUILTIN_AGENT_AVATARS.auto}
                {@const on = roomMode ? inRoom(a.id) : !customAgent && a.id === agent}
                <button
                  type="button"
                  class="ch-agent-opt"
                  class:sel={on}
                  role="option"
                  aria-selected={on}
                  onclick={() => (roomMode ? toggleRoom(a.id) : setAgent(a.id))}
                >
                  <span class="ch-agent-opt-ico">
                    <AgentAvatar face={av.face} color={av.color} size={22} />
                  </span>
                  <span class="ch-agent-opt-text">
                    <span class="ch-agent-opt-lbl">{$_(`chat.agents.${a.id}.label`)}</span>
                    <span class="ch-agent-opt-desc">{$_(`chat.agents.${a.id}.desc`)}</span>
                  </span>
                  {#if on}
                    <span class="ch-agent-opt-check"><Check size={14} /></span>
                  {/if}
                </button>
              {/each}

              <div class="ch-dd-group">{$_('chat.agents.custom')}</div>
              {#each customAgents as a (a.id)}
                {@const on = roomMode ? inRoom(`custom:${a.id}`) : customAgent === a.id}
                <button
                  type="button"
                  class="ch-agent-opt"
                  class:sel={on}
                  role="option"
                  aria-selected={on}
                  onclick={() => (roomMode ? toggleRoom(`custom:${a.id}`) : setCustomAgent(a))}
                >
                  <span class="ch-agent-opt-ico">
                    <AgentAvatar face={a.face} color={a.color} size={22} />
                  </span>
                  <span class="ch-agent-opt-text">
                    <span class="ch-agent-opt-lbl">{a.name}</span>
                  </span>
                  {#if on}
                    <span class="ch-agent-opt-check"><Check size={14} /></span>
                  {/if}
                </button>
              {:else}
                <a class="ch-agent-empty" href={`/app/${brandSlug}/agents`}>
                  {$_('chat.agents.customEmpty')}
                </a>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if reasoningLevelsFor(tier).length > 1}
        <div class="ch-tier-wrap" data-menu-root>
          {#if menu === 'reasoning'}
            <div class="ch-dropdown ch-tier-dd" role="listbox">
              <button type="button" class="ch-dd-back" onclick={() => (menu = 'plus')}>
                ← {$_('chat.reasoning.label')}
              </button>
              {#each reasoningLevelsFor(tier) as level (level)}
                <button
                  type="button"
                  class="ch-dd-item ch-dd-item-stack"
                  class:active={reasoning === level}
                  role="option"
                  aria-selected={reasoning === level}
                  onclick={() => setReasoning(level)}
                >
                  <span class="ch-dd-title">{$_('chat.reasoning.' + level)}</span>
                  <span class="ch-dd-sub">{$_('chat.reasoning.' + level + 'Hint')}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if hydrated}
        {#if brandSlug}
          <input
            bind:this={fileEl}
            type="file"
            accept={`${RASTER_IMAGE_ACCEPT},${CHAT_VIDEO_ACCEPT}`}
            multiple
            hidden
            onchange={onPickFiles}
          />
          <input
            bind:this={docEl}
            type="file"
            accept={CHAT_DOCUMENT_ACCEPT}
            multiple
            hidden
            onchange={onPickDocs}
          />
          <input bind:this={importEl} type="file" accept={RASTER_IMAGE_ACCEPT} multiple hidden onchange={onImportFiles} />
        {/if}
      {/if}
      {#if convertStatus}
        <span class="ch-hint" role="status" aria-live="polite">{convertStatus}</span>
      {/if}
      {#if importStatus}
        <span class="ch-hint" role="status" aria-live="polite">{importStatus}</span>
      {/if}

      {#if showHint}
        <span class="ch-hint">{$_('app.home.chat.hint')}</span>
      {/if}
    </div>

    <div class="ch-right">
      {#if recording}
        <span class="ch-voice-live" role="status" aria-live="polite">
          <span class="ch-voice-dot" aria-hidden="true"></span>
          <span class="ch-voice-time">{formatRecTime(recordedMs)}</span>
        </span>
        <button
          type="button"
          class="ch-voice-x"
          onclick={cancelVoice}
          aria-label={$_('chat.voice.cancel')}
          title={$_('chat.voice.cancel')}
        >×</button>
      {:else if transcribing}
        <span class="ch-voice-live" role="status" aria-live="polite">{$_('chat.voice.transcribing')}</span>
      {/if}
      {#if loading || remoteBusy}
        <button type="button" class="ch-send ch-stop" onclick={onstop} aria-label={$_('chat.stop')}>
          <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" /></svg>
        </button>
      {/if}
      <!-- Uno slot, un bottone: trascrizione → spinner, registrazione → stop, niente da inviare →
           mic, altrimenti → invio. -->
      {#if transcribing}
        <button type="button" class="ch-send ch-busy" disabled aria-label={$_('chat.voice.transcribing')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M12 3a9 9 0 1 0 9 9" />
          </svg>
        </button>
      {:else if recording}
        <button
          type="button"
          class="ch-send ch-rec"
          onclick={finishVoice}
          aria-label={$_('chat.voice.stop')}
          title={$_('chat.voice.stop')}
        >
          <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
        </button>
      {:else if sending}
        <button type="button" class="ch-send ch-busy" disabled aria-label={$_('chat.send')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M12 3a9 9 0 1 0 9 9" />
          </svg>
        </button>
      {:else if showMic}
        <button
          type="button"
          class="ch-send ch-mic"
          onclick={startVoice}
          aria-label={$_('chat.voice.start')}
          title={$_('chat.voice.start')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <path d="M12 19v3" />
          </svg>
        </button>
      {:else if !(loading && !canSend)}
        <button
          type="submit"
          class="ch-send"
          disabled={!canSend || convertingDocs || !attachReady}
          aria-label={$_('chat.send')}
        >
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
        </button>
      {/if}
    </div>
  </div>
</form>
</div>

<style>
  .ch-shell { display: flex; flex-direction: column; width: 100%; flex-shrink: 0; }

  .ch-agent-opt {
    display: flex; align-items: flex-start; gap: 9px;
    width: 100%;
    padding: 9px 10px; border-radius: 9px;
    background: none; border: none; cursor: pointer; text-align: left;
    font: inherit; color: var(--ink, #1d1d1f);
  }
  .ch-agent-opt:hover { background: var(--paper-2, #f5f5f7); }
  .ch-agent-opt.sel .ch-agent-opt-lbl { font-weight: 650; }
  .ch-agent-opt-ico {
    display: inline-flex; color: var(--ink-soft, #6e6e73); line-height: 0;
    margin-top: 2px; flex-shrink: 0;
  }
  .ch-agent-opt-text {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column; gap: 2px;
  }
  .ch-agent-opt-lbl { font-size: 13.5px; font-weight: 600; line-height: 1.25; }
  .ch-agent-opt-desc {
    font-size: 11.5px; color: var(--ink-soft, #6e6e73); line-height: 1.35;
  }
  .ch-agent-opt-check {
    color: var(--ink-soft, #6e6e73);
    display: inline-flex; align-items: center;
    margin-top: 2px; flex-shrink: 0;
  }
  .ch-room-toggle {
    display: flex; align-items: center; gap: 7px;
    width: 100%;
    padding: 8px 10px; margin-bottom: 2px; border-radius: 9px;
    background: none; border: none; cursor: pointer; text-align: left;
    font: inherit; font-size: 12.5px; font-weight: 600;
    color: var(--ink-soft, #6e6e73);
  }
  .ch-room-toggle:hover { background: var(--paper-2, #f5f5f7); }
  .ch-room-toggle.on { color: var(--accent); }
  .ch-room-toggle-lbl { flex: 1; min-width: 0; }
  .ch-room-hint {
    padding: 0 10px 8px;
    font-size: 11.5px; line-height: 1.35;
    color: var(--ink-soft, #6e6e73);
  }

  .ch-right { grid-area: send; display: flex; align-items: center; gap: 8px; justify-content: flex-end; flex-shrink: 0; }

  .ch-box {
    position: relative;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 22px;
    padding: 12px 14px 10px;
    box-shadow: 0 6px 28px rgba(0, 0, 0, 0.06);
    transition: border-color 0.15s var(--ease, ease);
  }
  .ch-box:focus-within { border-color: var(--accent); }

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
  /* Riposo: una riga sola, casella fra i controlli. Cambia solo il grid — stesso DOM. */
  .ch-body.ch-oneline {
    grid-template-columns: auto 1fr auto;
    grid-template-areas: 'left input send';
    row-gap: 0;
    align-items: center;
  }
  .ch-body.ch-oneline .ch-left { flex-wrap: nowrap; }
  /* Suggerimento e stati di caricamento mangerebbero la casella nella riga stretta. */
  .ch-body.ch-oneline .ch-hint { display: none; }

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
    max-height: 200px;
    box-sizing: border-box;
    padding: 0;
  }
  .ch-input::placeholder { color: var(--ink-faint); }

  .ch-refs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }
  /* A failed upload leaves nothing in the strip, so this must render outside it or it never shows. */
  .ch-ref-err {
    margin: 0 0 6px;
    font-size: 12px;
    color: var(--danger, #dc2626);
  }
  .ch-ref {
    position: relative;
    width: 52px;
    height: 52px;
    border-radius: 10px;
    background-size: cover;
    background-position: center;
    border: 1px solid var(--line);
  }
  /* Il downscale sta girando: il chip esiste, l'immagine non c'è ancora. */
  .ch-ref-busy {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-soft);
  }
  .ch-ref-busy svg {
    width: 18px;
    height: 18px;
    animation: ch-ref-spin 0.9s linear infinite;
  }
  @keyframes ch-ref-spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* A clip has no poster frame — show a film glyph instead of an empty tile. */
  .ch-ref-video {
    background-color: #111;
  }
  .ch-ref-video::after {
    content: '▶';
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #fff;
    font-size: 16px;
  }
  .ch-ref-x {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: none;
    background: var(--ink);
    color: #fff;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
  }
  .ch-doc {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 180px;
    height: 32px;
    padding: 0 10px 0 8px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--paper-2);
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .ch-doc.busy { opacity: 0.65; }
  .ch-doc.err { border-color: color-mix(in srgb, var(--danger, #c00) 40%, var(--line)); color: var(--danger, #c00); }
  .ch-doc-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ch-left {
    grid-area: left;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex-wrap: wrap;
  }
  .ch-hint {
    font-size: 12px;
    color: var(--ink-faint);
    margin-left: 6px;
  }
  .ch-menu-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .ch-tier-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .ch-tier-label {
    appearance: none;
    border: none;
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
    background: var(--paper-2, #f5f5f7);
    color: var(--ink-soft, #6e6e73);
  }
  .ch-tier-label.on,
  .ch-tier-label:hover:not(:disabled) {
    filter: brightness(0.97);
  }
  .ch-tier-label:disabled { opacity: 0.5; cursor: default; }
  .ch-tier-chev { width: 12px; height: 12px; opacity: 0.7; flex-shrink: 0; }

  .ch-tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
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
  .ch-tool:disabled { opacity: 0.4; cursor: default; }

  .ch-dropdown {
    position: absolute;
    left: 0;
    bottom: calc(100% + 8px);
    z-index: 30;
    min-width: 240px;
    max-width: min(320px, 80vw);
    max-height: 320px;
    overflow-y: auto;
    padding: 6px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
  }
  /* ── Menu dei comandi dentro la casella (si apre con `/`) ───────────────────────────────── */
  .ch-slash {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 8px);
    z-index: 32;
    /* Largo quanto il composer: niente da far debordare, su nessuno schermo. */
    max-width: 100%;
    padding: 6px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 16px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.14);
  }
  .ch-slash-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 6px 6px;
  }
  .ch-slash-title {
    font-size: 0.62rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  /* Bersaglio da pollice: su mobile chiudere deve costare un tocco, non una mira. */
  .ch-slash-x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    margin: -6px -4px -6px 0;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .ch-slash-x:hover { background: var(--paper-2); color: var(--ink); }
  .ch-slash-list {
    display: flex;
    flex-direction: column;
    /* Metà schermo al massimo: sopra una tastiera aperta, di più significa non vedere più nulla. */
    max-height: min(46vh, 320px);
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .ch-slash-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 8px;
    border: 0;
    border-radius: 10px;
    background: none;
    text-align: left;
    color: var(--ink);
    cursor: pointer;
  }
  .ch-slash-item.on { background: var(--paper-2); }
  .ch-slash-key {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.74rem;
    color: var(--accent);
    flex-shrink: 0;
  }
  .ch-slash-lbl {
    font-size: 0.8rem;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ch-slash-tag {
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-faint);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 1px 6px;
    flex-shrink: 0;
  }

  .ch-tier-dd { min-width: 260px; }
  .ch-commands { min-width: 240px; }
  .ch-agents { min-width: 268px; max-height: 340px; overflow-y: auto; }


  /* Agent control: avatar + name, where the model chip used to sit. */
  .ch-agent-wrap { position: relative; display: inline-flex; }
  .ch-agent-btn {
    display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 8px;
    border: none; border-radius: 10px; background: transparent;
    color: var(--ink-soft); font-size: 12px; font-weight: 550; cursor: pointer; max-width: 190px;
    transition: background 0.15s, color 0.15s;
  }
  .ch-agent-btn:hover:not(:disabled) { background: var(--paper-2, #f5f5f7); color: var(--ink); }
  .ch-agent-btn.on { background: var(--paper-2, #f5f5f7); color: var(--ink); }
  .ch-agent-btn:disabled { opacity: 0.55; cursor: default; }
  .ch-agent-btn-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ch-agent-empty {
    display: block; padding: 9px 11px; font-size: 12.5px; color: var(--ink-faint);
    text-decoration: none;
  }
  .ch-agent-empty:hover { color: var(--ink); }
  a.ch-dd-item { text-decoration: none; }
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
  .ch-dd-back:hover { background: var(--paper-2); color: var(--ink); }
  .ch-dd-sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--line);
  }
  .ch-dd-group {
    padding: 8px 10px 4px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-faint);
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
  .ch-dd-item:hover,
  .ch-dd-item.active { background: var(--paper-2); }
  .ch-dd-item:disabled { opacity: 0.4; cursor: default; }
  .ch-dd-item :global(svg) { flex-shrink: 0; color: var(--ink-soft); }
  .ch-dd-item > span { flex: 1; min-width: 0; }
  .ch-dd-chevron { margin-left: auto; opacity: 0.55; }
  .ch-dd-item-stack {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }
  .ch-dd-title { font-weight: 600; }
  .ch-dd-sub { font-size: 11.5px; color: var(--ink-soft); line-height: 1.35; }

  .ch-picker {
    position: absolute;
    left: 0;
    bottom: calc(100% + 8px);
    z-index: 30;
    width: min(300px, 80vw);
    max-height: 280px;
    overflow-y: auto;
    padding: 10px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
  }
  .ch-grp {
    font-size: 11px;
    font-weight: 600;
    color: var(--ink-soft);
    margin: 8px 0 6px;
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
  .ch-cell.on { border-color: var(--accent); }
  .ch-empty {
    font-size: 12.5px;
    color: var(--ink-soft);
    padding: 12px 4px;
    line-height: 1.4;
  }

  .ch-send {
    width: 38px;
    height: 38px;
    border: none;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex: 0 0 auto;
    transition: opacity 0.15s, transform 0.15s;
  }
  .ch-send:disabled { opacity: 0.4; cursor: default; }
  .ch-send:not(:disabled):hover { transform: scale(1.05); }
  .ch-send svg { width: 17px; height: 17px; margin-left: 2px; }
  .ch-send.ch-stop { background: #ef4444; }
  .ch-send.ch-stop:hover { background: #dc2626; }
  .ch-send.ch-stop svg { margin-left: 0; }

  /* Mic takes the send slot when there is nothing to send — same circle, quieter fill. */
  .ch-send.ch-mic {
    background: var(--paper-2, #f5f5f7);
    color: var(--ink, #1d1d1f);
    border: 1px solid var(--line, #e5e5ea);
  }
  .ch-send.ch-mic:hover { background: var(--line, #e5e5ea); }
  .ch-send.ch-mic svg { margin-left: 0; width: 18px; height: 18px; }

  .ch-send.ch-rec { background: #ef4444; }
  .ch-send.ch-rec:hover { background: #dc2626; }
  .ch-send.ch-rec svg { margin-left: 0; width: 15px; height: 15px; }

  .ch-send.ch-busy { opacity: 1; cursor: default; }
  .ch-send.ch-busy svg { margin-left: 0; animation: ch-rot 0.8s linear infinite; }
  @keyframes ch-rot { to { transform: rotate(360deg); } }

  .ch-voice-live {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--ink-soft, #6e6e73);
    white-space: nowrap;
  }
  .ch-voice-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ef4444;
    animation: ch-pulse 1.2s ease-in-out infinite;
  }
  @keyframes ch-pulse { 50% { opacity: 0.25; } }
  .ch-voice-x {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: none;
    background: none;
    color: var(--ink-soft, #6e6e73);
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
    flex: 0 0 auto;
  }
  .ch-voice-x:hover { background: var(--paper-2, #f5f5f7); color: var(--ink, #1d1d1f); }

  @media (prefers-reduced-motion: reduce) {
    .ch-voice-dot, .ch-send.ch-busy svg { animation: none; }
  }

  @media (max-width: 520px) {
    .ch-hint { display: none; }
  }
  /* Su schermo stretto un dropdown ancorato a un bottone di mezzo composer usciva dal bordo
     destro: quelli che stanno a destra si allineano a destra, e nessuno supera la larghezza
     della finestra. */
  @media (max-width: 560px) {
    /* Su schermo stretto i menu si allineano al composer invece di pendere dal loro bottone:
       ancorati a un bottone di mezza barra uscivano da un lato o dall'altro. */
    .ch-menu-wrap,
    .ch-agent-wrap,
    .ch-tier-wrap {
      position: static;
    }
    .ch-dropdown,
    .ch-picker {
      left: 0;
      right: 0;
      width: auto;
      min-width: 0;
      max-width: none;
    }
    .ch-slash-list { max-height: min(40vh, 260px); }
  }
</style>
