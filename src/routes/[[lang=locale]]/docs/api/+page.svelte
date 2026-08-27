<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { toc } from '$lib/stores/toc';

  const BASE = 'https://anomalia.so/api/v1';
  let copied = $state('');
  function cp(text: string, id: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(text);
    copied = id;
    setTimeout(() => { if (copied === id) copied = ''; }, 2000);
  }

  toc.set([]);
</script>

<svelte:head>
  <title>{$_('docs.api.s0')}</title>
  <meta name="description" content={$_('docs.api.s1')} />
</svelte:head>

<h1 class="!text-[clamp(1.6rem,3.5vw,2.2rem)] !font-[family-name:var(--serif)] !mb-2" style="font-weight: var(--heading-weight)">{$_('docs.api.s4')}</h1>
<p class="!text-[15px] !text-muted-foreground !mb-7">{$_('docs.api.s5')}</p>

<section class="mb-9">
  <h2 class="!text-lg !font-bold !mb-3 !pb-2 !border-b !border-border !mt-0 !pt-0 !border-t-0">{$_('docs.api.s6')}</h2>
  <div class="relative bg-muted border border-border rounded-[10px] px-4 py-3.5 my-2 mb-4 overflow-x-auto group">
    <code class="!text-[12.5px] !bg-transparent !p-0 font-mono text-foreground whitespace-pre">{BASE}</code>
    <button class="absolute top-2 right-2 text-[11px] font-semibold px-2.5 py-1 rounded border border-border bg-background text-muted-foreground cursor-pointer opacity-0 group-hover:opacity-100 hover:text-primary hover:border-primary transition-all" onclick={() => cp(BASE, 'base')}>{copied === 'base' ? '✓' : $_('docs.api.s2')}</button>
  </div>
</section>

<section class="mb-9">
  <h2 class="!text-lg !font-bold !mb-3 !pb-2 !border-b !border-border !mt-0 !pt-0 !border-t-0">{$_('docs.api.s7')}</h2>
  <p class="!text-sm !leading-[1.65] !text-muted-foreground !mb-3">{@html $_('docs.api.s8')}</p>

  <h3 class="!text-[0.95rem] !font-semibold !mt-4 !mb-1.5">{$_('docs.api.s9')}</h3>
  <p class="!text-sm !leading-[1.65] !text-muted-foreground !mb-3">{$_('docs.api.s10')}</p>
  <div class="relative bg-muted border border-border rounded-[10px] px-4 py-3.5 my-2 mb-4 overflow-x-auto group">
    <code class="!text-[12.5px] !bg-transparent !p-0 font-mono text-foreground whitespace-pre">Authorization: Bearer &lt;jwt_token&gt;</code>
  </div>

  <h3 class="!text-[0.95rem] !font-semibold !mt-4 !mb-1.5">{$_('docs.api.s11')}</h3>
  <p class="!text-sm !leading-[1.65] !text-muted-foreground !mb-3">{$_('docs.api.s12')} <a class="text-primary no-underline hover:underline" href="/app/api-keys">{$_('docs.api.s13')}</a>{@html $_('docs.api.s14')}</p>
  <div class="relative bg-muted border border-border rounded-[10px] px-4 py-3.5 my-2 mb-4 overflow-x-auto group">
    <code class="!text-[12.5px] !bg-transparent !p-0 font-mono text-foreground whitespace-pre">Authorization: Bearer anomalia_live_...</code>
  </div>
</section>

<section class="mb-9">
  <h2 class="!text-lg !font-bold !mb-3 !pb-2 !border-b !border-border !mt-0 !pt-0 !border-t-0">{$_('docs.api.s15')}</h2>
  <p class="!text-sm !leading-[1.65] !text-muted-foreground !mb-3">{$_('docs.api.s16')}</p>
  <div class="relative bg-muted border border-border rounded-[10px] px-4 py-3.5 my-2 mb-4 overflow-x-auto group">
    <code class="!text-[12.5px] !bg-transparent !p-0 font-mono text-foreground whitespace-pre">{ '{ "error": "Human-readable message" }' }</code>
  </div>
  <table class="w-full border-collapse text-[13.5px] my-2.5">
    <thead><tr><th class="text-left font-semibold px-3 py-2 border-b-2 border-border text-muted-foreground text-xs uppercase">{$_('docs.api.s17')}</th><th class="text-left font-semibold px-3 py-2 border-b-2 border-border text-muted-foreground text-xs uppercase">{$_('docs.api.s18')}</th></tr></thead>
    <tbody>
      <tr><td class="px-3 py-2 border-b border-border"><code class="!text-[12.5px] !bg-muted !px-1.5 !py-0.5 !rounded font-mono">401</code></td><td class="px-3 py-2 border-b border-border">{$_('docs.api.s19')}</td></tr>
      <tr><td class="px-3 py-2 border-b border-border"><code class="!text-[12.5px] !bg-muted !px-1.5 !py-0.5 !rounded font-mono">403</code></td><td class="px-3 py-2 border-b border-border">{$_('docs.api.s20')}</td></tr>
      <tr><td class="px-3 py-2 border-b border-border"><code class="!text-[12.5px] !bg-muted !px-1.5 !py-0.5 !rounded font-mono">404</code></td><td class="px-3 py-2 border-b border-border">{$_('docs.api.s21')}</td></tr>
      <tr><td class="px-3 py-2 border-b border-border"><code class="!text-[12.5px] !bg-muted !px-1.5 !py-0.5 !rounded font-mono">405</code></td><td class="px-3 py-2 border-b border-border">{$_('docs.api.s22')}</td></tr>
      <tr><td class="px-3 py-2 border-b border-border"><code class="!text-[12.5px] !bg-muted !px-1.5 !py-0.5 !rounded font-mono">500</code></td><td class="px-3 py-2 border-b border-border">{$_('docs.api.s23')}</td></tr>
    </tbody>
  </table>
</section>

<section class="mb-9">
  <h2 class="!text-lg !font-bold !mb-3 !pb-2 !border-b !border-border !mt-0 !pt-0 !border-t-0">{$_('docs.api.s24')}</h2>
  <div class="relative bg-muted border border-border rounded-[10px] px-4 py-3.5 my-2 mb-4 overflow-x-auto group">
    <button class="absolute top-2 right-2 text-[11px] font-semibold px-2.5 py-1 rounded border border-border bg-background text-muted-foreground cursor-pointer opacity-0 group-hover:opacity-100 hover:text-primary hover:border-primary transition-all" onclick={() => cp(`export TOKEN="anomalia_live_..."\n\n# List brands\ncurl -H "Authorization: Bearer $TOKEN" https://anomalia.so/api/v1/brands\n\n# Get posts\ncurl -H "Authorization: Bearer $TOKEN" \\\n  https://anomalia.so/api/v1/brands/my-brand/posts\n\n# Approve a post\ncurl -X POST -H "Authorization: Bearer $TOKEN" \\\n  https://anomalia.so/api/v1/brands/my-brand/posts/ID/approve`, 'quickstart')}>{copied === 'quickstart' ? '✓' : $_('docs.api.s3')}</button>
    <pre class="!text-[12.5px] !bg-transparent !p-0 font-mono text-foreground whitespace-pre m-0">export TOKEN="anomalia_live_..."

# List brands
curl -H "Authorization: Bearer $TOKEN" https://anomalia.so/api/v1/brands

# Get posts
curl -H "Authorization: Bearer $TOKEN" \
  https://anomalia.so/api/v1/brands/my-brand/posts

# Approve a post
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://anomalia.so/api/v1/brands/my-brand/posts/ID/approve</pre>
  </div>
</section>
