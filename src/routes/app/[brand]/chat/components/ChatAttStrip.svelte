<script lang="ts">
  let { urls = [], docs = [], video = false }: { urls?: string[]; docs?: string[]; video?: boolean } = $props();
</script>

<div class="att-strip">
  {#each urls as url (url)}
    {#if video && /\.(mp4|webm|mov)(\?|$)/i.test(url)}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video class="att-video" src={url} controls preload="metadata"></video>
    {:else}
      <img class="att-thumb" src={url} alt="" loading="lazy" />
    {/if}
  {/each}
  {#each docs as name (name)}
    <span class="att-doc">{name}</span>
  {/each}
</div>

<style>
  .att-strip { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
  .att-video { max-width: 340px; max-height: 220px; border-radius: 10px; border: 1px solid var(--line, #e3e3e6); background: #000; }
  .att-thumb { width: 92px; height: 92px; object-fit: cover; border-radius: 10px; border: 1px solid var(--line, #e3e3e6); cursor: zoom-in; }
  .att-doc {
    display: inline-flex;
    align-items: center;
    max-width: 200px;
    height: 28px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--line, #e3e3e6);
    background: var(--paper-2, #f5f5f7);
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-soft, #6e6e73);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
