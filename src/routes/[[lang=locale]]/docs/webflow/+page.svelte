<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  import DocsStep from '$lib/components/docs/DocsStep.svelte';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  toc.set([]);
</script>

<svelte:head>
  <title>{$_('docs.webflow.s0')}</title>
  <meta name="description" content={$_('docs.webflow.s1')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.webflow.s2')}</a> {$_('docs.webflow.s3')}</div>

<h1>{$_('docs.webflow.s4')}</h1>
<p class="docs-lead">
  {$_('docs.webflow.s5')}
</p>

<h2>{$_('docs.webflow.s6')}</h2>
<ul>
  <li>{$_('docs.webflow.s7')} <strong>{$_('docs.webflow.s8')}</strong> {$_('docs.webflow.s9')}</li>
  <li>{$_('docs.webflow.s10')} <strong>{$_('docs.webflow.s11')}</strong> {$_('docs.webflow.s12')}</li>
</ul>

<h2>{$_('docs.webflow.s13')}</h2>

<DocsStep step={1} title="Generate a Site API token">
  <p>
    {$_('docs.webflow.s14')} <em>{$_('docs.webflow.s15')}</em> {$_('docs.webflow.s16')}
    <strong>{$_('docs.webflow.s17')}</strong>{$_('docs.webflow.s18')}
  </p>
</DocsStep>

<DocsStep step={2} title="Set the token permissions">
  <p>{$_('docs.webflow.s19')}</p>
  <ul>
    <li><code>CMS: Read &amp; Write</code></li>
    <li><code>Sites: Read Only</code></li>
  </ul>
  <p>{$_('docs.webflow.s20')}</p>
</DocsStep>

<DocsStep step={3} title="Connect in Anomalia">
  <p>
    {$_('docs.webflow.s21')} <strong>{$_('docs.webflow.s22')}</strong> {$_('docs.webflow.s23')} <strong>{$_('docs.webflow.s24')}</strong>{$_('docs.webflow.s25')}
    <strong>⋮</strong> {$_('docs.webflow.s26')}
  </p>
</DocsStep>

<DocsStep step={4} title="Pick the collection">
  <p>
    {$_('docs.webflow.s27')} <strong>{$_('docs.webflow.s28')}</strong> {$_('docs.webflow.s29')}
    <em>{$_('docs.webflow.s30')}</em>{$_('docs.webflow.s31')} <em>{$_('docs.webflow.s32')}</em>{$_('docs.webflow.s33')} <strong>{$_('docs.webflow.s34')}</strong> {$_('docs.webflow.s35')} <strong>{$_('docs.webflow.s36')}</strong> {$_('docs.webflow.s37')}
  </p>
</DocsStep>

<DocsStep step={5} title="Publish">
  <p>
    {$_('docs.webflow.s38')}
    <em>{$_('docs.webflow.s39')}</em>{$_('docs.webflow.s40')}
  </p>
</DocsStep>

<hr />

<h2>{$_('docs.webflow.s41')}</h2>
<ul>
  <li><strong>{$_('docs.webflow.s42')}</strong> {@html $_('docs.webflow.s43')}</li>
  <li><strong>{$_('docs.webflow.s44')}</strong> {$_('docs.webflow.s45')}</li>
  <li><strong>{$_('docs.webflow.s46')}</strong> {$_('docs.webflow.s47')}</li>
  <li><strong>{$_('docs.webflow.s48')}</strong> {$_('docs.webflow.s49')}</li>
</ul>

<h2>{$_('docs.webflow.s50')}</h2>
<ul>
  <li><a href={lp('/docs/shopify')}>{$_('docs.webflow.s51')}</a> {$_('docs.webflow.s52')}</li>
  <li><a href={lp('/docs/seo-advisor')}>{$_('docs.webflow.s53')}</a> {$_('docs.webflow.s54')}</li>
</ul>
