<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Check from '@lucide/svelte/icons/check';
  import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
  import Minus from '@lucide/svelte/icons/minus';

  // Mirrors AdsCheck in src/lib/server/ads.ts — kept local so this stays a client-safe import.
  type CheckRow = { key: string; ok: boolean; blocking: boolean; fix?: string; detail?: string };

  let { checks, channel }: { checks: CheckRow[]; channel: 'social' | 'google' } = $props();

  const blocking = $derived(checks.filter((c) => !c.ok && c.blocking));
  const warnings = $derived(checks.filter((c) => !c.ok && !c.blocking));
  const done = $derived(checks.filter((c) => c.ok).length);
  // A solved checklist is not a section — it disappears entirely rather than sitting there green.
  const pending = $derived(checks.some((c) => !c.ok));

  // Collapsed: it leads the page when something is missing, so the header alone is the message.
  let open = $state(false);
</script>

{#if pending}
<section class="panel readiness" class:blocked={blocking.length > 0}>
  <button class="panel-head trigger" type="button" onclick={() => (open = !open)} aria-expanded={open}>
    <div class="t">
      {$_('app.ads.readiness.title')}
      <span>{done}/{checks.length}</span>
    </div>
    <div class="right">
      <span class="status" class:err={blocking.length} class:warn={!blocking.length && warnings.length}>
        {#if blocking.length}
          {$_('app.ads.readiness.blocked', { values: { n: blocking.length } })}
        {:else if warnings.length}
          {$_('app.ads.readiness.warn', { values: { n: warnings.length } })}
        {:else}
          {$_('app.ads.readiness.ok')}
        {/if}
      </span>
      <span class="chev" class:open>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 9 6 6 6-6" /></svg>
      </span>
    </div>
  </button>

  {#if open}
    <ul class="checks">
      {#each checks as c (c.key)}
        <li class:ok={c.ok} class:blocking={!c.ok && c.blocking}>
          <span class="mark" aria-hidden="true">
            {#if c.ok}<Check size={13} />{:else if c.blocking}<AlertTriangle size={13} />{:else}<Minus size={13} />{/if}
          </span>
          <span class="txt">
            <span class="lb">
              {$_(`app.ads.readiness.checks.${c.key}.label`, {
                values: { channel: $_(`app.ads.channel.${channel}`) }
              })}
            </span>
            <span class="ds">
              {c.ok && c.detail
                ? c.detail
                : $_(`app.ads.readiness.checks.${c.key}.${c.ok ? 'ok' : 'todo'}`, {
                    values: { channel: $_(`app.ads.channel.${channel}`), detail: c.detail ?? '' }
                  })}
            </span>
          </span>
          {#if !c.ok && c.fix}
            <a class="mini edit" href={c.fix}>{$_('app.ads.readiness.fix')}</a>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
{/if}

<style>
  .readiness { margin-bottom: 16px; }
  .trigger {
    width: 100%; background: none; border: 0; border-bottom: 1px solid var(--line);
    font: inherit; color: inherit; text-align: left; cursor: pointer;
  }
  .trigger:hover { background: var(--paper-2); }
  .right { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
  .status {
    font-size: 12px; font-weight: 600; letter-spacing: 0.01em;
    padding: 5px 12px; border-radius: 980px;
    background: rgba(var(--accent-rgb), 0.1); color: var(--accent);
  }
  .status.err { background: #fdecea; color: #c0392b; }
  .status.warn { background: color-mix(in oklab, #f39c12 16%, transparent); color: #a4630a; }
  .chev { display: inline-flex; color: var(--ink-faint); transition: transform 0.18s var(--ease); }
  .chev svg { width: 16px; height: 16px; }
  .chev.open { transform: rotate(180deg); }

  .checks { list-style: none; margin: 0; padding: 0; }
  .checks li {
    display: flex; align-items: center; gap: 12px; min-height: 62px;
    padding: 12px 22px; border-bottom: 1px solid var(--line);
  }
  .checks li:last-child { border-bottom: none; }
  .mark {
    width: 24px; height: 24px; border-radius: 50%; flex: 0 0 auto;
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--paper-2); color: var(--ink-faint); border: 1px solid var(--line);
  }
  li.ok .mark { background: rgba(var(--accent-rgb), 0.12); color: var(--accent); border-color: transparent; }
  li.blocking .mark { background: #fdecea; color: #c0392b; border-color: transparent; }
  .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .lb { font-size: 14px; font-weight: 600; }
  .ds { font-size: 12.5px; color: var(--ink-faint); line-height: 1.45; }
  li.ok .ds { color: var(--ink-soft); }
  .checks li a { flex: 0 0 auto; text-decoration: none; }
  @media (max-width: 620px) {
    .checks li { align-items: flex-start; flex-wrap: wrap; }
    .checks li a { margin-left: 36px; }
  }
</style>
