<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  import DocsStep from '$lib/components/docs/DocsStep.svelte';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  toc.set([]);
</script>

<svelte:head>
  <title>{$_('docs.wix.s0')}</title>
  <meta name="description" content={$_('docs.wix.s1')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.wix.s2')}</a> {$_('docs.wix.s3')}</div>

<h1>{$_('docs.wix.s4')}</h1>
<p class="docs-lead">
  {$_('docs.wix.s5')}
</p>

<h2>{$_('docs.wix.s6')}</h2>
<p>
  {$_('docs.wix.s7')} <strong>{$_('docs.wix.s8')}</strong> {$_('docs.wix.s9')}
</p>

<h2>{$_('docs.wix.s10')}</h2>

<DocsStep step={1} title="Find your Site ID">
  <p>
    {@html $_('docs.wix.s11')}
  </p>
</DocsStep>

<DocsStep step={2} title="Generate an API key">
  <p>
    {$_('docs.wix.s12')} <em>{$_('docs.wix.s13')}</em> →
    <strong>{$_('docs.wix.s14')}</strong>{$_('docs.wix.s15')}
  </p>
</DocsStep>

<DocsStep step={3} title="Set the permissions">
  <p>{$_('docs.wix.s16')} <em>{$_('docs.wix.s17')}</em> {$_('docs.wix.s18')}</p>
  <ul>
    <li><code>Wix Blog</code></li>
    <li><code>Wix Contacts &amp; Members</code></li>
  </ul>
  <p>{$_('docs.wix.s19')} <strong>{$_('docs.wix.s20')}</strong></p>
</DocsStep>

<DocsStep step={4} title="Connect in Anomalia">
  <p>
    {$_('docs.wix.s21')} <strong>{$_('docs.wix.s22')}</strong> {$_('docs.wix.s23')} <strong>{$_('docs.wix.s24')}</strong>{$_('docs.wix.s25')}
    <strong>⋮</strong> {$_('docs.wix.s26')} <strong>{$_('docs.wix.s27')}</strong> {$_('docs.wix.s28')}
    <strong>{$_('docs.wix.s29')}</strong>{$_('docs.wix.s30')} <strong>{$_('docs.wix.s31')}</strong> {$_('docs.wix.s32')}
  </p>
</DocsStep>

<DocsStep step={5} title="Publish">
  <p>
    {$_('docs.wix.s33')}
    <em>{$_('docs.wix.s34')}</em>{$_('docs.wix.s35')}
  </p>
</DocsStep>

<hr />

<h2>{$_('docs.wix.s36')}</h2>
<ul>
  <li><strong>{$_('docs.wix.s37')}</strong> {$_('docs.wix.s38')}</li>
  <li><strong>{$_('docs.wix.s39')}</strong> {$_('docs.wix.s40')}</li>
  <li><strong>{$_('docs.wix.s41')}</strong> {$_('docs.wix.s42')}</li>
  <li><strong>{$_('docs.wix.s43')}</strong> {$_('docs.wix.s44')}</li>
</ul>

<h2>{$_('docs.wix.s45')}</h2>
<ul>
  <li><a href={lp('/docs/shopify')}>{$_('docs.wix.s46')}</a> {$_('docs.wix.s47')} <a href={lp('/docs/webflow')}>{$_('docs.wix.s48')}</a> {$_('docs.wix.s49')}</li>
</ul>
