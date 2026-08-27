<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  $effect(() => {
    toc.set([
    { title: $_('docs.gtm_strategy.s0'), href: '#gtm' },
    { title: $_('docs.gtm_strategy.s1'), href: '#phases' },
    { title: $_('docs.gtm_strategy.s2'), href: '#redirect' },
    { title: $_('docs.gtm_strategy.s3'), href: '#ops' },
  ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.gtm_strategy.s4')}</title>
  <meta name="description" content={$_('docs.gtm_strategy.s5')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.gtm_strategy.s6')}</a><span>/</span>{$_('docs.gtm_strategy.s7')}</div>

<h1>{$_('docs.gtm_strategy.s8')}</h1>
<p class="docs-lead">
  {$_('docs.gtm_strategy.s9')} <strong>{$_('docs.gtm_strategy.s10')}</strong> {$_('docs.gtm_strategy.s11')} <strong>{$_('docs.gtm_strategy.s12')}</strong> {$_('docs.gtm_strategy.s13')}
</p>

<h2 id="gtm">{$_('docs.gtm_strategy.s14')}</h2>
<p>{$_('docs.gtm_strategy.s15')}</p>
<ul>
  <li><strong>{$_('docs.gtm_strategy.s16')}</strong> {$_('docs.gtm_strategy.s17')}</li>
  <li><strong>{$_('docs.gtm_strategy.s18')}</strong> {$_('docs.gtm_strategy.s19')}</li>
</ul>
<p>{$_('docs.gtm_strategy.s20')}</p>

<h2 id="phases">{$_('docs.gtm_strategy.s21')}</h2>
<ul>
  <li><strong>{$_('docs.gtm_strategy.s22')}</strong> {$_('docs.gtm_strategy.s23')}</li>
  <li><strong>{$_('docs.gtm_strategy.s24')}</strong> {$_('docs.gtm_strategy.s25')}</li>
  <li><strong>{$_('docs.gtm_strategy.s26')}</strong> {$_('docs.gtm_strategy.s27')}</li>
  <li><strong>{$_('docs.gtm_strategy.s28')}</strong> {$_('docs.gtm_strategy.s29')}</li>
  <li><strong>{$_('docs.gtm_strategy.s30')}</strong> {$_('docs.gtm_strategy.s31')}</li>
</ul>

<div class="docs-note">
  <strong>{$_('docs.gtm_strategy.s32')}</strong> {$_('docs.gtm_strategy.s33')}
</div>

<h2 id="redirect">{$_('docs.gtm_strategy.s34')}</h2>
<p>{$_('docs.gtm_strategy.s35')}</p>
<p>{$_('docs.gtm_strategy.s36')}</p>

<h2 id="ops">{$_('docs.gtm_strategy.s37')}</h2>
<p>{$_('docs.gtm_strategy.s38')}</p>

<h3>{$_('docs.gtm_strategy.s39')}</h3>
<p>{$_('docs.gtm_strategy.s40')}</p>

<h3>{$_('docs.gtm_strategy.s41')}</h3>
<p>{$_('docs.gtm_strategy.s42')}</p>
<ul>
  <li><strong>{$_('docs.gtm_strategy.s43')}</strong> {$_('docs.gtm_strategy.s44')}</li>
  <li><strong>{$_('docs.gtm_strategy.s45')}</strong> {$_('docs.gtm_strategy.s46')}</li>
</ul>
<p>{$_('docs.gtm_strategy.s47')}</p>
