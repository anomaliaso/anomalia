<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  $effect(() => {
    toc.set([
    { title: $_('docs.brand_memory.s0'), href: '#what' },
    { title: $_('docs.brand_memory.s1'), href: '#learns' },
    { title: $_('docs.brand_memory.s2'), href: '#improves' },
  ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.brand_memory.s3')}</title>
  <meta name="description" content={$_('docs.brand_memory.s4')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.brand_memory.s5')}</a><span>/</span>{$_('docs.brand_memory.s6')}</div>

<h1>{$_('docs.brand_memory.s7')}</h1>
<p class="docs-lead">
  {$_('docs.brand_memory.s8')}
</p>

<h2 id="what">{$_('docs.brand_memory.s9')}</h2>
<ul>
  <li><strong>{$_('docs.brand_memory.s10')}</strong> {$_('docs.brand_memory.s11')}</li>
  <li><strong>{$_('docs.brand_memory.s12')}</strong> {$_('docs.brand_memory.s13')}</li>
  <li><strong>{$_('docs.brand_memory.s14')}</strong> {$_('docs.brand_memory.s15')}</li>
  <li><strong>{$_('docs.brand_memory.s16')}</strong> {$_('docs.brand_memory.s17')}</li>
  <li><strong>{$_('docs.brand_memory.s18')}</strong> {$_('docs.brand_memory.s19')}</li>
</ul>

<h2 id="learns">{$_('docs.brand_memory.s20')}</h2>
<p>{$_('docs.brand_memory.s21')}</p>
<ul>
  <li><strong>{$_('docs.brand_memory.s22')}</strong> {$_('docs.brand_memory.s23')}</li>
  <li><strong>{$_('docs.brand_memory.s24')}</strong> {$_('docs.brand_memory.s25')}</li>
  <li><strong>{$_('docs.brand_memory.s26')}</strong> {$_('docs.brand_memory.s27')}</li>
  <li><strong>{$_('docs.brand_memory.s28')}</strong> {$_('docs.brand_memory.s29')}</li>
</ul>
<p>{$_('docs.brand_memory.s30')}</p>

<h2 id="improves">{$_('docs.brand_memory.s31')}</h2>
<p>{$_('docs.brand_memory.s32')}</p>
<ul>
  <li>{$_('docs.brand_memory.s33')}</li>
  <li>{$_('docs.brand_memory.s34')}</li>
  <li>{$_('docs.brand_memory.s35')}</li>
</ul>
<p>{$_('docs.brand_memory.s36')}</p>
