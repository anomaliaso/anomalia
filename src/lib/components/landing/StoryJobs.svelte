<script lang="ts">
  import { _ } from 'svelte-i18n';

  /**
   * I tre mestieri che si pagano a un'agenzia, ognuno con la faccia del proprio risultato: i post,
   * un articolo sul proprio dominio, una creativita' pubblicitaria. Tre colonne uguali perche' i
   * tre mestieri valgono uguale — chi arriva qui sta contando cosa smette di comprare, e una
   * colonna piu' grande delle altre gli direbbe che le altre due sono un contorno.
   */
  const TK = 'landing.jobs';

  const SOCIAL_SHOTS = [
    '/showcase-gen/mellon-1.webp',
    '/showcase-gen/andrea-1.webp',
    '/showcase-gen/flashcamp-2.webp'
  ];
</script>

<section class="jb">
  <div class="wrap">
    <div class="sec-head reveal">
      <div class="kicker">{$_(`${TK}.kicker`)}</div>
      <h2>{$_(`${TK}.titleLead`)} <span class="gr-accent">{$_(`${TK}.titleAccent`)}</span></h2>
    </div>

    <div class="jb-grid">
      <article class="jb-card reveal" data-d="1">
        <div class="jb-art jb-social">
          {#each SOCIAL_SHOTS as src, i}
            <img {src} alt="" loading="lazy" decoding="async" style="--i:{i}" />
          {/each}
        </div>
        <h3>{$_(`${TK}.social.title`)}</h3>
        <p>{$_(`${TK}.social.body`)}</p>
      </article>

      <article class="jb-card reveal" data-d="2">
        <div class="jb-art jb-web">
          <div class="jb-page">
            <span class="jb-t"></span>
            <span class="jb-l w90"></span>
            <span class="jb-l w75"></span>
            <span class="jb-img"></span>
            <span class="jb-l w85"></span>
            <span class="jb-l w60"></span>
          </div>
        </div>
        <h3>{$_(`${TK}.web.title`)}</h3>
        <p>{$_(`${TK}.web.body`)}</p>
      </article>

      <article class="jb-card reveal" data-d="3">
        <div class="jb-art jb-ads">
          <img src="/ads/a-claim-en-4x5.png" alt="" loading="lazy" decoding="async" />
          <img src="/ads/b-log-en-4x5.png" alt="" loading="lazy" decoding="async" />
        </div>
        <h3>{$_(`${TK}.ads.title`)}</h3>
        <p>{$_(`${TK}.ads.body`)}</p>
      </article>
    </div>
  </div>
</section>

<style>
  .jb { padding: clamp(80px, 10vw, 150px) 0 0; }

  .jb-grid {
    display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: clamp(20px, 2.6vw, 36px);
    max-width: 1160px; margin: 0 auto;
  }

  .jb-card {
    border: 1px solid var(--line); border-radius: 26px;
    background: var(--paper); overflow: hidden;
    padding-bottom: 26px;
    transition: transform 380ms var(--ease, ease), box-shadow 380ms var(--ease, ease);
  }
  .jb-card:hover { transform: translateY(-4px); box-shadow: 0 34px 70px -50px rgba(0, 0, 0, 0.42); }
  .jb-card h3 {
    margin: 24px 26px 8px;
    font-size: 1.2rem; font-weight: 650; letter-spacing: -0.015em;
  }
  .jb-card p { margin: 0 26px; color: var(--ink-soft); font-size: 0.96rem; line-height: 1.55; }

  .jb-art {
    height: 210px; overflow: hidden;
    background:
      radial-gradient(110% 80% at 50% 0%, rgba(var(--accent-rgb), 0.10), transparent 70%),
      var(--paper-2);
    border-bottom: 1px solid var(--line);
    position: relative;
  }

  /* I tre post a ventaglio: la rotazione viene dall'indice, cosi' la stessa card rende sempre
     la stessa immagine e non c'e' niente che balli a ogni render. */
  .jb-social { display: flex; align-items: center; justify-content: center; gap: -10px; }
  .jb-social img {
    width: 94px; aspect-ratio: 4 / 5; object-fit: cover;
    border-radius: 12px; border: 3px solid var(--paper);
    box-shadow: 0 14px 30px -18px rgba(0, 0, 0, 0.5);
    transform: rotate(calc((var(--i) - 1) * 7deg)) translateY(calc(var(--i) * -2px));
    margin-inline: -12px;
    transition: transform 420ms var(--ease, ease);
  }
  .jb-card:hover .jb-social img {
    transform: rotate(calc((var(--i) - 1) * 10deg)) translateY(calc(var(--i) * -5px));
  }

  .jb-web { display: grid; place-items: end center; }
  .jb-page {
    width: 200px; background: var(--paper);
    border: 1px solid var(--line); border-bottom: 0;
    border-radius: 12px 12px 0 0; padding: 18px 18px 0;
    display: flex; flex-direction: column; gap: 8px;
    box-shadow: 0 20px 40px -30px rgba(0, 0, 0, 0.5);
  }
  .jb-t { height: 13px; width: 70%; border-radius: 4px; background: var(--ink); opacity: 0.85; }
  .jb-l { height: 6px; border-radius: 999px; background: var(--line-2); }
  .jb-img { height: 54px; border-radius: 8px; background: rgba(var(--accent-rgb), 0.22); margin: 4px 0; }
  .w90 { width: 90%; } .w85 { width: 85%; } .w75 { width: 75%; } .w60 { width: 60%; }

  .jb-ads { display: flex; align-items: center; justify-content: center; gap: 12px; }
  .jb-ads img {
    width: 100px; aspect-ratio: 4 / 5; object-fit: cover;
    border-radius: 12px; box-shadow: 0 16px 34px -22px rgba(0, 0, 0, 0.55);
    transition: transform 420ms var(--ease, ease);
  }
  .jb-ads img:first-child { transform: rotate(-4deg); }
  .jb-ads img:last-child { transform: rotate(4deg); }
  .jb-card:hover .jb-ads img:first-child { transform: rotate(-7deg) translateY(-4px); }
  .jb-card:hover .jb-ads img:last-child { transform: rotate(7deg) translateY(-4px); }

  @media (max-width: 940px) {
    .jb-grid { grid-template-columns: 1fr; max-width: 460px; }
  }
</style>
