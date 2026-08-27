<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import { BUILTIN_AGENT_AVATARS } from '$lib/agent-avatars';
  import { describeSchedule } from '$lib/chat-agent-proposal';
  import type { TeamCard } from '$lib/chat-team';

  /**
   * LA SQUADRA, IN CHAT (tool `show_team`).
   *
   * Prima l'onboarding la squadra la RACCONTAVA: un paragrafo con sei nomi dentro, che nessuno
   * legge e che non lascia niente a schermo. Poi proponeva un agente custom — l'unica cosa che
   * l'utente vedeva davvero, il che faceva sembrare che la squadra fosse quell'uno.
   *
   * Qui i sei ci sono con la loro faccia, la loro riga di mestiere e le loro routine sotto. Nessun
   * testo arriva dal modello: i nomi vengono da `chat.agents.*` e le routine da `app.roster.job.*`,
   * cioè dagli stessi cataloghi della pagina /agents — la card e la pagina non possono divergere,
   * e la squadra si legge nella lingua di chi guarda.
   */
  let { team, brandSlug }: { team: TeamCard; brandSlug: string } = $props();

  const lang = $derived(String($locale ?? 'en').slice(0, 2));
</script>

<div class="team-card">
  <div class="tc-head">
    <span class="tc-title">{$_('chat.team.title')}</span>
    {#if brandSlug}
      <a class="tc-open" href={`/app/${brandSlug}/agents`}>{$_('chat.team.open')}</a>
    {/if}
  </div>

  <ul class="tc-list">
    {#each team.agents as a (a.id)}
      <li class="tc-agent">
        <AgentAvatar
          face={BUILTIN_AGENT_AVATARS[a.id]?.face}
          color={BUILTIN_AGENT_AVATARS[a.id]?.color}
          size={26}
        />
        <div class="tc-body">
          <p class="tc-name">{$_(`chat.agents.${a.id}.label`)}</p>
          <p class="tc-desc">{$_(`chat.agents.${a.id}.desc`)}</p>
          {#if a.routines.length || a.custom.length}
            <ul class="tc-routines">
              {#each a.routines as r (r.key)}
                <li class:off={!r.enabled}>
                  {$_(`app.roster.job.${r.key}.name`)}
                  <span class="tc-when">· {$_(`app.roster.job.${r.key}.cadence`)}</span>
                </li>
              {/each}
              {#each a.custom as c (c.id || c.name)}
                <li class:off={!c.enabled}>
                  {c.name}
                  <span class="tc-when">· {describeSchedule(c.days, c.times, lang)}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="tc-ondemand">{$_('chat.team.onDemand')}</p>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  {#if team.standalone.length}
    <p class="tc-sub">{$_('chat.agents.custom')}</p>
    <ul class="tc-routines tc-standalone">
      {#each team.standalone as c (c.id || c.name)}
        <li class:off={!c.enabled}>
          {c.name}
          <span class="tc-when">· {describeSchedule(c.days, c.times, lang)}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if !team.scheduled}
    <p class="tc-note">{$_('chat.team.paused')}</p>
  {/if}
</div>

<style>
  /* Stessa grammatica di ChatConnectCard: contenuto del turno, non un pannello. Nessun bordo
     attorno alla card — la struttura la fanno le facce e il rientro, non un riquadro. */
  .team-card {
    margin: 8px 0 4px;
    max-width: 460px;
  }
  .tc-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .tc-title {
    font-size: 12px;
    font-weight: 650;
    color: var(--ink-soft);
    letter-spacing: 0.02em;
  }
  .tc-open {
    margin-left: auto;
    font-size: 11.5px;
    color: var(--accent);
    text-decoration: none;
  }
  .tc-open:hover {
    text-decoration: underline;
  }
  .tc-list {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tc-agent {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .tc-body {
    min-width: 0;
    flex: 1;
  }
  .tc-name {
    margin: 0;
    font-size: 13px;
    font-weight: 650;
    color: var(--ink);
  }
  .tc-desc {
    margin: 1px 0 0;
    font-size: 12px;
    color: var(--ink-soft);
    line-height: 1.35;
  }
  .tc-routines {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
  }
  .tc-routines li {
    font-size: 11.5px;
    color: var(--ink-soft);
    line-height: 1.5;
  }
  .tc-routines li::before {
    content: '·';
    margin-right: 5px;
    color: var(--ink-faint);
  }
  .tc-routines li.off {
    color: var(--ink-faint);
    text-decoration: line-through;
  }
  .tc-when {
    color: var(--ink-faint);
  }
  .tc-ondemand,
  .tc-note {
    margin: 3px 0 0;
    font-size: 11.5px;
    color: var(--ink-faint);
  }
  .tc-sub {
    margin: 10px 0 0;
    font-size: 12px;
    font-weight: 650;
    color: var(--ink-soft);
  }
  .tc-standalone {
    margin-top: 2px;
  }
  .tc-note {
    margin-top: 8px;
  }
</style>
