<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import BrandMark from '$lib/components/BrandMark.svelte';

  let { data } = $props();

  let status = $state(data.status);
  let stage = $state(data.stage);
  let slug = $state(data.brandSlug);
  let timer: ReturnType<typeof setInterval> | undefined;

  // The ordered pipeline stages, for the little progress checklist.
  const STAGES = [
    { key: 'research', label: 'onboarding.generating.stageResearch' },
    { key: 'generate', label: 'onboarding.generating.stageGenerate' },
    { key: 'finalize', label: 'onboarding.generating.stageFinalize' }
  ];
  // Index of the stage currently running (or how far we got). 'done' → past the end.
  const stageIndex = $derived(stage === 'done' ? STAGES.length : Math.max(0, STAGES.findIndex((s) => s.key === stage)));

  const proofUrl = $derived.by(() => {
    const params = new URLSearchParams();
    if (data.plan) params.set('plan', data.plan);
    if (data.cycle) params.set('cycle', data.cycle);
    const q = params.toString();
    return `/app/${slug}/proposal${q ? `?${q}` : ''}`;
  });

  async function poll() {
    try {
      const res = await fetch(`/app/onboarding/status?job=${encodeURIComponent(data.jobId)}`);
      if (!res.ok) return;
      const d = (await res.json()) as { found: boolean; status?: string; stage?: string; slug?: string | null };
      if (!d.found) return;
      if (d.status) status = d.status;
      if (d.stage) stage = d.stage;
      if (d.slug) slug = d.slug;
      if (status === 'ready' || status === 'failed') stop();
    } catch {
      /* transient — keep polling */
    }
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  onMount(() => {
    if (status !== 'ready' && status !== 'failed') {
      timer = setInterval(poll, 4000);
      poll();
    }
  });
  onDestroy(stop);
</script>

<svelte:head><title>{$_('onboarding.generating.title', { values: { brand: data.brandName } })}</title></svelte:head>

<div class="gen-wrap">
  <a class="gen-brand" href="/app"><BrandMark size={22} /><span>Anomalia</span></a>

  <div class="gen-card">
    {#if status === 'ready'}
      <div class="gen-tick">✓</div>
      <h1>{$_('onboarding.generating.readyTitle', { values: { brand: data.brandName } })}</h1>
      <p class="gen-lead">{$_('onboarding.generating.readyLead')}</p>
      <button class="gen-cta" onclick={() => goto(proofUrl)}>{$_('onboarding.generating.readyCta')}</button>
    {:else if status === 'failed'}
      <div class="gen-x">!</div>
      <h1>{$_('onboarding.generating.failedTitle')}</h1>
      <p class="gen-lead">{$_('onboarding.generating.failedLead')}</p>
      <a class="gen-cta" href="/app">{$_('onboarding.allBrands')}</a>
    {:else}
      <div class="gen-spinner"></div>
      <h1>{$_('onboarding.generating.title', { values: { brand: data.brandName } })}</h1>
      <p class="gen-lead">{$_('onboarding.generating.lead')}</p>

      <ol class="gen-steps">
        {#each STAGES as s, i (s.key)}
          <li class:done={i < stageIndex} class:active={i === stageIndex}>
            <span class="gen-dot">{#if i < stageIndex}✓{:else if i === stageIndex}<span class="gen-mini"></span>{/if}</span>
            <span class="gen-step-label">{$_(s.label)}</span>
          </li>
        {/each}
      </ol>

      {#if data.email}<p class="gen-note">{$_('onboarding.generating.emailNote', { values: { email: data.email } })}</p>{/if}
    {/if}
  </div>
</div>

<style>
  .gen-wrap {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 28px 20px 60px;
    background: #fff;
  }
  .gen-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    font-size: 18px;
    color: #1d1d1f;
    text-decoration: none;
    align-self: flex-start;
  }
  .gen-card {
    margin: auto;
    max-width: 460px;
    width: 100%;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 32px 8px;
  }
  .gen-card h1 {
    font-size: 26px;
    letter-spacing: -0.02em;
    margin: 4px 0 0;
  }
  .gen-lead {
    color: #6e6e73;
    line-height: 1.5;
    margin: 0;
    max-width: 380px;
  }
  .gen-spinner {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 3px solid #ece9ff;
    border-top-color: #7c5cff;
    animation: gen-spin 0.8s linear infinite;
  }
  .gen-tick,
  .gen-x {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    font-weight: 700;
    color: #fff;
  }
  .gen-tick {
    background: #1d1d1f;
  }
  .gen-x {
    background: #d9534f;
  }
  .gen-steps {
    list-style: none;
    padding: 0;
    margin: 10px 0 0;
    width: 100%;
    max-width: 320px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .gen-steps li {
    display: flex;
    align-items: center;
    gap: 12px;
    color: #b0b0b5;
    transition: color 0.2s;
  }
  .gen-steps li.active,
  .gen-steps li.done {
    color: #1d1d1f;
  }
  .gen-dot {
    width: 22px;
    height: 22px;
    flex: 0 0 22px;
    border-radius: 50%;
    border: 1.5px solid currentColor;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: inherit;
  }
  .gen-steps li.done .gen-dot {
    background: #1d1d1f;
    color: #fff;
    border-color: #1d1d1f;
  }
  .gen-mini {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 2px solid #7c5cff;
    border-top-color: transparent;
    animation: gen-spin 0.8s linear infinite;
  }
  .gen-note {
    color: #86868b;
    font-size: 13px;
    margin: 8px 0 0;
  }
  .gen-cta {
    display: inline-block;
    background: #1d1d1f;
    color: #fff;
    border: none;
    padding: 13px 26px;
    border-radius: 980px;
    font-weight: 600;
    font-size: 15px;
    cursor: pointer;
    text-decoration: none;
    margin-top: 6px;
  }
  @keyframes gen-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
