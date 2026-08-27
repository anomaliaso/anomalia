<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  $effect(() => {
    toc.set([
    { title: $_('docs.studio.s0'), href: '#brand-kit' },
    { title: $_('docs.studio.s1'), href: '#products' },
    { title: $_('docs.studio.s2'), href: '#knowledge' },
    { title: $_('docs.studio.s3'), href: '#people' },
    { title: $_('docs.studio.s4'), href: '#competitors' },
  ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.studio.s5')}</title>
  <meta name="description" content={$_('docs.studio.s6')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.studio.s7')}</a><span>/</span>{$_('docs.studio.s8')}</div>

<h1>{$_('docs.studio.s9')}</h1>
<p class="docs-lead">
  {$_('docs.studio.s10')}
</p>

<h2 id="brand-kit">{$_('docs.studio.s11')}</h2>
<p>{$_('docs.studio.s12')}</p>
<p>{$_('docs.studio.s13')}</p>

<h2 id="products">{$_('docs.studio.s14')}</h2>
<p>{$_('docs.studio.s15')}</p>
<ul>
  <li><strong>{$_('docs.studio.s16')}</strong> {$_('docs.studio.s17')}</li>
  <li><strong>{$_('docs.studio.s18')}</strong> {$_('docs.studio.s19')}</li>
</ul>

<h2 id="knowledge">{$_('docs.studio.s20')}</h2>
<p>{$_('docs.studio.s21')}</p>
<ul>
  <li>{$_('docs.studio.s22')}</li>
  <li>{$_('docs.studio.s23')}</li>
  <li>{$_('docs.studio.s24')}</li>
  <li>{$_('docs.studio.s25')}</li>
</ul>
<p>{$_('docs.studio.s26')}</p>

<h2 id="people">{$_('docs.studio.s27')}</h2>
<p>{$_('docs.studio.s28')}</p>
<ul>
  <li><strong>{$_('docs.studio.s29')}</strong> {$_('docs.studio.s30')}</li>
  <li><strong>{$_('docs.studio.s31')}</strong> {$_('docs.studio.s32')}</li>
</ul>

<h2 id="competitors">{$_('docs.studio.s33')}</h2>
<p>{$_('docs.studio.s34')}</p>
<p>{$_('docs.studio.s35')}</p>
