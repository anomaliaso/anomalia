<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  $effect(() => {
    toc.set([
    { title: $_('docs.weekly_recap.s0'), href: '#content' },
    { title: $_('docs.weekly_recap.s1'), href: '#trends' },
    { title: $_('docs.weekly_recap.s2'), href: '#reflection' },
  ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.weekly_recap.s3')}</title>
  <meta name="description" content={$_('docs.weekly_recap.s4')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.weekly_recap.s5')}</a><span>/</span>{$_('docs.weekly_recap.s6')}</div>

<h1>{$_('docs.weekly_recap.s7')}</h1>
<p class="docs-lead">
  {$_('docs.weekly_recap.s8')}
</p>

<h2 id="content">{$_('docs.weekly_recap.s9')}</h2>
<ul>
  <li><strong>{$_('docs.weekly_recap.s10')}</strong> {$_('docs.weekly_recap.s11')}</li>
  <li><strong>{$_('docs.weekly_recap.s12')}</strong> {$_('docs.weekly_recap.s13')}</li>
  <li><strong>{$_('docs.weekly_recap.s14')}</strong> {$_('docs.weekly_recap.s15')}</li>
  <li><strong>{$_('docs.weekly_recap.s16')}</strong> {$_('docs.weekly_recap.s17')}</li>
</ul>

<h2 id="trends">{$_('docs.weekly_recap.s18')}</h2>
<p>{$_('docs.weekly_recap.s19')}</p>
<ul>
  <li><strong>{$_('docs.weekly_recap.s20')}</strong> {$_('docs.weekly_recap.s21')}</li>
  <li><strong>{$_('docs.weekly_recap.s22')}</strong> {$_('docs.weekly_recap.s23')}</li>
</ul>
<p>{$_('docs.weekly_recap.s24')}</p>

<h2 id="reflection">{$_('docs.weekly_recap.s25')}</h2>
<p>{$_('docs.weekly_recap.s26')}</p>

<div class="docs-note">
  <strong>{$_('docs.weekly_recap.s27')}</strong> {$_('docs.weekly_recap.s28')}
</div>
