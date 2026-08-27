<script lang="ts">
  // L'UNICA pagina d'errore del progetto — e una basta.
  //
  // Perché una sola: per una URL che non matcha nessuna rotta, SvelteKit monta SOLO il layout
  // radice e questo file (`respond_with_error` costruisce un branch di due nodi: 0 = root layout,
  // 1 = root error). Un `src/routes/app/+error.svelte` non verrebbe quindi mai usato per un 404.
  // Gli errori lanciati dentro /app arrivano comunque qui: il 404 "Brand not found" nasce in
  // `app/[brand]/+layout.server.ts`, cioè proprio nel layout che disegna topbar e sidebar —
  // renderlo dentro una shell che non ha caricato niente sarebbe peggio di una pagina intera.
  //
  // La destinazione dipende dalla SESSIONE, non dall'URL: `data.session` viene dal
  // `+layout.server.ts` radice, che `respond_with_error` esegue anche in stato d'errore. Se per
  // qualsiasi motivo non arriva, si va sulla home pubblica — mai un bottone che promette l'app
  // e sbatte sul login.
  import { page } from '$app/stores';
  import { _, locale } from 'svelte-i18n';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import { localePath, type Locale } from '$lib/i18n/locale';

  const status = $derived($page.status);
  const loggedIn = $derived(Boolean($page.data?.session));
  const href = $derived(loggedIn ? '/app' : localePath('/', ($locale as Locale) ?? 'en'));

  // 404 → non c'è; 401/403 → non è tua; tutto il resto → si è rotto da noi.
  // `$page.error.message` non si mostra MAI: è testo interno.
  const kind = $derived(
    status === 404 ? 'notFound' : status === 401 || status === 403 ? 'denied' : 'generic'
  );
  const face = $derived(kind === 'notFound' ? 'curious' : kind === 'denied' ? 'squint' : 'sad');
</script>

<svelte:head>
  <title>{$_(`error.${kind}.title`)} · Anomalia</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="err-page">
  <!-- Classi prefissate `err-`: app.css ha già `.card`, `.body` & co. come classi globali,
       e Svelte scopa le PROPRIE regole ma non impedisce a quelle globali di applicarsi. -->
  <div class="err-card">
    <div class="err-face" aria-hidden="true">
      <!-- L'elemento di casa: lo sguardo segue il puntatore. `follow` si spegne da solo con
           prefers-reduced-motion (vedi AgentAvatar), quindi qui non serve un secondo guard. -->
      <AgentAvatar {face} color="theme" size={72} follow="pointer" />
    </div>
    <p class="err-code">{status}</p>
    <h1>{$_(`error.${kind}.title`)}</h1>
    <p class="err-body">{$_(`error.${kind}.body`)}</p>
    <div class="err-acts">
      <a class="btn btn-primary" {href}>{loggedIn ? $_('error.toApp') : $_('error.toHome')}</a>
      {#if status >= 500}
        <button class="btn btn-ghost" onclick={() => location.reload()}>{$_('error.retry')}</button>
      {/if}
    </div>
  </div>
</main>

<style>
  .err-page {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 40px 20px;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--sans);
  }
  .err-card {
    width: 100%;
    max-width: 460px;
    text-align: center;
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 24px;
    padding: 44px 32px 40px;
  }
  .err-face {
    display: flex;
    justify-content: center;
    margin-bottom: 24px;
  }
  .err-code {
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.16em;
    color: var(--ink-faint);
    margin-bottom: 10px;
  }
  h1 {
    font-family: var(--serif);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    font-size: clamp(1.9rem, 4.4vw, 2.5rem);
    line-height: 1.1;
    text-wrap: balance;
  }
  .err-body {
    margin: 14px auto 0;
    max-width: 32ch;
    font-size: 0.97rem;
    line-height: 1.55;
    color: var(--ink-soft);
    text-wrap: pretty;
  }
  .err-acts {
    margin-top: 28px;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: center;
  }
  .err-acts :global(.btn) {
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
  }
  @media (max-width: 420px) {
    .err-card {
      padding: 36px 22px 32px;
      border-radius: 20px;
    }
  }
</style>
