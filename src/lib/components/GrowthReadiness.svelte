<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Check from '@lucide/svelte/icons/check';
  import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
  import Minus from '@lucide/svelte/icons/minus';
  import type { GrowthCheck } from '$lib/growth-readiness';

  let {
    checks,
    compact = false
  }: {
    checks: GrowthCheck[];
    /** When true, start collapsed (plan page header nudge). */
    compact?: boolean;
  } = $props();

  const blocking = $derived(checks.filter((c) => !c.ok && c.blocking));
  const warnings = $derived(checks.filter((c) => !c.ok && !c.blocking));
  const done = $derived(checks.filter((c) => c.ok).length);
  const pending = $derived(checks.some((c) => !c.ok));
  let open = $state(!compact);
</script>

{#if pending}
  <section class="panel readiness" class:blocked={blocking.length > 0}>
    <button class="panel-head trigger" type="button" onclick={() => (open = !open)} aria-expanded={open}>
      <div class="t">
        {$_('app.growthReadiness.title')}
        <span>{done}/{checks.length}</span>
      </div>
      <div class="right">
        <span class="status" class:err={blocking.length} class:warn={!blocking.length && warnings.length}>
          {#if blocking.length}
            {$_('app.growthReadiness.blocked', { values: { n: blocking.length } })}
          {:else if warnings.length}
            {$_('app.growthReadiness.warn', { values: { n: warnings.length } })}
          {:else}
            {$_('app.growthReadiness.ok')}
          {/if}
        </span>
        <span class="chev" class:open>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 9 6 6 6-6" /></svg>
        </span>
      </div>
    </button>

    {#if open}
      <p class="lede">
        {#if blocking.length}
          {$_('app.growthReadiness.ledeBlocked')}
        {:else}
          {$_('app.growthReadiness.ledeWarn')}
        {/if}
      </p>
      <ul class="checks">
        {#each checks as c (c.key)}
          <li class:ok={c.ok} class:blocking={!c.ok && c.blocking}>
            <span class="mark" aria-hidden="true">
              {#if c.ok}<Check size={13} />{:else if c.blocking}<AlertTriangle size={13} />{:else}<Minus size={13} />{/if}
            </span>
            <span class="txt">
              <span class="lb">{$_(`app.growthReadiness.checks.${c.key}.label`)}</span>
              <span class="ds">
                {$_(`app.growthReadiness.checks.${c.key}.${c.ok ? 'ok' : 'todo'}`, {
                  values: { detail: c.detail ?? '' }
                })}
              </span>
            </span>
            {#if !c.ok && c.fix}
              <a class="mini edit" href={c.fix}>{$_('app.growthReadiness.fix')}</a>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .readiness {
    margin-bottom: 16px;
  }
  .readiness.blocked {
    border-color: color-mix(in oklab, var(--danger, #c44) 35%, var(--line));
  }
  .trigger {
    width: 100%;
    background: none;
    border: 0;
    border-bottom: 1px solid var(--line);
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
  }
  .t {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }
  .t span {
    font-weight: 500;
    opacity: 0.55;
    font-size: 0.85em;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .status {
    font-size: 0.85em;
    opacity: 0.75;
  }
  .status.err {
    color: var(--danger, #c44);
    opacity: 1;
  }
  .status.warn {
    color: var(--warn, #b8860b);
    opacity: 1;
  }
  .chev {
    display: inline-flex;
    width: 18px;
    height: 18px;
    transition: transform 0.15s ease;
  }
  .chev.open {
    transform: rotate(180deg);
  }
  .chev svg {
    width: 100%;
    height: 100%;
  }
  .lede {
    margin: 0;
    padding: 10px 14px 0;
    font-size: 0.92em;
    line-height: 1.45;
    opacity: 0.8;
  }
  .checks {
    list-style: none;
    margin: 0;
    padding: 8px 8px 12px;
  }
  .checks li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 6px;
    border-radius: 8px;
  }
  .checks li.blocking {
    background: color-mix(in oklab, var(--danger, #c44) 8%, transparent);
  }
  .mark {
    flex: 0 0 auto;
    margin-top: 2px;
    opacity: 0.7;
  }
  .txt {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .lb {
    font-weight: 600;
    font-size: 0.92em;
  }
  .ds {
    font-size: 0.85em;
    opacity: 0.72;
    line-height: 1.35;
  }
  .mini.edit {
    flex: 0 0 auto;
    font-size: 0.82em;
    text-decoration: none;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--line);
    color: inherit;
  }
</style>
