<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  import DocsStep from '$lib/components/docs/DocsStep.svelte';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  toc.set([]);
</script>

<svelte:head>
  <title>{$_('docs.shopify.s0')}</title>
  <meta name="description" content={$_('docs.shopify.s1')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.shopify.s2')}</a> {$_('docs.shopify.s3')}</div>

<h1>{$_('docs.shopify.s4')}</h1>
<p class="docs-lead">
  {$_('docs.shopify.s5')}
</p>

<h2>{$_('docs.shopify.s6')}</h2>
<p>{$_('docs.shopify.s7')}</p>
<ul>
  <li>{$_('docs.shopify.s8')} <strong>{$_('docs.shopify.s9')}</strong> {$_('docs.shopify.s10')}</li>
  <li>{@html $_('docs.shopify.s11')}</li>
  <li>{$_('docs.shopify.s12')} <strong>{$_('docs.shopify.s13')}</strong> {$_('docs.shopify.s14')} <em>{$_('docs.shopify.s15')}</em> {$_('docs.shopify.s16')}</li>
</ul>

<h2>{$_('docs.shopify.s17')}</h2>

<DocsStep step={1} title="Create a custom app in Shopify">
  <p>
    {$_('docs.shopify.s18')} <em>{$_('docs.shopify.s19')}</em>{$_('docs.shopify.s20')} <strong>{$_('docs.shopify.s21')}</strong>.
  </p>
</DocsStep>

<DocsStep step={2} title="Set the API scopes">
  <p>
    {$_('docs.shopify.s22')} <em>{$_('docs.shopify.s23')}</em>{$_('docs.shopify.s24')}
  </p>
  <ul>
    <li><code>read_content</code></li>
    <li><code>write_content</code></li>
  </ul>
  <p>{$_('docs.shopify.s25')} <strong>{$_('docs.shopify.s26')}</strong> {$_('docs.shopify.s27')}</p>
</DocsStep>

<DocsStep step={3} title="Get your credentials">
  <p>
    {$_('docs.shopify.s28')} <em>{$_('docs.shopify.s29')}</em> {$_('docs.shopify.s30')} <strong>{$_('docs.shopify.s31')}</strong> {$_('docs.shopify.s32')}
    <strong>{$_('docs.shopify.s33')}</strong>{$_('docs.shopify.s34')}
  </p>
</DocsStep>

<DocsStep step={4} title="Connect in Anomalia">
  <p>
    {$_('docs.shopify.s35')} <strong>{$_('docs.shopify.s36')}</strong> {$_('docs.shopify.s37')} <strong>{$_('docs.shopify.s38')}</strong>{$_('docs.shopify.s39')}
    <strong>⋮</strong> {$_('docs.shopify.s40')}
  </p>
  <ul>
    <li><strong>{$_('docs.shopify.s41')}</strong> {@html $_('docs.shopify.s42')}</li>
    <li><strong>{$_('docs.shopify.s43')}</strong> {$_('docs.shopify.s44')} <strong>{$_('docs.shopify.s45')}</strong> {$_('docs.shopify.s46')}</li>
  </ul>
  <p>
    {$_('docs.shopify.s47')} <strong>{$_('docs.shopify.s48')}</strong> {$_('docs.shopify.s49')} <strong>{$_('docs.shopify.s50')}</strong> {$_('docs.shopify.s51')} <strong>{$_('docs.shopify.s52')}</strong> {$_('docs.shopify.s53')}
  </p>
</DocsStep>

<DocsStep step={5} title="Publish">
  <p>
    {$_('docs.shopify.s54')}
    <em>{$_('docs.shopify.s55')}</em>{$_('docs.shopify.s56')}
  </p>
</DocsStep>

<hr />

<h2>{$_('docs.shopify.s57')}</h2>
<ul>
  <li><strong>{$_('docs.shopify.s58')}</strong> {$_('docs.shopify.s59')}<em>{$_('docs.shopify.s60')}</em>{$_('docs.shopify.s61')}</li>
  <li><strong>{$_('docs.shopify.s62')}</strong> {@html $_('docs.shopify.s63')}</li>
  <li><strong>{$_('docs.shopify.s64')}</strong> {$_('docs.shopify.s65')}</li>
</ul>

<h2>{$_('docs.shopify.s66')}</h2>
<ul>
  <li><a href={lp('/docs/seo-advisor')}>{$_('docs.shopify.s67')}</a> {$_('docs.shopify.s68')}</li>
  <li><a href={lp('/docs/content-library')}>{$_('docs.shopify.s69')}</a> {$_('docs.shopify.s70')}</li>
</ul>
