<script lang="ts">
  /**
   * IL DESKTOP A SCHERMO INTERO — la pagina dove l'utente guida la macchina dell'agente.
   *
   * Nel pannello ci stava un francobollo: si vede che succede qualcosa, non ci si lavora. Qui lo
   * schermo prende tutto — il nome `+page@.svelte` azzera i layout intermedi e riparte da quello
   * di radice, altrimenti la sidebar dell'app si mangerebbe 280px di desktop — e la barra in basso
   * porta le tre cose che l'iframe non può darci, perché vive su un altro dominio e la nostra
   * pagina non lo può toccare:
   *  - la TASTIERA del telefono, che si apre solo se un campo NOSTRO prende il fuoco;
   *  - gli APPUNTI nei due sensi, che dentro noVNC sono raggiungibili solo dal suo pannello.
   */
  import { _ } from 'svelte-i18n';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { ArrowLeft, Keyboard, ClipboardCopy, ClipboardPaste } from '@lucide/svelte';

  const base = $derived(`/app/${$page.params.brand}`);
  // La macchina è dell'agente, non del brand: l'identità arriva in query da chi ci ha portati qui.
  const agentParam = $derived(`?agent=${encodeURIComponent($page.url.searchParams.get('agent') ?? '')}`);

  let src = $state<string | null>(null);
  let ready = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let keyboardInput = $state<HTMLInputElement | null>(null);

  const loading = $derived(!src || !ready);

  /**
   * La stessa chiamata apre e TIENE APERTO: l'affitto della VM si alza a ogni passaggio, e i
   * processi caduti (Xvfb, il pannello, x11vnc) vengono rilanciati. Senza il battito, dopo il
   * lease la macchina si spegne e resta lo schermo dell'ultimo fotogramma — che sembra vivo.
   */
  const HEARTBEAT_MS = 3 * 60_000;

  async function open(first: boolean) {
    try {
      const res = await fetch(`${base}/agents/computer/desktop${agentParam}`, { method: 'POST' });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        if (first) error = body.error ?? 'desktop_failed';
        return;
      }
      // L'URL non cambia fra un battito e l'altro: riassegnarlo ricaricherebbe l'iframe e
      // butterebbe via la sessione VNC ogni tre minuti.
      if (src !== body.url) src = body.url;
    } catch {
      if (first) error = 'desktop_failed';
    }
  }

  onMount(() => {
    open(true);
    const beat = setInterval(() => open(false), HEARTBEAT_MS);
    return () => clearInterval(beat);
  });

  /** Un messaggio che sparisce da solo: qui non c'è spazio per una riga di stato permanente. */
  function flash(message: string) {
    notice = message;
    setTimeout(() => (notice = null), 2500);
  }

  async function copyFromVm() {
    const res = await fetch(`${base}/agents/computer/clipboard${agentParam}`);
    if (!res.ok) return flash($_('chat.computer.clipboardFailed'));
    const { text } = (await res.json()) as { text: string };
    if (!text) return flash($_('chat.computer.clipboardEmpty'));
    await navigator.clipboard.writeText(text);
    flash($_('chat.computer.copiedFromVm'));
  }

  async function pasteToVm() {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Safari e i browser che non danno la lettura senza gesto: meglio dirlo che fingere.
      return flash($_('chat.computer.clipboardBlocked'));
    }
    if (!text) return flash($_('chat.computer.clipboardEmpty'));
    const res = await fetch(`${base}/agents/computer/clipboard${agentParam}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text })
    });
    flash(res.ok ? $_('chat.computer.pastedToVm') : $_('chat.computer.clipboardFailed'));
  }

  /**
   * La tastiera di sistema si apre solo col fuoco su un campo di questa pagina. Quello che viene
   * digitato lo batte `xdotool` dentro la VM: un giro in più, ma è l'unico che attraversa il
   * confine fra domini.
   */
  function openKeyboard() {
    keyboardInput?.focus();
  }

  async function sendTyped(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const text = input.value;
    if (!text) return;
    input.value = '';
    await fetch(`${base}/agents/computer/input${agentParam}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text })
    });
  }

  async function sendKey(key: string) {
    await fetch(`${base}/agents/computer/input${agentParam}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key })
    });
  }
</script>

<svelte:head><title>{$_('chat.computer.desktopTitle')}</title></svelte:head>

<div class="cd">
  <header class="cd-top">
    <a class="cd-back" href={base}><ArrowLeft size={16} strokeWidth={2} />{$_('chat.computer.backToApp')}</a>
    {#if notice}<span class="cd-notice">{notice}</span>{/if}
  </header>

  <div class="cd-screen">
    {#if src}
      <iframe
        class="cd-frame"
        class:cd-hidden={!ready}
        {src}
        title={$_('chat.computer.desktopTitle')}
        onload={() => (ready = true)}
      ></iframe>
    {/if}
    {#if error}
      <p class="cd-msg">{$_('chat.computer.controlError')}</p>
    {:else if loading}
      <!-- Accendere la macchina e il desktop prende secondi: un'attesa dichiarata, non lo stato
           di prima che descrive un mondo che stiamo già cambiando. -->
      <div class="cd-msg">
        <span class="cd-spinner" aria-hidden="true"></span>
        <p>{$_('chat.computer.controlOpening')}</p>
      </div>
    {/if}
  </div>

  <footer class="cd-bar">
    <button type="button" onclick={openKeyboard}>
      <Keyboard size={15} strokeWidth={2} />{$_('chat.computer.keyboard')}
    </button>
    <button type="button" onclick={copyFromVm}>
      <ClipboardCopy size={15} strokeWidth={2} />{$_('chat.computer.copyFromVm')}
    </button>
    <button type="button" onclick={pasteToVm}>
      <ClipboardPaste size={15} strokeWidth={2} />{$_('chat.computer.copyToVm')}
    </button>
    <!-- Fuori campo ma non nascosto agli screen reader: è il campo che apre la tastiera. -->
    <input
      class="cd-keys"
      bind:this={keyboardInput}
      aria-label={$_('chat.computer.keyboard')}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      onchange={sendTyped}
      onkeydown={(e) => {
        if (e.key !== 'Enter') return;
        sendTyped(e);
        sendKey('Return');
      }}
    />
  </footer>
</div>

<style>
  .cd {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--paper);
  }
  .cd-top {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
    font-size: 12px;
  }
  .cd-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--ink);
    text-decoration: none;
  }
  .cd-notice {
    color: var(--ink-faint);
  }
  .cd-screen {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    background: #000;
  }
  .cd-frame {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }
  /* Nascosto ma CARICATO: toglierlo dal DOM farebbe ripartire la connessione VNC da capo. */
  .cd-hidden {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .cd-msg {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--ink-faint);
    font-size: 13px;
  }
  .cd-msg p {
    margin: 0;
  }
  .cd-spinner {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid var(--line);
    border-top-color: var(--ink);
    animation: cd-spin 0.8s linear infinite;
  }
  @keyframes cd-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cd-spinner {
      animation-duration: 2.4s;
    }
  }
  .cd-bar {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--line);
    /* La barra deve restare sopra la tastiera del telefono e sopra la home bar di iOS. */
    padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
  }
  .cd-bar button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: inherit;
    font-size: 12px;
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: transparent;
    color: var(--ink);
    cursor: pointer;
  }
  .cd-keys {
    /* Serve il FUOCO, non la vista: un campo nascosto con `display:none` la tastiera non la apre. */
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    border: 0;
    padding: 0;
  }
</style>
