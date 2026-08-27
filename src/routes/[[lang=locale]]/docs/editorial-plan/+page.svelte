<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  $effect(() => {
    toc.set([
    { title: $_('docs.editorial_plan.s0'), href: '#strategy' },
    { title: $_('docs.editorial_plan.s1'), href: '#editorial' },
    { title: $_('docs.editorial_plan.s2'), href: '#weekly' },
    { title: $_('docs.editorial_plan.s3'), href: '#workflow' },
  ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.editorial_plan.s4')}</title>
  <meta name="description" content={$_('docs.editorial_plan.s5')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.editorial_plan.s6')}</a><span>/</span>{$_('docs.editorial_plan.s7')}</div>

<h1>{$_('docs.editorial_plan.s8')}</h1>
<p class="docs-lead">
  {$_('docs.editorial_plan.s9')}
</p>

<h2 id="strategy">{$_('docs.editorial_plan.s10')}</h2>
<p>{$_('docs.editorial_plan.s11')}</p>
<p>{$_('docs.editorial_plan.s12')}</p>

<h2 id="editorial">{$_('docs.editorial_plan.s13')}</h2>
<p>{$_('docs.editorial_plan.s14')}</p>
<ul>
  <li><strong>{$_('docs.editorial_plan.s15')}</strong> {$_('docs.editorial_plan.s16')}</li>
  <li><strong>{$_('docs.editorial_plan.s17')}</strong> {$_('docs.editorial_plan.s18')}</li>
  <li><strong>{$_('docs.editorial_plan.s19')}</strong> {$_('docs.editorial_plan.s20')}</li>
  <li><strong>{$_('docs.editorial_plan.s21')}</strong> {$_('docs.editorial_plan.s22')}</li>
</ul>

<h2 id="weekly">{$_('docs.editorial_plan.s23')}</h2>
<p>{$_('docs.editorial_plan.s24')}</p>
<p>{$_('docs.editorial_plan.s25')}</p>

<h2 id="workflow">{$_('docs.editorial_plan.s26')}</h2>
<div class="docs-steps">
  <div class="docs-step"><h3>{$_('docs.editorial_plan.s27')}</h3><p>{$_('docs.editorial_plan.s28')}</p></div>
  <div class="docs-step"><h3>{$_('docs.editorial_plan.s29')}</h3><p>{$_('docs.editorial_plan.s30')}</p></div>
  <div class="docs-step"><h3>{$_('docs.editorial_plan.s31')}</h3><p>{$_('docs.editorial_plan.s32')}</p></div>
  <div class="docs-step"><h3>{$_('docs.editorial_plan.s33')}</h3><p>{$_('docs.editorial_plan.s34')}</p></div>
</div>
