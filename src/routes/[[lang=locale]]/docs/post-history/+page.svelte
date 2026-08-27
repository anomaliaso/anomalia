<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  $effect(() => {
    toc.set([
    { title: $_('docs.post_history.s0'), href: '#what' },
    { title: $_('docs.post_history.s1'), href: '#usage' },
  ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.post_history.s2')}</title>
  <meta name="description" content={$_('docs.post_history.s3')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.post_history.s4')}</a><span>/</span>{$_('docs.post_history.s5')}</div>

<h1>{$_('docs.post_history.s6')}</h1>
<p class="docs-lead">
  {$_('docs.post_history.s7')}
</p>

<h2 id="what">{$_('docs.post_history.s8')}</h2>
<ul>
  <li><strong>{$_('docs.post_history.s9')}</strong> {$_('docs.post_history.s10')}</li>
  <li><strong>{$_('docs.post_history.s11')}</strong> {$_('docs.post_history.s12')}</li>
  <li><strong>{$_('docs.post_history.s13')}</strong> {$_('docs.post_history.s14')}</li>
  <li><strong>{$_('docs.post_history.s15')}</strong> {$_('docs.post_history.s16')}</li>
</ul>

<h2 id="usage">{$_('docs.post_history.s17')}</h2>
<p>{$_('docs.post_history.s18')}</p>
<ul>
  <li>{$_('docs.post_history.s19')}</li>
  <li>{$_('docs.post_history.s20')}</li>
  <li>{$_('docs.post_history.s21')}</li>
  <li>{$_('docs.post_history.s22')}</li>
</ul>
<p>{$_('docs.post_history.s23')}</p>
