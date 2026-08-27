<script lang="ts">
  let { data } = $props();
</script>

<svelte:head><title>Autorizza accesso — Anomalia</title></svelte:head>

<div class="wrap">
  <div class="card">
    <div class="logo">Anomalia</div>

    {#if data.fatal}
      <h2>Richiesta non valida</h2>
      <p class="desc">{data.fatal}</p>
      <a class="btn-cancel" href="/app">Torna ad Anomalia</a>
    {:else}
      <h2>{data.clientName} vuole accedere al tuo account</h2>
      <p class="email">{data.userEmail}</p>
      <p class="desc">
        Potrà leggere e gestire i tuoi brand e i tuoi contenuti tramite MCP, con le stesse
        autorizzazioni del tuo account. Puoi disconnetterlo in qualsiasi momento dal client.
      </p>

      <!-- No use:enhance: the actions redirect to the client's loopback URL, which the browser
           has to follow as a real navigation. -->
      <form method="POST" action="{data.search}&/approve">
        <button class="btn-primary" type="submit">Autorizza</button>
      </form>
      <form method="POST" action="{data.search}&/deny">
        <button class="btn-cancel" type="submit">Annulla</button>
      </form>
    {/if}
  </div>
</div>

<style>
  .wrap {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface, #f5f5f7);
    padding: 24px;
  }
  .card {
    background: var(--paper, #fff);
    border-radius: 20px;
    padding: 40px 36px;
    max-width: 420px;
    width: 100%;
    box-shadow: 0 4px 32px rgba(0, 0, 0, 0.08);
    text-align: center;
  }
  .logo {
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 24px;
    color: var(--ink, #1d1d1f);
  }
  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0 0 8px;
    color: var(--ink, #1d1d1f);
  }
  .email {
    font-size: 14px;
    color: var(--ink-soft, #6e6e73);
    margin: 0 0 20px;
  }
  .desc {
    font-size: 14px;
    color: var(--ink-soft, #6e6e73);
    line-height: 1.55;
    margin: 0 0 28px;
  }
  .btn-primary {
    display: block;
    width: 100%;
    background: var(--accent, #7c5cff);
    color: #fff;
    border: none;
    border-radius: 14px;
    padding: 14px 22px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    margin-bottom: 10px;
  }
  .btn-cancel {
    display: block;
    width: 100%;
    background: none;
    border: none;
    font-size: 14px;
    color: var(--ink-soft, #6e6e73);
    text-decoration: none;
    padding: 8px;
    cursor: pointer;
  }
  .btn-cancel:hover {
    text-decoration: underline;
  }
</style>
