<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { siClaude, siPerplexity } from 'simple-icons';

  // ChatGPT brand mark isn't in simple-icons under a usable key — same path as the landing hero.
  const chatgptIcon =
    'M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071.006l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.843-3.387L15.11 7.2a.076.076 0 0 1 .071-.005l4.83 2.785a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z';

  const providers = $derived.by(() => {
    const q = encodeURIComponent($_('common.askAi.prompt'));
    return [
      { name: 'Claude', url: `https://claude.ai/new?q=${q}`, path: siClaude.path },
      { name: 'ChatGPT', url: `https://chatgpt.com/?q=${q}`, path: chatgptIcon },
      { name: 'Perplexity', url: `https://www.perplexity.ai/search?q=${q}`, path: siPerplexity.path }
    ];
  });
</script>

<section class="ask-ai-sec">
  <div class="wrap">
    <h2 class="ask-ai-title">
      {$_('common.askAi.title')}
      <span class="ask-ai-sub">{$_('common.askAi.subtitle')}</span>
    </h2>
    <div class="ask-ai-providers">
      {#each providers as p (p.name)}
        <a class="ask-ai-provider" href={p.url} target="_blank" rel="noopener" aria-label={p.name}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d={p.path} />
          </svg>
          <span>{p.name}</span>
        </a>
      {/each}
    </div>
  </div>
</section>

<style>
  .ask-ai-sec {
    padding: 96px 0 110px;
    text-align: center;
  }
  .ask-ai-title {
    font-size: clamp(2.4rem, 6.5vw, 4.2rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    line-height: 1.05;
    max-width: 16ch;
    margin: 0 auto;
  }
  .ask-ai-sub {
    display: block;
    color: var(--accent);
  }
  .ask-ai-providers {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 14px;
    margin-top: 40px;
  }
  .ask-ai-provider {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 16px 28px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--paper);
    color: var(--ink);
    font-size: 1.15rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    text-decoration: none;
    transition:
      border-color 0.18s var(--ease),
      background 0.18s var(--ease),
      transform 0.18s var(--ease),
      color 0.18s var(--ease);
  }
  .ask-ai-provider:hover {
    border-color: rgba(var(--accent-rgb), 0.4);
    background: rgba(var(--accent-rgb), 0.06);
    transform: translateY(-2px);
  }
  .ask-ai-provider svg {
    width: 28px;
    height: 28px;
    flex: 0 0 auto;
  }
  @media (min-width: 821px) {
    .ask-ai-title {
      font-size: clamp(56px, 6vw, 72px);
    }
  }
  @media (max-width: 520px) {
    .ask-ai-providers {
      flex-direction: column;
      align-items: stretch;
      max-width: 280px;
      margin-inline: auto;
    }
    .ask-ai-provider {
      justify-content: center;
    }
  }
</style>
