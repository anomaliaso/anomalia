<script lang="ts">
  import { tick } from 'svelte';

  // Per-article AI chat. Feedback → the AI rewrites the article; each revision is a version.
  // undo/redo move across versions and push the applied content back into the editor.
  // Image edits ("Chiedi alle AI" on cover/body images) and text-selection edits land here too.
  let {
    chatUrl,
    initialMessages = [],
    canUndo = false,
    canRedo = false,
    getMarkdown,
    setMarkdown,
    onTitleChange,
    onMetaChange,
    onCoverChange
  }: {
    chatUrl: string;
    initialMessages?: { role: 'user' | 'assistant'; text: string }[];
    canUndo?: boolean;
    canRedo?: boolean;
    getMarkdown: () => string;
    setMarkdown: (md: string) => void;
    onTitleChange?: (title: string) => void;
    onMetaChange?: (metaTitle: string, metaDescription: string) => void;
    onCoverChange?: (url: string) => void;
  } = $props();

  let messages = $state<{ role: 'user' | 'assistant' | 'system'; text: string; thumb?: string }[]>([...initialMessages]);
  let input = $state('');
  let sending = $state(false);
  let undoable = $state(canUndo);
  let redoable = $state(canRedo);
  let listEl = $state<HTMLDivElement | null>(null);
  let rootEl = $state<HTMLElement | null>(null);

  async function scrollDown() { await tick(); if (listEl) listEl.scrollTop = listEl.scrollHeight; }

  async function post(payload: Record<string, unknown>) {
    const res = await fetch(chatUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    input = '';
    messages.push({ role: 'user', text });
    sending = true;
    scrollDown();
    try {
      const r = await post({ action: 'revise', instruction: text, bodyMd: getMarkdown() });
      messages.push({ role: 'assistant', text: r.reply ?? 'Fatto.' });
      if (typeof r.bodyMd === 'string') setMarkdown(r.bodyMd);
      if (typeof r.title === 'string') onTitleChange?.(r.title);
      if (typeof r.metaTitle === 'string' || typeof r.metaDescription === 'string') onMetaChange?.(r.metaTitle ?? '', r.metaDescription ?? '');
      undoable = !!r.canUndo; redoable = !!r.canRedo;
    } catch (e) {
      messages.push({ role: 'system', text: 'Errore: ' + (e instanceof Error ? e.message : 'richiesta fallita') });
    } finally {
      sending = false;
      scrollDown();
    }
  }

  /** Called from cover / body "Chiedi alle AI" — edits that image via Nano Banana and replaces it. */
  export async function sendImageEdit(opts: { instruction: string; imageUrl: string; target: 'cover' | 'body' }) {
    const text = opts.instruction.trim();
    if (!text || !opts.imageUrl || sending) return;
    rootEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const label = opts.target === 'cover' ? 'Copertina' : 'Immagine';
    messages.push({ role: 'user', text: `[${label}] ${text}`, thumb: opts.imageUrl });
    sending = true;
    scrollDown();
    try {
      const r = await post({
        action: 'editImage',
        instruction: text,
        imageUrl: opts.imageUrl,
        target: opts.target,
        bodyMd: getMarkdown()
      });
      messages.push({ role: 'assistant', text: r.reply ?? 'Immagine aggiornata.', thumb: typeof r.imageUrl === 'string' ? r.imageUrl : undefined });
      if (typeof r.bodyMd === 'string') setMarkdown(r.bodyMd);
      if (opts.target === 'cover' && typeof r.cover === 'string') onCoverChange?.(r.cover);
      undoable = !!r.canUndo; redoable = !!r.canRedo;
    } catch (e) {
      messages.push({ role: 'system', text: 'Errore: ' + (e instanceof Error ? e.message : 'modifica immagine fallita') });
    } finally {
      sending = false;
      scrollDown();
    }
  }

  /** Called from text-selection "Chiedi alle AI" — rewrites only the selected passage. */
  export async function sendTextEdit(opts: { instruction: string; selectedText: string }) {
    const text = opts.instruction.trim();
    const selected = opts.selectedText.trim();
    if (!text || !selected || sending) return;
    rootEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const preview = selected.length > 80 ? `${selected.slice(0, 80)}…` : selected;
    messages.push({ role: 'user', text: `[Testo] ${text}\n«${preview}»` });
    sending = true;
    scrollDown();
    try {
      const r = await post({
        action: 'editSelection',
        instruction: text,
        selectedText: selected,
        bodyMd: getMarkdown()
      });
      messages.push({ role: 'assistant', text: r.reply ?? 'Testo aggiornato.' });
      if (typeof r.bodyMd === 'string') setMarkdown(r.bodyMd);
      undoable = !!r.canUndo; redoable = !!r.canRedo;
    } catch (e) {
      messages.push({ role: 'system', text: 'Errore: ' + (e instanceof Error ? e.message : 'modifica testo fallita') });
    } finally {
      sending = false;
      scrollDown();
    }
  }

  async function nav(dir: 'undo' | 'redo') {
    if (sending) return;
    sending = true;
    try {
      const r = await post({ action: dir });
      if (!r.noop) {
        if (typeof r.bodyMd === 'string') setMarkdown(r.bodyMd);
        if (typeof r.title === 'string') onTitleChange?.(r.title);
        if (typeof r.metaTitle === 'string' || typeof r.metaDescription === 'string') onMetaChange?.(r.metaTitle ?? '', r.metaDescription ?? '');
        undoable = !!r.canUndo; redoable = !!r.canRedo;
        messages.push({ role: 'system', text: dir === 'undo' ? '↩ Modifica annullata' : '↪ Modifica ripristinata' });
        scrollDown();
      }
    } catch { /* ignore */ } finally { sending = false; }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }
</script>

<aside class="chat" bind:this={rootEl}>
  <header class="chat-head">
    <span class="chat-title">Chat sull'articolo</span>
    <div class="chat-nav">
      <button type="button" onclick={() => nav('undo')} disabled={!undoable || sending} title="Annulla modifica AI">↶</button>
      <button type="button" onclick={() => nav('redo')} disabled={!redoable || sending} title="Ripristina modifica AI">↷</button>
    </div>
  </header>

  <div class="chat-list" bind:this={listEl}>
    {#if messages.length === 0}
      <p class="chat-empty">Dai un feedback e l'AI aggiornerà l'articolo. Es. "rendi l'intro più incisiva", "aggiungi una sezione sui costi". Oppure seleziona un testo o usa <b>Chiedi alle AI</b> su un'immagine per modificarli.</p>
    {/if}
    {#each messages as m, i (i)}
      <div class="msg {m.role}">
        {#if m.thumb}
          <img class="msg-thumb" src={m.thumb} alt="" />
        {/if}
        <span>{m.text}</span>
      </div>
    {/each}
    {#if sending}<div class="msg assistant loading">…</div>{/if}
  </div>

  <div class="chat-input">
    <textarea bind:value={input} onkeydown={onKey} rows="2" placeholder="Chiedi una modifica…" disabled={sending}></textarea>
    <button type="button" onclick={send} disabled={sending || !input.trim()} title="Invia">↑</button>
  </div>
</aside>

<style>
  .chat { display: flex; flex-direction: column; width: 100%; max-width: 100%; min-width: 0; flex-shrink: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); overflow: hidden; height: 380px; box-sizing: border-box; }
  .chat-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--line); flex-shrink: 0; }
  .chat-title { font-size: 14px; font-weight: 600; color: var(--ink); }
  .chat-nav { display: flex; gap: 4px; }
  .chat-nav button { width: 28px; height: 28px; border-radius: 7px; border: 1px solid var(--line); background: var(--paper-2); color: var(--ink-soft); cursor: pointer; font-size: 14px; }
  .chat-nav button:hover:not(:disabled) { color: var(--ink); }
  .chat-nav button:disabled { opacity: 0.4; cursor: default; }
  .chat-list { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .chat-empty { font-size: 13px; color: var(--ink-faint); line-height: 1.5; margin: 0; }
  .msg { font-size: 13.5px; line-height: 1.5; padding: 9px 12px; border-radius: 12px; max-width: 88%; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: anywhere; min-width: 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; }
  .msg.user { align-self: flex-end; background: var(--accent, #7c5cff); color: #fff; border-bottom-right-radius: 4px; }
  .msg.assistant { align-self: flex-start; background: var(--paper-2); color: var(--ink); border-bottom-left-radius: 4px; }
  .msg.system { align-self: center; background: transparent; color: var(--ink-faint); font-size: 12px; padding: 2px 8px; }
  .msg.loading { opacity: 0.6; }
  .msg-thumb { width: 72px; height: 40px; object-fit: cover; border-radius: 6px; display: block; }
  .msg.user .msg-thumb { box-shadow: 0 0 0 1px rgba(255,255,255,0.25); }
  .chat-input { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--line); flex-shrink: 0; align-items: flex-end; }
  .chat-input textarea { flex: 1; min-width: 0; resize: none; font-size: 13.5px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); color: var(--ink); font-family: inherit; line-height: 1.4; outline: none; box-sizing: border-box; }
  .chat-input button { width: 36px; height: 36px; border-radius: 9px; border: none; background: var(--accent, #7c5cff); color: #fff; font-size: 16px; cursor: pointer; flex-shrink: 0; }
  .chat-input button:disabled { opacity: 0.5; cursor: default; }
</style>
