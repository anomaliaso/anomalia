<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { Check } from '@lucide/svelte';
  import type { ConnectProposal } from '$lib/chat-connect';

  /**
   * La card "connetti questa app" renderizzata dalle tool-call parts di `propose_app_connection`
   * (ChatColumn + chat a pagina piena). Il bottone apre la Connect Link Composio in una nuova
   * tab; lo stato diventa "Connessa" quando il claim — la stessa reconcile on-read di
   * Settings → Connectors, via POST /app/{brand}/knowledge/connect — vede l'account attivo.
   * Nessun token passa mai di qui: solo slug, nome, logo e l'URL hostato da Composio.
   */
  let { connect, brandSlug }: { connect: ConnectProposal; brandSlug: string } = $props();

  let status = $state<'pending' | 'connected'>(connect.status);
  /** L'utente ha aperto la Connect Link da QUESTA card: da qui in poi il ritorno in tab riclama. */
  let opened = $state(false);
  let claiming = false;

  async function claim() {
    if (claiming || status === 'connected' || !brandSlug) return;
    claiming = true;
    try {
      const res = await fetch(`/app/${brandSlug}/knowledge/connect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'claim', toolkit: connect.toolkit })
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; status?: string } | null;
      if (body?.ok || body?.status === 'active') status = 'connected';
    } catch {
      /* ancora in autorizzazione, o offline: la card resta com'è e riprova al prossimo focus */
    } finally {
      claiming = false;
    }
  }

  function openConnect() {
    if (!connect.connect_url) return;
    window.open(connect.connect_url, '_blank', 'noopener');
    opened = true;
  }

  $effect(() => {
    if (status === 'connected') return;
    // Riaprire un thread vecchio: la connessione può essere arrivata da un'altra superficie.
    void claim();
    // ponytail: poll on-focus, niente realtime — il claim è idempotente e la reconcile esiste già.
    const onFocus = () => {
      if (opened) void claim();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  });
</script>

<div class="connect-card" class:connected={status === 'connected'}>
  <div class="cc-head">
    {#if connect.logo}
      <img class="cc-logo" src={connect.logo} alt="" loading="lazy" />
    {:else}
      <span class="cc-logo cc-logo-fallback" aria-hidden="true">{connect.name.slice(0, 1)}</span>
    {/if}
    <span class="cc-name">{connect.name}</span>
    {#if status === 'connected'}
      <span class="cc-done"><Check size={14} strokeWidth={3} /> {$_('app.shell.connectCardConnected')}</span>
    {:else}
      <button type="button" class="cc-cta" onclick={openConnect}>
        {$_('app.shell.connectCardCta', { values: { name: connect.name } })}
      </button>
    {/if}
  </div>
  <p class="cc-reason">{connect.reason || $_('app.shell.connectCardReason', { values: { name: connect.name } })}</p>
  {#if status !== 'connected' && opened}
    <p class="cc-waiting">{$_('app.shell.connectCardOpened')}</p>
  {/if}
</div>

<style>
  /* Contenuto del turno, a sinistra — ma niente pannello: una riga logo + nome + bottone
     ghost, con la motivazione come riga quieta sotto. Il bottone resta l'unico elemento
     azionabile del blocco, quindi resta evidente anche senza il riempimento accent. */
  .connect-card {
    margin: 8px 0 4px;
    max-width: 420px;
  }
  .cc-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cc-logo {
    width: 18px;
    height: 18px;
    border-radius: 5px;
    object-fit: contain;
    flex: none;
  }
  .cc-logo-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--paper-3);
    color: var(--ink-soft);
    font-size: 11px;
    font-weight: 700;
  }
  .cc-name {
    font-size: 13px;
    font-weight: 650;
    color: var(--ink);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cc-done {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .cc-reason {
    margin: 3px 0 0;
    padding-left: 26px; /* allinea alla colonna del nome, sotto il logo */
    font-size: 12px;
    color: var(--ink-soft);
    line-height: 1.4;
  }
  /* Ghost: bordo sottile, testo accent — evidente perché è l'unica azione del blocco. */
  .cc-cta {
    appearance: none;
    margin-left: auto;
    border: 1px solid color-mix(in oklab, var(--accent) 45%, var(--line));
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 600;
    background: none;
    color: var(--accent);
    cursor: pointer;
    flex: none;
    transition: border-color 0.12s ease, background-color 0.12s ease;
  }
  .cc-cta:hover {
    border-color: var(--accent);
    background: color-mix(in oklab, var(--accent) 8%, transparent);
  }
  .cc-waiting {
    margin: 4px 0 0;
    padding-left: 26px;
    font-size: 11.5px;
    color: var(--ink-faint);
  }
</style>
