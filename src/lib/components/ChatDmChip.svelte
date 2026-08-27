<script lang="ts">
  import { _ } from 'svelte-i18n';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import {
    BUILTIN_AGENT_AVATARS,
    fallbackAvatarColor,
    fallbackAvatarFace
  } from '$lib/agent-avatars';
  import { dmSendsFromCall } from '$lib/chat-dm';

  /**
   * La riga "N messaggi con X" sotto un turno che ha usato `message_agent`: un link compatto al
   * thread privato fra i due agenti (che è in sola lettura per l'utente). Tutto viene dalle
   * tool-call — `dmSends` hoisted in persistenza, o l'output srotolato dal kit — quindi la riga
   * si ridisegna identica in streaming e alla riapertura, senza query sue.
   *
   * È un EVENTO DI SISTEMA, non contenuto del turno: niente box/bordo/sfondo e centrata nella
   * colonna (stile iMessage), con il volto dell'agente di DESTINAZIONE al posto dell'icona —
   * lo stesso personaggio che l'utente ritrova nella sidebar aprendo il thread.
   */
  type DmCall = {
    toolName: string;
    output?: unknown;
    dmSends?: unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [k: string]: any;
  };

  let { calls = [] as DmCall[], brandSlug = '' }: { calls?: DmCall[]; brandSlug?: string } = $props();

  /** Un gruppo per thread DM: più invii allo stesso agente nello stesso turno = una riga sola. */
  const groups = $derived.by(() => {
    const byThread = new Map<string, { name: string; to: string; n: number }>();
    for (const tc of calls) {
      if (tc.toolName !== 'message_agent') continue;
      for (const send of dmSendsFromCall(tc)) {
        const g = byThread.get(send.threadId) ?? { name: send.name, to: send.to, n: 0 };
        g.n += 1;
        byThread.set(send.threadId, g);
      }
    }
    return [...byThread.entries()];
  });

  /** Il volto del destinatario: identità fissa per i builtin (`web`, `content`, …); per i
   *  custom (`custom:<uuid>`) la stessa derivazione deterministica del resto del prodotto —
   *  l'avatar salvato non viaggia nel tool output, e una faccia stabile basta a riconoscerlo. */
  function avatarFor(g: { to: string; name: string }) {
    const seed = g.to || g.name;
    return (
      BUILTIN_AGENT_AVATARS[g.to] ?? {
        face: fallbackAvatarFace(seed),
        color: fallbackAvatarColor(seed)
      }
    );
  }
</script>

{#if groups.length}
  <div class="dm-chips">
    {#each groups as [threadId, g] (threadId)}
      {@const av = avatarFor(g)}
      <a class="dm-chip" href={`/app/${brandSlug}/chat/${threadId}`}>
        <AgentAvatar face={av.face} color={av.color} size={16} title={g.name} />
        <span>{$_('chat.dmChip', { values: { n: g.n, name: g.name } })}</span>
      </a>
    {/each}
  </div>
{/if}

<style>
  /* Evento di sistema: centrato nella colonna, in colonna se i thread sono più d'uno. */
  .dm-chips {
    align-self: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    margin: 2px 0;
    max-width: 100%;
  }
  .dm-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--ink-soft);
    text-decoration: none;
    min-width: 0;
    transition: color 0.12s ease;
  }
  .dm-chip:hover,
  .dm-chip:focus-visible {
    color: var(--ink);
  }
  .dm-chip span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
