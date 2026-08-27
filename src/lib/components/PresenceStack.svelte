<script lang="ts">
  import { _ } from 'svelte-i18n';
  import type { PresencePeer } from '$lib/realtime/presence-peers';

  let { peers = [] as PresencePeer[] }: { peers?: PresencePeer[] } = $props();

  /** Two faces is the point where a stack still reads as faces rather than as a blob. */
  const MAX_FACES = 2;

  const faces = $derived(peers.slice(0, MAX_FACES));
  const label = $derived(
    peers.length === 1
      ? peers[0].name.split(' ')[0]
      : `${peers.length} ${$_('app.presence.here')}`
  );
  const title = $derived(peers.map((p) => p.name).join(', '));

  function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }
</script>

{#if peers.length}
  <div class="presence" {title} aria-label={`${title} — ${$_('app.presence.here')}`}>
    <div class="presence-faces">
      {#each faces as peer (peer.userId)}
        <span class="presence-face">
          {#if peer.avatar}
            <img src={peer.avatar} alt={peer.name} referrerpolicy="no-referrer" />
          {:else}
            <span class="presence-initials">{initials(peer.name)}</span>
          {/if}
        </span>
      {/each}
    </div>
    <span class="presence-label">{label}</span>
  </div>
{/if}

<style>
  .presence {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 10px 0 4px;
    border-radius: 999px;
    background: var(--paper-2);
    flex: 0 0 auto;
    min-width: 0;
    /* Arrivals should register without yanking the eye away from the page. */
    animation: presence-in 0.22s ease-out;
  }
  @keyframes presence-in {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .presence {
      animation: none;
    }
  }
  .presence-faces {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
  }
  .presence-face {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--accent);
    color: #fff;
    /* The ring is what separates overlapping faces; it must match the pill, not the page. */
    box-shadow: 0 0 0 2px var(--paper-2);
    flex: 0 0 auto;
  }
  .presence-face + .presence-face {
    margin-inline-start: -8px;
  }
  .presence-face img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .presence-initials {
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.02em;
  }
  .presence-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* On phones the top bar is already tight — the faces alone still carry the signal. */
  @media (max-width: 640px) {
    .presence {
      padding-inline-end: 4px;
    }
    .presence-label {
      display: none;
    }
  }
</style>
