<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import { SvelteSet } from 'svelte/reactivity';
  import PageHead from '$lib/components/PageHead.svelte';
  import UpgradeLink from '$lib/components/UpgradeLink.svelte';
  import { _ } from 'svelte-i18n';
  import { ArrowLeft, Sparkles, CalendarDays, Zap, Loader } from '@lucide/svelte';

  let { form, data } = $props();
  // The month job is refused server-side when the balance can't cover it; mirror that here so the
  // button explains itself instead of failing on submit.
  const enoughForBatch = $derived(data.credits >= data.estimate.credits);
  const enoughForFast = $derived(data.credits >= data.estimateFast.credits);
  const busy = new SvelteSet<string>();
  const isBusy = (key: string) => busy.has(key);
  const withBusy = (key: string) => () => {
    busy.add(key);
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy.delete(key);
    };
  };
</script>

<div class="new-page">
  <PageHead title="Nuovo post" subtitle="Genera un articolo blog come bozza, pronto da revisionare.">
    {#snippet actions()}
      <a class="btn ghost" href="/app/{$page.params.brand}/site">
        <ArrowLeft size={14} strokeWidth={2} /> Torna al blog
      </a>
    {/snippet}
  </PageHead>

  <!-- Questi banner erano hardcoded in italiano: uno spagnolo o un francese leggeva italiano.
       Quello dei crediti prometteva anche "oppure aggiungere crediti" — un bottone che non
       esiste (non c'è top-up: credit_grants ha un solo chiamante, i referral). Al suo posto il
       link all'upgrade, che è l'unica uscita vera. -->
  {#if form?.error === 'topic_required'}
    <p class="banner err">{$_('app.site.newPost.topicRequired')}</p>
  {:else if form?.error === 'generation_failed'}
    <p class="banner err">{$_('app.site.newPost.generationFailed')}</p>
  {:else if form?.error === 'plan_month_failed'}
    <p class="banner err">{$_('app.site.newPost.planMonthFailed')}</p>
  {:else if form?.error === 'insufficient_credits'}
    <p class="banner warn">
      {$_('app.site.newPost.insufficientCredits', {
        values: { needed: data.estimate.credits, have: data.credits }
      })}
      <UpgradeLink />
    </p>
  {:else if form?.error === 'month_cap_reached'}
    <p class="banner warn">
      {$_('app.site.newPost.monthCapReached', { values: { cap: data.usage.cap } })}
    </p>
  {/if}

  <section class="card">
    <h2>Da un argomento</h2>
    <p class="muted small">
      Il post viene creato come <b>bozza</b>, ancorato alla voce del brand e alle pagine del sito.
    </p>
    <form method="POST" action="?/generatePost" use:enhance={withBusy('generate')} class="gen">
      <input
        type="text"
        name="topic"
        placeholder="Argomento o titolo (es. Guida alla carriera alias)"
        disabled={isBusy('generate')}
        autofocus
      />
      <button
        class="btn primary"
        class:loading={isBusy('generate')}
        type="submit"
        disabled={isBusy('generate')}
      >
        <Sparkles size={14} /> Genera post
      </button>
    </form>
  </section>

  <section class="card">
    <h2>Un mese di articoli</h2>

    {#if data.monthJob}
      <!-- A job is in flight: the button would only queue a duplicate, so show progress instead. -->
      <div class="job">
        <p class="job-title"><Loader size={14} class="spin" /> Stiamo preparando il tuo mese di articoli</p>
        <p class="muted small">
          {#if data.monthJob.status === 'translating'}
            Testi e immagini pronti. Ora stiamo traducendo nelle altre lingue del blog
            ({data.monthJob.progress?.translations ?? 0} fatte).
          {:else if data.monthJob.status === 'imaging'}
            Testi pronti ({data.monthJob.progress?.written ?? 0}). Ora stiamo generando le immagini
            {#if data.monthJob.progress?.images_expected}({data.monthJob.progress.images_expected} in coda){/if}.
          {:else}
            Scrittura degli articoli in corso — {data.monthJob.progress?.written ?? 0} di
            {data.monthJob.progress?.planned ?? 0} completati.
          {/if}
        </p>
        <p class="muted small">
          {#if data.monthJob.mode === 'fast'}
            Generazione veloce attiva: di solito è questione di minuti. <b>Ti avvisiamo via email</b> quando è tutto pronto.
          {:else}
            <b>Ti avvisiamo via email entro 12-24 ore</b>, quando gli articoli sono scritti e illustrati. Puoi
            chiudere questa pagina — il lavoro continua.
          {/if}
        </p>
      </div>
    {:else if data.usage.remaining <= 0}
      <!-- Cap reached: the month button is gone, single-article generation above still works. -->
      <div class="job">
        <p class="job-title">Limite mensile raggiunto</p>
        <p class="muted small">
          Hai usato tutti i <b>{data.usage.cap} articoli</b> di questo mese. Il conteggio si azzera il primo del
          mese prossimo. Nel frattempo puoi generare <b>singoli articoli</b> da un argomento, qui sopra.
        </p>
      </div>
    {:else}
      <p class="muted small">
        Anomalia pianifica un mese di argomenti dal tuo piano editoriale, con una data di uscita ciascuno, e li
        scrive tutti. Ogni articolo riceve:
      </p>
      <ul class="deliverables">
        <li>Testo lungo, titolo, meta title e meta description ottimizzati</li>
        <li>Immagine di copertina + immagini dentro l'articolo</li>
        <li>Passaggio di humanizing e ottimizzazione fino a punteggio alto</li>
        <li>Link interni alle tue pagine e fonti esterne reali citate</li>
      </ul>
      <div class="alt-actions">
        <form method="POST" action="?/planMonth" use:enhance={withBusy('plan-month')}>
          <button
            class="btn primary"
            class:loading={isBusy('plan-month')}
            type="submit"
            disabled={isBusy('plan-month') || isBusy('plan-month-fast') || !enoughForBatch}
            title={enoughForBatch
              ? 'Pianifica il mese e genera tutto in background. Ti avvisiamo via email entro 12-24 ore.'
              : `Servono circa ${data.estimate.credits} crediti, ne hai ${data.credits}.`}
          >
            <CalendarDays size={14} /> Pianifica il mese
          </button>
        </form>
        <form method="POST" action="?/planMonth" use:enhance={withBusy('plan-month-fast')}>
          <input type="hidden" name="mode" value="fast" />
          <button
            class="btn ghost"
            class:loading={isBusy('plan-month-fast')}
            type="submit"
            disabled={isBusy('plan-month') || isBusy('plan-month-fast') || (data.fastAvailable && !enoughForFast)}
            title={data.fastAvailable
              ? 'Genera subito, senza attendere la coda. Richiede il piano Pro.'
              : 'Disponibile con il piano Pro: genera subito invece di attendere 12-24 ore.'}
          >
            <Zap size={14} /> Fast generation
            {#if !data.fastAvailable}<span class="badge">Pro</span>{/if}
          </button>
        </form>
      </div>
      <p class="muted tiny">
        <b>{data.usage.remaining}</b> di {data.usage.cap} articoli disponibili questo mese{#if data.usage.remaining < data.usage.cap} ({data.usage.used} già usati){/if}.
        Costo stimato: <b>~{data.estimate.credits} crediti</b> in batch{#if data.fastAvailable}, ~{data.estimateFast.credits} in fast{/if}
        — ne hai <b>{data.credits}</b>.
        {#if data.estimate.translations}
          Incluse {data.estimate.translations} traduzioni.
        {/if}
        La generazione normale usa la coda batch: costa molto meno e arriva entro 12-24 ore.
        <b>Fast generation</b> genera subito{#if !data.fastAvailable} ed è inclusa nel piano Pro{/if}.
      </p>
    {/if}
  </section>
</div>

<style>
  .new-page {
    max-width: var(--content-max, 720px);
    margin: 0 auto;
  }
  .banner {
    font-size: 13px;
    border-radius: 10px;
    padding: 10px 14px;
    margin: 0 0 16px;
  }
  .banner.err {
    background: #fef2f2;
    color: #b91c1c;
  }
  .banner.warn {
    background: #fffbeb;
    color: #92400e;
  }
  .card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 22px 24px;
    margin-bottom: 16px;
  }
  .card h2 {
    font-size: 17px;
    font-weight: 600;
    margin: 0 0 8px;
    color: var(--ink);
  }
  .gen {
    display: flex;
    gap: 8px;
    margin-top: 14px;
  }
  .gen input {
    flex: 1;
    font-size: 14px;
    padding: 11px 13px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
  }
  .alt-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 14px;
  }
  .job {
    margin-top: 6px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: color-mix(in srgb, var(--accent, #7c5cff) 5%, transparent);
  }
  .job-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 8px;
    color: var(--ink);
  }
  .job .small + .small {
    margin-top: 8px;
  }
  :global(.spin) {
    animation: spin 1.1s linear infinite;
  }
  .tiny {
    font-size: 12px;
    line-height: 1.5;
    margin: 12px 0 0;
  }
  .badge {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 2px 5px;
    border-radius: 5px;
    background: var(--accent, #7c5cff);
    color: #fff;
  }
  .deliverables {
    margin: 12px 0 0;
    padding-left: 18px;
    color: var(--ink-soft);
    font-size: 13px;
    line-height: 1.6;
  }
  .muted {
    color: var(--ink-faint);
  }
  .small {
    font-size: 13px;
    line-height: 1.45;
    margin: 0;
  }
  .btn {
    font-size: 13px;
    font-weight: 600;
    border-radius: 10px;
    padding: 10px 16px;
    cursor: pointer;
    border: 1px solid transparent;
    line-height: 1;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    color: inherit;
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .btn.primary {
    background: var(--accent, #7c5cff);
    color: #fff;
  }
  .btn.ghost {
    background: transparent;
    color: var(--ink-soft);
    border-color: var(--line);
  }
  .loading {
    position: relative;
    color: transparent !important;
    pointer-events: none;
  }
  .loading::after {
    content: '';
    position: absolute;
    inset: 0;
    margin: auto;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 2px solid var(--ink-faint);
    border-top-color: transparent;
    animation: spin 0.7s linear infinite;
  }
  .btn.primary.loading::after {
    border-color: #fff;
    border-top-color: transparent;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @container workbench (max-width: 640px) {
    .gen {
      flex-direction: column;
    }
  }
</style>
