<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import ApiEndpoint from '$lib/components/ApiEndpoint.svelte';
</script>

<svelte:head><title>{$_('docs.api_analytics.s0')}</title></svelte:head>

<h1>{$_('docs.api_analytics.s1')}</h1>
<p class="docs-lead">{$_('docs.api_analytics.s2')}</p>

<ApiEndpoint method="GET" path="/brands/:slug/analytics" description={$_('docs.api_analytics.s3')}
  responses={[{ status: 200, desc: $_('docs.api_analytics.s4'), body: '{ "posts": [...], "summary": { "total_posts": 45 } }' }]}
/>

<ApiEndpoint method="GET" path="/brands/:slug/calendar" description={$_('docs.api_analytics.s5')}
  query="?month=2026-06"
  responses={[{ status: 200, desc: $_('docs.api_analytics.s6'), body: '[{ "date": "2026-06-20", "posts": [...] }]' }]}
/>

<style>h1 { font-size: clamp(1.6rem, 3.5vw, 2.2rem); font-weight: var(--heading-weight); margin: 0 0 8px; } .docs-lead { color: var(--ink-soft); font-size: 15px; margin: 0 0 28px; }</style>
