<script lang="ts">
  import type { Component } from 'svelte';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { _ } from 'svelte-i18n';
  import AnimatedNum from '$lib/components/AnimatedNum.svelte';

  type Stat = { label: string; value: string | number };

  let {
    href,
    title,
    description,
    stats = [],
    badge,
    icon: Icon,
    accent = false,
  }: {
    href: string;
    title: string;
    description: string;
    stats?: Stat[];
    badge?: number;
    icon: Component;
    /** Emphasize the card when it has actionable items (badge > 0). */
    accent?: boolean;
  } = $props();

  const hero = $derived(stats[0] ?? null);
  const rest = $derived(stats.slice(1));
  const emphasized = $derived(accent || (badge != null && badge > 0));
</script>

<a class="hub-card" class:emphasized {href}>
  <div class="hub-card-top">
    <span class="hub-card-icon" aria-hidden="true">
      <Icon size={18} strokeWidth={1.75} />
    </span>
    <div class="hub-card-meta">
      <div class="hub-card-title-row">
        <span class="hub-card-title">{title}</span>
        {#if badge && badge > 0}
          <span class="hub-card-badge">{badge > 99 ? '99+' : badge}</span>
        {/if}
      </div>
      <p class="hub-card-desc">{description}</p>
    </div>
  </div>

  {#if hero}
    <div class="hub-card-metrics">
      <div class="hub-card-hero">
        <span class="hub-card-hero-n">
          {#if typeof hero.value === 'number'}
            <AnimatedNum value={hero.value} />
          {:else}
            {hero.value}
          {/if}
        </span>
        <span class="hub-card-hero-l">{hero.label}</span>
      </div>
      {#if rest.length}
        <div class="hub-card-side">
          {#each rest as s (s.label)}
            <div class="hub-card-chip">
              <span class="hub-card-chip-n">
                {#if typeof s.value === 'number'}
                  <AnimatedNum value={s.value} />
                {:else}
                  {s.value}
                {/if}
              </span>
              <span class="hub-card-chip-l">{s.label}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <div class="hub-card-footer">
    <span class="hub-card-cta">{$_('app.hub.overview.open')}</span>
    <ChevronRight class="hub-card-arrow" size={16} strokeWidth={2} aria-hidden="true" />
  </div>
</a>

<style>
  .hub-card {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 18px 20px;
    border: 1px solid var(--line);
    border-radius: 20px;
    background: var(--paper);
    color: var(--ink);
    text-decoration: none;
    min-height: 100%;
    min-width: 0;
    transition:
      background 0.18s ease,
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      transform 0.18s ease;
  }
  .hub-card:hover {
    background: var(--paper-2);
    border-color: color-mix(in srgb, var(--accent) 28%, var(--line));
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.05);
    transform: translateY(-1px);
  }
  .hub-card.emphasized {
    border-color: color-mix(in srgb, var(--accent) 32%, var(--line));
    background:
      linear-gradient(
        160deg,
        color-mix(in srgb, var(--accent) 9%, var(--paper)) 0%,
        var(--paper) 48%
      );
  }
  .hub-card.emphasized:hover {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
  }

  .hub-card-top {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .hub-card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 11px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    flex-shrink: 0;
  }

  .hub-card-meta {
    flex: 1;
    min-width: 0;
  }

  .hub-card-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .hub-card-title {
    font-size: 15.5px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.25;
  }

  .hub-card-badge {
    font-size: 10.5px;
    font-weight: 700;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .hub-card-desc {
    margin: 5px 0 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--ink-soft);
  }

  .hub-card-metrics {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 14px;
    padding-top: 2px;
    flex-wrap: wrap;
  }

  .hub-card-hero {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .hub-card-hero-n {
    font-size: clamp(26px, 4.5cqi, 34px);
    font-weight: 700;
    letter-spacing: -0.04em;
    line-height: 1;
    color: var(--ink);
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
  }

  .hub-card-hero-l {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--ink-faint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .hub-card-side {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;
  }

  .hub-card-chip {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border-radius: 12px;
    background: var(--paper-2);
    border: 1px solid var(--line);
    min-width: 72px;
  }

  .hub-card-chip-n {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }

  .hub-card-chip-l {
    font-size: 10.5px;
    color: var(--ink-faint);
    line-height: 1.2;
  }

  .hub-card-footer {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: auto;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }

  .hub-card-cta {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--accent);
  }

  :global(.hub-card-arrow) {
    color: var(--accent);
    flex-shrink: 0;
  }

  .hub-card:hover .hub-card-cta,
  .hub-card:hover :global(.hub-card-arrow) {
    color: var(--ink);
  }
</style>
