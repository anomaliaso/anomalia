<script lang="ts" module>
  export const INTRO_SCREENS = [
    { art: 'team', titleKey: 'onboarding.intro.team.title', bodyKey: 'onboarding.intro.team.body' },
    {
      art: 'work',
      titleKey: 'onboarding.intro.work.title',
      bodyKey: 'onboarding.intro.work.body',
      svg: `<svg viewBox="0 0 200 120" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="18" y="18" width="76" height="84" rx="8" stroke="var(--accent, #7c5cff)" stroke-width="2.5"/><rect x="30" y="32" width="52" height="34" rx="4" fill="var(--accent, #7c5cff)" opacity=".18"/><rect x="30" y="74" width="52" height="4" rx="2" fill="currentColor" opacity=".3"/><rect x="30" y="84" width="34" height="4" rx="2" fill="currentColor" opacity=".3"/><path d="M104 60h22" stroke="currentColor" stroke-width="2" opacity=".35" stroke-dasharray="4 4"/><path d="M120 54l8 6-8 6" stroke="currentColor" stroke-width="2" opacity=".5" stroke-linecap="round" stroke-linejoin="round"/><rect x="136" y="18" width="46" height="84" rx="10" stroke="var(--accent-2, #ff8a5c)" stroke-width="2.5"/><rect x="146" y="30" width="26" height="30" rx="4" fill="var(--accent-2, #ff8a5c)" opacity=".25"/><rect x="146" y="68" width="26" height="3.5" rx="1.75" fill="currentColor" opacity=".3"/><rect x="146" y="76" width="18" height="3.5" rx="1.75" fill="currentColor" opacity=".3"/><circle cx="159" cy="92" r="5" fill="var(--accent-2, #ff8a5c)" opacity=".55"/></svg>`    },
    { art: 'apps', titleKey: 'onboarding.intro.apps.title', bodyKey: 'onboarding.intro.apps.body' },
    { art: 'routines', titleKey: 'onboarding.intro.routines.title', bodyKey: 'onboarding.intro.routines.body' }
  ];
</script>

<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { PLATFORM_KEYS } from '$lib/components/platform-meta';
  import {
    siGoogledrive,
    siNotion,
    siGithub,
    siGmail,
    siGooglecalendar,
    siHubspot,
    siLinear
  } from 'simple-icons';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import AgentStack3D from '$lib/components/AgentStack3D.svelte';
  import type { ThreadAgentAvatar } from '$lib/stores/chat';
  import { agentMetaForBrand } from '$lib/agent-icons';
  import { BUILTIN_AGENT_AVATARS, DEFAULT_CHAT_AGENT_AVATAR } from '$lib/agent-avatars';
  import { pmeta, plabel, picon } from './platform-utils';

  let {
    introStep = $bindable(0),
    onenterpick
  }: {
    introStep?: number;
    onenterpick: () => void;
  } = $props();

  // Posizioni in percentuale della SCENA (più grande del disegno di una cornice): due colonne che
  // fiancheggiano il mockup, mai sopra. `d`/`dl` sfasano il galleggio — all'unisono sembra un bug.
  const SOCIAL_SPOTS = [
    { x: 0.5, y: 0, d: 7.5, dl: 0 },
    { x: 91, y: 0, d: 9.5, dl: -1.2 },
    { x: 0.5, y: 21.5, d: 8.5, dl: -3.4 },
    { x: 91, y: 21.5, d: 10.5, dl: -2.1 },
    { x: 0.5, y: 43, d: 9, dl: -5.6 },
    { x: 91, y: 43, d: 8, dl: -0.7 },
    { x: 0.5, y: 64.5, d: 11, dl: -4.3 },
    { x: 91, y: 64.5, d: 8.8, dl: -6.9 },
    { x: 91, y: 86, d: 10, dl: -2.8 }
  ];
  const socialTiles = $derived(
    PLATFORM_KEYS.map((k, i) => ({
      key: k,
      label: plabel(k),
      icon: picon(k),
      bg: pmeta(k)?.bg ?? '#999',
      short: pmeta(k)?.short ?? '?',
      spot: SOCIAL_SPOTS[i % SOCIAL_SPOTS.length]
    }))
  );

  // Lista corta di proposito: il catalogo vero è dinamico (Composio). Qui solo integrazioni che
  // esistono davvero — niente che il primo clic possa smentire.
  const APP_TILES = [
    { key: 'drive', icon: siGoogledrive },
    { key: 'notion', icon: siNotion },
    { key: 'github', icon: siGithub },
    { key: 'gmail', icon: siGmail },
    { key: 'calendar', icon: siGooglecalendar },
    { key: 'hubspot', icon: siHubspot },
    { key: 'linear', icon: siLinear }
  ];
  const appTiles = APP_TILES.map((a) => ({
    key: a.key,
    label: a.icon.title,
    path: a.icon.path,
    bg: `#${a.icon.hex}`
  }));

  // content/analyst/web sono i soli di `JOB_OWNERS` con routine ricorrenti. Niente testo dentro
  // l'illustrazione: `w` e `beat` dicono "più lavori, ognuno col suo passo" senza nulla da tradurre.
  const routineRows = $derived(
    (['content', 'analyst', 'web'] as const).map((id, i) => {
      const av = BUILTIN_AGENT_AVATARS[id] ?? DEFAULT_CHAT_AGENT_AVATAR;
      return { id, face: av.face, color: av.color, w: [74, 58, 66][i], beat: i % 3 };
    })
  );

  // Stessa fonte del picker due schermate dopo: qui non si può promettere una squadra diversa.
  const teamFaces = $derived<ThreadAgentAvatar[]>(
    agentMetaForBrand(true).map((a) => {
      const av = BUILTIN_AGENT_AVATARS[a.id] ?? DEFAULT_CHAT_AGENT_AVATAR;
      return { id: a.id, name: $_(`chat.agents.${a.id}.label`), face: av.face, color: av.color };
    })
  );
  // 104 e non di più: la composizione è larga ~2.6× la faccia davanti, e 104×2.6 ≈ 270px sta nei
  // ~342 utili di uno schermo da 390. Un numero solo, nessun breakpoint.
  const teamFront = 104;

  function next() {
    if (introStep < INTRO_SCREENS.length - 1) introStep += 1;
    else onenterpick();
  }
  function back() {
    if (introStep > 0) introStep -= 1;
  }
</script>

{#key introStep}
  <div class="intro-stage">
    <h1 class="intro-title">{$_(INTRO_SCREENS[introStep].titleKey)}</h1>
    {#if INTRO_SCREENS[introStep].art === 'team'}
      <div class="intro-team">
        <AgentStack3D agents={teamFaces} front={teamFront} follow="pointer" />
      </div>
    {:else if INTRO_SCREENS[introStep].art === 'work'}
      <div class="mock-scene has-orbit">
        <div class="mock-orbit" aria-hidden="true">
          {#each socialTiles as t (t.key)}
            <span
              class="soc-tile"
              title={t.label}
              style="--x: {t.spot.x}%; --y: {t.spot.y}%; --d: {t.spot.d}s; --dl: {t.spot.dl}s; background: {t.bg}"
            >
              {#if t.icon}
                <svg viewBox="0 0 24 24" fill="#fff"><path d={t.icon.path} /></svg>
              {:else}
                <span class="soc-short">{t.short}</span>
              {/if}
            </span>
          {/each}
        </div>
        <div class="intro-art">{@html INTRO_SCREENS[introStep].svg}</div>
      </div>
    {:else if INTRO_SCREENS[introStep].art === 'apps'}
      <div class="app-grid" aria-hidden="true">
        {#each appTiles as a, i (a.key)}
          <span class="app-tile" style="--i: {i}; background: {a.bg}" title={a.label}>
            <svg viewBox="0 0 24 24" fill="#fff"><path d={a.path} /></svg>
          </span>
        {/each}
        <span class="app-tile more">{$_('onboarding.intro.apps.more')}</span>
      </div>
    {:else}
      <div class="rt-card" aria-hidden="true">
        {#each routineRows as r, i (r.id)}
          <div class="rt-row" style="--i: {i}">
            <AgentAvatar face={r.face} color={r.color} size={22} />
            <span class="rt-bar" style="--w: {r.w}%"></span>
            <span class="rt-cad">
              {#each [0, 1, 2] as d (d)}
                <span class="rt-dot" class:on={d === r.beat}></span>
              {/each}
            </span>
            <span class="rt-tick">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4"
                ><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round" /></svg
              >
            </span>
          </div>
        {/each}
        <div class="rt-gate">
          <span class="rt-thumb"></span>
          <span class="rt-lines"><span></span><span></span></span>
          <span class="rt-no">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"
              ><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" /></svg
            >
          </span>
          <span class="rt-yes">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"
              ><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round" /></svg
            >
          </span>
        </div>
      </div>
    {/if}
    <p class="intro-body">{$_(INTRO_SCREENS[introStep].bodyKey)}</p>
  </div>
{/key}
<div class="intro-foot">
  <div class="intro-dots" role="presentation">
    {#each INTRO_SCREENS as sc, i (sc.titleKey)}
      <span class="intro-dot" class:on={i === introStep}></span>
    {/each}
  </div>
  <button type="button" class="wide-btn" onclick={next}>{$_('onboarding.intro.next')}</button>
</div>
{#if introStep > 0}
  <button type="button" class="intro-back" onclick={back}>{$_('onboarding.back')}</button>
{/if}

<style>
  .intro-stage { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 20px; }
  .intro-title {
    font-size: clamp(28px, 5vw, 40px); line-height: 1.12; font-weight: 700;
    letter-spacing: -0.02em; text-align: center; margin: 0; max-width: 14ch;
  }
  .intro-art { width: min(340px, 80vw); color: var(--ink); }
  /* Il padding è la cornice in cui vivono le tessere: dentro, non sopra il mockup. */
  .mock-scene { position: relative; }
  .mock-scene.has-orbit { padding: 30px 46px; }
  .mock-orbit { position: absolute; inset: 0; pointer-events: none; }
  .soc-tile {
    position: absolute;
    left: var(--x);
    top: var(--y);
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    /* Anello nel colore della pagina + filo interno: senza, le tessere quasi nere (TikTok, X,
       Threads) perdono la loro forma sul fondo scuro. */
    box-shadow:
      inset 0 0 0 1px rgb(255 255 255 / 0.16),
      0 0 0 3px var(--paper, #fff),
      0 6px 18px rgb(0 0 0 / 0.12);
    animation: soc-float var(--d, 9s) ease-in-out var(--dl, 0s) infinite;
  }
  .soc-tile :global(svg) { width: 17px; height: 17px; display: block; }
  /* Una sola keyframes per tutte e nove: le fasi le danno --d e --dl, nessun timer JS. */
  @keyframes soc-float {
    0%, 100% { transform: translate(0, 0); }
    33% { transform: translate(3px, -7px); }
    66% { transform: translate(-3px, 4px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .soc-tile { animation: none; }
  }
  .app-grid {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 12px;
    max-width: 320px;
  }
  .app-tile {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    /* Stesso filo interno delle tessere social: Notion e GitHub sono neri quanto TikTok. */
    box-shadow:
      inset 0 0 0 1px rgb(255 255 255 / 0.16),
      0 0 0 3px var(--paper, #fff),
      0 6px 18px rgb(0 0 0 / 0.12);
    animation: app-in 0.5s var(--ease, ease) both;
    animation-delay: calc(var(--i, 0) * 60ms);
  }
  .app-tile :global(svg) { width: 24px; height: 24px; display: block; }
  .app-tile.more {
    background: color-mix(in srgb, var(--ink) 8%, transparent);
    color: var(--ink-soft);
    font-size: 13px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  @keyframes app-in {
    from { opacity: 0; transform: translateY(8px) scale(0.9); }
    to { opacity: 1; transform: none; }
  }

  .rt-card {
    width: min(360px, 88vw);
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--paper-2, var(--paper));
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .rt-row { display: flex; align-items: center; gap: 10px; }
  .rt-bar {
    height: 8px;
    width: var(--w, 60%);
    border-radius: 4px;
    background: color-mix(in srgb, var(--ink) 16%, transparent);
    flex: 0 1 auto;
  }
  .rt-cad { display: inline-flex; gap: 4px; margin-left: auto; }
  .rt-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--ink) 18%, transparent);
  }
  .rt-dot.on { background: var(--accent); }
  .rt-tick {
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    color: var(--accent);
    opacity: 0;
    animation: rt-report 6s ease-in-out infinite;
    animation-delay: calc(var(--i, 0) * 1.1s);
  }
  .rt-tick :global(svg) { width: 100%; height: 100%; display: block; }
  @keyframes rt-report {
    0%, 8% { opacity: 0; transform: scale(0.7); }
    18%, 62% { opacity: 1; transform: scale(1); }
    78%, 100% { opacity: 0; transform: scale(1); }
  }
  .rt-gate {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
  .rt-thumb {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    flex: 0 0 auto;
    background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 34%, transparent), color-mix(in srgb, var(--accent-2, var(--accent)) 26%, transparent));
  }
  .rt-lines { display: flex; flex-direction: column; gap: 5px; flex: 1 1 auto; }
  .rt-lines span { height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--ink) 14%, transparent); }
  .rt-lines span:last-child { width: 58%; }
  .rt-no, .rt-yes {
    width: 28px;
    height: 28px;
    border-radius: 9px;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .rt-no :global(svg), .rt-yes :global(svg) { width: 15px; height: 15px; display: block; }
  .rt-no { border: 1px solid var(--line); color: var(--ink-faint); }
  .rt-yes {
    background: var(--ink);
    color: var(--paper);
    animation: rt-yes 6s ease-in-out infinite;
  }
  @keyframes rt-yes {
    0%, 60% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ink) 26%, transparent); }
    76% { box-shadow: 0 0 0 7px color-mix(in srgb, var(--ink) 0%, transparent); }
    100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ink) 0%, transparent); }
  }
  @media (prefers-reduced-motion: reduce) {
    /* Ferme, non rallentate: la spunta è informazione e deve restare visibile. */
    .app-tile, .rt-yes { animation: none; }
    .rt-tick { animation: none; opacity: 1; }
  }

  /* Sotto i 560 non c'è spazio attorno al mockup: le nove tessere si raccolgono in una fascia. */
  @media (max-width: 560px) {
    .mock-scene.has-orbit { padding: 0; display: flex; flex-direction: column; align-items: center; gap: 14px; }
    .mock-orbit {
      position: static;
      order: 2;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
      max-width: 320px;
    }
    .soc-tile {
      position: static;
      width: 30px;
      height: 30px;
      box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.16), 0 0 0 2px var(--paper, #fff);
    }
    .soc-tile :global(svg) { width: 15px; height: 15px; }
  }
  /* Altezza fissa: le facce lontane sono assolute, senza un'altezza il testo sopra e sotto balla. */
  .intro-team {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 190px;
  }
  .intro-art :global(svg) { width: 100%; height: auto; display: block; }
  .intro-body {
    margin: 0; max-width: 46ch; text-align: center; font-size: 15px; line-height: 1.55;
    color: var(--ink-soft);
  }
  .intro-foot { width: 100%; max-width: 420px; margin-top: 36px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .intro-dots { display: flex; gap: 7px; justify-content: center; margin-top: 18px; }
  .intro-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .22; transition: opacity .2s, transform .2s; }
  .intro-dot.on { opacity: .85; transform: scale(1.25); }
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
  .intro-stage { animation: rise 0.45s var(--ease, ease) both; }
  @media (prefers-reduced-motion: reduce) { .intro-stage { animation: none; } }
  @keyframes rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
</style>
