<script lang="ts">
  // L'agente che si offre negli empty state (FEATURE_NAV_TEAM): al posto del classico
  // "crea il tuo primo X", il proprietario della pagina si propone — una riga e il link al
  // suo thread. Niente meccanica nuova: nome dal roster i18n, volto/colore con la stessa
  // derivazione di threadIdentity, href dal thread persistente del job se esiste
  // (jobThreadHref, agent-owners.ts — la fonte unica del "chi possiede cosa").
  import { _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import { chatThreads } from '$lib/stores/chat';
  import { fallbackAvatarColor, fallbackAvatarFace } from '$lib/agent-avatars';
  import { jobThreadHref, type OwnerJobKey } from '$lib/agent-owners';

  let { job }: { job: OwnerJobKey } = $props();

  const slug = $derived($page.params.brand as string);
  const name = $derived($_(`app.roster.job.${job}.name`));
  const href = $derived(jobThreadHref($chatThreads, slug ?? '', job));
</script>

<a class="agent-offer" {href}>
  <AgentAvatar face={fallbackAvatarFace(job)} color={fallbackAvatarColor(job)} size={22} />
  <span>{$_('app.nav2.agentOffer', { values: { name } })}</span>
</a>

<style>
  .agent-offer {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--ink-soft);
    font-size: 13.5px;
    text-decoration: none;
  }
  .agent-offer:hover span {
    color: var(--ink);
    text-decoration: underline;
  }
</style>
