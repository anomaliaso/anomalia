<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { homeHeadline, type HeadlinePost } from '$lib/home-headline';
  import type { HomeOverview } from '$lib/server/hub-overview';

  /**
   * La testa della home: una domanda, il lavoro, quattro numeri.
   *
   * Prima qui c'erano cinque blocchi che dicevano tutti la stessa cosa in modi diversi — quanto
   * manca. Nessuno diceva cosa fosse uscito, e in un prodotto che produce immagini la home non ne
   * conteneva nemmeno una. L'ordine ora è: **cosa devi fare** (una cosa sola, con la sua foto),
   * **cosa è uscito** (la striscia), **come va** (i numeri). I controlli restano, in fondo, in una
   * pastiglia: sono una nota, non la prima cosa che si vede entrando.
   *
   * Quale sia la domanda lo decide `homeHeadline`, che è puro e sotto test: qui si disegna e basta.
   */
  let { overview, brandSlug }: { overview: HomeOverview; brandSlug: string } = $props();

  const TK = 'app.home.head';
  const base = $derived(`/app/${brandSlug}`);
  const head = $derived(homeHeadline(overview));

  /**
   * La striscia mescola le tre code — uscito, aspetta te, in programma — perché per chi guarda
   * sono la stessa cosa: il lavoro del brand. Lo stato lo dice la pastiglia sulla card, non una
   * sezione diversa per ciascuno.
   *
   * Senza `media_url` una card sarebbe un rettangolo grigio: quelle restano nei numeri e nella
   * coda, non qui.
   */
  type Tile = { id: string; url: string; state: 'live' | 'wait' | 'plan'; when: string | null };

  const STRIP_MAX = 10;

  const tiles = $derived.by<Tile[]>(() => {
    const out: Tile[] = [];
    for (const p of overview.queue.posts) {
      if (p.media_url) out.push({ id: p.id, url: p.media_url, state: 'wait', when: null });
    }
    for (const p of overview.queue.upcoming) {
      if (p.media_url) out.push({ id: p.id, url: p.media_url, state: 'plan', when: p.scheduled_for });
    }
    for (const p of overview.queue.published) {
      if (p.media_url) out.push({ id: p.id, url: p.media_url, state: 'live', when: p.published_at });
    }
    return out.slice(0, STRIP_MAX);
  });

  const blocking = $derived(overview.growth?.blocking?.length ?? 0);
  const views = $derived(overview.analysis?.views7d ?? 0);

  const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

  function dayOf(iso: string | null): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? null
      : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  const postHref = (p: HeadlinePost | null) => (p ? `${base}/posts/${p.id}` : `${base}/content`);
</script>

<section class="hh">
  <!-- 1 — la domanda -->
  <div class="hh-ask">
    <h2>
      {#if head.kind === 'approve'}
        {head.waiting === 1 ? $_(`${TK}.approveOne`) : $_(`${TK}.approveMany`, { values: { n: head.waiting } })}
      {:else if head.kind === 'published'}
        {$_(`${TK}.publishedTitle`)}
      {:else}
        {$_(`${TK}.emptyTitle`)}
      {/if}
    </h2>

    {#if head.post}
      <div class="hh-card" class:nomedia={!head.post.media_url}>
        {#if head.post.media_url}
          <img src={head.post.media_url} alt="" loading="lazy" decoding="async" />
        {/if}
        <div class="hh-card-body">
          {#if head.post.caption}<p class="hh-cap">{head.post.caption}</p>{/if}
          <div class="hh-acts">
            {#if head.kind === 'approve'}
              <a class="hh-btn" href={postHref(head.post)}>{$_(`${TK}.openPost`)}</a>
              {#if head.waiting > 1}
                <a class="hh-btn ghost" href={`${base}/content`}>{$_(`${TK}.openQueue`)}</a>
              {/if}
            {:else}
              <a class="hh-btn ghost" href={postHref(head.post)}>{$_(`${TK}.openPost2`)}</a>
              <a class="hh-btn ghost" href={`${base}/analytics`}>{$_(`${TK}.openResults`)}</a>
            {/if}
          </div>
        </div>
      </div>
    {:else}
      <p class="hh-empty">
        {head.kind === 'approve' ? $_(`${TK}.approveBlog`) : $_(`${TK}.emptyBody`)}
        {#if head.kind === 'approve'}<a href={`${base}/site`}>{$_(`${TK}.openBlog`)}</a>{/if}
      </p>
    {/if}
  </div>

  <!-- 2 — il lavoro -->
  {#if tiles.length}
    <div class="hh-strip">
      {#each tiles as t (t.id)}
        <a class="hh-tile" href={`${base}/posts/${t.id}`}>
          <img src={t.url} alt="" loading="lazy" decoding="async" />
          <span class="hh-pill {t.state}">{$_(`${TK}.state.${t.state}`)}</span>
          {#if dayOf(t.when)}<span class="hh-when">{dayOf(t.when)}</span>{/if}
        </a>
      {/each}
    </div>
  {/if}

  <!-- 3 — come va -->
  <div class="hh-figs">
    <div><b>{overview.analysis?.published ?? 0}</b><span>{$_(`${TK}.figPublished`)}</span></div>
    <div><b>{head.waiting}</b><span>{$_(`${TK}.figWaiting`)}</span></div>
    <div><b>{overview.queue.scheduled}</b><span>{$_(`${TK}.figScheduled`)}</span></div>
    <div><b>{compact(views)}</b><span>{$_(`${TK}.figViews`)}</span></div>
  </div>

  {#if blocking > 0}
    <a class="hh-fix" href={`${base}/plan`}>
      <span class="hh-fix-n">{blocking}</span>
      <span>{$_(`${TK}.fixPill`)}</span>
      <span class="hh-fix-x">{$_(`${TK}.fixTail`)}</span>
    </a>
  {/if}
</section>

<style>
  .hh { display: flex; flex-direction: column; gap: 22px; margin-bottom: 44px; }

  .hh-ask { display: flex; flex-direction: column; gap: 14px; }
  .hh-ask h2 {
    margin: 0;
    font-size: clamp(1.2rem, 2.4vw, 1.6rem);
    font-weight: 500; letter-spacing: -0.02em; line-height: 1.25;
    color: var(--ink);
  }

  /* La foto è grande quanto serve a riconoscere il post, non quanto serve a riempire la riga:
     è un invito ad aprirlo, non il posto dove lo si guarda. Centrata, perché il testo è più corto
     di lei e allineare in alto lasciava mezza card vuota sotto i bottoni. */
  .hh-card {
    display: grid; grid-template-columns: 108px minmax(0, 1fr); gap: 16px;
    align-items: center;
    background: var(--paper); border: 1px solid var(--line); border-radius: 16px; padding: 14px;
  }
  /* Senza foto la colonna della foto non esiste: riservarla lasciava un rettangolo di vuoto
     larghissimo accanto a una riga di testo. */
  .hh-card.nomedia { grid-template-columns: minmax(0, 1fr); }
  .hh-card img { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; border-radius: 10px; display: block; }
  .hh-card-body { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .hh-cap {
    margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--ink-soft);
    display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4;
    -webkit-box-orient: vertical; overflow: hidden;
  }
  .hh-acts { display: flex; gap: 8px; flex-wrap: wrap; }
  .hh-btn {
    display: inline-flex; align-items: center;
    background: var(--ink); color: var(--paper);
    font-size: 12.5px; font-weight: 600; padding: 8px 16px; border-radius: 999px;
    text-decoration: none; transition: opacity 140ms ease;
  }
  .hh-btn:hover { opacity: 0.9; }
  .hh-btn.ghost { background: transparent; color: var(--ink); border: 1px solid var(--line-2); }
  .hh-btn.ghost:hover { background: var(--paper-2); opacity: 1; }

  .hh-empty { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--ink-soft); max-width: 56ch; }
  .hh-empty a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }

  /* Una striscia, non un muro. A quattro colonne piene ogni piastrella diventava alta trecento
     pixel e la prima schermata era soltanto lei; a larghezza fissa ne entrano sei o sette, le
     altre scorrono, e nessuna riga resta spaiata a fine corsa. */
  .hh-strip {
    display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x proximity;
    padding-bottom: 2px; scrollbar-width: thin;
  }
  .hh-tile {
    position: relative; display: block; flex: 0 0 148px; scroll-snap-align: start;
    border-radius: 12px; overflow: hidden;
    background: var(--paper-2); text-decoration: none;
  }
  .hh-tile img { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; display: block; }
  .hh-pill {
    position: absolute; top: 8px; left: 8px;
    padding: 3px 8px; border-radius: 999px;
    font-size: 10px; font-weight: 650; letter-spacing: 0.01em;
    backdrop-filter: blur(6px);
  }
  .hh-pill.wait { background: rgba(var(--accent-rgb), 0.9); color: #fff; }
  .hh-pill.plan { background: rgba(0, 0, 0, 0.55); color: #fff; }
  .hh-pill.live { background: rgba(16, 185, 129, 0.9); color: #04281c; }
  .hh-when {
    position: absolute; left: 0; right: 0; bottom: 0; padding: 16px 9px 7px;
    font-size: 10.5px; color: #fff;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.72));
  }

  .hh-figs {
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px;
    border-top: 1px solid var(--line); padding-top: 16px;
  }
  .hh-figs div { display: flex; flex-direction: column; gap: 1px; }
  .hh-figs b {
    font-size: 20px; font-weight: 650; letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums; color: var(--ink);
  }
  .hh-figs span { font-size: 11.5px; color: var(--ink-faint); }

  /* I controlli non spariscono: scendono al rango che hanno. Una riga, non otto con otto bottoni. */
  .hh-fix {
    display: inline-flex; align-items: center; gap: 9px; align-self: flex-start;
    padding: 7px 14px 7px 7px; border-radius: 999px;
    background: rgba(245, 158, 11, 0.1); color: var(--ink);
    font-size: 12.5px; text-decoration: none;
  }
  .hh-fix:hover { background: rgba(245, 158, 11, 0.16); }
  .hh-fix-n {
    display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%;
    background: #f59e0b; color: #3b2600; font-size: 11.5px; font-weight: 700;
  }
  .hh-fix-x { color: var(--ink-faint); }

  /* `@container`, non `@media`: la home vive dentro il contenitore `workbench` dichiarato dal
     layout del brand, e la sidebar si apre e si chiude. A finestra larga con la sidebar aperta
     lo spazio vero è duecentotrenta pixel in meno di quello che una media query vede. */
  @container workbench (max-width: 640px) {
    .hh-card { grid-template-columns: 92px minmax(0, 1fr); gap: 12px; }
    .hh-tile { flex-basis: 128px; }
    .hh-figs { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 14px; }
    .hh-fix-x { display: none; }
  }
</style>
