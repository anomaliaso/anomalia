<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  toc.set([]);
</script>

<svelte:head>
  <title>{$_('docs.cli.s0')}</title>
  <meta name="description" content={$_('docs.cli.s1')} />
</svelte:head>

<div class="docs-breadcrumb"><a href={lp('/docs')}>{$_('docs.cli.s2')}</a> {$_('docs.cli.s3')}</div>

<h1>{$_('docs.cli.s4')}</h1>
<p class="docs-lead">
  {$_('docs.cli.s5')}
</p>

<h2>{$_('docs.cli.s6')}</h2>
<pre><code>curl -sSL https://anomalia.so/install.sh | bash</code></pre>

<p>
  {@html $_('docs.cli.s7')}
</p>

<h2>{$_('docs.cli.s8')}</h2>
<p>
  {@html $_('docs.cli.s9')}
</p>

<h2>{$_('docs.cli.s10')}</h2>
<pre><code>anomalia brands                          # List brands
anomalia dashboard &lt;slug&gt;                # Brand overview
anomalia content &lt;slug&gt; --status pending_user  # Pending posts
anomalia approve &lt;slug&gt; --all            # Approve all pending
anomalia post &lt;slug&gt; &lt;id&gt; edit --caption "..." # Edit post
anomalia plan &lt;slug&gt;                     # View editorial plan
anomalia ai &lt;slug&gt; --message "..."       # AI chat</code></pre>

<h2>{$_('docs.cli.s11')}</h2>
<pre><code>anomalia update</code></pre>

<h2>{$_('docs.cli.s12')}</h2>
<p>
  {$_('docs.cli.s13')}
</p>
<ul>
  <li>{$_('docs.cli.s14')}</li>
  <li>{$_('docs.cli.s15')}</li>
  <li>{$_('docs.cli.s16')}</li>
</ul>

<hr />

<h2>{$_('docs.cli.s17')}</h2>
<ul>
  <li><a href={lp('/docs/mcp')}>{$_('docs.cli.s21')}</a> — {$_('docs.cli.s22')}</li>
  <li><a href={lp('/docs/agents')}>{$_('docs.cli.s23')}</a> — {$_('docs.cli.s24')}</li>
  <li>
    {$_('docs.cli.s18')} <a href={lp('/docs/api')}>{$_('docs.cli.s19')}</a> {$_('docs.cli.s20')}
  </li>
</ul>
