<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { siClaude } from 'simple-icons';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const TK = 'landing.hero.claudeConnect';

  let tab = $state('claude');
  let copied = $state('');

  function copy(value: string) {
    navigator.clipboard.writeText(value);
    copied = value;
    setTimeout(() => (copied = ''), 2000);
  }
</script>

{#if open}
  <div
    class="cd-overlay"
    role="presentation"
    onclick={(e) => e.target === e.currentTarget && (open = false)}
    onkeydown={(e) => e.key === 'Escape' && (open = false)}
  >
    <div class="cd-card" role="dialog" aria-modal="true" aria-labelledby="cd-title">
      <header class="cd-head">
        <span class="cd-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d={siClaude.path} /></svg>
        </span>
        <div class="cd-head-text">
          <h3 id="cd-title">{$_(`${TK}.title`)}</h3>
          <p>{$_(`${TK}.subtitle`)}</p>
        </div>
        <button class="cd-close" onclick={() => (open = false)} aria-label={$_(`${TK}.close`)}>×</button>
      </header>

      <div class="cd-tabs" role="tablist" aria-label={$_(`${TK}.title`)}>
        <button
          class="cd-tab"
          class:active={tab === 'claude'}
          role="tab"
          aria-selected={tab === 'claude'}
          onclick={() => (tab = 'claude')}
        >
          {$_(`${TK}.tabs.claude`)}
        </button>
        <button
          class="cd-tab"
          class:active={tab === 'code'}
          role="tab"
          aria-selected={tab === 'code'}
          onclick={() => (tab = 'code')}
        >
          {$_(`${TK}.tabs.code`)}
        </button>
      </div>

      {#if tab === 'claude'}
        <ol class="cd-steps">
          <li class="cd-step">
            <span class="cd-num">1</span>
            <div class="cd-step-body">
              <h4>{$_(`${TK}.claude.s1.title`)}</h4>
              <p>{$_(`${TK}.claude.s1.body`)}</p>
              <span class="cd-chip">{$_(`${TK}.claude.s1.chip`)}</span>
            </div>
          </li>
          <li class="cd-step">
            <span class="cd-num">2</span>
            <div class="cd-step-body">
              <h4>{$_(`${TK}.claude.s2.title`)}</h4>
              <p>{$_(`${TK}.claude.s2.body`)}</p>
              <div class="cd-code">
                <code>{$_(`${TK}.claude.s2.value`)}</code>
                <button
                  class="cd-copy"
                  onclick={() => copy($_(`${TK}.claude.s2.value`))}
                  aria-label={$_(`${TK}.copy`)}
                >
                  {copied === $_(`${TK}.claude.s2.value`) ? $_(`${TK}.copied`) : $_(`${TK}.copy`)}
                </button>
              </div>
            </div>
          </li>
          <li class="cd-step">
            <span class="cd-num">3</span>
            <div class="cd-step-body">
              <h4>{$_(`${TK}.claude.s3.title`)}</h4>
              <p>{$_(`${TK}.claude.s3.body`)}</p>
            </div>
          </li>
        </ol>
      {:else}
        <ol class="cd-steps">
          <li class="cd-step">
            <span class="cd-num">1</span>
            <div class="cd-step-body">
              <h4>{$_(`${TK}.code.s1.title`)}</h4>
              <p>{$_(`${TK}.code.s1.body`)}</p>
              <div class="cd-code">
                <code>{$_(`${TK}.code.s1.value`)}</code>
                <button
                  class="cd-copy"
                  onclick={() => copy($_(`${TK}.code.s1.value`))}
                  aria-label={$_(`${TK}.copy`)}
                >
                  {copied === $_(`${TK}.code.s1.value`) ? $_(`${TK}.copied`) : $_(`${TK}.copy`)}
                </button>
              </div>
            </div>
          </li>
          <li class="cd-step">
            <span class="cd-num">2</span>
            <div class="cd-step-body">
              <h4>{$_(`${TK}.code.s2.title`)}</h4>
              <p>{$_(`${TK}.code.s2.body`)}</p>
            </div>
          </li>
          <li class="cd-step">
            <span class="cd-num">3</span>
            <div class="cd-step-body">
              <h4>{$_(`${TK}.code.s3.title`)}</h4>
              <p>{$_(`${TK}.code.s3.body`)}</p>
            </div>
          </li>
        </ol>
      {/if}
    </div>
  </div>
{/if}

<style>
  .cd-overlay {
    position: fixed; inset: 0; z-index: 300;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
  }
  .cd-card {
    width: 100%; max-width: 520px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 22px;
    box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.4);
    padding: 26px;
    max-height: min(86vh, 640px);
    overflow-y: auto;
  }
  .cd-head {
    display: flex; align-items: flex-start; gap: 14px;
    padding-right: 28px;
  }
  .cd-logo {
    flex: 0 0 auto;
    width: 44px; height: 44px; border-radius: 12px;
    display: inline-flex; align-items: center; justify-content: center;
    background: #d97757; color: #fff;
  }
  .cd-logo svg { width: 26px; height: 26px; }
  .cd-head-text h3 {
    font-family: var(--sans);
    font-size: 1.15rem; font-weight: 600; letter-spacing: -0.02em;
    margin: 2px 0 4px;
  }
  .cd-head-text p {
    margin: 0; font-size: 13px; color: var(--ink-soft); line-height: 1.5;
  }
  .cd-close {
    position: absolute; top: 18px; right: 18px;
    width: 30px; height: 30px; border-radius: 50%;
    border: none; background: transparent; color: var(--ink-faint);
    font-size: 20px; line-height: 1; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
    transition: background .18s var(--ease), color .18s var(--ease);
  }
  .cd-close:hover { background: var(--paper-2); color: var(--ink); }
  .cd-card { position: relative; }

  .cd-tabs {
    margin-top: 22px;
    display: flex; gap: 4px;
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 4px;
  }
  .cd-tab {
    flex: 1; padding: 9px 12px;
    border: none; border-radius: 9px;
    background: transparent; color: var(--ink-faint);
    font: inherit; font-size: 14px; font-weight: 600;
    cursor: pointer; transition: color .18s var(--ease), background .18s var(--ease), box-shadow .18s var(--ease);
  }
  .cd-tab.active {
    background: var(--paper); color: var(--ink);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  }

  .cd-steps { list-style: none; margin: 24px 0 0; padding: 0; display: flex; flex-direction: column; gap: 22px; }
  .cd-step { display: flex; gap: 14px; }
  .cd-num {
    flex: 0 0 auto;
    width: 28px; height: 28px; border-radius: 50%;
    background: var(--accent); color: #fff;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 700;
    margin-top: 1px;
  }
  .cd-step-body { min-width: 0; }
  .cd-step-body h4 {
    font-family: var(--sans);
    font-size: 15px; font-weight: 600; letter-spacing: -0.01em;
    margin: 0 0 5px;
  }
  .cd-step-body p {
    margin: 0; font-size: 13.5px; color: var(--ink-soft); line-height: 1.55;
  }
  .cd-chip {
    display: inline-block; margin-top: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px; color: var(--ink);
    background: var(--paper-2); border: 1px solid var(--line);
    border-radius: 9px; padding: 7px 11px;
  }
  .cd-code {
    margin-top: 10px;
    display: flex; align-items: center; gap: 8px;
    background: #1d1d1f; border-radius: 11px; padding: 11px 11px 11px 14px;
  }
  .cd-code code {
    flex: 1; min-width: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px; color: #f2f2f2;
    overflow-x: auto; white-space: nowrap;
  }
  .cd-copy {
    flex: 0 0 auto;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px; background: rgba(255, 255, 255, 0.08);
    color: #fff; font: inherit; font-size: 12px; font-weight: 600;
    padding: 6px 11px; cursor: pointer;
    transition: background .18s var(--ease);
  }
  .cd-copy:hover { background: rgba(255, 255, 255, 0.16); }

  :global(:root[data-theme='dark']) .cd-card {
    background: var(--paper-2);
  }
  :global(:root[data-theme='dark']) .cd-tabs { background: var(--paper-3, #222); }
  :global(:root[data-theme='dark']) .cd-tab.active { background: var(--paper-2); }
  :global(:root[data-theme='dark']) .cd-chip { background: var(--paper-3, #222); }
  :global(:root[data-theme='dark']) .cd-code { background: #0c0c0c; }

  @media (max-width: 480px) {
    .cd-card { padding: 20px; }
    .cd-head-text h3 { font-size: 1.05rem; }
  }
</style>
