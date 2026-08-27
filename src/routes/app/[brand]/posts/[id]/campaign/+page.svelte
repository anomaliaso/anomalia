<script lang="ts">
  import { _ } from 'svelte-i18n';

  let { data } = $props();
  const brand = $derived(data.brand);
  const post = $derived(data.post);

  const prompt = $derived(
    $_('app.post.campaign.chatPrompt', {
      values: {
        platform: post.platform ?? 'social',
        caption: (post.caption ?? '').slice(0, 120)
      }
    })
  );

  const chatHref = $derived(
    `/app/${brand.slug}/posts/${post.id}/chat`
  );
</script>

<section class="panel">
  <div class="panel-head">
    <div class="t">{$_('app.post.campaign.title')}</div>
    <div class="s">{$_('app.post.campaign.body')}</div>
  </div>

  <ol class="steps">
    <li>{$_('app.post.campaign.step1')}</li>
    <li>{$_('app.post.campaign.step2')}</li>
    <li>{$_('app.post.campaign.step3')}</li>
  </ol>

  <div class="prompt-box">
    <div class="prompt-lbl">{$_('app.post.campaign.suggestedPrompt')}</div>
    <p class="prompt">{prompt}</p>
  </div>

  {#if data.flags?.studio}
    <a class="cta" href={chatHref}>{$_('app.post.campaign.openChat')}</a>
  {:else}
    <p class="off">{$_('app.post.chat.studioOff')}</p>
    <a class="cta ghost" href={`/app/${brand.slug}/posts/${post.id}/edit`}>{$_('app.post.chat.goEdit')}</a>
  {/if}
</section>

<style>
  .panel {
    padding: 22px 22px 26px; border: 1px solid var(--line); border-radius: 14px; background: var(--paper);
    max-width: 560px;
  }
  .t { font-size: 15px; font-weight: 700; }
  .s { margin: 6px 0 0; font-size: 14px; color: var(--ink-soft); line-height: 1.5; }
  .steps {
    margin: 18px 0 0; padding-left: 18px; font-size: 13.5px; color: var(--ink);
    line-height: 1.55; display: flex; flex-direction: column; gap: 8px;
  }
  .prompt-box {
    margin-top: 18px; padding: 12px 14px; border-radius: 12px;
    background: var(--paper-2); border: 1px solid var(--line);
  }
  .prompt-lbl {
    font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
    color: var(--ink-faint);
  }
  .prompt { margin: 8px 0 0; font-size: 13.5px; line-height: 1.5; white-space: pre-wrap; }
  .cta {
    display: inline-flex; margin-top: 18px; font-size: 13.5px; font-weight: 650;
    padding: 10px 16px; border-radius: 11px; background: var(--invert-surface, #1d1d1f);
    color: #fff; text-decoration: none;
  }
  .cta.ghost {
    background: var(--paper); color: var(--ink); border: 1px solid var(--line);
  }
  .off { margin: 16px 0 0; font-size: 13.5px; color: var(--ink-soft); }
</style>
