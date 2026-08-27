<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { enhance } from '$app/forms';
  let { data } = $props();
</script>

<svelte:head><title>{$_('meta.approve.title')}</title></svelte:head>

<main class="wrap">
  {#if data.ok}
    {#if data.count > 0}
      <!-- FIX D: show confirmation button instead of auto-publishing on GET -->
      <div class="mark">📋</div>
      <h1>{$_('approve.confirm.title', { values: { brand: data.brand } }) ?? `Approve ${data.count} posts for ${data.brand}?`}</h1>
      <p>{$_('approve.confirm.desc', { values: { count: data.count } }) ?? `You have ${data.count} posts waiting for approval. Click below to schedule them.`}</p>
      <form method="POST" action="?/approve" use:enhance>
        <input type="hidden" name="token" value={data.token} />
        <button type="submit" class="btn">{$_('approve.confirm.btn') ?? 'Approve & Schedule'}</button>
      </form>
      <!-- Flagged posts are counted in the email but are never bulk-approvable: say so, or the
           numbers on this page and in the email disagree. -->
      {#if data.excluded?.length}
        <p>{$_('approve.review.desc', { values: { count: data.excluded.length } })}</p>
      {/if}
    {:else if data.excluded?.length}
      <!-- Every pending post is flagged: "nothing pending" would read as if the posts the email
           announced had vanished. -->
      <div class="mark">📋</div>
      <h1>{$_('approve.review.title')}</h1>
      <p>{$_('approve.review.desc', { values: { count: data.excluded.length } })}</p>
    {:else}
      <div class="mark">✓</div>
      <h1>{$_('approve.ok.title')}</h1>
      <!-- Brand name is user/AI-derived data rendered on a public page: never interpolate
           it into {@html} (XSS via brand.name). Text-node interpolation escapes it. -->
      <p>{$_('approve.ok.nothing', { values: { brand: data.brand } })}</p>
    {/if}
  {:else}
    <div class="mark err">✕</div>
    <h1>{$_('approve.fail.title')}</h1>
    <p>{data.reason}</p>
  {/if}
  <a class="home" href="/">← Anomalia</a>
</main>

<style>
  .wrap { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 40px 24px; gap: 4px; }
  .mark { width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 26px; color: #fff;
    background: linear-gradient(135deg, var(--accent-2, #9d86ff), var(--accent, #7c5cff)); margin-bottom: 18px; }
  .mark.err { background: #c0392b; }
  h1 { font-size: clamp(1.8rem, 4vw, 2.4rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); margin: 0; }
  p { color: var(--ink-soft, #6e6e73); margin: 12px 0 0; max-width: 40ch; line-height: 1.5; }
  .btn { margin-top: 20px; padding: 14px 36px; border: none; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer;
    background: linear-gradient(135deg, var(--accent-2, #9d86ff), var(--accent, #7c5cff)); color: #fff; transition: transform .1s; }
  .btn:hover { transform: scale(1.03); }
  .btn:active { transform: scale(.98); }
  .home { margin-top: 26px; font-size: 13.5px; color: var(--ink-soft, #6e6e73); text-decoration: none; }
</style>
