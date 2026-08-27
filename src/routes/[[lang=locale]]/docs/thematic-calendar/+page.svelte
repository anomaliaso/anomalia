<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  $effect(() => {
    toc.set([
    { title: $_('docs.thematic_calendar.s0'), href: '#how' },
    { title: $_('docs.thematic_calendar.s1'), href: '#output' },
  ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.thematic_calendar.s2')}</title>
  <meta name="description" content={$_('docs.thematic_calendar.s3')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.thematic_calendar.s4')}</a><span>/</span>{$_('docs.thematic_calendar.s5')}</div>

<h1>{$_('docs.thematic_calendar.s6')}</h1>
<p class="docs-lead">
  {$_('docs.thematic_calendar.s7')}
</p>

<h2 id="how">{$_('docs.thematic_calendar.s8')}</h2>
<p>{$_('docs.thematic_calendar.s9')}</p>
<p>{$_('docs.thematic_calendar.s10')}</p>

<h2 id="output">{$_('docs.thematic_calendar.s11')}</h2>
<p>{$_('docs.thematic_calendar.s12')}</p>
<ul>
  <li><strong>{$_('docs.thematic_calendar.s13')}</strong> {$_('docs.thematic_calendar.s14')}</li>
  <li><strong>{$_('docs.thematic_calendar.s15')}</strong> {$_('docs.thematic_calendar.s16')}</li>
  <li><strong>{$_('docs.thematic_calendar.s17')}</strong> {$_('docs.thematic_calendar.s18')}</li>
</ul>
<p>{$_('docs.thematic_calendar.s19')}</p>
