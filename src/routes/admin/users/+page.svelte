<script lang="ts">
  import { enhance } from '$app/forms';

  // Strumento interno: etichette in chiaro, niente i18n.
  let { data, form } = $props();

  type Pending = {
    id: string;
    email: string | null;
    full_name: string | null;
    utm: string | null;
    created_at: string;
    queuedAt: string | null;
  };
  type Approved = { id: string; email: string | null; full_name: string | null; approved_at: string };

  const pending = $derived(data.pending as Pending[]);
  const approved = $derived(data.approved as Approved[]);

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '—';
</script>

<svelte:head><title>Admin — Accessi</title></svelte:head>

<main>
  <h1>Accessi</h1>
  <p class="lead">
    Il prodotto è chiuso: si entra dopo la call. Approva qui, l'accesso si accende al reload
    dell'utente.
  </p>
  {#if form?.error}<p class="err">{form.error}</p>{/if}

  <h2>In attesa <span class="count">{pending.length}</span></h2>
  {#if !pending.length}
    <p class="empty">Nessuno in attesa.</p>
  {:else}
    <table>
      <thead>
        <tr><th>Email</th><th>Nome</th><th>Iscritto</th><th>Provenienza</th><th></th></tr>
      </thead>
      <tbody>
        {#each pending as p (p.id)}
          <tr>
            <td>{p.email ?? '—'}</td>
            <td>{p.full_name ?? '—'}</td>
            <td>{when(p.created_at)}</td>
            <td class="utm">{p.utm ?? '—'}</td>
            <td>
              <form method="POST" action="?/approve" use:enhance>
                <input type="hidden" name="id" value={p.id} />
                <button type="submit">Approva</button>
              </form>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <h2>Approvati di recente</h2>
  {#if !approved.length}
    <p class="empty">Nessuno.</p>
  {:else}
    <table>
      <thead><tr><th>Email</th><th>Nome</th><th>Approvato</th><th></th></tr></thead>
      <tbody>
        {#each approved as a (a.id)}
          <tr>
            <td>{a.email ?? '—'}</td>
            <td>{a.full_name ?? '—'}</td>
            <td>{when(a.approved_at)}</td>
            <td>
              <form method="POST" action="?/revoke" use:enhance>
                <input type="hidden" name="id" value={a.id} />
                <button type="submit" class="ghost">Revoca</button>
              </form>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</main>

<style>
  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 32px 24px 80px;
  }
  h1 {
    margin: 0 0 6px;
  }
  h2 {
    margin: 36px 0 10px;
    font-size: 1.05rem;
  }
  .count {
    color: var(--ink-soft, #6e6e73);
    font-weight: 400;
  }
  .lead,
  .empty {
    color: var(--ink-soft, #6e6e73);
    margin: 0;
  }
  .err {
    color: #c0392b;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92rem;
  }
  th,
  td {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line, #e6e6e9);
    vertical-align: middle;
  }
  th {
    font-weight: 600;
    color: var(--ink-soft, #6e6e73);
  }
  .utm {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button {
    padding: 5px 12px;
    border-radius: 8px;
    border: 1px solid var(--line, #e6e6e9);
    background: var(--accent, #7c5cff);
    color: #fff;
    cursor: pointer;
  }
  button.ghost {
    background: transparent;
    color: var(--ink-soft, #6e6e73);
  }
</style>
