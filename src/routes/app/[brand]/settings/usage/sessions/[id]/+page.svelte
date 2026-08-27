<script lang="ts">
  import { _ } from 'svelte-i18n';

  let { data } = $props();
  const brand = $derived(data.brand);
  const session = $derived(data.session);
  const back = $derived(`/app/${brand.slug}/settings/usage`);

  const eventsJson = $derived.by(() => {
    try {
      return JSON.stringify(session.events ?? [], null, 2);
    } catch {
      return '[]';
    }
  });
</script>

<div class="session">
  <a class="back" href={back}>{$_('app.settings.usage.sessionBack')}</a>
  <div class="head">
    <div class="title">{session.agent}</div>
    <div class="meta">
      <span class="pill" class:ok={session.status === 'finished'} class:bad={session.status === 'failed' || session.status === 'aborted'}>
        {session.status}
      </span>
      {#if session.mode}<span class="pill">{session.mode}</span>{/if}
      {#if session.surface}<span class="pill">{session.surface}</span>{/if}
      {#if session.provider}<span class="pill">{session.provider}</span>{/if}
      {#if session.model}<span class="pill">{session.model}</span>{/if}
      <span class="pill">{session.event_count} events</span>
    </div>
    <div class="when">{new Date(session.created_at).toLocaleString()}</div>
    {#if session.error}<div class="err">{session.error}</div>{/if}
  </div>

  {#if session.system_prompt}
    <section class="panel">
      <div class="panel-head">
        <div class="t">{$_('app.settings.usage.sessionSystem')}</div>
      </div>
      <pre class="log">{session.system_prompt}</pre>
    </section>
  {/if}

  <section class="panel">
    <div class="panel-head">
      <div class="t">{$_('app.settings.usage.sessionTranscript')}</div>
    </div>
    <pre class="log">{session.transcript}</pre>
  </section>

  <details class="panel events">
    <summary class="panel-head">
      <div class="t">{$_('app.settings.usage.sessionEvents')}</div>
    </summary>
    <pre class="log">{eventsJson}</pre>
  </details>
</div>

<style>
  .session {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .back {
    font-size: 12.5px;
    color: var(--ink-faint);
    text-decoration: none;
    width: fit-content;
  }
  .back:hover {
    color: var(--ink);
  }
  .head .title {
    font-size: 18px;
    font-weight: 650;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .when {
    margin-top: 6px;
    font-size: 12px;
    color: var(--ink-faint);
  }
  .err {
    margin-top: 8px;
    font-size: 13px;
    color: #c0392b;
  }
  .pill {
    font-size: 11.5px;
    padding: 2px 7px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.04);
    color: var(--ink-faint);
  }
  .pill.ok {
    color: var(--accent);
  }
  .pill.bad {
    color: #c0392b;
  }
  :global([data-theme='dark']) .pill {
    background: rgba(255, 255, 255, 0.06);
  }
  .log {
    margin: 0;
    padding: 14px 18px 18px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: min(70vh, 720px);
    overflow: auto;
  }
  .events summary {
    cursor: pointer;
    list-style: none;
  }
  .events summary::-webkit-details-marker {
    display: none;
  }
</style>
