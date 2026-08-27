<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  $effect(() => {
    toc.set([
    { title: $_('docs.seo_advisor.s0'), href: '#plan' },
    { title: $_('docs.seo_advisor.s1'), href: '#types' },
    { title: $_('docs.seo_advisor.s2'), href: '#assets' },
  ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.seo_advisor.s3')}</title>
  <meta name="description" content={$_('docs.seo_advisor.s4')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.seo_advisor.s5')}</a><span>/</span>{$_('docs.seo_advisor.s6')}</div>

<h1>{$_('docs.seo_advisor.s7')}</h1>
<p class="docs-lead">
  {$_('docs.seo_advisor.s8')}
</p>

<div class="docs-note">
  <strong>{$_('docs.seo_advisor.s9')}</strong> {$_('docs.seo_advisor.s10')}
</div>

<h2 id="plan">{$_('docs.seo_advisor.s11')}</h2>
<p>{$_('docs.seo_advisor.s12')}</p>
<ol>
  <li><strong>{$_('docs.seo_advisor.s13')}</strong> {$_('docs.seo_advisor.s14')}</li>
  <li><strong>{$_('docs.seo_advisor.s15')}</strong> {$_('docs.seo_advisor.s16')}</li>
</ol>
<p>{$_('docs.seo_advisor.s17')}</p>

<h2 id="types">{$_('docs.seo_advisor.s18')}</h2>
<p>{$_('docs.seo_advisor.s19')}</p>
<ul>
  <li><strong>{$_('docs.seo_advisor.s20')}</strong> {$_('docs.seo_advisor.s21')}</li>
  <li><strong>{$_('docs.seo_advisor.s22')}</strong> {$_('docs.seo_advisor.s23')}</li>
  <li><strong>{$_('docs.seo_advisor.s24')}</strong> {$_('docs.seo_advisor.s25')}</li>
  <li><strong>{$_('docs.seo_advisor.s26')}</strong> {$_('docs.seo_advisor.s27')}</li>
  <li><strong>{$_('docs.seo_advisor.s28')}</strong> {$_('docs.seo_advisor.s29')}</li>
</ul>
<p>{$_('docs.seo_advisor.s30')}</p>

<h2 id="assets">{$_('docs.seo_advisor.s31')}</h2>
<p>{$_('docs.seo_advisor.s32')}</p>

<div class="docs-note">
  <strong>{$_('docs.seo_advisor.s33')}</strong> {$_('docs.seo_advisor.s34')}
</div>
