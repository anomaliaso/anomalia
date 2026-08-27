<script lang="ts">
  import { _ } from 'svelte-i18n';

  // Reusable "social thumbnail picker" — platform + handle in, recent post thumbnails out,
  // multi-select up to `max`. Foundation for pages that need visual reference images pulled
  // from a brand's (or a person's) own social history.
  let {
    brandSlug,
    selected = $bindable([]),
    max = 6
  }: { brandSlug: string; selected: string[]; max?: number } = $props();

  const PLATFORMS = ['instagram', 'tiktok', 'x', 'threads', 'facebook', 'youtube', 'linkedin'];

  let platform = $state('instagram');
  let handle = $state('');
  let thumbs = $state<string[]>([]);
  let loading = $state(false);
  let loaded = $state(false);

  async function load() {
    if (!handle.trim() || loading) return;
    loading = true;
    loaded = false;
    thumbs = [];
    try {
      const res = await fetch(`/app/${brandSlug}/social-thumbs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform, handle })
      });
      const data = await res.json().catch(() => ({}));
      thumbs = data?.thumbs ?? [];
    } finally {
      loading = false;
      loaded = true;
    }
  }

  function toggle(url: string) {
    if (selected.includes(url)) {
      selected = selected.filter((u) => u !== url);
    } else if (selected.length < max) {
      selected = [...selected, url];
    }
  }
</script>

<div class="stp">
  <div class="stp-bar">
    <select class="ctrl" bind:value={platform}>
      {#each PLATFORMS as p (p)}
        <option value={p}>{$_('socialThumbPicker.platform.' + p, { default: p })}</option>
      {/each}
    </select>
    <input
      class="ctrl"
      type="text"
      bind:value={handle}
      placeholder={$_('socialThumbPicker.handlePlaceholder', { default: '@handle' })}
      onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); load(); } }}
    />
    <button type="button" class="ctrl btn-out" onclick={load} disabled={loading || !handle.trim()}>
      {#if loading}<span class="spinner sm"></span>{:else}{$_('socialThumbPicker.load', { default: 'Load' })}{/if}
    </button>
  </div>

  {#if loading}
    <div class="stp-status"><span class="spinner"></span></div>
  {:else if loaded && thumbs.length === 0}
    <div class="stp-empty">{$_('socialThumbPicker.empty', { default: 'No posts found — try another handle' })}</div>
  {:else if thumbs.length}
    <div class="stp-grid">
      {#each thumbs as url (url)}
        <button
          type="button"
          class="stp-cell"
          class:on={selected.includes(url)}
          onclick={() => toggle(url)}
          aria-label={$_('socialThumbPicker.pick', { default: 'Select' })}
        >
          <!-- `url` is a signed URL to our own storage (the server archived the CDN thumbnail
               there), so it renders without the social CDN's cross-origin block. -->
          <img src={url} alt="" loading="lazy" />
          {#if selected.includes(url)}<span class="stp-check">✓</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .stp { display: flex; flex-direction: column; gap: 10px; }
  .stp-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .ctrl { font: inherit; font-size: 13px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--line);
    background: var(--paper); color: var(--ink); }
  .btn-out { cursor: pointer; font-weight: 600; color: var(--ink-soft); white-space: nowrap;
    display: inline-flex; align-items: center; justify-content: center; min-width: 64px; }
  .btn-out:hover:not(:disabled) { background: var(--paper-2); color: var(--ink); }
  .btn-out:disabled { opacity: 0.55; cursor: default; }
  .stp-status { display: flex; justify-content: center; padding: 10px 0; }
  .stp-empty { font-size: 12px; color: var(--ink-faint); padding: 8px 2px; }
  .stp-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .stp-cell { position: relative; width: 56px; height: 56px; border-radius: 9px; border: 2px solid transparent;
    padding: 0; cursor: pointer; background-color: var(--paper-2); overflow: hidden; }
  .stp-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .stp-cell:hover { border-color: var(--line-2, #d2d2d7); }
  .stp-cell.on { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.25); }
  .stp-check { position: absolute; top: 2px; right: 2px; width: 16px; height: 16px; border-radius: 50%;
    background: var(--accent); color: #fff; font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; }
  .spinner { width: 20px; height: 20px; border-radius: 50%; border: 3px solid rgba(var(--accent-rgb), 0.25);
    border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
  .spinner.sm { width: 14px; height: 14px; border-width: 2px; border-color: rgba(var(--accent-rgb), 0.3); border-top-color: var(--accent); }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
