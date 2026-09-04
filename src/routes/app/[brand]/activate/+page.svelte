<script lang="ts">
  import { page } from '$app/stores';
  import { onMount, untrack } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { X } from '@lucide/svelte';
  import { showsLocalCurrency, currencyForCountry, visiblePlans } from '$lib/plans';
  import { track, metaPixelTrack } from '$lib/analytics';
  import DeleteBrandDialog from '$lib/components/DeleteBrandDialog.svelte';
  import PlanCards from '$lib/components/PlanCards.svelte';

  let { data, form } = $props();
  const brand = $derived(data.brand);
  const readyPosts = $derived(data.readyPosts ?? 0);
  const localCurrency = $derived(showsLocalCurrency(data.country));
  const currency = $derived(currencyForCountry(data.country));
  const plans = $derived(visiblePlans(!!data.planGo));

  // Dopo il checkout il brand diventa attivo e il load rimanda a /success: qui restano due stati
  // soli, il paywall e l'attesa che l'attivazione arrivi.
  const processing = $derived($page.url.searchParams.get('status') === 'processing');
  // Ciclo e piano evidenziato arrivano dal listino pubblico (?plan&cycle). Valore iniziale
  // soltanto (untrack): il componente si ricrea a ogni navigazione.
  let cycle = $state<'month' | 'year'>(
    untrack(() => ($page.url.searchParams.get('cycle') === 'month' ? 'month' : 'year'))
  );
  const chosenPlan = untrack(() => $page.url.searchParams.get('plan'));

  onMount(() => {
    // Arrivare al paywall vuol dire prospect registrato e onboardato: l'acquisto vero capita
    // troppo di rado perché Meta ci ottimizzi sopra una campagna, questa conversione a monte no.
    if (!processing) {
      metaPixelTrack('CompleteRegistration', undefined, `reg_${brand.id}`);
      return;
    }
    // Il brand diventa attivo per il trigger sulla sottoscrizione, non per una risposta che
    // stiamo aspettando: l'unico modo di accorgersene è richiedere la pagina finché il load
    // rimanda a /success.
    const poll = setInterval(() => location.reload(), 4000);
    return () => clearInterval(poll);
  });

  // Non lo vuole affatto, un piano? Il brand si cancella dal paywall stesso.
  let deleteOpen = $state(false);
</script>

<!-- Sfondo: la dashboard a metà caricamento, puramente visivo. -->
<div class="dash-skel" aria-hidden="true">
  <div class="sk-row"><div class="sk-stat"></div><div class="sk-stat"></div><div class="sk-stat"></div><div class="sk-stat"></div></div>
  <div class="sk-block"></div>
  <div class="sk-grid"><div class="sk-card"></div><div class="sk-card"></div><div class="sk-card"></div></div>
</div>

{#if processing}
  <!-- Il pagamento è tornato: si sta attivando, e non si chiude. -->
  <div class="overlay strong">
    <div class="dialog sm">
      <div class="spinner"></div>
      <h2>{$_('app.activate.processing.title')}</h2>
      <p>{$_('app.activate.processing.body', { values: { brand: brand.name } })}</p>
      <a class="back" href={`/app/${brand.slug}/activate`}>{$_('app.activate.processing.retry')}</a>
    </div>
  </div>
{:else}
  <!-- Paywall a tutta larghezza: niente scorciatoie, solo una via d'uscita silenziosa. -->
  <div class="overlay strong">
    <div class="dialog wide">
      <a class="exit" href={`/app/${brand.slug}`} aria-label={$_('app.activate.paywall.back')}><X size={20} /></a>
      <div class="activate-head">
        {#if readyPosts > 0}
          <div class="ready-pill"><span class="rdot"></span>{$_('app.activate.paywall.readyPill', { values: { count: readyPosts, brand: brand.name } })}</div>
        {/if}
        <p>
          {#if readyPosts > 0}{$_('app.activate.paywall.queued', { values: { count: readyPosts } })} {/if}
          {@html $_('app.activate.paywall.pitch')}
        </p>
        <div class="price-toggles">
          <div class="bill-toggle" role="group" aria-label={$_('pricing.toggle.cycleAria')}>
            <button type="button" class:on={cycle === 'month'} onclick={() => (cycle = 'month')}>{$_('pricing.toggle.monthly')}</button>
            <button type="button" class:on={cycle === 'year'} onclick={() => (cycle = 'year')}>{$_('pricing.toggle.annual')} <span class="save">{$_('pricing.toggle.save')}</span></button>
          </div>
        </div>
      </div>

      {#if localCurrency}
        <p class="local-cur-note">{$_('pricing.localCurrency')}</p>
      {/if}

      <PlanCards {cycle} {currency} {plans} selectedPlan={chosenPlan}>
        {#snippet cta(p)}
          <form method="POST" action="?/checkout">
            <input type="hidden" name="plan" value={p.key} />
            <input type="hidden" name="cycle" value={cycle} />
            <button
              class="pcta {p.popular ? 'is-primary' : 'is-ghost'}"
              type="submit"
              onclick={() => track('checkout_started', { plan: p.key, cycle })}
            >
              {$_('app.activate.paywall.trialCta')}
            </button>
          </form>
        {/snippet}
      </PlanCards>

      <div class="perbrand-note">
        {$_('app.activate.paywall.footerNote')} {#if form?.error}<span style="color:#c0392b;">{form.error}</span>{/if}
      </div>
      <div class="del-row">
        <button class="del-link" type="button" onclick={() => (deleteOpen = true)}>{$_('app.settings.del.cta')}</button>
      </div>
    </div>
  </div>
{/if}

<DeleteBrandDialog bind:open={deleteOpen} brand={{ name: brand.name, slug: brand.slug }} action={`/app/${brand.slug}/settings/danger?/deleteBrand`} />

<style>
  /* finta dashboard in caricamento dietro il dialogo */
  .dash-skel { padding: 4px 4px 24px; }
  .sk-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .sk-stat { height: 92px; border-radius: 16px; }
  .sk-block { height: 220px; border-radius: 18px; margin-top: 16px; }
  .sk-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 16px; }
  .sk-card { height: 150px; border-radius: 16px; }
  .sk-stat, .sk-block, .sk-card {
    background: linear-gradient(100deg, #f1f1f3 30%, #f8f8fa 50%, #f1f1f3 70%);
    background-size: 200% 100%; animation: shimmer 1.4s linear infinite;
  }
  @keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

  /* overlay bloccante — nessun modo di chiuderlo */
  .overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 0; animation: fade 0.25s ease; }
  .overlay.strong { background: rgba(18, 26, 22, 0.42); backdrop-filter: blur(6px); }
  .dialog { background: var(--paper, #fff); border-radius: 0; box-shadow: none; }
  .dialog.sm { max-width: 100%; width: 100%; height: 100%; padding: 38px 34px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .dialog.wide { position: relative; width: 100%; height: 100%; max-height: 100vh; overflow-y: auto; padding: 36px clamp(20px, 4vw, 44px) 32px; }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

  .exit { position: absolute; top: 18px; right: clamp(20px, 4vw, 44px); z-index: 1; color: var(--ink-faint, #86868b);
    display: inline-flex; align-items: center; justify-content: center; text-decoration: none; transition: color 0.15s ease; }
  .exit:hover { color: var(--ink, #1d1d1f); }

  .dialog.sm h2 { font-size: 1.5rem; font-weight: var(--heading-weight); margin-top: 14px; letter-spacing: var(--heading-tracking); }
  .dialog.sm p { color: var(--ink-soft); margin-top: 10px; line-height: 1.5; }

  .activate-head { text-align: center; max-width: 46ch; margin: 2px auto 26px; }
  .ready-pill { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 980px; margin-bottom: 16px;
    background: rgba(var(--accent-rgb), 0.08); color: var(--accent); font-size: 13px; font-weight: 600; }
  .rdot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0.5); animation: pulse 1.8s infinite; }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0.45); } 70% { box-shadow: 0 0 0 7px rgba(var(--accent-rgb), 0); } 100% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0); } }
  .activate-head p { color: var(--ink-soft); margin: 10px 0 18px; }
  .price-toggles {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .bill-toggle { margin: 0; }
  .local-cur-note { margin: 0 auto 18px; max-width: 460px; font-size: 13px; line-height: 1.5; opacity: 0.6; text-align: center; }
  .perbrand-note { text-align: center; margin-top: 22px; color: var(--ink-soft); font-size: 13.5px; line-height: 1.6; }
  .del-row { text-align: center; margin-top: 14px; }
  .del-link { background: none; border: none; font: inherit; font-size: 12px; cursor: pointer;
    color: var(--ink-faint, #86868b); text-decoration: underline; padding: 2px; }
  .del-link:hover { color: #c0392b; }
  .back { color: var(--ink-soft); text-decoration: none; }
  .spinner { width: 30px; height: 30px; margin: 0 auto; border-radius: 50%;
    border: 3px solid rgba(var(--accent-rgb), 0.25); border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  form { margin: 0; }

  @container workbench (max-width: 720px) {
    .sk-row { grid-template-columns: repeat(2, 1fr); }
    .sk-grid { grid-template-columns: 1fr; }
  }
</style>
