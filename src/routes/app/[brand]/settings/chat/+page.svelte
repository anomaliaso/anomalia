<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import { CHAT_PRESET_TIERS, coerceChatTier } from '$lib/chat-tiers';
  import { usdPerMillion } from '$lib/model-price';

  let { data, form } = $props();
  // NULL in the DB means "never chosen" — show what the chat actually starts on.
  const current = $derived(coerceChatTier(data.brand?.chat_default_tier));
  const models = $derived(data.chatModels ?? []);
  const currentModel = $derived(models.find((m) => m.id === current));
  const K_TOKENS = 1000;
</script>

<section class="panel">
  <div class="panel-head"><div class="t">{$_('app.settings.chat.title')}</div></div>
  <div class="field">
    <div class="ftxt">
      <div class="fh">{$_('app.settings.chat.defaultModel')}</div>
      <div class="fs">{$_('app.settings.chat.defaultModelDesc')}</div>
    </div>
    <form method="POST" action="?/setChatDefaultTier" use:enhance class="tier-form">
      <select name="tier" class="tier-select">
        {#each CHAT_PRESET_TIERS as t (t)}
          <option value={t} selected={t === current}>{$_('chat.tier.' + t)}</option>
        {/each}
        {#if models.length}
          <optgroup label={$_('chat.tier.custom')}>
            {#each models as m (m.id)}
              <option value={m.id} selected={m.id === current}>{m.label}</option>
            {/each}
          </optgroup>
        {/if}
      </select>
      <button class="mini connect" type="submit">{$_('app.settings.save')}</button>
    </form>
  </div>
  <div class="field">
    <div class="ftxt">
      <div class="fs">
        {#if currentModel}
          {Math.round(currentModel.contextLength / K_TOKENS)}k · {usdPerMillion(currentModel.inputUsdPerM)}/{usdPerMillion(currentModel.outputUsdPerM)} per 1M token
        {:else}
          {$_('chat.tier.' + current + 'Hint')}
        {/if}
      </div>
    </div>
  </div>
  {#if form?.chatTierSaved}
    <div class="field"><div class="fs" style="color:var(--accent);">{$_('app.settings.chat.saved')}</div></div>
  {/if}
  {#if form?.error}
    <div class="field"><div class="fs" style="color:#c0392b;">{form.error}</div></div>
  {/if}
</section>

<style>
  .tier-form { display: flex; align-items: center; gap: 8px; }
  .tier-select {
    font: inherit;
    font-size: 13px;
    padding: 7px 10px;
    border: 1px solid var(--line, #e3e3e6);
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
  }
</style>
