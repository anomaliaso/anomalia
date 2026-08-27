<script lang="ts">
  import { _ } from 'svelte-i18n';
  let { data } = $props();
</script>

<svelte:head>
  <title>{$_('meta.waitlist.title')}</title>
  <!-- Confirmation page shows the user's email — keep it out of the index. -->
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="wrap">
  <div class="mark">Anomalia</div>
  <h1>{$_('waitlist.title')}</h1>
  <p class="sub">
    {@html $_('waitlist.sub', { values: { email: '<b>' + data.email + '</b>' } })}
  </p>
  <div class="queue">
    <div class="num">{data.ahead}</div>
    <div class="lbl">{$_('waitlist.ahead', { values: { count: data.ahead } })}</div>
  </div>
  <p class="note">{$_('waitlist.note')}</p>
</main>

<style>
  .wrap {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 40px 24px;
    gap: 6px;
  }
  .mark {
    width: 60px;
    height: 60px;
    border-radius: 18px;
    background: linear-gradient(135deg, var(--accent-2, #9d86ff), var(--accent, #7c5cff));
    color: #fff;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 22px;
    box-shadow: 0 16px 40px -16px rgba(var(--accent-rgb), 0.6);
  }
  h1 {
    font-size: clamp(1.8rem, 4vw, 2.6rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    margin: 0;
  }
  .sub {
    color: var(--ink-soft, #6e6e73);
    margin: 12px 0 0;
    max-width: 36ch;
    line-height: 1.45;
  }
  .queue {
    margin: 30px 0 0;
    padding: 24px 40px;
    border: 1px solid var(--line, #e3e3e6);
    border-radius: 20px;
    background: var(--paper-2, #f5f5f7);
  }
  .num {
    font-size: 3.2rem;
    font-weight: 700;
    letter-spacing: -0.04em;
    line-height: 1;
    color: var(--accent, #7c5cff);
  }
  .lbl {
    font-size: 14px;
    color: var(--ink-faint, #86868b);
    margin-top: 6px;
  }
  .note {
    margin-top: 22px;
    font-size: 13px;
    color: var(--ink-faint, #86868b);
  }
</style>
