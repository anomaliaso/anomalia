<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import ApiEndpoint from '$lib/components/ApiEndpoint.svelte';
</script>

<svelte:head><title>{$_('docs.api_brands.s0')}</title></svelte:head>

<h1>{$_('docs.api_brands.s1')}</h1>
<p class="docs-lead">{$_('docs.api_brands.s2')}</p>

<ApiEndpoint method="GET" path="/brands" description={$_('docs.api_brands.s3')}
  responses={[
    { status: 200, desc: $_('docs.api_brands.s4'), body: '[{ "id": "uuid", "name": "My Brand", "slug": "my-brand", "plan": "pro", "status": "active" }]' },
    { status: 401, desc: $_('docs.api_brands.s5'), body: '{ "error": "Missing or invalid Authorization header" }' }
  ]}
/>

<ApiEndpoint method="GET" path="/brands/:slug" description={$_('docs.api_brands.s6')}
  responses={[
    { status: 200, desc: $_('docs.api_brands.s7'), body: '{ "brand": { "id": "uuid", "name": "My Brand" }, "pendingCount": 3, "productCount": 12 }' },
    { status: 404, desc: $_('docs.api_brands.s8'), body: '{ "error": "Brand not found" }' }
  ]}
/>

<style>
  h1 { font-size: clamp(1.6rem, 3.5vw, 2.2rem); font-weight: var(--heading-weight); margin: 0 0 8px; }
  .docs-lead { color: var(--ink-soft); font-size: 15px; margin: 0 0 28px; }
</style>
