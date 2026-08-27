<script lang="ts">
  import { enhance } from '$app/forms';
  import { _, locale } from 'svelte-i18n';
  import { fly } from 'svelte/transition';
  import CountryPicker from '$lib/components/CountryPicker.svelte';

  // Intl knows every ISO-4217 code and how to name it — no currency table to maintain.
  const currencies = $derived.by(() => {
    const dn = new Intl.DisplayNames([$locale ?? 'en'], { type: 'currency' });
    return Intl.supportedValuesOf('currency')
      .map((code) => ({ code, name: dn.of(code) ?? code }))
      .sort((a, b) => a.code.localeCompare(b.code));
  });

  let { data, form } = $props();
  const brand = $derived(data.brand);
  const base = $derived(`/app/${brand.slug}`);

  let daily = $state('');
  let monthly = $state('');
  let countries = $state('IT');
  let currency = $state('EUR');
  let dsaBeneficiary = $state('');
  let dsaPayor = $state('');

  $effect(() => {
    // Empty, not 50/500: a pre-filled number reads as "the budget", which it is not — the budget
    // lives on the campaign. Blank means no ceiling.
    daily = data.settings.dailyBudgetCap != null ? String(data.settings.dailyBudgetCap) : '';
    monthly = data.settings.monthlyBudgetCap != null ? String(data.settings.monthlyBudgetCap) : '';
    countries = (data.settings.defaultCountries ?? ['IT']).join(', ');
    currency = data.settings.defaultCurrency ?? 'EUR';
    dsaBeneficiary = data.settings.dsaBeneficiary ?? '';
    dsaPayor = data.settings.dsaPayor ?? '';
  });

  let saving = $state(false);
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const saveEnhance = () => {
    saving = true;
    return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
      await update();
      saving = false;
      if (result.type !== 'success') return;
      toast = $_('app.settings.ads.saved');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast = null), 3000);
    };
  };
</script>

<section class="panel">
  <div class="panel-head"><div class="t">{$_('app.settings.ads.capsTitle')}</div></div>

  {#if !data.adsEnabled}
    <div class="field">
      <div class="fs">{$_('app.settings.ads.proOnly')}</div>
      <a class="mini connect" href={`${base}/upgrade?plan=starter`}>{$_('app.settings.ads.upgrade')}</a>
    </div>
  {:else}
    <div class="field" style="flex-direction:column;align-items:stretch;gap:10px;">
      <div class="ftxt">
        <div class="fs">{$_('app.settings.ads.capsDesc')}</div>
      </div>
      <!-- Global .form-grid/.fld system (src/app.css): themed controls, and the select gets the
           appearance:none + custom arrow a native select needs to be styleable at all. -->
      <form method="POST" action="?/saveSettings" use:enhance={saveEnhance} class="form-grid cols-2">
        <label class="fld">
          <span class="lb">{$_('app.settings.ads.dailyCap')}</span>
          <input
            name="dailyBudgetCap"
            type="number"
            min="1"
            step="1"
            bind:value={daily}
            placeholder={$_('app.settings.ads.noCap')}
          />
        </label>
        <label class="fld">
          <span class="lb">{$_('app.settings.ads.monthlyCap')}</span>
          <input
            name="monthlyBudgetCap"
            type="number"
            min="1"
            step="1"
            bind:value={monthly}
            placeholder={$_('app.settings.ads.noCap')}
          />
        </label>
        <!-- A div, not a label: the picker is several controls, and a wrapping label re-dispatches
             every inner click onto the search box, which swallowed the option clicks. -->
        <div class="fld wide">
          <span class="lb">{$_('app.settings.ads.countries')}</span>
          <CountryPicker
            name="defaultCountries"
            bind:value={countries}
            placeholder={$_('app.settings.ads.countriesPh')}
          />
        </div>
        <label class="fld">
          <span class="lb">{$_('app.settings.ads.currency')}</span>
          <select name="defaultCurrency" bind:value={currency}>
            {#each currencies as c (c.code)}
              <option value={c.code}>{c.code} — {c.name}</option>
            {/each}
          </select>
        </label>
        <label class="fld">
          <span class="lb">{$_('app.settings.ads.dsaBeneficiary')}</span>
          <input name="dsaBeneficiary" type="text" bind:value={dsaBeneficiary} maxlength="100" />
        </label>
        <label class="fld">
          <span class="lb">{$_('app.settings.ads.dsaPayor')}</span>
          <input name="dsaPayor" type="text" bind:value={dsaPayor} maxlength="100" />
        </label>
        <div class="form-foot">
          <span></span>
          <div class="acts">
            <button class="mini connect" type="submit" disabled={saving}>
              {#if saving}<span class="roller" aria-hidden="true"></span>{/if}
              {saving ? $_('app.settings.ads.saving') : $_('app.settings.save')}
            </button>
          </div>
        </div>
      </form>
    </div>

    <!-- Success is the toast; an error stays put, because a message you may have missed is the one
         thing you cannot afford to miss. -->
    {#if form?.error}<div class="field"><div class="fs err">{form.error}</div></div>{/if}

    <div class="field">
      <a class="mini connect" href={`${base}/ads`}>{$_('app.settings.ads.openAds')} →</a>
    </div>
  {/if}
</section>

{#if toast}
  <div class="toast" role="status" aria-live="polite" transition:fly={{ y: 12, duration: 180 }}>
    <span aria-hidden="true">✓</span>{toast}
  </div>
{/if}

<style>
  /* Controls come from the global .form-grid/.fld system — nothing to restyle here. */
  .form-grid { padding: 0; }
  .err { color: #c0392b; }

  .roller {
    display: inline-block; width: 13px; height: 13px; margin-right: 7px; vertical-align: -2px;
    border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
    animation: roll 0.7s linear infinite;
  }
  @keyframes roll { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .roller { animation-duration: 2.4s; }
  }

  .toast {
    position: fixed; z-index: 60; left: 50%; bottom: 26px; transform: translateX(-50%);
    display: flex; align-items: center; gap: 8px;
    padding: 11px 18px; border-radius: 980px;
    background: var(--ink); color: var(--paper);
    font-size: 13.5px; font-weight: 600;
    box-shadow: 0 14px 30px -12px rgba(0, 0, 0, 0.5);
  }
</style>
