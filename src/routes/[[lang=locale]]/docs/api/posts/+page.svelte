<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import ApiEndpoint from '$lib/components/ApiEndpoint.svelte';

  const updateBody = '{ "caption": "New text", "platforms": ["instagram"] }';
  const rescheduleBody = '{ "scheduled_for": "2026-06-22T14:00:00Z" }';
</script>

<svelte:head><title>{$_('docs.api_posts.s0')}</title></svelte:head>

<h1>{$_('docs.api_posts.s1')}</h1>
<p class="docs-lead">{$_('docs.api_posts.s2')}</p>

<ApiEndpoint method="GET" path="/brands/:slug/posts" description={$_('docs.api_posts.s3')}
  query="?status=pending_user | approved | scheduled | published | failed"
  responses={[
    { status: 200, desc: $_('docs.api_posts.s4'), body: '[{ "id": "uuid", "platform": "instagram", "status": "pending_user" }]' },
    { status: 401, desc: $_('docs.api_posts.s5') }
  ]}
/>

<ApiEndpoint method="PUT" path="/brands/:slug/posts/:id" description={$_('docs.api_posts.s6')}
  postBody={updateBody}
  responses={[
    { status: 200, desc: $_('docs.api_posts.s7'), body: '{ "id": "uuid", "caption": "New text" }' },
    { status: 404, desc: $_('docs.api_posts.s8') }
  ]}
/>

<ApiEndpoint method="POST" path="/brands/:slug/posts/:id/approve" description={$_('docs.api_posts.s9')}
  responses={[{ status: 200, desc: $_('docs.api_posts.s10'), body: '{ "ok": true, "status": "published" }' }]}
/>

<ApiEndpoint method="POST" path="/brands/:slug/posts/approve-all" description={$_('docs.api_posts.s11')}
  responses={[{ status: 200, desc: $_('docs.api_posts.s12'), body: '{ "results": [{ "id": "uuid", "ok": true }] }' }]}
/>

<ApiEndpoint method="POST" path="/brands/:slug/posts/:id/publish" description={$_('docs.api_posts.s13')}
  responses={[{ status: 200, desc: $_('docs.api_posts.s14'), body: '{ "ok": true }' }]}
/>

<ApiEndpoint method="POST" path="/brands/:slug/posts/:id/reschedule" description={$_('docs.api_posts.s15')}
  postBody={rescheduleBody}
  responses={[{ status: 200, desc: $_('docs.api_posts.s16'), body: '{ "ok": true }' }]}
/>

<ApiEndpoint method="DELETE" path="/brands/:slug/posts/:id" description={$_('docs.api_posts.s17')}
  responses={[{ status: 200, desc: $_('docs.api_posts.s18'), body: '{ "deleted": true }' }]}
/>

<style>
  h1 { font-size: clamp(1.6rem, 3.5vw, 2.2rem); font-weight: var(--heading-weight); margin: 0 0 8px; }
  .docs-lead { color: var(--ink-soft); font-size: 15px; margin: 0 0 28px; }
</style>
