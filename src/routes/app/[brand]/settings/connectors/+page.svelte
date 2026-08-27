<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { enhance } from '$app/forms';
  import KnowledgeConnectors from '$lib/components/KnowledgeConnectors.svelte';

  let { data, form } = $props();
  const brandSlug = $derived(data.brand?.slug ?? '');
  const webhook = $derived(data.webhook ?? null);
  const triggers = $derived(data.triggers ?? []);
  let url = $state('');
  $effect(() => {
    url = data.webhook?.url ?? '';
  });
</script>

<section>
  <p class="lede">{$_('app.settings.connectors.lede')}</p>
  <KnowledgeConnectors
    {brandSlug}
    sources={data.sources ?? []}
    connections={data.connections ?? []}
    catalog={data.catalog ?? []}
    catalogError={data.catalogError ?? ''}
    connectorsConfigured={data.connectorsConfigured}
    githubRepos={data.githubRepos ?? []}
    githubReposError={data.githubReposError ?? ''}
    notionPages={data.notionPages ?? []}
    notionPagesError={data.notionPagesError ?? ''}
    gsc={data.gsc}
    formError={form?.error ?? ''}
  />
</section>

<section class="hooks">
  <h2>{$_('app.settings.connectors.webhookTitle')}</h2>
  <p class="lede">{$_('app.settings.connectors.webhookLede')}</p>

  {#if form?.secret}
    <!-- Shown once: the secret is not stored anywhere the page can read it again. -->
    <p class="banner ok">
      {$_('app.settings.connectors.webhookSecretOnce')}
      <code>{form.secret}</code>
    </p>
  {/if}

  <form method="POST" action="?/saveWebhook" use:enhance class="hook-form">
    <input
      type="url"
      name="url"
      bind:value={url}
      placeholder="https://esempio.com/webhooks/anomalia"
      required
    />
    <label class="rotate">
      <input type="checkbox" name="rotate" disabled={!webhook} />
      {$_('app.settings.connectors.webhookRotate')}
    </label>
    <button class="btn primary" type="submit">{$_('app.settings.connectors.webhookSave')}</button>
    {#if webhook}
      <button class="btn danger" type="submit" formaction="?/deleteWebhook">
        {$_('app.settings.connectors.webhookRemove')}
      </button>
    {/if}
  </form>

  {#if webhook}
    <p class="muted small">
      {$_(`app.settings.connectors.webhookStatus.${webhook.status}`, { default: webhook.status })}
      {#if webhook.last_delivery_at}
        · {$_('app.settings.connectors.webhookLastDelivery')}
        {new Date(webhook.last_delivery_at).toLocaleString()}
      {/if}
      {#if webhook.failure_count > 0}
        · {$_('app.settings.connectors.webhookFailures', { values: { n: webhook.failure_count } })}
      {/if}
    </p>
    {#if webhook.last_error}
      <p class="banner err tiny">{webhook.last_error}</p>
    {/if}
  {/if}

  {#if triggers.length}
    <ul class="trigger-list">
      {#each triggers as t (t.trigger + JSON.stringify(t.config))}
        <li>
          <code>{t.trigger}</code>
          {#if t.config?.owner}
            <span class="muted">{t.config.owner}/{t.config.repo}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {:else if webhook}
    <p class="muted small">{$_('app.settings.connectors.webhookNoTriggers')}</p>
  {/if}
</section>

<style>
  .hooks { margin: 32px 0 8px; }
  .hooks h2 { font-size: 15px; margin: 0 0 6px; }
  .hook-form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0 0 10px;
  }
  .hook-form input[type='url'] {
    flex: 1 1 320px;
    min-width: 0;
    padding: 9px 12px;
    border: 1px solid var(--line, #e5e5e8);
    border-radius: 10px;
    font: inherit;
  }
  .rotate { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
  .trigger-list { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 6px; }
  .trigger-list li { display: flex; gap: 8px; align-items: baseline; font-size: 13px; }
  .trigger-list code, .banner code { font-size: 12px; }
  .muted { color: var(--ink-soft, #6e6e73); }
  .small { font-size: 13px; margin: 0; }
  .banner { padding: 8px 12px; border-radius: 10px; font-size: 13px; }
  .banner.ok { background: color-mix(in srgb, #34a853 12%, transparent); }
  .banner.err { background: color-mix(in srgb, #ea4335 12%, transparent); }
  .banner.tiny { font-size: 12px; }
  .lede {
    color: var(--ink-soft, #666);
    margin: 0 0 16px;
    font-size: 14px;
    line-height: 1.45;
  }
</style>
