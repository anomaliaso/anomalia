<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  $effect(() => {
    toc.set([
    { title: $_('docs.content_library.s0'), href: '#how' },
    { title: $_('docs.content_library.s1'), href: '#indexed' },
    { title: $_('docs.content_library.s2'), href: '#usage' },
  ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.content_library.s3')}</title>
  <meta name="description" content={$_('docs.content_library.s4')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.content_library.s5')}</a><span>/</span>{$_('docs.content_library.s6')}</div>

<h1>{$_('docs.content_library.s7')}</h1>
<p class="docs-lead">
  {$_('docs.content_library.s8')}
</p>

<h2 id="how">{$_('docs.content_library.s9')}</h2>
<ol>
  <li>{$_('docs.content_library.s10')}</li>
  <li>{$_('docs.content_library.s11')}</li>
  <li>{$_('docs.content_library.s12')}</li>
</ol>

<h2 id="indexed">{$_('docs.content_library.s13')}</h2>
<p>{$_('docs.content_library.s14')}</p>
<p>{$_('docs.content_library.s15')}</p>

<h2 id="usage">{$_('docs.content_library.s16')}</h2>
<p>{$_('docs.content_library.s17')}</p>
<ul>
  <li><strong>{$_('docs.content_library.s18')}</strong> {$_('docs.content_library.s19')}</li>
  <li><strong>{$_('docs.content_library.s20')}</strong> {$_('docs.content_library.s21')}</li>
</ul>
<p>{$_('docs.content_library.s22')}</p>
