<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';

  let { data, form } = $props();

  let apiKeyModalOpen = $state(false);
  let copied = $state(false);
  let confirmingRevoke = $state<string | null>(null);

  function closeApiKeyModal() {
    apiKeyModalOpen = false;
    copied = false;
  }

  function copyKey(raw: string) {
    navigator.clipboard.writeText(raw);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<section class="panel">
  <div class="panel-head">
    <div class="t">{$_('app.settings.apiKeys.title')}</div>
    <button class="approve-all" type="button" onclick={() => (apiKeyModalOpen = true)}>+ {$_('app.settings.apiKeys.createKey')}</button>
  </div>
  <div class="field"><div class="ftxt"><div class="fs">{$_('app.settings.apiKeys.subtitle')}</div></div></div>

  {#if form?.apiKeyCreated && form?.apiKeyRaw}
    <div class="apikey-created">
      <div class="apikey-warning">{$_('app.settings.apiKeys.warning')}</div>
      <div class="apikey-copy-row">
        <code class="apikey-raw">{form.apiKeyRaw}</code>
        <button class="mini connect" type="button" onclick={() => copyKey(form.apiKeyRaw)}>{copied ? $_('app.settings.apiKeys.copied') : $_('app.settings.apiKeys.copyKey')}</button>
      </div>
    </div>
  {/if}

  {#if form?.apiKeyError}<div class="field"><div class="fs" style="color:#c0392b;">{form.apiKeyError}</div></div>{/if}
  {#if form?.apiKeyRevoked}<div class="field"><div class="fs" style="color:var(--accent);">{$_('app.settings.apiKeys.keyRevoked')}</div></div>{/if}

  {#if data.apiKeys.length}
    <div class="apikey-list">
      {#each data.apiKeys as k (k.id)}
        <div class="apikey-row">
          <div class="apikey-info">
            <div class="apikey-name">{k.name}</div>
            <div class="apikey-meta">
              <code class="apikey-prefix">{k.key_prefix}…</code>
              <span class="apikey-scope">
                {#if k.permissions?.scopes?.includes('write')}
                  <span class="scope-badge write">{$_('app.settings.apiKeys.write')}</span>
                {/if}
                <span class="scope-badge read">{$_('app.settings.apiKeys.read')}</span>
              </span>
              {#if k.permissions?.brand_ids === '*'}
                <span class="scope-badge all">{$_('app.settings.apiKeys.allBrands')}</span>
              {/if}
            </div>
            <div class="apikey-dates">
              {$_('app.settings.apiKeys.created')}: {new Date(k.created_at).toLocaleDateString()}
              · {$_('app.settings.apiKeys.lastUsed')}: {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : $_('app.settings.apiKeys.never')}
            </div>
          </div>
          {#if confirmingRevoke === k.id}
            <div class="disc-confirm">
              <form method="POST" action="?/revokeApiKey" use:enhance>
                <input type="hidden" name="key_id" value={k.id} />
                <button class="mini danger" type="submit">{$_('app.settings.apiKeys.revoke')}</button>
              </form>
              <button class="mini ghost" type="button" onclick={() => (confirmingRevoke = null)}>{$_('app.settings.keep')}</button>
            </div>
          {:else}
            <button class="disc-btn" type="button" onclick={() => (confirmingRevoke = k.id)}>{$_('app.settings.apiKeys.revoke')}</button>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="field"><div class="fs">{$_('app.settings.apiKeys.noKeys')}</div></div>
  {/if}
</section>

{#if apiKeyModalOpen}
  <div
    class="cx-overlay"
    role="button"
    tabindex="-1"
    aria-label={$_('app.settings.close')}
    onclick={(e) => e.target === e.currentTarget && closeApiKeyModal()}
    onkeydown={(e) => e.key === 'Escape' && closeApiKeyModal()}
  >
    <div class="cx-card" role="dialog" aria-modal="true">
      <h3>{$_('app.settings.apiKeys.createKey')}</h3>
      <form
        method="POST"
        action="?/createApiKey"
        use:enhance={() => {
          return async ({ result, update }) => {
            await update();
            if (result.type === 'success' && result.data?.apiKeyRaw) {
              apiKeyModalOpen = false;
            }
          };
        }}
      >
        <div class="apikey-form-field">
          <label for="key_name">{$_('app.settings.apiKeys.keyName')}</label>
          <input id="key_name" name="key_name" type="text" placeholder={$_('app.settings.apiKeys.keyNamePlaceholder')} />
        </div>
        <div class="apikey-form-field">
          <label>{$_('app.settings.apiKeys.scopes')}</label>
          <div class="apikey-scopes">
            <label class="cx-reason sel"><input type="checkbox" checked disabled /> {$_('app.settings.apiKeys.read')}</label>
            <label class="cx-reason"><input type="checkbox" name="write" value="true" /> {$_('app.settings.apiKeys.write')}</label>
          </div>
        </div>
        <div class="apikey-form-field">
          <label>{$_('app.settings.apiKeys.brandScope')}</label>
          <div class="apikey-scopes">
            <label class="cx-reason sel"><input type="radio" name="all_brands" value="false" checked /> {$_('app.settings.apiKeys.thisBrandOnly')}</label>
            <label class="cx-reason"><input type="radio" name="all_brands" value="true" /> {$_('app.settings.apiKeys.allBrands')}</label>
          </div>
        </div>
        <div class="cx-actions">
          <button class="bbtn" type="button" onclick={closeApiKeyModal}>{$_('app.settings.close')}</button>
          <button class="bbtn primary" type="submit">{$_('app.settings.apiKeys.createKey')}</button>
        </div>
      </form>
    </div>
  </div>
{/if}
