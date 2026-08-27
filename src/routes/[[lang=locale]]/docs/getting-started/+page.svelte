<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  toc.set([]);
</script>

<svelte:head>
  <title>{$_('docs.getting_started.s0')}</title>
  <meta name="description" content={$_('docs.getting_started.s1')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.getting_started.s2')}</a> {$_('docs.getting_started.s3')}</div>

<h1>{$_('docs.getting_started.s4')}</h1>
<p class="docs-lead">
  {$_('docs.getting_started.s5')}
</p>

<h2>{$_('docs.getting_started.s6')}</h2>
<p>
  {$_('docs.getting_started.s7')} <a href="/start">{$_('docs.getting_started.s8')}</a> {$_('docs.getting_started.s9')}
</p>

<h2>{$_('docs.getting_started.s10')}</h2>
<p>
  {$_('docs.getting_started.s11')}
</p>

<h2>{$_('docs.getting_started.s12')}</h2>
<p>
  {$_('docs.getting_started.s13')}
</p>

<h2>{$_('docs.getting_started.s14')}</h2>
<p>
  {$_('docs.getting_started.s15')}
</p>

<h2>{$_('docs.getting_started.s16')}</h2>
<p>
  {$_('docs.getting_started.s17')}
</p>

<hr />

<h2>{$_('docs.getting_started.s18')}</h2>
<ul>
  <li><a href={lp('/docs/credits')}>{$_('docs.getting_started.s25')}</a> {$_('docs.getting_started.s26')}</li>
  <li><a href={lp('/docs/editorial-plan')}>{$_('docs.getting_started.s19')}</a> {$_('docs.getting_started.s20')}</li>
  <li><a href={lp('/docs/studio')}>{$_('docs.getting_started.s21')}</a> {$_('docs.getting_started.s22')}</li>
  <li><a href={lp('/docs/team-invites')}>{$_('docs.getting_started.s23')}</a> {$_('docs.getting_started.s24')}</li>
</ul>
