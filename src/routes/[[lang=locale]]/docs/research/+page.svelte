<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  $effect(() => {
    toc.set([
    { title: $_('docs.research.s0'), href: '#what' },
    { title: $_('docs.research.s1'), href: '#benchmark' },
    { title: $_('docs.research.s2'), href: '#report' },
  ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.research.s3')}</title>
  <meta name="description" content={$_('docs.research.s4')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.research.s5')}</a><span>/</span>{$_('docs.research.s6')}</div>

<h1>{$_('docs.research.s7')}</h1>
<p class="docs-lead">
  {$_('docs.research.s8')}
</p>

<h2 id="what">{$_('docs.research.s9')}</h2>
<ol>
  <li><strong>{$_('docs.research.s10')}</strong> {$_('docs.research.s11')}</li>
  <li><strong>{$_('docs.research.s12')}</strong> {$_('docs.research.s13')}</li>
  <li><strong>{$_('docs.research.s14')}</strong> {$_('docs.research.s15')}</li>
  <li><strong>{$_('docs.research.s16')}</strong> {$_('docs.research.s17')}</li>
  <li><strong>{$_('docs.research.s18')}</strong> {$_('docs.research.s19')}</li>
</ol>

<h2 id="benchmark">{$_('docs.research.s20')}</h2>
<p>{$_('docs.research.s21')}</p>
<ul>
  <li>{$_('docs.research.s22')}</li>
  <li>{$_('docs.research.s23')}</li>
  <li>{$_('docs.research.s24')}</li>
  <li>{$_('docs.research.s25')}</li>
</ul>
<p>{$_('docs.research.s26')}</p>

<h2 id="report">{$_('docs.research.s27')}</h2>
<p>{$_('docs.research.s28')}</p>
<ul>
  <li><strong>{$_('docs.research.s29')}</strong> {$_('docs.research.s30')}</li>
  <li><strong>{$_('docs.research.s31')}</strong> {$_('docs.research.s32')}</li>
  <li><strong>{$_('docs.research.s33')}</strong> {$_('docs.research.s34')}</li>
  <li><strong>{$_('docs.research.s35')}</strong> {$_('docs.research.s36')}</li>
  <li><strong>{$_('docs.research.s37')}</strong> {$_('docs.research.s38')}</li>
  <li><strong>{$_('docs.research.s39')}</strong> {$_('docs.research.s40')}</li>
  <li><strong>{$_('docs.research.s41')}</strong> {$_('docs.research.s42')}</li>
</ul>
<p>{$_('docs.research.s43')}</p>
