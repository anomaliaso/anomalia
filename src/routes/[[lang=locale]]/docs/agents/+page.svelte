<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  $effect(() => {
    toc.set([
      { title: $_('docs.agents.s0'), href: '#choose' },
      { title: $_('docs.agents.s1'), href: '#install-skill' },
      { title: $_('docs.agents.s28'), href: '#auth' },
      { title: $_('docs.agents.s29'), href: '#rules' },
      { title: $_('docs.agents.s30'), href: '#workflows' },
      { title: $_('docs.agents.s2'), href: '#examples' },
      { title: $_('docs.agents.s10'), href: '#supported-agents' },
      { title: $_('docs.agents.s64'), href: '#cli-fallback' },
      { title: $_('docs.agents.s31'), href: '#next' }
    ]);
  });
</script>

<svelte:head>
  <title>{$_('docs.agents.s4')}</title>
  <meta name="description" content={$_('docs.agents.s5')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.agents.s6')}</a><span>/</span>{$_('docs.agents.s7')}</div>

<h1>{$_('docs.agents.s8')}</h1>
<p class="docs-lead">
  {$_('docs.agents.s9')}
</p>

<div class="docs-note">
  <strong>{$_('docs.agents.s32')}</strong> {$_('docs.agents.s33')}
</div>

<h2 id="choose">{$_('docs.agents.s34')}</h2>
<table>
  <thead>
    <tr>
      <th>{$_('docs.agents.s35')}</th>
      <th>{$_('docs.agents.s36')}</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>{$_('docs.agents.s37')}</td>
      <td>{$_('docs.agents.s38')}</td>
    </tr>
    <tr>
      <td>{$_('docs.agents.s39')}</td>
      <td>{$_('docs.agents.s40')}</td>
    </tr>
    <tr>
      <td>{$_('docs.agents.s41')}</td>
      <td>{$_('docs.agents.s42')}</td>
    </tr>
  </tbody>
</table>
<p>{$_('docs.agents.s43')}</p>

<h2 id="install-skill">{$_('docs.agents.s23')}</h2>
<p>{$_('docs.agents.s44')}</p>
<pre><code>npx skills add andreabuttarelli/anomalia-cli --skill anomalia</code></pre>
<p>{$_('docs.agents.s45')}</p>
<pre><code>curl -sSL https://anomalia.so/install-skill.sh | bash</code></pre>
<p>{$_('docs.agents.s24')}</p>
<p>{@html $_('docs.agents.s46')}</p>

<h2 id="auth">{$_('docs.agents.s47')}</h2>
<ul>
  <li>{@html $_('docs.agents.s48')}</li>
  <li>{@html $_('docs.agents.s49')}</li>
  <li>{@html $_('docs.agents.s50')}</li>
</ul>

<h2 id="rules">{$_('docs.agents.s51')}</h2>
<ol>
  <li>{$_('docs.agents.s52')}</li>
  <li>{$_('docs.agents.s53')}</li>
  <li>{$_('docs.agents.s54')}</li>
  <li>{$_('docs.agents.s55')}</li>
  <li>{$_('docs.agents.s56')}</li>
</ol>

<h2 id="workflows">{$_('docs.agents.s57')}</h2>
<ul>
  <li><strong>{$_('docs.agents.s58')}</strong> — {$_('docs.agents.s59')}</li>
  <li><strong>{$_('docs.agents.s60')}</strong> — {$_('docs.agents.s61')}</li>
  <li><strong>{$_('docs.agents.s62')}</strong> — {$_('docs.agents.s63')}</li>
</ul>

<h2 id="examples">{$_('docs.agents.s25')}</h2>
<pre><code>"Use the Anomalia CLI to show me my brands"
"Approve all pending posts for flashcamp"
"Ask Anomalia to analyze my last 10 posts"
"Change the tone to friendly and professional"</code></pre>

<h2 id="supported-agents">{$_('docs.agents.s10')}</h2>
<ul>
  <li><strong>{$_('docs.agents.s11')}</strong> {$_('docs.agents.s12')}</li>
  <li><strong>{$_('docs.agents.s13')}</strong> {$_('docs.agents.s14')}</li>
  <li><strong>{$_('docs.agents.s15')}</strong> {$_('docs.agents.s16')}</li>
  <li><strong>{$_('docs.agents.s17')}</strong> {$_('docs.agents.s18')}</li>
  <li><strong>{$_('docs.agents.s19')}</strong> {$_('docs.agents.s20')}</li>
  <li><strong>{$_('docs.agents.s21')}</strong> {$_('docs.agents.s22')}</li>
</ul>

<h2 id="cli-fallback">{$_('docs.agents.s64')}</h2>
<p>{$_('docs.agents.s65')}</p>
<pre><code>curl -sSL https://anomalia.so/install.sh | bash
anomalia login
anomalia brands
anomalia content &lt;slug&gt; --status pending_user
anomalia approve &lt;slug&gt; --all
anomalia ai &lt;slug&gt; --message "..." --pipe</code></pre>
<p>{$_('docs.agents.s27')}</p>
<pre><code>echo "Analyze my posts" | anomalia ai my-brand --pipe</code></pre>

<hr />

<h2 id="next">{$_('docs.agents.s66')}</h2>
<ul>
  <li><a href={lp('/docs/mcp')}>{$_('docs.agents.s67')}</a> — {$_('docs.agents.s68')}</li>
  <li><a href={lp('/docs/cli')}>{$_('docs.agents.s69')}</a> — {$_('docs.agents.s70')}</li>
  <li>
    <a href="https://github.com/andreabuttarelli/anomalia-cli" target="_blank" rel="noopener noreferrer"
      >anomalia-cli</a
    >
    — {$_('docs.agents.s71')}
  </li>
</ul>
