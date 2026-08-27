<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import ApiEndpoint from '$lib/components/ApiEndpoint.svelte';

  const kitBody = '{ "about": "We make artisan pizza", "category": "food" }';
  const colorsBody = '{ "colors": ["#7c5cff", "#ffffff"] }';
  const personBody = '{ "name": "Sofia", "kind": "ai", "gender": "female" }';
  const docBody = '{ "title": "Tone of voice", "kind": "note" }';
  const compBody = '{ "name": "RivalCo", "website": "rivalco.com" }';
</script>

<svelte:head><title>{$_('docs.api_studio.s0')}</title></svelte:head>

<h1>{$_('docs.api_studio.s1')}</h1>
<p class="docs-lead">{$_('docs.api_studio.s2')}</p>

<ApiEndpoint method="GET" path="/brands/:slug/studio" description={$_('docs.api_studio.s3')}
  responses={[{ status: 200, desc: $_('docs.api_studio.s4'), body: '{ "kit": {...}, "products": [...], "people": [...] }' }]}
/>
<ApiEndpoint method="PUT" path="/brands/:slug/studio/kit" description={$_('docs.api_studio.s5')} postBody={kitBody}
  responses={[{ status: 200, desc: $_('docs.api_studio.s6'), body: '{ "ok": true }' }]}
/>
<ApiEndpoint method="PUT" path="/brands/:slug/studio/colors" description={$_('docs.api_studio.s7')} postBody={colorsBody}
  responses={[{ status: 200, desc: $_('docs.api_studio.s8'), body: '{ "ok": true }' }]}
/>
<ApiEndpoint method="POST" path="/brands/:slug/studio/people" description={$_('docs.api_studio.s9')} postBody={personBody}
  responses={[{ status: 201, desc: $_('docs.api_studio.s10'), body: '{ "id": "uuid" }' }]}
/>
<ApiEndpoint method="PUT" path="/brands/:slug/studio/people/:id" description={$_('docs.api_studio.s11')}
  responses={[{ status: 200, desc: $_('docs.api_studio.s12'), body: '{ "ok": true }' }]}
/>
<ApiEndpoint method="DELETE" path="/brands/:slug/studio/people/:id" description={$_('docs.api_studio.s13')}
  responses={[{ status: 200, desc: $_('docs.api_studio.s14'), body: '{ "deleted": true }' }]}
/>
<ApiEndpoint method="POST" path="/brands/:slug/studio/documents" description={$_('docs.api_studio.s15')} postBody={docBody}
  responses={[{ status: 201, desc: $_('docs.api_studio.s16'), body: '{ "id": "uuid" }' }]}
/>
<ApiEndpoint method="DELETE" path="/brands/:slug/studio/documents/:id" description={$_('docs.api_studio.s17')}
  responses={[{ status: 200, desc: $_('docs.api_studio.s18'), body: '{ "deleted": true }' }]}
/>
<ApiEndpoint method="POST" path="/brands/:slug/studio/competitors" description={$_('docs.api_studio.s19')} postBody={compBody}
  responses={[{ status: 201, desc: $_('docs.api_studio.s20'), body: '{ "id": "uuid" }' }]}
/>
<ApiEndpoint method="PUT" path="/brands/:slug/studio/competitors/:id" description={$_('docs.api_studio.s21')}
  responses={[{ status: 200, desc: $_('docs.api_studio.s22'), body: '{ "ok": true }' }]}
/>
<ApiEndpoint method="DELETE" path="/brands/:slug/studio/competitors/:id" description={$_('docs.api_studio.s23')}
  responses={[{ status: 200, desc: $_('docs.api_studio.s24'), body: '{ "deleted": true }' }]}
/>
<ApiEndpoint method="POST" path="/brands/:slug/studio/competitors/research" description={$_('docs.api_studio.s25')}
  responses={[{ status: 200, desc: $_('docs.api_studio.s26'), body: '{ "ok": true, "found": 5 }' }]}
/>
<ApiEndpoint method="POST" path="/brands/:slug/studio/history/sync" description={$_('docs.api_studio.s27')}
  responses={[{ status: 200, desc: $_('docs.api_studio.s28'), body: '{ "synced": 24 }' }]}
/>

<style>h1 { font-size: clamp(1.6rem, 3.5vw, 2.2rem); font-weight: var(--heading-weight); margin: 0 0 8px; } .docs-lead { color: var(--ink-soft); font-size: 15px; margin: 0 0 28px; }</style>
