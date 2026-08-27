<script lang="ts">
  import { cn } from '$lib/utils';

  let { method, path, description, query, postBody, responses }: {
    method: string;
    path: string;
    description: string;
    query?: string;
    postBody?: string;
    responses: { status: number; desc: string; body?: string }[];
  } = $props();

  let copied = $state('');
  let showExample = $state(0);

  const BASE = 'https://anomalia.so/api/v1';

  function cp(text: string, id: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(text);
    copied = id;
    setTimeout(() => { if (copied === id) copied = ''; }, 2000);
  }

  function mkCurl(b?: string) {
    let s = `curl -X ${method} \\\n  ${BASE}${path} \\\n  -H "Authorization: Bearer $TOKEN"`;
    if (b) s += ` \\\n  -H "Content-Type: application/json" \\\n  -d '${b}'`;
    return s;
  }

  let allExamples = $derived([
    { label: 'curl', content: mkCurl(postBody) },
    ...responses.filter(r => r.body).map(r => ({ label: `${r.status}`, content: r.body! }))
  ]);

  function methodColor(m: string) {
    switch (m) {
      case 'GET': return 'bg-blue-500/10 text-blue-500';
      case 'POST': return 'bg-emerald-500/10 text-emerald-500';
      case 'PUT': return 'bg-amber-500/10 text-amber-500';
      case 'DELETE': return 'bg-red-500/10 text-red-500';
      default: return 'bg-muted text-muted-foreground';
    }
  }

  function statusColor(code: number) {
    if (code >= 200 && code < 300) return 'bg-emerald-500/10 text-emerald-500';
    return 'bg-red-500/10 text-red-500';
  }
</script>

<div class="grid grid-cols-[1fr_380px] gap-6 py-6 border-b border-border last:border-b-0 max-[900px]:grid-cols-1">
  <div>
    <div class="flex items-center gap-2.5 mb-2">
      <span class={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-md uppercase', methodColor(method))}>{method}</span>
      <code class="text-sm font-semibold text-foreground bg-transparent p-0 font-mono">{path}</code>
    </div>
    <p class="text-sm text-muted-foreground mb-4">{description}</p>
    {#if query}
      <div class="mb-3.5"><div class="text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground mb-1.5">Query</div><code class="text-[12.5px] bg-muted px-1.5 py-0.5 rounded font-mono">{query}</code></div>
    {/if}
    {#if postBody}
      <div class="mb-3.5"><div class="text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground mb-1.5">Request Body</div><div class="bg-muted border border-border rounded-lg p-2.5 px-3.5 overflow-x-auto"><pre class="text-[12.5px] font-mono text-foreground whitespace-pre m-0">{postBody}</pre></div></div>
    {/if}
    <div class="mb-3.5">
      <div class="text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground mb-1.5">Responses</div>
      {#each responses as resp}
        <div class="flex items-center gap-2 my-1"><span class={cn('text-[11px] font-bold px-2 py-0.5 rounded font-mono', statusColor(resp.status))}>{resp.status}</span><span>{resp.desc}</span></div>
      {/each}
    </div>
  </div>
  <div class="sticky top-20 self-start">
    <div class="flex gap-px bg-muted rounded-t-lg p-[3px] pb-0">
      {#each allExamples as ex, i}
        <button class={cn('text-xs font-semibold px-3 py-1.5 border-0 rounded-t-lg cursor-pointer bg-transparent transition-colors', showExample === i ? 'bg-background text-foreground' : 'text-muted-foreground')} onclick={() => showExample = i}>{ex.label}</button>
      {/each}
    </div>
    <div class="relative bg-background border border-border rounded-b-[10px] p-3.5 px-4 overflow-x-auto group">
      <button class="absolute top-2 right-2 text-[11px] font-semibold px-2.5 py-1 rounded border border-border bg-background text-muted-foreground cursor-pointer opacity-0 group-hover:opacity-100 hover:text-primary hover:border-primary transition-all" onclick={() => cp(allExamples[showExample].content, `${method}${path}${showExample}`)}>
        {copied === `${method}${path}${showExample}` ? '✓' : 'Copy'}
      </button>
      <pre class="text-xs font-mono text-foreground whitespace-pre m-0">{allExamples[showExample].content}</pre>
    </div>
  </div>
</div>
