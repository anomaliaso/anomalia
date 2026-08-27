<script lang="ts">
  import { _ } from 'svelte-i18n';

  let {
    index = 0,
    total = 4,
    label = '',
    early = false,
    name = '',
    platformCount = 0
  }: {
    index?: number;
    total?: number;
    label?: string;
    early?: boolean;
    name?: string;
    platformCount?: number;
  } = $props();
</script>

<div class="pub-overlay">
  <div class="pub-card">
    <div class="pub-rings"><span></span><span></span><span></span></div>
    <h2>{$_('onboarding.publishSteps.' + label)}</h2>
    <p>
      {#if early}
        {$_('onboarding.publishing.earlyBefore')}<b>{name}</b>{$_('onboarding.publishing.earlyAfter')}
      {:else}
        {$_('onboarding.publishing.before')}<b>{name}</b>{$_('onboarding.publishing.after', { values: { count: platformCount } })}
      {/if}
    </p>
    <div class="pub-bar"><span style={`width:${((index + 1) / total) * 100}%`}></span></div>
  </div>
</div>

<style>
  .pub-overlay { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 24px;
    background: color-mix(in srgb, var(--paper, #fff) 88%, transparent); backdrop-filter: blur(10px); animation: fade 0.25s var(--ease, ease); }
  .pub-card { text-align: center; max-width: 380px; }
  .pub-card h2 { font-size: 1.4rem; font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 22px 0 0; }
  .pub-card p { color: var(--ink-soft, #6e6e73); margin: 10px 0 0; line-height: 1.5; }
  .pub-rings { position: relative; width: 64px; height: 64px; margin: 0 auto; }
  .pub-rings span { position: absolute; inset: 0; margin: auto; border-radius: 50%; border: 2.5px solid var(--accent, #7c5cff);
    opacity: 0; animation: ring 1.8s var(--ease, ease) infinite; }
  .pub-rings span:nth-child(2) { animation-delay: 0.6s; }
  .pub-rings span:nth-child(3) { animation-delay: 1.2s; }
  .pub-bar { height: 5px; border-radius: 980px; background: var(--paper-2, #f1f1f3); overflow: hidden; margin-top: 22px; }
  .pub-bar span { display: block; height: 100%; border-radius: 980px; background: var(--accent, #7c5cff); transition: width 0.7s var(--ease, ease); }
  @keyframes ring { 0% { transform: scale(0.2); opacity: 0.9; } 100% { transform: scale(1); opacity: 0; } }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
</style>
