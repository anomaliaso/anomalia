<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  $effect(() => {
    toc.set([
    { title: $_('docs.team_invites.s0'), href: '#how-it-works' },
    { title: $_('docs.team_invites.s1'), href: '#invite' },
    { title: $_('docs.team_invites.s2'), href: '#accept' },
    { title: $_('docs.team_invites.s3'), href: '#permissions' },
    { title: $_('docs.team_invites.s4'), href: '#revoke' },
    { title: $_('docs.team_invites.s5'), href: '#security' },
  ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.team_invites.s6')}</title>
  <meta name="description" content={$_('docs.team_invites.s7')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.team_invites.s8')}</a><span>/</span>{$_('docs.team_invites.s9')}</div>

<h1>{$_('docs.team_invites.s10')}</h1>
<p class="docs-lead">
  {$_('docs.team_invites.s11')}
</p>

<h2 id="how-it-works">{$_('docs.team_invites.s12')}</h2>
<p>
  {$_('docs.team_invites.s13')}
</p>
<ul>
  <li>{$_('docs.team_invites.s14')} <strong>{$_('docs.team_invites.s15')}</strong></li>
  <li>{$_('docs.team_invites.s16')}</li>
  <li>{$_('docs.team_invites.s17')}</li>
  <li>{$_('docs.team_invites.s18')}</li>
</ul>

<h2 id="invite">{$_('docs.team_invites.s19')}</h2>
<ol>
  <li>{$_('docs.team_invites.s20')}</li>
  <li>{$_('docs.team_invites.s21')} <strong>{$_('docs.team_invites.s22')}</strong></li>
  <li>{$_('docs.team_invites.s23')}</li>
  <li>{$_('docs.team_invites.s24')} <strong>{$_('docs.team_invites.s25')}</strong></li>
</ol>
<p>
  {$_('docs.team_invites.s26')} <strong>{$_('docs.team_invites.s27')}</strong> {$_('docs.team_invites.s28')}
</p>

<div class="docs-note">
  <strong>{$_('docs.team_invites.s29')}</strong> {$_('docs.team_invites.s30')}
</div>

<h2 id="accept">{$_('docs.team_invites.s31')}</h2>
<p>{$_('docs.team_invites.s32')}</p>
<ol>
  <li>{$_('docs.team_invites.s33')}</li>
  <li>{$_('docs.team_invites.s34')} <strong>{$_('docs.team_invites.s35')}</strong></li>
  <li>{$_('docs.team_invites.s36')}</li>
  <li>{$_('docs.team_invites.s37')} <strong>{$_('docs.team_invites.s38')}</strong> {$_('docs.team_invites.s39')}</li>
</ol>
<p>
  {$_('docs.team_invites.s40')}
</p>

<div class="docs-note">
  <strong>{$_('docs.team_invites.s41')}</strong> {$_('docs.team_invites.s42')}
</div>

<h2 id="permissions">{$_('docs.team_invites.s43')}</h2>
<p>{$_('docs.team_invites.s44')}</p>
<ul>
  <li><strong>{$_('docs.team_invites.s45')}</strong> {$_('docs.team_invites.s46')}</li>
  <li><strong>{$_('docs.team_invites.s47')}</strong> {$_('docs.team_invites.s48')}</li>
</ul>
<p>
  {$_('docs.team_invites.s49')}
</p>

<h2 id="revoke">{$_('docs.team_invites.s50')}</h2>
<p>{$_('docs.team_invites.s51')}</p>
<ol>
  <li>{$_('docs.team_invites.s52')} <strong>{$_('docs.team_invites.s53')}</strong></li>
  <li>{$_('docs.team_invites.s54')}</li>
  <li>{$_('docs.team_invites.s55')} <strong>{$_('docs.team_invites.s56')}</strong></li>
</ol>
<p>
  {$_('docs.team_invites.s57')}
</p>
<p>
  {$_('docs.team_invites.s58')}
</p>

<h2 id="security">{$_('docs.team_invites.s59')}</h2>
<p>{$_('docs.team_invites.s60')}</p>
<ul>
  <li><strong>{$_('docs.team_invites.s61')}</strong> {$_('docs.team_invites.s62')}</li>
  <li><strong>{$_('docs.team_invites.s63')}</strong> {$_('docs.team_invites.s64')}</li>
  <li><strong>{$_('docs.team_invites.s65')}</strong> {$_('docs.team_invites.s66')}</li>
  <li><strong>{$_('docs.team_invites.s67')}</strong> {$_('docs.team_invites.s68')}</li>
  <li><strong>{$_('docs.team_invites.s69')}</strong> {$_('docs.team_invites.s70')}</li>
</ul>
