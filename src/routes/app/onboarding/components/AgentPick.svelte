<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { goto } from '$app/navigation';
  import { track } from '$lib/analytics';
  import { agentMetaForBrand } from '$lib/agent-icons';
  import { BUILTIN_AGENT_AVATARS, DEFAULT_CHAT_AGENT_AVATAR } from '$lib/agent-avatars';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import { clearGuestOnboarding } from '$lib/guest-onboarding';

  let {
    slug = '',
    customs = [],
    setupThreadPath = '',
    onback
  }: {
    slug?: string;
    customs?: Array<{ id: string; name: string; face: string; color: string }>;
    setupThreadPath?: string;
    onback: () => void;
  } = $props();

  let pickIndex = $state(0);

  type PickOption = { key: string; name: string; desc: string; face: string; color: string };
  const pickOptions = $derived<PickOption[]>([
    ...agentMetaForBrand(true).map((a) => {
      const av = BUILTIN_AGENT_AVATARS[a.id] ?? DEFAULT_CHAT_AGENT_AVATAR;
      return {
        key: a.id,
        name: $_(`chat.agents.${a.id}.label`),
        desc: $_(`chat.agents.${a.id}.desc`),
        face: av.face,
        color: av.color
      };
    }),
    ...customs.map((a) => ({
      key: `custom:${a.id}`,
      name: a.name,
      desc: $_('onboarding.pick.customDesc'),
      face: a.face,
      color: a.color
    }))
  ]);
  const pickCurrent = $derived(pickOptions[Math.min(pickIndex, pickOptions.length - 1)] ?? null);

  function move(delta: number) {
    if (!pickOptions.length) return;
    pickIndex = (pickIndex + delta + pickOptions.length) % pickOptions.length;
  }

  /** Se il seed ha creato il thread di setup ci si atterra DENTRO (con l'Analyst), non si apre
   * una chat nuova: la scelta dell'agente resta come preferenza per le chat future. */
  function startChat() {
    if (!slug || !pickCurrent) return;
    track('onboarding_agent_picked', { agent: pickCurrent.key });
    clearGuestOnboarding();
    // La scelta vale anche dopo (ChatColumn → newChatAgent), ma solo per i cinque mestieri:
    // un agente custom è una persona del brand, non un default con cui aprire le chat nuove.
    if (!pickCurrent.key.startsWith('custom:')) {
      try {
        localStorage.setItem(`anomalia:first-agent:${slug}`, pickCurrent.key);
      } catch {
        /* quota / private mode: si perde la memoria, non la chat */
      }
    }
    if (setupThreadPath) {
      void goto(setupThreadPath);
      return;
    }
    void goto(`/app/${slug}/chat/new?agent=${encodeURIComponent(pickCurrent.key)}`);
  }
</script>

<h1 class="intro-title">{$_('onboarding.pick.title')}</h1>
<p class="ch-lead">{$_('onboarding.pick.sub')}</p>
{#if pickCurrent}
  <div class="pick-stage">
    <button
      type="button"
      class="pick-arrow"
      aria-label={$_('onboarding.pick.prev')}
      onclick={() => move(-1)}
      disabled={pickOptions.length < 2}>‹</button
    >
    {#key pickCurrent.key}
      <div class="pick-card">
        <AgentAvatar face={pickCurrent.face} color={pickCurrent.color} size={104} />
        <div class="pick-name">{pickCurrent.name}</div>
        <div class="pick-desc">{pickCurrent.desc}</div>
      </div>
    {/key}
    <button
      type="button"
      class="pick-arrow"
      aria-label={$_('onboarding.pick.next')}
      onclick={() => move(1)}
      disabled={pickOptions.length < 2}>›</button
    >
  </div>
  <div class="intro-dots" role="presentation">
    {#each pickOptions as o, i (o.key)}
      <button
        type="button"
        class="intro-dot as-dot"
        class:on={i === pickIndex}
        aria-label={o.name}
        onclick={() => (pickIndex = i)}
      ></button>
    {/each}
  </div>
{/if}
<div class="intro-foot">
  <button type="button" class="wide-btn" onclick={startChat} disabled={!pickCurrent}>
    {$_('onboarding.pick.start')}
  </button>
</div>
<button type="button" class="intro-back" onclick={onback}>{$_('onboarding.back')}</button>

<style>
  .intro-title {
    font-size: clamp(28px, 5vw, 40px); line-height: 1.12; font-weight: 700;
    letter-spacing: -0.02em; text-align: center; margin: 0; max-width: 14ch;
  }
  .ch-lead { color: var(--ink-soft, #6e6e73); font-size: 1.02rem; line-height: 1.5; margin: 12px 0 0; max-width: 52ch; }
  button { background: var(--ink, #1d1d1f); color: #fff; border: none; border-radius: 12px; padding: 0 20px; font-size: 15px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  button:disabled { opacity: 0.4; cursor: default; }

  .intro-foot { width: 100%; max-width: 420px; margin-top: 36px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .intro-dots { display: flex; gap: 7px; justify-content: center; margin-top: 18px; }
  .intro-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .22; transition: opacity .2s, transform .2s; }
  .intro-dot.on { opacity: .85; transform: scale(1.25); }
  .intro-dot.as-dot { border: 0; padding: 0; cursor: pointer; }
  .wide-btn {
    width: 100%; padding: 15px 20px; border-radius: 999px; border: 0; cursor: pointer;
    font-size: 16px; font-weight: 600;
    background: var(--ink); color: var(--paper);
  }
  .wide-btn:disabled { opacity: .5; cursor: default; }
  .intro-back {
    background: none; border: 0; cursor: pointer; font-size: 14px;
    color: var(--ink-soft); padding: 8px; text-decoration: underline;
  }
  .intro-back { margin-top: 14px; }
  .pick-stage { display: flex; align-items: center; gap: 8px; margin-top: 28px; }
  .pick-arrow {
    background: none; border: 0; cursor: pointer; font-size: 30px; line-height: 1;
    color: var(--ink-soft); padding: 8px 12px; border-radius: 999px;
  }
  .pick-arrow:disabled { opacity: .25; cursor: default; }
  .pick-card { display: flex; flex-direction: column; align-items: center; gap: 12px; min-width: min(300px, 70vw); }
  .pick-name { font-size: 22px; font-weight: 650; letter-spacing: -0.01em; }
  .pick-desc { font-size: 14px; line-height: 1.5; color: var(--ink-soft); text-align: center; max-width: 34ch; }
  .pick-stage { animation: rise 0.45s var(--ease, ease) both; }
  @media (prefers-reduced-motion: reduce) { .pick-stage { animation: none; } }
  @keyframes rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
</style>
