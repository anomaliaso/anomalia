<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  import {
    FREE_CREDITS,
    PLANS,
    type Plan
  } from '$lib/plans';

  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const loc = $derived($locale ?? 'en');

  type CreditRow = {
    name: string;
    credits: number;
    fiveHour: number;
    weekly: number;
  };

  function chatWindows(monthly: number, free: boolean): { fiveHour: number; weekly: number } {
    if (free) {
      return {
        fiveHour: Math.round(FREE_CREDITS * 0.5),
        weekly: Math.round(FREE_CREDITS * 0.8)
      };
    }
    return {
      fiveHour: Math.round(monthly * 0.3),
      weekly: Math.round(monthly * 0.5)
    };
  }

  const rows: CreditRow[] = [
    {
      name: 'Free',
      credits: FREE_CREDITS,
      ...chatWindows(FREE_CREDITS, true)
    },
    ...(['go', 'starter', 'pro'] as const).map((key) => {
      const plan = PLANS.find((p: Plan) => p.key === key)!;
      return {
        name: plan.name,
        credits: plan.credits,
        ...chatWindows(plan.credits, false)
      };
    })
  ];

  function n(v: number): string {
    return v.toLocaleString(loc);
  }

  $effect(() => {
    toc.set([
      { title: $_('docs.credits.s6'), href: '#how-credits-work' },
      { title: $_('docs.credits.s11'), href: '#monthly-credits' },
      { title: $_('docs.credits.s17'), href: '#chat-limits' },
      { title: $_('docs.credits.s26'), href: '#what-counts' },
      { title: $_('docs.credits.s33'), href: '#see-also' }
    ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.credits.s0')}</title>
  <meta name="description" content={$_('docs.credits.s1')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.credits.s2')}</a><span>/</span>{$_('docs.credits.s3')}</div>

<h1>{$_('docs.credits.s4')}</h1>
<p class="docs-lead">
  {$_('docs.credits.s5')}
</p>

<h2 id="how-credits-work">{$_('docs.credits.s6')}</h2>
<p>
  {$_('docs.credits.s7')}
</p>
<!-- Qui c'era "100 crediti ≈ €2,40 / $2,50 di valore API ufficiale" (s9) e la nota "Go è
     l'affare migliore sull'API" (s38). Tolte, non corrette: a listino pieno 100 crediti valgono
     $1 e ogni piano compra lo stesso lavoro per credito, quindi non esiste più né l'equivalenza
     in euro né un piano che sia "l'affare migliore". Resta la spiegazione del contatore. -->
<p>
  {$_('docs.credits.s10')}
</p>

<div class="docs-note">
  {$_('docs.credits.s39')}
</div>

<h2 id="monthly-credits">{$_('docs.credits.s11')}</h2>
<p>
  {$_('docs.credits.s40')}
</p>
<table>
  <thead>
    <tr>
      <th>{$_('docs.credits.s12')}</th>
      <th>{$_('docs.credits.s13')}</th>
    </tr>
  </thead>
  <tbody>
    {#each rows as row}
      <tr>
        <td>{row.name === 'Free' ? $_('docs.credits.s16') : row.name}</td>
        <td>{n(row.credits)}</td>
      </tr>
    {/each}
  </tbody>
</table>

<h2 id="chat-limits">{$_('docs.credits.s17')}</h2>
<p>
  {$_('docs.credits.s18')} <strong>{$_('docs.credits.s19')}</strong> {$_('docs.credits.s20')}
</p>
<p>
  {$_('docs.credits.s21')} <strong>{$_('docs.credits.s22')}</strong> {$_('docs.credits.s23')}
</p>
<table>
  <thead>
    <tr>
      <th>{$_('docs.credits.s12')}</th>
      <th>{$_('docs.credits.s24')}</th>
      <th>{$_('docs.credits.s25')}</th>
    </tr>
  </thead>
  <tbody>
    {#each rows as row}
      <tr>
        <td>{row.name === 'Free' ? $_('docs.credits.s16') : row.name}</td>
        <td>{n(row.fiveHour)}</td>
        <td>{n(row.weekly)}</td>
      </tr>
    {/each}
  </tbody>
</table>

<h2 id="what-counts">{$_('docs.credits.s26')}</h2>
<ul>
  <li><strong>{$_('docs.credits.s27')}</strong> — {$_('docs.credits.s28')}</li>
  <li><strong>{$_('docs.credits.s29')}</strong> — {$_('docs.credits.s30')}</li>
  <li><strong>{$_('docs.credits.s31')}</strong> — {$_('docs.credits.s32')}</li>
</ul>

<hr />

<h2 id="see-also">{$_('docs.credits.s33')}</h2>
<ul>
  <li><a href={lp('/pricing')}>{$_('docs.credits.s34')}</a> {$_('docs.credits.s35')}</li>
  <li><a href={lp('/docs/getting-started')}>{$_('docs.credits.s36')}</a> {$_('docs.credits.s37')}</li>
</ul>
