<script lang="ts">
  import { _ } from 'svelte-i18n';
  import DeleteBrandDialog from '$lib/components/DeleteBrandDialog.svelte';

  let { data } = $props();
  const brand = $derived(data.brand);
  let deleteOpen = $state(false);
</script>

<section class="panel">
  <div class="panel-head"><div class="t">{$_('app.settings.del.title')}</div></div>

  {#if !data.isOwner}
    <div class="field"><div class="bill-notice">{$_('app.settings.billing.membersNotice')}</div></div>
  {:else}
    <div class="field">
      <div class="ftxt">
        <div class="fh">{$_('app.settings.del.heading')}</div>
        <div class="fs">{$_('app.settings.del.desc')}</div>
      </div>
      <button class="bbtn danger" type="button" onclick={() => (deleteOpen = true)}>{$_('app.settings.del.cta')}</button>
    </div>
  {/if}
</section>

{#if data.isOwner}
  <DeleteBrandDialog bind:open={deleteOpen} brand={{ name: brand.name, slug: brand.slug }} action="?/deleteBrand" />
{/if}
