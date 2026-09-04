<script lang="ts">
  import { _ } from 'svelte-i18n';

  // Landing FAQ — first the promise the hero makes and its limits, then the objection from the
  // reader who could build it himself. Those two are the doubts; the rest is detail.
  // Copy lives in i18n under landing.faq.*.
  const KEYS = ['agency', 'diy', 'which', 'mcp', 'review', 'platforms', 'cost', 'selfhost'];
</script>

<section class="alt faq-sec" aria-labelledby="landing-faq-title">
  <div class="wrap">
    <div class="sec-head">
      <div class="kicker">{$_('landing.faq.kicker')}</div>
      <h2 id="landing-faq-title">{$_('landing.faq.title')}</h2>
    </div>
    <div class="faq">
      {#each KEYS as k (k)}
        <details class="faq-item">
          <summary>{$_('landing.faq.' + k + '.q')}<span class="chev" aria-hidden="true">+</span></summary>
          <p>{$_('landing.faq.' + k + '.a')}</p>
        </details>
      {/each}
    </div>
  </div>
</section>

<style>
  /* Self-contained accordion; reuses the global landing tokens (--line, --paper, --accent-rgb…). */
  .faq-sec {
    padding: 88px 0;
  }
  .faq {
    max-width: 720px;
    margin: 28px auto 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .faq-item {
    border: 1px solid var(--line, rgba(0, 0, 0, 0.1));
    border-radius: 16px;
    background: var(--paper, #fff);
    padding: 4px 20px;
    transition: border-color 0.2s var(--ease, ease);
  }
  .faq-item[open] {
    border-color: rgba(var(--accent-rgb, 124, 92, 255), 0.35);
  }
  .faq-item summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    cursor: pointer;
    list-style: none;
    padding: 16px 0;
    font-weight: 600;
    font-size: 1.02rem;
    color: var(--ink, #1d1d1f);
  }
  .faq-item summary::-webkit-details-marker {
    display: none;
  }
  .faq-item .chev {
    font-size: 1.4rem;
    line-height: 1;
    color: var(--ink-soft, #6e6e73);
    transition: transform 0.2s var(--ease, ease);
    flex: none;
  }
  .faq-item[open] .chev {
    transform: rotate(45deg);
  }
  .faq-item p {
    margin: 0 0 18px;
    color: var(--ink-soft, #6e6e73);
    line-height: 1.55;
  }
</style>
