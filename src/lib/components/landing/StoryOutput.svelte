<script lang="ts">
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { PLATFORM_META } from '$lib/components/platform-meta';

  /**
   * La prima cosa dopo la hero e' l'artefatto, non una spiegazione: un post vero che attraversa i
   * suoi tre stati mentre si scorre. La colonna dei passi e' alta, la scheda resta incollata: il
   * lettore non cambia pagina, guarda lo stesso oggetto cambiare — che e' esattamente cio' che
   * succede dentro il prodotto.
   */
  const TK = 'landing.story.output';
  const STEPS = ['s1', 's2', 's3'] as const;

  /** Lo stato che la scheda mostra a ogni passo: il badge, il suo colore e cosa compare sotto. */
  const STATE = [
    { key: 'draft', tone: 'wait' },
    { key: 'approve', tone: 'wait' },
    { key: 'live', tone: 'live' }
  ] as const;

  let active = $state(0);
  let steps: HTMLElement[] = [];

  onMount(() => {
    if (!('IntersectionObserver' in window)) return;

    // La banda stretta al centro dello schermo decide il passo: quello che la attraversa e' quello
    // che si sta leggendo. Senza banda, due passi restano visibili insieme e il vincitore lo
    // sceglie l'ordine di callback, che non e' una regola.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = steps.indexOf(e.target as HTMLElement);
          if (i >= 0) active = i;
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );
    for (const s of steps) {
      if (s) io.observe(s);
    }
    return () => io.disconnect();
  });
</script>

<section class="so">
  <div class="wrap">
    <div class="sec-head reveal">
      <div class="kicker">{$_(`${TK}.kicker`)}</div>
      <h2>{$_(`${TK}.title`)}</h2>
      <p>{$_(`${TK}.sub`)}</p>
    </div>

    <div class="so-grid">
      <ol class="so-steps">
        {#each STEPS as s, i (s)}
          <li bind:this={steps[i]} class="so-step" class:is-on={active === i}>
            <span class="so-n">{i + 1}</span>
            <h3>{$_(`${TK}.${s}.title`)}</h3>
            <p>{$_(`${TK}.${s}.body`)}</p>
          </li>
        {/each}
      </ol>

      <div class="so-visual">
        <article class="so-card" class:is-live={active === 2}>
          <header class="so-card-head">
            <span class="so-plat" style="background:{PLATFORM_META.instagram.bg}">
              <svg viewBox="0 0 24 24" fill="#fff"><path d={PLATFORM_META.instagram.icon?.path} /></svg>
            </span>
            <b>@flashcamp</b>
            <span class="so-badge {STATE[active].tone}">{$_(`${TK}.state.${STATE[active].key}`)}</span>
          </header>

          <img src="/showcase-gen/flashcamp-1.webp" alt="" loading="lazy" decoding="async" />

          <p class="so-cap">{$_(`${TK}.caption`)}</p>

          <footer class="so-foot">
            {#if active === 0}
              <span class="so-meta">{$_(`${TK}.meta.written`)}</span>
            {:else if active === 1}
              <span class="so-act">{$_(`${TK}.meta.approve`)}</span>
              <span class="so-meta">{$_(`${TK}.meta.edit`)}</span>
            {:else}
              <span class="so-meta is-live">{$_(`${TK}.meta.live`)}</span>
            {/if}
          </footer>
        </article>
      </div>
    </div>
  </div>
</section>

<style>
  .so { padding: clamp(80px, 10vw, 150px) 0 clamp(30px, 4vw, 60px); }

  .so-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: clamp(40px, 7vw, 110px);
    align-items: start;
    max-width: 1080px;
    margin: 0 auto;
  }

  /* La colonna dei passi e' deliberatamente alta: e' lei a dare alla scheda incollata lo spazio
     in cui restare ferma mentre il resto scorre. */
  .so-steps { list-style: none; margin: 0; padding: 0; }
  .so-step {
    min-height: 54vh;
    display: flex; flex-direction: column; justify-content: center;
    opacity: 0.32;
    transition: opacity 420ms var(--ease, cubic-bezier(0.22, 1, 0.36, 1));
  }
  .so-step.is-on { opacity: 1; }
  .so-n {
    display: inline-grid; place-items: center;
    width: 30px; height: 30px; border-radius: 50%;
    background: rgba(var(--accent-rgb), 0.14); color: var(--accent);
    font-size: 13px; font-weight: 700; margin-bottom: 18px;
  }
  .so-step h3 {
    margin: 0 0 12px;
    font-size: clamp(1.5rem, 2.6vw, 2.1rem);
    font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); line-height: 1.12;
  }
  .so-step p { margin: 0; color: var(--ink-soft); font-size: 1.05rem; line-height: 1.55; max-width: 34ch; }

  .so-visual { position: sticky; top: 14vh; }

  .so-card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 26px;
    overflow: hidden;
    box-shadow: 0 40px 90px -60px rgba(0, 0, 0, 0.45);
    transition: box-shadow 500ms var(--ease, ease), border-color 500ms var(--ease, ease);
  }
  .so-card.is-live {
    border-color: rgba(var(--accent-rgb), 0.4);
    box-shadow: 0 40px 90px -50px rgba(var(--accent-rgb), 0.55);
  }

  .so-card-head { display: flex; align-items: center; gap: 9px; padding: 14px 16px; }
  .so-plat {
    width: 26px; height: 26px; border-radius: 8px; flex: none;
    display: inline-grid; place-items: center;
  }
  .so-plat svg { width: 15px; height: 15px; }
  .so-card-head b { font-size: 14px; }

  .so-badge {
    margin-left: auto;
    font-size: 11px; font-weight: 650; letter-spacing: 0.01em;
    padding: 4px 10px; border-radius: 999px;
  }
  .so-badge.wait { background: rgba(var(--accent-rgb), 0.13); color: var(--accent-ink); }
  .so-badge.live { background: rgba(16, 185, 129, 0.14); color: #0f9d6d; }

  /* L'immagine e' limitata in altezza, non solo in rapporto: una scheda incollata piu' alta
     dello schermo perde la testa e il piede proprio mentre cambiano — che e' l'unica cosa che
     questa sezione deve far vedere. */
  .so-card img {
    display: block; width: 100%;
    aspect-ratio: 4 / 5; max-height: 44vh; object-fit: cover;
  }

  .so-cap { margin: 0; padding: 16px 18px 6px; font-size: 14.5px; line-height: 1.5; color: var(--ink); }

  .so-foot {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 18px 18px;
    min-height: 56px;
  }
  .so-meta { font-size: 12.5px; color: var(--ink-faint); }
  .so-meta.is-live { color: #0f9d6d; font-weight: 600; }
  .so-act {
    font-size: 13px; font-weight: 600;
    background: var(--ink); color: var(--paper);
    padding: 8px 18px; border-radius: 999px;
  }

  @media (max-width: 900px) {
    .so-grid { grid-template-columns: 1fr; gap: 28px; }
    /* Su una colonna la scheda va in cima e i passi le scorrono sotto: incollarla piu' in basso
       la farebbe uscire dallo schermo proprio mentre cambia stato. */
    .so-visual { position: sticky; top: 72px; order: -1; max-width: 420px; margin: 0 auto; width: 100%; }
    .so-step { min-height: 0; padding: 26px 0; opacity: 1; }
    .so-card img { aspect-ratio: 16 / 10; }
  }
</style>
