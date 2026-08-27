<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import ApiEndpoint from '$lib/components/ApiEndpoint.svelte';

  const gtmBody = '{ "objective": "Increase brand awareness" }';
  const voiceBody = '{ "mood": "energetic", "tone": "friendly" }';
</script>

<svelte:head><title>{$_('docs.api_strategy.s0')}</title></svelte:head>

<h1>{$_('docs.api_strategy.s1')}</h1>
<p class="docs-lead">{$_('docs.api_strategy.s2')}</p>

<ApiEndpoint method="GET" path="/brands/:slug/gtm" description={$_('docs.api_strategy.s3')}
  responses={[{ status: 200, desc: $_('docs.api_strategy.s4'), body: '{ "phases": [{ "name": "Launch" }] }' }]}
/>
<ApiEndpoint method="POST" path="/brands/:slug/gtm/update" description={$_('docs.api_strategy.s5')} postBody={gtmBody}
  responses={[{ status: 200, desc: $_('docs.api_strategy.s6'), body: '{ "ok": true }' }]}
/>
<ApiEndpoint method="GET" path="/brands/:slug/voice" description={$_('docs.api_strategy.s7')}
  responses={[{ status: 200, desc: $_('docs.api_strategy.s8'), body: '{ "mood": "friendly", "register": 40 }' }]}
/>
<ApiEndpoint method="POST" path="/brands/:slug/voice/update" description={$_('docs.api_strategy.s9')} postBody={voiceBody}
  responses={[{ status: 200, desc: $_('docs.api_strategy.s10'), body: '{ "ok": true }' }]}
/>

<style>h1 { font-size: clamp(1.6rem, 3.5vw, 2.2rem); font-weight: var(--heading-weight); margin: 0 0 8px; } .docs-lead { color: var(--ink-soft); font-size: 15px; margin: 0 0 28px; }</style>
