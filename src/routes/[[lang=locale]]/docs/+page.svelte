<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  $effect(() => {
    toc.set([
    { title: $_('docs.intro.s0'), href: '#overview' },
    { title: $_('docs.intro.s1'), href: '#features' },
    { title: $_('docs.intro.s2'), href: '#how-it-works' },
    { title: $_('docs.intro.s3'), href: '#next' },
  ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.intro.s4')}</title>
  <meta name="description" content={$_('docs.intro.s5')} />
</svelte:head>

<h1>{$_('docs.intro.s6')}</h1>
<p class="docs-lead">
  {$_('docs.intro.s7')}
</p>

<h2 id="overview">{$_('docs.intro.s8')}</h2>
<p>
  {$_('docs.intro.s9')}
</p>
<p>
  {$_('docs.intro.s10')}
</p>

<div class="docs-note">
  <strong>{$_('docs.intro.s11')}</strong> {$_('docs.intro.s12')}
</div>

<h2 id="features">{$_('docs.intro.s13')}</h2>
<ul>
  <li><strong>{$_('docs.intro.s14')}</strong> {$_('docs.intro.s15')}</li>
  <li><strong>{$_('docs.intro.s16')}</strong> {$_('docs.intro.s17')}</li>
  <li><strong>{$_('docs.intro.s18')}</strong> {$_('docs.intro.s19')}</li>
  <li><strong>{$_('docs.intro.s20')}</strong> {$_('docs.intro.s21')}</li>
  <li><strong>{$_('docs.intro.s22')}</strong> {$_('docs.intro.s23')}</li>
  <li><strong>{$_('docs.intro.s24')}</strong> {$_('docs.intro.s25')}</li>
</ul>

<h2 id="how-it-works">{$_('docs.intro.s26')}</h2>
<div class="docs-steps">
  <div class="docs-step">
    <h3>{$_('docs.intro.s27')}</h3>
    <p>{$_('docs.intro.s28')}</p>
  </div>
  <div class="docs-step">
    <h3>{$_('docs.intro.s29')}</h3>
    <p>{$_('docs.intro.s30')}</p>
  </div>
  <div class="docs-step">
    <h3>{$_('docs.intro.s31')}</h3>
    <p>{$_('docs.intro.s32')}</p>
  </div>
  <div class="docs-step">
    <h3>{$_('docs.intro.s33')}</h3>
    <p>{$_('docs.intro.s34')}</p>
  </div>
</div>

<h2 id="next">{$_('docs.intro.s35')}</h2>
<ul>
  <li><a href={lp('/docs/getting-started')}>{$_('docs.intro.s36')}</a> {$_('docs.intro.s37')}</li>
  <li><a href={lp('/docs/brands')}>{$_('docs.intro.s38')}</a> {$_('docs.intro.s39')}</li>
  <li><a href={lp('/docs/editorial-plan')}>{$_('docs.intro.s40')}</a> {$_('docs.intro.s41')}</li>
  <li><a href={lp('/docs/studio')}>{$_('docs.intro.s42')}</a> {$_('docs.intro.s43')}</li>
</ul>
