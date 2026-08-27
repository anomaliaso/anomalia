<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import PageHead from '$lib/components/PageHead.svelte';
  import { Sparkles } from '@lucide/svelte';
  import { adsErrorMessage, creditsForSpend } from '$lib/ads-fee';
  import CountryPicker from '$lib/components/CountryPicker.svelte';

  let { data, form } = $props();
  const brand = $derived(data.brand);
  const isGoogle = $derived(data.channel === 'google');
  const backHref = $derived(`/app/${brand.slug}/ads/${data.channel}`);

  // The AI writes the whole campaign; these hold the draft so every field stays editable before it
  // is saved. A returned draft overwrites them — that IS the point of pressing Generate again.
  let campaignType = $state('SEARCH');
  let brief = $state('');
  let name = $state('');
  let goal = $state('traffic');
  let budgetAmount = $state(25);
  let headline = $state('');
  // One input per variant — a textarea of "one per line" is a list pretending to be prose.
  let additionalHeadlines = $state<string[]>([]);
  let body = $state('');
  let additionalDescriptions = $state<string[]>([]);
  let keywords = $state('');
  let landingPageUrl = $state('');
  let businessName = $state('');
  let countries = $state('');
  let ageMin = $state(25);
  let ageMax = $state(55);
  let imageUrl = $state('');
  let squareImageUrl = $state('');
  let storyImageUrl = $state('');
  let endDate = $state('');
  const today = new Date().toISOString().slice(0, 10);
  /** Extra ads sharing this campaign's ad set. Empty = a single-ad campaign, as before. */
  let variants = $state<{ headline: string; body: string; imageUrl: string }[]>([]);
  let generating = $state(false);
  let draftRationale = $state('');
  let hasDraft = $state(false);

  $effect(() => {
    const d = form?.draft;
    if (!d) return;
    name = d.name;
    goal = d.goal;
    budgetAmount = d.budgetAmount;
    headline = d.headline;
    additionalHeadlines = [...d.additionalHeadlines];
    body = d.body;
    additionalDescriptions = [...d.additionalDescriptions];
    keywords = d.keywords.join('\n');
    landingPageUrl = d.landingPageUrl;
    businessName = d.businessName;
    countries = d.countries.join(', ');
    ageMin = d.ageMin;
    ageMax = d.ageMax;
    if (d.campaignType) campaignType = d.campaignType;
    draftRationale = d.rationale;
    hasDraft = true;
  });

  const headlineMax = $derived(isGoogle ? 30 : 40);
  const launchCredits = $derived(creditsForSpend(Number(budgetAmount) || 0));
  const bodyMax = $derived(isGoogle ? 90 : 280);

  function addTo(list: string[]): string[] {
    return [...list, ''];
  }
  function removeFrom(list: string[], i: number): string[] {
    return list.filter((_, idx) => idx !== i);
  }
</script>

<PageHead title={$_(`app.ads.new.title.${data.channel}`)} subtitle={$_('app.ads.new.subtitle')}>
  {#snippet actions()}
    <a class="topback" href={backHref}>{$_('app.ads.new.back')}</a>
  {/snippet}
</PageHead>

<div class="content narrow">
  {#if form?.error}
    {@const e = adsErrorMessage(form.error)}
    <div class="banner err">{$_(e.key, { values: e.values, default: form.error })}</div>
  {/if}
  {#if !data.readiness.ready}
    <div class="banner warn">
      <span>{$_('app.ads.new.notReady')}</span>
      <a href={backHref}>{$_('app.ads.readiness.title')} →</a>
    </div>
  {/if}

  <!-- Step 1 — say what to push (optional). The AI does the rest. -->
  <section class="panel step">
    <div class="panel-head">
      <div class="t"><span class="num">1</span>{$_('app.ads.new.briefTitle')}</div>
    </div>
    <form
      method="POST"
      action="?/generate"
      class="form-grid cols-2"
      use:enhance={() => {
        generating = true;
        return async ({ update }) => {
          await update({ reset: false });
          generating = false;
        };
      }}
    >
      {#if isGoogle}
        <label class="fld">
          <span class="lb">{$_('app.ads.campaignType')}</span>
          <select name="campaignType" bind:value={campaignType}>
            <option value="SEARCH">Search</option>
            <option value="DISPLAY">Display</option>
          </select>
        </label>
      {/if}
      <label class="fld">
        <span class="lb">{$_('app.ads.dailyBudget')}</span>
        <input name="budgetAmount" type="number" min="1" step="1" bind:value={budgetAmount} />
      </label>
      <label class="fld" class:wide={!isGoogle}>
        <span class="lb">{$_('app.ads.new.landingLabel')} <span class="opt">— {$_('app.ads.new.optional')}</span></span>
        <input name="landingPageUrl" type="text" inputmode="url" bind:value={landingPageUrl} placeholder={brand.website ?? 'anomalia.so'} />
      </label>
      <label class="fld wide">
        <span class="lb">{$_('app.ads.new.briefLabel')} <span class="opt">— {$_('app.ads.new.optional')}</span></span>
        <textarea name="brief" rows="2" bind:value={brief} placeholder={$_('app.ads.new.briefPlaceholder')}></textarea>
      </label>
      <div class="form-foot">
        <p class="note">{$_('app.ads.new.briefHint')}</p>
        <div class="acts">
          <button class="mini connect gen" type="submit" disabled={generating}>
            <Sparkles size={15} />
            {generating ? $_('app.ads.new.generating') : $_('app.ads.new.generate')}
          </button>
        </div>
      </div>
    </form>
  </section>

  <!-- Step 2 — review what the AI wrote, edit anything, save as a proposal. -->
  <section class="panel step" class:idle={!hasDraft}>
    <div class="panel-head">
      <div class="t"><span class="num">2</span>{$_('app.ads.new.reviewTitle')}</div>
      {#if hasDraft}<span class="pill">{$_('app.ads.new.editable')}</span>{/if}
    </div>

    {#if !hasDraft}
      <div class="waiting">
        <Sparkles size={18} />
        <p>{$_('app.ads.new.waiting')}</p>
      </div>
    {:else}
      {#if draftRationale}
        <p class="rationale">{draftRationale}</p>
      {/if}

      <form method="POST" action="?/create" use:enhance class="form-grid cols-2">
        <input type="hidden" name="campaignType" value={isGoogle ? campaignType : ''} />

        <div class="sec wide">{$_('app.ads.new.secBasics')}</div>
        {#if !isGoogle}
          <input type="hidden" name="platform" value="metaads" />
        {/if}
        <label class="fld">
          <span class="lb">{$_('app.ads.adAccount')}</span>
          <select name="adAccountId">
            <option value="">{$_('app.ads.adAccountAuto')}</option>
            {#each data.readiness.adAccounts as a (a.id)}
              <option value={a.id}>{a.platform} — {a.name ?? a.id.slice(0, 8)}</option>
            {/each}
          </select>
        </label>
        <label class="fld wide">
          <span class="lb">{$_('app.ads.name')}</span>
          <input name="name" required maxlength="255" bind:value={name} />
        </label>
        <label class="fld">
          <span class="lb">{$_('app.ads.goal')}</span>
          <select name="goal" bind:value={goal}>
            <option value="traffic">traffic</option>
            <option value="engagement">engagement</option>
            <option value="awareness">awareness</option>
            <option value="video_views">video_views</option>
            <!-- conversions / lead_generation removed: Meta rejects them without a pixel or a lead
                 form, which we do not send yet. See SUPPORTED_GOALS in ads-generate.ts. -->
          </select>
        </label>
        <label class="fld">
          <span class="lb">{$_('app.ads.dailyBudget')}</span>
          <input name="budgetAmount" type="number" min="1" step="1" bind:value={budgetAmount} />
        </label>
        <!-- Without this the daily budget recurs forever: the most likely way a non-expert
             overspends is forgetting a campaign is still running. -->
        <label class="fld">
          <span class="lb">
            {$_('app.ads.new.endDate')}
            <span class="opt">— {$_('app.ads.new.endDateOpt')}</span>
          </span>
          <input name="endDate" type="date" min={today} bind:value={endDate} />
        </label>
        <p class="inline-hint wide">
          {endDate
            ? $_('app.ads.new.budgetUntil', { values: { amount: budgetAmount, date: endDate } })
            : $_('app.ads.new.budgetForever', { values: { amount: budgetAmount } })}
        </p>

        <div class="sec wide">{$_('app.ads.new.secCreative')}</div>
        <label class="fld wide">
          <span class="lb">
            {isGoogle ? $_('app.ads.google.headline') : $_('app.ads.headline')}
            <span class="opt">{headline.length}/{headlineMax}</span>
          </span>
          <input name="headline" required maxlength={headlineMax} bind:value={headline} />
        </label>
        <div class="fld wide">
          <span class="lb">
            {$_('app.ads.google.moreHeadlines')}
            <span class="opt">{additionalHeadlines.length}</span>
          </span>
          <div class="repeat">
            {#each additionalHeadlines as _row, i (i)}
              <div class="rrow">
                <input
                  name="additionalHeadlines"
                  maxlength={headlineMax}
                  bind:value={additionalHeadlines[i]}
                  placeholder={$_('app.ads.new.variantPlaceholder', { values: { n: i + 2 } })}
                />
                <span class="count">{(additionalHeadlines[i] ?? '').length}/{headlineMax}</span>
                <button
                  type="button"
                  class="rdel"
                  aria-label={$_('app.ads.new.removeVariant')}
                  onclick={() => (additionalHeadlines = removeFrom(additionalHeadlines, i))}
                >×</button>
              </div>
            {/each}
            <button type="button" class="radd" onclick={() => (additionalHeadlines = addTo(additionalHeadlines))}>
              + {$_('app.ads.new.addHeadline')}
            </button>
          </div>
        </div>
        <label class="fld wide">
          <span class="lb">{isGoogle ? $_('app.ads.google.description') : $_('app.ads.body')}</span>
          <textarea name="body" rows="2" bind:value={body}></textarea>
        </label>
        <div class="fld wide">
          <span class="lb">
            {$_('app.ads.google.moreDescriptions')}
            <span class="opt">{additionalDescriptions.length}</span>
          </span>
          <div class="repeat">
            {#each additionalDescriptions as _row, i (i)}
              <div class="rrow">
                <input
                  name="additionalDescriptions"
                  maxlength={bodyMax}
                  bind:value={additionalDescriptions[i]}
                  placeholder={$_('app.ads.new.variantPlaceholder', { values: { n: i + 2 } })}
                />
                <span class="count">{(additionalDescriptions[i] ?? '').length}/{bodyMax}</span>
                <button
                  type="button"
                  class="rdel"
                  aria-label={$_('app.ads.new.removeVariant')}
                  onclick={() => (additionalDescriptions = removeFrom(additionalDescriptions, i))}
                >×</button>
              </div>
            {/each}
            <button type="button" class="radd" onclick={() => (additionalDescriptions = addTo(additionalDescriptions))}>
              + {$_('app.ads.new.addDescription')}
            </button>
          </div>
        </div>
        <label class="fld wide">
          <span class="lb">{$_('app.ads.landingUrl')}</span>
          <input name="landingPageUrl" type="text" inputmode="url" bind:value={landingPageUrl} placeholder="anomalia.so" />
        </label>

        {#if isGoogle && campaignType === 'DISPLAY'}
          <label class="fld wide">
            <span class="lb">{$_('app.ads.google.businessName')}</span>
            <input name="businessName" maxlength="25" bind:value={businessName} />
          </label>
          <label class="fld">
            <span class="lb">{$_('app.ads.google.landscape')}</span>
            <input name="imageUrl" type="text" inputmode="url" required bind:value={imageUrl} placeholder="1200×628" />
          </label>
          <label class="fld">
            <span class="lb">{$_('app.ads.google.square')}</span>
            <input name="squareImageUrl" type="text" inputmode="url" required bind:value={squareImageUrl} placeholder="1080×1080" />
          </label>
          <p class="inline-hint wide">{$_('app.ads.google.displayHint')}</p>
        {:else if !isGoogle}
          <label class="fld">
            <span class="lb">{$_('app.ads.imageUrl')}</span>
            <input name="imageUrl" type="text" inputmode="url" bind:value={imageUrl} placeholder="https://…" />
          </label>
          <!-- Pinned to Stories/Reels; the feed image serves everywhere else. Disabled alongside
               extra creatives because Meta cannot do both on one ad. -->
          <label class="fld">
            <span class="lb">
              {$_('app.ads.new.storyImage')}
              <span class="opt">— 9:16</span>
            </span>
            <input
              name="storyImageUrl"
              type="text"
              inputmode="url"
              bind:value={storyImageUrl}
              disabled={variants.length > 0}
              placeholder={variants.length ? $_('app.ads.new.storyImageBlocked') : 'https://…'}
            />
          </label>
        {/if}

        <!-- Meta only: each extra creative becomes its own ad inside the SAME ad set, so they
             share budget and targeting and compete in the same auction. Google needs none of this
             — it recombines the headlines/descriptions above inside one responsive ad. -->
        {#if !isGoogle}
          <div class="sec wide">
            {$_('app.ads.new.secVariants')}
            <span class="opt">— {$_('app.ads.new.variantsHint')}</span>
          </div>
          <div class="fld wide">
            {#each variants as _v, i (i)}
              <div class="variant">
                <div class="vhead">
                  <span class="vnum">{i + 2}</span>
                  <button
                    type="button"
                    class="rdel"
                    aria-label={$_('app.ads.new.removeVariant')}
                    onclick={() => (variants = variants.filter((_, idx) => idx !== i))}
                  >×</button>
                </div>
                <input
                  name="variantHeadline"
                  maxlength={headlineMax}
                  bind:value={variants[i].headline}
                  placeholder={$_('app.ads.headline')}
                />
                <textarea
                  name="variantBody"
                  rows="2"
                  bind:value={variants[i].body}
                  placeholder={$_('app.ads.body')}
                ></textarea>
                <input
                  name="variantImageUrl"
                  type="text"
                  inputmode="url"
                  bind:value={variants[i].imageUrl}
                  placeholder={$_('app.ads.imageUrl')}
                />
              </div>
            {/each}
            <button
              type="button"
              class="radd"
              onclick={() => (variants = [...variants, { headline: '', body: '', imageUrl: '' }])}
            >+ {$_('app.ads.new.addVariant')}</button>
          </div>
        {/if}

        <div class="sec wide">{$_('app.ads.new.secTargeting')}</div>
        {#if isGoogle && campaignType === 'SEARCH'}
          <label class="fld wide">
            <span class="lb">{$_('app.ads.google.keywords')} <span class="opt">— {$_('app.ads.google.keywordsHint')}</span></span>
            <textarea name="keywords" rows="5" bind:value={keywords}></textarea>
          </label>
        {/if}
        <!-- div, not label: a wrapping label re-dispatches inner clicks onto the search box. -->
        <div class="fld wide">
          <span class="lb">{$_('app.ads.new.countries')}</span>
          <CountryPicker
            name="countries"
            bind:value={countries}
            placeholder={$_('app.settings.ads.countriesPh')}
          />
        </div>
        <div class="fld ages">
          <span class="lb">{$_('app.ads.new.ageRange')}</span>
          <div class="age-row">
            <input name="ageMin" type="number" min="13" max="65" bind:value={ageMin} aria-label={$_('app.ads.new.ageMin')} />
            <span class="sep">—</span>
            <input name="ageMax" type="number" min="18" max="65" bind:value={ageMax} aria-label={$_('app.ads.new.ageMax')} />
          </div>
        </div>

        <div class="form-foot">
          <p class="note">
            {$_('app.ads.createHint')}
            <b>{$_('app.ads.launchCost', { values: { credits: launchCredits } })}</b>
            {#if !data.readiness.adAccounts.length}
              <br />{$_('app.ads.new.noAccountYet')}
            {/if}
          </p>
          <div class="acts">
            <a class="mini edit" href={backHref}>{$_('app.ads.cancelCreate')}</a>
            <button class="mini connect" type="submit">{$_('app.ads.saveProposal')}</button>
          </div>
        </div>
      </form>
    {/if}
  </section>
</div>

<style>
  .narrow { max-width: 820px; }
  .topback {
    display: inline-flex; align-items: center; height: 34px; padding: 0 14px;
    border-radius: 980px; border: 1px solid var(--line-2); background: var(--paper);
    color: var(--ink-soft); font-size: 13px; font-weight: 600; text-decoration: none;
  }
  .topback:hover { background: var(--paper-2); color: var(--ink); }

  .banner {
    padding: 12px 16px; border-radius: 14px; font-size: 13.5px; margin-bottom: 14px;
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  }
  .banner.err { background: #fdecea; color: #c0392b; }
  .banner.warn { background: color-mix(in oklab, #f39c12 14%, transparent); }
  .banner a { color: inherit; font-weight: 600; text-decoration: underline; }

  .step { margin-bottom: 16px; }
  .step .num {
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; margin-right: 9px; border-radius: 50%;
    background: var(--ink); color: var(--paper); font-size: 12px; font-weight: 700;
  }
  .step.idle .num { background: var(--line-2); color: var(--ink-faint); }
  .panel-head .t { display: flex; align-items: center; }
  .pill {
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    padding: 4px 10px; border-radius: 980px;
    background: rgba(var(--accent-rgb), 0.12); color: var(--accent);
  }

  .waiting {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    padding: 38px 22px; color: var(--ink-faint); text-align: center;
  }
  .waiting p { margin: 0; font-size: 13.5px; max-width: 42ch; line-height: 1.5; }

  .rationale {
    margin: 18px 22px 0; padding: 12px 16px;
    border-radius: 14px; border: 1px solid color-mix(in srgb, var(--accent) 26%, var(--line));
    background: color-mix(in srgb, var(--accent) 7%, var(--paper));
    font-size: 13.5px; line-height: 1.5; color: var(--ink);
  }

  /* Section divider inside the form — groups the fields without nesting more panels. */
  .sec {
    font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--ink-faint); padding-top: 8px; margin-top: 2px; border-top: 1px solid var(--line);
    padding-bottom: 2px;
  }
  .form-grid > .sec:first-child { border-top: none; padding-top: 0; margin-top: 0; }
  .inline-hint { font-size: 12px; color: var(--ink-faint); margin: 0; line-height: 1.45; }
  .wide { grid-column: 1 / -1; }

  .age-row { display: flex; align-items: center; gap: 8px; }
  .age-row input { text-align: center; }
  .age-row .sep { color: var(--ink-faint); }

  /* Repeatable variant rows — every row is one control tall, like the rest of the form. */
  .variant {
    display: flex; flex-direction: column; gap: 8px;
    padding: 12px; margin-bottom: 8px;
    border: 1px solid var(--line-2); border-radius: 12px; background: var(--paper-2);
  }
  .variant .vhead { display: flex; align-items: center; justify-content: space-between; }
  .variant .vnum {
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; border-radius: 50%;
    background: var(--paper); border: 1px solid var(--line-2);
    font-size: 12px; font-weight: 700;
  }
  .repeat { display: flex; flex-direction: column; gap: 8px; }
  .rrow { display: flex; align-items: center; gap: 8px; }
  .rrow input { flex: 1; min-width: 0; }
  .rrow .count { font-size: 11.5px; color: var(--ink-faint); flex: 0 0 auto; min-width: 46px; text-align: right; }
  .rdel {
    width: 30px; height: 30px; flex: 0 0 auto; border-radius: 50%;
    border: 1px solid var(--line-2); background: var(--paper); color: var(--ink-faint);
    font-size: 16px; line-height: 1; cursor: pointer;
  }
  .rdel:hover { border-color: #c0392b; color: #c0392b; }
  .radd {
    align-self: flex-start; height: 34px; padding: 0 14px; border-radius: 980px;
    border: 1px dashed var(--line-2); background: transparent; color: var(--ink-soft);
    font-size: 12.5px; font-weight: 600; cursor: pointer;
  }
  .radd:hover { border-color: var(--accent); color: var(--accent); }

  .gen { display: inline-flex; align-items: center; gap: 7px; }
  .form-foot .acts a { text-decoration: none; }
  .form-foot .note b { color: var(--ink); font-weight: 600; }
</style>
