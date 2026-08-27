<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  import DocsStep from '$lib/components/docs/DocsStep.svelte';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  toc.set([]);
</script>

<svelte:head>
  <title>{$_('docs.blog_hosting.s0')}</title>
  <meta name="description" content={$_('docs.blog_hosting.s1')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.blog_hosting.s2')}</a> {$_('docs.blog_hosting.s3')}</div>

<h1>{$_('docs.blog_hosting.s4')}</h1>
<p class="docs-lead">
  {$_('docs.blog_hosting.s5')}
</p>

<h2>{$_('docs.blog_hosting.s6')}</h2>
<p>
  {@html $_('docs.blog_hosting.s7')}
</p>

<h2>{$_('docs.blog_hosting.s8')}</h2>
<p>
  {@html $_('docs.blog_hosting.s9')} <strong>{$_('docs.blog_hosting.s10')}</strong> {$_('docs.blog_hosting.s11')}
  <strong>{$_('docs.blog_hosting.s12')}</strong> {$_('docs.blog_hosting.s13')}
</p>

<DocsStep step={1} title="Enter your subdomain">
  <p>
    {@html $_('docs.blog_hosting.s14')} <strong>{$_('docs.blog_hosting.s15')}</strong>.
  </p>
</DocsStep>

<DocsStep step={2} title="Add the DNS record">
  <p>
    {$_('docs.blog_hosting.s16')} <strong>{$_('docs.blog_hosting.s17')}</strong> {@html $_('docs.blog_hosting.s18')}
  </p>
  <p class="docs-note"><strong>{$_('docs.blog_hosting.s19')}</strong> {@html $_('docs.blog_hosting.s20')}</p>
</DocsStep>

<DocsStep step={3} title="Verify">
  <p>
    {$_('docs.blog_hosting.s21')} <strong>{$_('docs.blog_hosting.s22')}</strong>{$_('docs.blog_hosting.s23')}
  </p>
</DocsStep>

<h2>{$_('docs.blog_hosting.s24')}</h2>
<p>
  {$_('docs.blog_hosting.s25')} <strong>{$_('docs.blog_hosting.s26')}</strong> {$_('docs.blog_hosting.s27')}
</p>

<hr />

<h2>{$_('docs.blog_hosting.s28')}</h2>
<p>
  {$_('docs.blog_hosting.s29')}
  <em>{$_('docs.blog_hosting.s30')}</em> {$_('docs.blog_hosting.s31')} <a href={lp('/docs/shopify')}>{$_('docs.blog_hosting.s32')}</a>,
  <a href={lp('/docs/webflow')}>{$_('docs.blog_hosting.s33')}</a> {$_('docs.blog_hosting.s34')} <a href={lp('/docs/wix')}>{$_('docs.blog_hosting.s35')}</a> {$_('docs.blog_hosting.s36')} <a href={lp('/docs/api/articles')}>{$_('docs.blog_hosting.s37')}</a>{$_('docs.blog_hosting.s38')}
</p>

<h2>{$_('docs.blog_hosting.s39')}</h2>
<ul>
  <li><strong>{$_('docs.blog_hosting.s40')}</strong> {$_('docs.blog_hosting.s41')}</li>
  <li><strong>{$_('docs.blog_hosting.s42')}</strong> {$_('docs.blog_hosting.s43')}</li>
  <li><strong>{$_('docs.blog_hosting.s44')}</strong> {$_('docs.blog_hosting.s45')} <a href={lp('/docs/api/articles')}>{$_('docs.blog_hosting.s46')}</a> {$_('docs.blog_hosting.s47')}</li>
</ul>
