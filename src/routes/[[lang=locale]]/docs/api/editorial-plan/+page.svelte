<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import ApiEndpoint from '$lib/components/ApiEndpoint.svelte';

  const updateBody = '{ "cadence": "5/week", "platform_mix": { "instagram": 0.6 } }';
  const reviseBody = '{ "feedback": "More behind-the-scenes content" }';
</script>

<svelte:head><title>{$_('docs.api_editorial_plan.s0')}</title></svelte:head>

<h1>{$_('docs.api_editorial_plan.s1')}</h1>
<p class="docs-lead">{$_('docs.api_editorial_plan.s2')}</p>

<ApiEndpoint method="GET" path="/brands/:slug/editorial-plan" description={$_('docs.api_editorial_plan.s3')}
  responses={[{ status: 200, desc: $_('docs.api_editorial_plan.s4'), body: '{ "plan": { "cadence": "5/week" }, "quota": { "weekly_target": 5 } }' }]}
/>

<ApiEndpoint method="POST" path="/brands/:slug/editorial-plan/propose" description={$_('docs.api_editorial_plan.s5')}
  responses={[{ status: 200, desc: $_('docs.api_editorial_plan.s6'), body: '{ "ok": true }' }]}
/>

<ApiEndpoint method="POST" path="/brands/:slug/editorial-plan/approve" description={$_('docs.api_editorial_plan.s7')}
  responses={[{ status: 200, desc: $_('docs.api_editorial_plan.s8'), body: '{ "ok": true }' }]}
/>

<ApiEndpoint method="POST" path="/brands/:slug/editorial-plan/revise" description={$_('docs.api_editorial_plan.s9')}
  postBody={reviseBody}
  responses={[{ status: 200, desc: $_('docs.api_editorial_plan.s10'), body: '{ "ok": true }' }]}
/>

<ApiEndpoint method="POST" path="/brands/:slug/editorial-plan/update" description={$_('docs.api_editorial_plan.s11')}
  postBody={updateBody}
  responses={[{ status: 200, desc: $_('docs.api_editorial_plan.s12'), body: '{ "ok": true }' }]}
/>

<ApiEndpoint method="POST" path="/brands/:slug/editorial-plan/discard" description={$_('docs.api_editorial_plan.s13')}
  responses={[{ status: 200, desc: $_('docs.api_editorial_plan.s14'), body: '{ "ok": true }' }]}
/>

<style>h1 { font-size: clamp(1.6rem, 3.5vw, 2.2rem); font-weight: var(--heading-weight); margin: 0 0 8px; } .docs-lead { color: var(--ink-soft); font-size: 15px; margin: 0 0 28px; }</style>
