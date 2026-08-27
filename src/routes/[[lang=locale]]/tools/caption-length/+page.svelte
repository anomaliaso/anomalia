<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import '$lib/styles/landing.css';

  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  let caption = $state('');
  let platform = $state<'instagram' | 'linkedin' | 'twitter' | 'tiktok' | 'facebook'>('instagram');

  const limits = {
    instagram: { max: 2200, preview: 125, name: 'Instagram' },
    linkedin: { max: 3000, preview: 140, name: 'LinkedIn' },
    twitter: { max: 280, preview: 280, name: 'X / Twitter' },
    tiktok: { max: 2200, preview: 100, name: 'TikTok' },
    facebook: { max: 63206, preview: 125, name: 'Facebook' }
  };

  const tipIndices = [0, 1, 2] as const;

  let stats = $derived(() => {
    const chars = caption.length;
    const words = caption.trim() ? caption.trim().split(/\s+/).length : 0;
    const emojis = (caption.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu) ?? []).length;
    const hashtags = (caption.match(/#[\w\u00C0-\u024F]+/g) ?? []).length;
    const mentions = (caption.match(/@[\w\u00C0-\u024F]+/g) ?? []).length;
    const limit = limits[platform];
    const overLimit = chars > limit.max;
    const overPreview = chars > limit.preview;
    const percent = Math.min(100, Math.round((chars / limit.max) * 100));
    return { chars, words, emojis, hashtags, mentions, limit, overLimit, overPreview, percent };
  });
</script>

<svelte:head>
  <title>{$_('tools.caption-length.meta.title')}</title>
  <meta name="description" content={$_('tools.caption-length.meta.description')} />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta property="og:title" content={$_('tools.caption-length.meta.ogTitle')} />
  <meta property="og:description" content={$_('tools.caption-length.meta.ogDescription')} />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={$_('tools.caption-length.meta.twitterTitle')} />
  <meta name="twitter:description" content={$_('tools.caption-length.meta.twitterDescription')} />
</svelte:head>

<SiteNav cta={$_('tools.common.navCta')} />

<main>
  <section class="tool-hero">
    <div class="wrap">
      <span class="eyebrow">{$_('tools.common.eyebrow')}</span>
      <h1>{$_('tools.caption-length.hero.title')}</h1>
      <p class="subhead">{$_('tools.caption-length.hero.subhead')}<br />{$_('tools.caption-length.hero.subheadLine2')}</p>
    </div>
  </section>

  <section class="tool-body">
    <div class="wrap">
      <div class="checker-grid">
        <!-- Input -->
        <div class="checker-input">
          <div class="platform-tabs">
            {#each Object.keys(limits) as key}
              <button
                class:active={platform === key}
                onclick={() => platform = key as typeof platform}
              >
                {$_(`tools.best-time-to-post.platforms.${key}`)}
              </button>
            {/each}
          </div>

          <div
            class="caption-input"
            contenteditable
            role="textbox"
            aria-label={$_('tools.caption-length.input.ariaLabel')}
            data-placeholder={$_('tools.caption-length.input.placeholder')}
            oninput={(e) => { caption = e.currentTarget.textContent || ''; }}
            onfocus={(e) => { if (!e.currentTarget.textContent) e.currentTarget.textContent = ''; }}
          ></div>

          <div class="char-bar">
            <div class="char-fill" style="width: {stats().percent}%" class:over={stats().overLimit}></div>
          </div>
          <div class="char-info">
            <span class:over={stats().overLimit}>{stats().chars} / {stats().limit.max}</span>
            {#if stats().overPreview && !stats().overLimit}
              <span class="preview-warn">{$_('tools.caption-length.input.seeMore', { values: { count: stats().limit.preview } })}</span>
            {/if}
          </div>
        </div>

        <!-- Stats -->
        <div class="checker-stats">
          <h3>{$_('tools.caption-length.stats.title')}</h3>
          <div class="stat-grid">
            <div class="stat-item">
              <span class="stat-val">{stats().chars}</span>
              <span class="stat-label">{$_('tools.caption-length.stats.characters')}</span>
            </div>
            <div class="stat-item">
              <span class="stat-val">{stats().words}</span>
              <span class="stat-label">{$_('tools.caption-length.stats.words')}</span>
            </div>
            <div class="stat-item">
              <span class="stat-val">{stats().emojis}</span>
              <span class="stat-label">{$_('tools.caption-length.stats.emojis')}</span>
            </div>
            <div class="stat-item">
              <span class="stat-val">{stats().hashtags}</span>
              <span class="stat-label">{$_('tools.caption-length.stats.hashtags')}</span>
            </div>
            <div class="stat-item">
              <span class="stat-val">{stats().mentions}</span>
              <span class="stat-label">{$_('tools.caption-length.stats.mentions')}</span>
            </div>
          </div>

          <!-- Preview -->
          <h3>{$_('tools.caption-length.preview.title')}</h3>
          <div class="preview-card">
            <div class="preview-header">
              <div class="preview-avatar"></div>
              <div>
                <div class="preview-name">{$_('tools.caption-length.preview.brand')}</div>
                <div class="preview-time">{$_('tools.caption-length.preview.justNow')}</div>
              </div>
            </div>
            <div class="preview-body">
              {#if caption}
                {#if stats().overPreview}
                  <span>{caption.slice(0, stats().limit.preview)}</span><span class="preview-more">{$_('tools.caption-length.preview.more')}</span>
                {:else}
                  <span>{caption}</span>
                {/if}
              {:else}
                <span class="preview-placeholder">{$_('tools.caption-length.preview.placeholder')}</span>
              {/if}
            </div>
          </div>

          <!-- Tips -->
          <h3>{$_('tools.caption-length.tips.title', { values: { platform: $_(`tools.best-time-to-post.platforms.${platform}`) } })}</h3>
          <ul class="tips-list">
            {#each tipIndices as i}
              <li>{$_(`tools.caption-length.tips.${platform}.${i}`)}</li>
            {/each}
          </ul>
        </div>
      </div>

      <div class="cta-section">
        <h3>{$_('tools.caption-length.cta.title')}</h3>
        <p>{$_('tools.caption-length.cta.body')}</p>
        <a href="/start" class="btn btn-primary">{$_('tools.common.cta.tryFree')}</a>
      </div>
    </div>
  </section>
</main>

<SiteFooter />

<style>
  .tool-hero {
    padding: 150px 0 80px;
    text-align: center;
    min-height: 40vh;
    display: flex;
    align-items: center;
  }
  .tool-hero h1 {
    font-size: clamp(2.4rem, 4.4vw, 3.5rem);
    font-weight: var(--heading-weight);
    line-height: 1.12;
    letter-spacing: var(--heading-tracking);
    margin: 0 auto;
    max-width: 20ch;
  }
  .tool-hero .subhead {
    font-size: clamp(1.05rem, 1.5vw, 1.25rem);
    color: var(--ink-soft);
    max-width: 52ch;
    margin: 24px auto 0;
    line-height: 1.45;
  }

  .tool-body { padding: 0 0 120px; }

  .checker-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
    max-width: 960px;
    margin: 0 auto 48px;
  }

  .checker-input, .checker-stats {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 28px;
  }

  .platform-tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }
  .platform-tabs button {
    padding: 8px 14px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--ink-soft);
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .platform-tabs button.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .platform-tabs button:hover:not(.active) {
    background: var(--paper-2);
  }

  .caption-input {
    width: 100%;
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 16px;
    font-family: var(--sans);
    font-size: 0.95rem;
    color: var(--ink);
    outline: none;
    transition: border-color 0.2s;
    line-height: 1.6;
    min-height: 120px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .caption-input:focus { border-color: var(--accent); }
  .caption-input:empty::before {
    content: attr(data-placeholder);
    color: var(--ink-faint);
    pointer-events: none;
  }

  .char-bar {
    height: 4px;
    background: var(--line);
    border-radius: 2px;
    margin-top: 12px;
    overflow: hidden;
  }
  .char-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.2s;
  }
  .char-fill.over { background: #ef4444; }

  .char-info {
    display: flex;
    justify-content: space-between;
    margin-top: 8px;
    font-size: 0.82rem;
    color: var(--ink-faint);
  }
  .char-info .over { color: #ef4444; font-weight: 600; }
  .preview-warn { color: #f59e0b; }

  .checker-stats h3 {
    font-size: 1rem;
    font-weight: 600;
    color: var(--ink);
    margin: 0 0 16px;
  }
  .checker-stats h3:not(:first-child) { margin-top: 28px; }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
  }
  .stat-item {
    text-align: center;
    background: var(--paper-2);
    border-radius: 10px;
    padding: 12px 8px;
  }
  .stat-val {
    display: block;
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--ink);
  }
  .stat-label {
    font-size: 0.7rem;
    color: var(--ink-faint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-top: 2px;
  }

  .preview-card {
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 16px;
  }
  .preview-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .preview-avatar {
    width: 32px; height: 32px; border-radius: 50%;
    background: var(--line);
  }
  .preview-name { font-size: 0.85rem; font-weight: 700; color: var(--ink); }
  .preview-time { font-size: 0.72rem; color: var(--ink-faint); }
  .preview-body { font-size: 0.85rem; color: var(--ink); line-height: 1.5; }
  .preview-more { color: var(--ink-faint); cursor: pointer; }
  .preview-placeholder { color: var(--ink-faint); font-style: italic; }

  .tips-list {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tips-list li {
    font-size: 0.85rem;
    color: var(--ink-soft);
    line-height: 1.5;
    padding-left: 16px;
    position: relative;
  }
  .tips-list li::before {
    content: '→';
    position: absolute;
    left: 0;
    color: var(--accent);
  }

  .cta-section {
    text-align: center;
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 48px 32px;
    max-width: 600px;
    margin: 0 auto;
  }
  .cta-section h3 { font-size: 1.3rem; color: var(--ink); margin: 0 0 12px; }
  .cta-section p { color: var(--ink-soft); font-size: 1rem; margin: 0 0 24px; line-height: 1.5; }

  @media (max-width: 768px) {
    .tool-hero { padding: 124px 0 60px; }
    .tool-hero h1 { font-size: 1.8rem; max-width: none; white-space: normal !important; overflow-wrap: break-word; word-break: break-word; }
    .checker-grid { grid-template-columns: 1fr; }
    .stat-grid { grid-template-columns: repeat(3, 1fr); }
  }
</style>
