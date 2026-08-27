<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  $effect(() => {
    toc.set([
    { title: $_('docs.geo_audit.s0'), href: '#what' },
    { title: $_('docs.geo_audit.s1'), href: '#score' },
    { title: $_('docs.geo_audit.s2'), href: '#ai-presence' },
    { title: $_('docs.geo_audit.s3'), href: '#fixes' },
  ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.geo_audit.s4')}</title>
  <meta name="description" content={$_('docs.geo_audit.s5')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.geo_audit.s6')}</a><span>/</span>{$_('docs.geo_audit.s7')}</div>

<h1>{$_('docs.geo_audit.s8')}</h1>
<p class="docs-lead">
  {$_('docs.geo_audit.s9')}
</p>

<div class="docs-note">
  <strong>{$_('docs.geo_audit.s10')}</strong> {$_('docs.geo_audit.s11')}
</div>

<h2 id="what">{$_('docs.geo_audit.s12')}</h2>
<p>{$_('docs.geo_audit.s13')}</p>
<ul>
  <li><strong>{$_('docs.geo_audit.s14')}</strong> {$_('docs.geo_audit.s15')}</li>
  <li><strong>{$_('docs.geo_audit.s16')}</strong> {$_('docs.geo_audit.s17')}</li>
  <li><strong>{$_('docs.geo_audit.s18')}</strong> {$_('docs.geo_audit.s19')}</li>
  <li><strong>{$_('docs.geo_audit.s20')}</strong> {$_('docs.geo_audit.s21')}</li>
</ul>

<h2 id="score">{$_('docs.geo_audit.s22')}</h2>
<p>{$_('docs.geo_audit.s23')}</p>

<h2 id="ai-presence">{$_('docs.geo_audit.s24')}</h2>
<p>{$_('docs.geo_audit.s25')}</p>
<p>{$_('docs.geo_audit.s26')}</p>
<ul>
  <li>{$_('docs.geo_audit.s27')}</li>
  <li>{$_('docs.geo_audit.s28')}</li>
  <li>{$_('docs.geo_audit.s29')}</li>
</ul>

<h2 id="fixes">{$_('docs.geo_audit.s30')}</h2>
<p>{$_('docs.geo_audit.s31')}</p>
<ul>
  <li><strong>{$_('docs.geo_audit.s32')}</strong> {$_('docs.geo_audit.s33')}</li>
  <li><strong>{$_('docs.geo_audit.s34')}</strong> {$_('docs.geo_audit.s35')}</li>
  <li><strong>{$_('docs.geo_audit.s36')}</strong> {$_('docs.geo_audit.s37')}</li>
</ul>
<p>{$_('docs.geo_audit.s38')}</p>

<div class="docs-note">
  <strong>{$_('docs.geo_audit.s39')}</strong> {$_('docs.geo_audit.s40')}
</div>
