<script lang="ts">
  /**
   * Il rail della sovrapposizione su mobile: lo stesso `PageRail` della modal, dentro un
   * pannello che apre il burger.
   *
   * Perché non la modal anche qui: su telefono le pagine restano pagine vere (la modal è
   * armata solo su desktop, `PageModal` con `desktop=false` non fa nulla). Cambia dunque
   * solo la NAVIGAZIONE: dentro una pagina della sovrapposizione il burger apre queste
   * voci invece dei quattro link della dashboard, da cui non si raggiungeva nient'altro.
   */
  import { page } from '$app/stores';
  import { _ } from 'svelte-i18n';
  import { beforeNavigate } from '$app/navigation';
  import { fade, fly } from 'svelte/transition';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import PageRail from '$lib/components/PageRail.svelte';
  import { DEFAULT_CHAT_AGENT_AVATAR } from '$lib/agent-avatars';
  import { overlayRoute } from '$lib/overlay-route';
  import { railDrawerOpen, railDrawerReady } from '$lib/stores/rail-drawer';

  let {
    base,
    enabled = false,
    navGroups = []
  }: {
    base: string;
    /** Solo mobile: su desktop il rail è la colonna della modal e questo non esiste. */
    enabled?: boolean;
    navGroups?: { label?: string; items?: { href: string; label: string }[] }[];
  } = $props();

  const path = $derived($page.url.pathname.replace(/\/$/, ''));
  const settingsBase = $derived(`${base}/settings`);
  const route = $derived(
    overlayRoute(path, base) ??
      // Una sezione settings che resta pagina piena (il drill-down di `usage/sessions/<id>`):
      // la modal non la ospita, ma il burger deve comunque aprire la mappa delle impostazioni —
      // su mobile non esiste altra navigazione da lì, e senza questo il bottone sarebbe morto.
      // Nessuna voce del rail corrisponde, quindi non si accende un attivo sbagliato.
      (path.startsWith(`${settingsBase}/`) ? `settings/${path.slice(settingsBase.length + 1)}` : null)
  );
  /** C'è un rail da mostrare solo se la pagina corrente vive in una sovrapposizione. */
  const available = $derived(enabled && route !== null);

  $effect(() => {
    railDrawerReady.set(available);
    if (!available) railDrawerOpen.set(false);
    return () => railDrawerReady.set(false);
  });

  // Una voce scelta è una navigazione vera: il pannello si toglie di mezzo subito, non
  // dopo che la pagina nuova ha finito di caricare.
  beforeNavigate(() => railDrawerOpen.set(false));

  $effect(() => {
    if (!$railDrawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  });
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && $railDrawerOpen) railDrawerOpen.set(false);
  }}
/>

{#if available && $railDrawerOpen}
  <div
    class="rd-backdrop"
    role="presentation"
    transition:fade={{ duration: 140 }}
    onclick={(e) => {
      if (e.target === e.currentTarget) railDrawerOpen.set(false);
    }}
  >
    <aside class="rd-panel" transition:fly={{ x: -40, duration: 180, opacity: 1 }}>
      <!-- La via d'uscita: fuori dalla sovrapposizione, non un'altra voce dentro. Chevron
           a sinistra perché è un ritorno, e il volto è quello dell'agente classico
           (`DEFAULT_CHAT_AGENT_AVATAR`, colore `theme`): la palla segue il tema, quindi
           nera su chiaro e bianca su scuro senza toccare AgentAvatar. -->
      <a class="rd-back" href={base}>
        <ChevronLeft class="size-4 shrink-0" strokeWidth={2} />
        <AgentAvatar
          face={DEFAULT_CHAT_AGENT_AVATAR.face}
          color={DEFAULT_CHAT_AGENT_AVATAR.color}
          size={22}
        />
        <span>{$_('app.nav2.backToTeam')}</span>
      </a>
      <PageRail {base} {route} {navGroups} drawer onnavigate={() => railDrawerOpen.set(false)} />
    </aside>
  </div>
{/if}

<style>
  /* Sopra la chrome dell'app (sidebar 30, barre 100-111), come la modal su desktop. */
  .rd-backdrop {
    position: fixed;
    inset: 0;
    z-index: 150;
    background: rgba(0, 0, 0, 0.44);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
  }
  .rd-panel {
    position: absolute;
    inset: 0 auto 0 0;
    width: min(86vw, 340px);
    display: flex;
    flex-direction: column;
    background: var(--paper-2, #f5f5f7);
    border-right: 1px solid var(--line, #e3e3e6);
    box-shadow: 8px 0 32px -12px rgba(0, 0, 0, 0.28);
    padding-top: max(env(safe-area-inset-top), 10px);
  }
  .rd-back {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 10px 10px;
    padding: 9px 10px;
    border-radius: 10px;
    background: var(--paper, #fff);
    border: 1px solid var(--line, #e3e3e6);
    color: var(--ink, #1d1d1f);
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
  }
  .rd-back:active {
    background: var(--paper-2, #f5f5f7);
  }
</style>
