<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  $effect(() => {
    toc.set([
    { title: $_('docs.radar.s0'), href: '#sources' },
    { title: $_('docs.radar.s1'), href: '#flow' },
    { title: $_('docs.radar.s2'), href: '#actions' },
    { title: $_('docs.radar.s3'), href: '#email' },
  ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.radar.s4')}</title>
  <meta name="description" content={$_('docs.radar.s5')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.radar.s6')}</a><span>/</span>{$_('docs.radar.s7')}</div>

<h1>{$_('docs.radar.s8')}</h1>
<p class="docs-lead">
  {$_('docs.radar.s9')}
</p>

<h2 id="sources">{$_('docs.radar.s10')}</h2>
<p>{$_('docs.radar.s11')}</p>
<ul>
  <li><strong>{$_('docs.radar.s12')}</strong> {$_('docs.radar.s13')}</li>
  <li><strong>{$_('docs.radar.s14')}</strong> {$_('docs.radar.s15')}</li>
  <li><strong>{$_('docs.radar.s16')}</strong> {$_('docs.radar.s17')}</li>
  <li><strong>{$_('docs.radar.s18')}</strong> {$_('docs.radar.s19')}</li>
</ul>

<h2 id="flow">{$_('docs.radar.s20')}</h2>
<ol>
  <li>{$_('docs.radar.s21')}</li>
  <li>{$_('docs.radar.s22')}</li>
  <li>{$_('docs.radar.s23')}</li>
  <li>{$_('docs.radar.s24')}</li>
</ol>
<p>{$_('docs.radar.s25')}</p>

<h2 id="actions">{$_('docs.radar.s26')}</h2>
<p><strong>{$_('docs.radar.s27')}</strong> {$_('docs.radar.s28')}</p>
<p><strong>{$_('docs.radar.s29')}</strong> {$_('docs.radar.s30')}</p>
<p><strong>{$_('docs.radar.s31')}</strong> {$_('docs.radar.s32')}</p>

<div class="docs-note">
  <strong>{$_('docs.radar.s33')}</strong> {$_('docs.radar.s34')}
</div>

<h2 id="email">{$_('docs.radar.s35')}</h2>
<p>{$_('docs.radar.s36')}</p>
<ul>
  <li>{$_('docs.radar.s37')}</li>
  <li>{$_('docs.radar.s38')}</li>
  <li>{$_('docs.radar.s39')}</li>
</ul>
