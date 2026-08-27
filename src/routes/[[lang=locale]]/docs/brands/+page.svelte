<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  $effect(() => {
    toc.set([
    { title: $_('docs.brands.s0'), href: '#create' },
    { title: $_('docs.brands.s1'), href: '#multi-brand' },
    { title: $_('docs.brands.s2'), href: '#studio' },
  ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.brands.s3')}</title>
  <meta name="description" content={$_('docs.brands.s4')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.brands.s5')}</a><span>/</span>{$_('docs.brands.s6')}</div>

<h1>{$_('docs.brands.s7')}</h1>
<p class="docs-lead">
  {$_('docs.brands.s8')}
</p>

<h2 id="create">{$_('docs.brands.s9')}</h2>
<ol>
  <li>{$_('docs.brands.s10')}</li>
  <li>{$_('docs.brands.s11')}</li>
  <li>{$_('docs.brands.s12')}</li>
  <li>{$_('docs.brands.s13')}</li>
</ol>

<h2 id="multi-brand">{$_('docs.brands.s14')}</h2>
<p>{$_('docs.brands.s15')}</p>
<ul>
  <li>{$_('docs.brands.s16')}</li>
  <li>{$_('docs.brands.s17')}</li>
  <li>{$_('docs.brands.s18')}</li>
  <li>{$_('docs.brands.s19')}</li>
</ul>

<h2 id="studio">{$_('docs.brands.s20')}</h2>
<p>{$_('docs.brands.s21')}</p>
<ul>
  <li><strong>{$_('docs.brands.s22')}</strong> {$_('docs.brands.s23')}</li>
  <li><strong>{$_('docs.brands.s24')}</strong> {$_('docs.brands.s25')}</li>
  <li><strong>{$_('docs.brands.s26')}</strong> {$_('docs.brands.s27')}</li>
  <li><strong>{$_('docs.brands.s28')}</strong> {$_('docs.brands.s29')}</li>
  <li><strong>{$_('docs.brands.s30')}</strong> {$_('docs.brands.s31')}</li>
</ul>
