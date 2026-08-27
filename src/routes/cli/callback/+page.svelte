<script lang="ts">
  let { data } = $props();
  const { accessToken, refreshToken, expiresAt, cliPort, cliState, userEmail } = data;

  type Status = 'idle' | 'sending' | 'done' | 'error';
  let status = $state<Status>('idle');
  let errorMsg = $state('');

  async function authorize() {
    status = 'sending';
    try {
      const res = await fetch(`http://localhost:${cliPort}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: expiresAt,
          state: cliState
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      status = 'done';
      setTimeout(() => { window.location.href = '/app'; }, 2500);
    } catch {
      status = 'error';
      errorMsg = 'Impossibile raggiungere la CLI. Assicurati che anomalia sia in esecuzione e riprova.';
    }
  }
</script>

<svelte:head><title>Autorizza CLI — Anomalia</title></svelte:head>

<div class="wrap">
  <div class="card">
    <div class="logo">Anomalia</div>

    {#if status === 'done'}
      <div class="done">
        <span class="check" aria-hidden="true">✓</span>
        <h2>Accesso completato</h2>
        <p>Torna al terminale. Questa pagina si chiuderà tra poco.</p>
      </div>
    {:else}
      <h2>Anomalia CLI vuole accedere al tuo account</h2>
      <p class="email">{userEmail}</p>
      <p class="desc">
        La CLI di Anomalia gestirà i tuoi brand e i contenuti dal terminale, usando le stesse autorizzazioni del tuo account.
      </p>

      {#if status === 'error'}
        <p class="err">{errorMsg}</p>
      {/if}

      <button class="btn-primary" onclick={authorize} disabled={status === 'sending'}>
        {status === 'sending' ? 'Autorizzazione…' : 'Autorizza'}
      </button>
      <a class="btn-cancel" href="/app">Annulla</a>
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
  .accent {
    color: var(--accent, #7c5cff);
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
  .btn-primary:disabled {
    opacity: 0.7;
    cursor: default;
  }
  .btn-cancel {
    display: block;
    font-size: 14px;
    color: var(--ink-soft, #6e6e73);
    text-decoration: none;
    padding: 8px;
  }
  .btn-cancel:hover {
    text-decoration: underline;
  }
  .err {
    font-size: 14px;
    color: #c0392b;
    margin-bottom: 16px;
  }
  .done {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .check {
    font-size: 40px;
    color: #00b37e;
  }
  .done h2 {
    margin: 0;
  }
  .done p {
    font-size: 14px;
    color: var(--ink-soft, #6e6e73);
    margin: 0;
  }
</style>
