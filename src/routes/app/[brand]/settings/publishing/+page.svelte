<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { PLATFORMS, ICONS } from '$lib/components/settings/platforms';

  let { data } = $props();
</script>

<section class="panel">
  <div class="panel-head">
    <div class="t">{$_('app.settings.publishing.title')}</div>
  </div>

  <div class="policy">
    <div class="fh">{$_('app.settings.publishing.policy.title')}</div>
    <div class="fs">{$_('app.settings.publishing.policy.desc')}</div>
    <div class="fs why">{$_('app.settings.publishing.policy.why')}</div>
  </div>

  <div class="field">
    <div class="ftxt">
      <div class="fh">{$_('app.settings.publishing.accounts')}</div>
      <div class="fs">{$_('app.settings.publishing.accountsDesc')}</div>
    </div>
  </div>

  {#if data.accounts.length}
    {#each data.accounts as a (a.id)}
      {@const pk = a.platform.toLowerCase()}
      {@const pm = PLATFORMS.find((p) => p.key === pk)}
      <div class="acct">
        <div class="glyph" style={`background:${pm?.bg ?? '#7c5cff'}`}>
          {#if ICONS[pk]}<svg viewBox="0 0 24 24" fill="#fff"><path d={ICONS[pk].path} /></svg>{:else}{pm?.glyph ?? pk.slice(0, 2).toUpperCase()}{/if}
        </div>
        <div class="nm">
          <div class="h">{pm?.label ?? a.platform}</div>
          <div class="s">{$_('app.settings.publishing.afterApproval')}</div>
        </div>
      </div>
    {/each}
  {:else}
    <div class="field"><div class="fs">{$_('app.settings.connectToChoose')}</div></div>
  {/if}
</section>

<style>
  .policy {
    padding: 13px 15px;
    border: 1px solid var(--line, #e3e3e6);
    border-radius: 14px;
    margin-bottom: 14px;
  }
  .policy .fs {
    margin-top: 4px;
  }
  .policy .why {
    color: var(--ink-faint, #86868b);
  }
</style>
