<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Euro from '@lucide/svelte/icons/euro';
  import Eye from '@lucide/svelte/icons/eye';
  import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
  import Play from '@lucide/svelte/icons/play';
  import Inbox from '@lucide/svelte/icons/inbox';
  import AnimatedNum from '$lib/components/AnimatedNum.svelte';

  let {
    totals,
    fmt
  }: {
    totals: { spend: number; impressions: number; clicks: number; active: number; proposed: number };
    fmt: (n: number) => string;
  } = $props();

  // CTR is the one number that says whether the creative works; derive it rather than add a column.
  const ctr = $derived(
    totals.impressions > 0 ? `${((totals.clicks / totals.impressions) * 100).toFixed(2)}%` : '—'
  );
</script>

<section class="stats ads-stats">
  <div class="tile">
    <div class="lbl"><Euro class="ic" size={15} />{$_('app.ads.spend')}</div>
    <div class="val"><AnimatedNum value={totals.spend} format={fmt} /></div>
  </div>
  <div class="tile">
    <div class="lbl"><Eye class="ic" size={15} />{$_('app.ads.impressions')}</div>
    <div class="val"><AnimatedNum value={totals.impressions} format={fmt} /></div>
    <div class="delta">CTR {ctr}</div>
  </div>
  <div class="tile">
    <div class="lbl"><MousePointerClick class="ic" size={15} />{$_('app.ads.clicks')}</div>
    <div class="val"><AnimatedNum value={totals.clicks} format={fmt} /></div>
  </div>
  <div class="tile">
    <div class="lbl"><Play class="ic" size={15} />{$_('app.ads.active')}</div>
    <div class="val"><AnimatedNum value={totals.active} /></div>
  </div>
  <div class="tile">
    <div class="lbl"><Inbox class="ic" size={15} />{$_('app.ads.proposed')}</div>
    <div class="val"><AnimatedNum value={totals.proposed} /></div>
    {#if totals.proposed > 0}<div class="delta up">{$_('app.ads.awaitingYou')}</div>{/if}
  </div>
</section>

<style>
  /* The global .stats grid is 4 columns; paid has five equally important numbers. */
  .ads-stats { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
  .ads-stats .tile { padding: 16px 18px; }
  .ads-stats .val { font-size: 1.6rem; margin-top: 10px; font-variant-numeric: tabular-nums; }
  .ads-stats :global(.ic) { stroke: var(--accent); }
  @media (max-width: 1000px) { .ads-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @media (max-width: 620px) { .ads-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
