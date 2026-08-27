<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import ApiEndpoint from '$lib/components/ApiEndpoint.svelte';

  const addBody = '{ "title": "Gourmet Pizza", "pricing": "€14" }';
  const updateBody = '{ "title": "Gourmet Pizza v2", "pricing": "€16" }';
</script>

<svelte:head><title>{$_('docs.api_products.s0')}</title></svelte:head>

<h1>{$_('docs.api_products.s1')}</h1>
<p class="docs-lead">{$_('docs.api_products.s2')}</p>

<ApiEndpoint method="GET" path="/brands/:slug/products" description={$_('docs.api_products.s3')}
  responses={[{ status: 200, desc: $_('docs.api_products.s4'), body: '[{ "id": "uuid", "title": "Pizza", "pricing": "€12" }]' }]}
/>
<ApiEndpoint method="POST" path="/brands/:slug/products" description={$_('docs.api_products.s5')} postBody={addBody}
  responses={[{ status: 201, desc: $_('docs.api_products.s6'), body: '{ "id": "uuid" }' }]}
/>
<ApiEndpoint method="PUT" path="/brands/:slug/products/:id" description={$_('docs.api_products.s7')} postBody={updateBody}
  responses={[{ status: 200, desc: $_('docs.api_products.s8'), body: '{ "ok": true }' }]}
/>
<ApiEndpoint method="DELETE" path="/brands/:slug/products/:id" description={$_('docs.api_products.s9')}
  responses={[{ status: 200, desc: $_('docs.api_products.s10'), body: '{ "deleted": true }' }]}
/>

<style>h1 { font-size: clamp(1.6rem, 3.5vw, 2.2rem); font-weight: var(--heading-weight); margin: 0 0 8px; } .docs-lead { color: var(--ink-soft); font-size: 15px; margin: 0 0 28px; }</style>
