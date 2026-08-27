<script lang="ts">
  import { enhance } from '$app/forms';
  import { SvelteSet } from 'svelte/reactivity';

  let {
    data,
    form
  }: {
    data: {
      sites: Array<{ id: string; host: string; verified: boolean }>;
      defaultUrl: string;
      cnameTarget: string;
      autoDomain: boolean;
    };
    form?: Record<string, unknown> | null;
  } = $props();

  const busy = new SvelteSet<string>();
  const isBusy = (key: string) => busy.has(key);
  const withBusy = (key: string) => () => {
    busy.add(key);
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy.delete(key);
    };
  };

  const defaultHost = $derived(data.defaultUrl.replace(/^https?:\/\//, ''));

  // Record DNS che Vercel richiede prima di emettere il certificato (tipicamente il TXT su
  // _vercel.<dominio> quando l'apex è già su un altro account). Senza mostrarli il dominio resta
  // "in attesa DNS" per sempre e il blog non risponde né in HTTPS né in HTTP.
  const challenges = $derived(
    (form?.verification as Array<{ type: string; domain: string; value: string }> | undefined) ?? []
  );
</script>

{#if form?.error === 'invalid_host'}
  <p class="banner err">Dominio non valido. Usa un host tipo <code>blog.tuosito.com</code>.</p>
{:else if form?.error === 'paid_plan_required'}
  <p class="banner err">Il dominio personalizzato richiede un piano a pagamento.</p>
{:else if form?.error === 'host_taken'}
  <p class="banner err">Questo dominio è già collegato.</p>
{:else if form?.connected && form?.regError}
  <p class="banner warn">
    Dominio salvato, ma la registrazione automatica su Vercel non è riuscita ({form.regError}). Aggiungilo
    manualmente nel progetto Vercel.
  </p>
{:else if form?.connected}
  <p class="banner ok">Dominio collegato.</p>
{:else if form?.verifyChecked}
  <p class="banner {form.verified ? 'ok' : 'warn'}">
    {form.verified ? 'Dominio verificato ✓' : 'Non ancora verificato — il DNS può richiedere qualche minuto.'}
  </p>
{:else if form?.disconnected}
  <p class="banner ok">Dominio scollegato.</p>
{/if}

{#if challenges.length}
  <div class="banner warn challenge">
    <strong>Serve un record di verifica</strong>
    <p>
      Il dominio principale è già registrato su un altro account Vercel. Aggiungi questo record nel tuo
      provider DNS, poi premi di nuovo Verifica:
    </p>
    <ul>
      {#each challenges as c (c.domain + c.value)}
        <li>
          <code>{c.type}</code>
          <code>{c.domain}</code>
          <code>{c.value}</code>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<div class="domain-layout">
  <section class="panel">
    <div class="panel-head">
      <div>
        <div class="t">Indirizzo attuale</div>
        <p class="panel-sub">Il blog è già online su questo URL Anomalia.</p>
      </div>
    </div>
    <div class="panel-body">
      <a class="live-url" href={data.defaultUrl} target="_blank" rel="noopener noreferrer">
        <span class="live-url-host">{defaultHost}</span>
        <span class="live-url-go" aria-hidden="true">↗</span>
      </a>
      <p class="muted small live-hint">
        Collega un dominio personalizzato qui sotto per usare il tuo brand al posto di questo indirizzo.
      </p>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <div>
        <div class="t">Domini collegati</div>
        <p class="panel-sub">
          {#if data.sites.length}
            {data.sites.length}
            {data.sites.length === 1 ? 'dominio' : 'domini'} configurat{data.sites.length === 1 ? 'o' : 'i'}.
          {:else}
            Nessun dominio personalizzato ancora.
          {/if}
        </p>
      </div>
    </div>
    <div class="panel-body">
      {#if data.sites.length}
        <ul class="domains">
          {#each data.sites as s (s.id)}
            <li class="domain-card">
              <div class="d-info">
                <a
                  href="https://{s.host}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="d-host">{s.host}</a
                >
                <span class="badge {s.verified ? 'ok' : ''}">{s.verified ? 'Verificato' : 'In attesa DNS'}</span>
              </div>
              <div class="d-actions">
                <form method="POST" action="?/verifyDomain" use:enhance={withBusy(`verify-${s.host}`)}>
                  <input type="hidden" name="host" value={s.host} />
                  <button
                    class="btn ghost"
                    class:loading={isBusy(`verify-${s.host}`)}
                    type="submit"
                    disabled={isBusy(`verify-${s.host}`)}>Verifica DNS</button
                  >
                </form>
                <form
                  method="POST"
                  action="?/disconnectDomain"
                  use:enhance={withBusy(`disconnect-${s.host}`)}
                >
                  <input type="hidden" name="host" value={s.host} />
                  <button
                    class="btn ghost danger"
                    class:loading={isBusy(`disconnect-${s.host}`)}
                    type="submit"
                    disabled={isBusy(`disconnect-${s.host}`)}>Scollega</button
                  >
                </form>
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty muted">Quando colleghi un dominio compare qui, con stato DNS e azioni.</p>
      {/if}
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <div>
        <div class="t">Collega un dominio</div>
        <p class="panel-sub">Usa un sottodominio (es. <code>blog.tuosito.com</code>) — è la via più semplice.</p>
      </div>
    </div>
    <div class="panel-body">
      <form method="POST" action="?/connectDomain" use:enhance={withBusy('connect-domain')} class="add-card">
        <label>
          Host
          <input
            type="text"
            name="host"
            placeholder="blog.tuosito.com"
            autocomplete="off"
            spellcheck="false"
            disabled={isBusy('connect-domain')}
          />
        </label>
        <div class="add-card-actions">
          <button
            class="btn primary"
            class:loading={isBusy('connect-domain')}
            type="submit"
            disabled={isBusy('connect-domain')}>Collega dominio</button
          >
        </div>
      </form>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <div>
        <div class="t">Configurazione DNS</div>
        <p class="panel-sub">Dopo aver collegato il dominio, punta il DNS qui e premi Verifica.</p>
      </div>
    </div>
    <div class="panel-body dns">
      <ol class="dns-steps">
        <li>
          <span class="step-n">1</span>
          <div class="step-body">
            <strong>Aggiungi un record CNAME</strong>
            <p>
              Nel tuo provider DNS: <code>Host: blog</code> →
              <code>Valore: {data.cnameTarget}</code>
            </p>
          </div>
        </li>
        <li>
          <span class="step-n">2</span>
          <div class="step-body">
            <strong>Torna qui e premi Verifica</strong>
            <p>DNS e certificato SSL possono richiedere qualche minuto.</p>
          </div>
        </li>
        {#if !data.autoDomain}
          <li>
            <span class="step-n">3</span>
            <div class="step-body">
              <strong>Aggiungi il dominio su Vercel</strong>
              <p class="muted">La registrazione automatica non è configurata su questo ambiente.</p>
            </div>
          </li>
        {/if}
      </ol>
      <p class="muted small tip">
        Consiglio: preferisci un sottodominio. Un dominio apex richiede record ALIAS/ANAME.
      </p>
    </div>
  </section>
</div>

<style>
  .domain-layout {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .panel-head > div {
    min-width: 0;
  }
  .panel-body {
    padding: 18px 22px 22px;
  }
  .panel-sub {
    margin: 4px 0 0;
    font-size: 13px;
    font-weight: 400;
    color: var(--ink-faint);
    line-height: 1.45;
  }
  .banner {
    font-size: 13px;
    border-radius: 10px;
    padding: 10px 14px;
    margin: 0 0 16px;
    line-height: 1.45;
  }
  .banner.ok {
    background: #dcfce7;
    color: #166534;
  }
  .banner.err {
    background: #fef2f2;
    color: #b91c1c;
  }
  .banner.warn {
    background: #fef3c7;
    color: #92400e;
  }
  .challenge p {
    margin: 6px 0 10px;
    line-height: 1.5;
  }
  .challenge ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .challenge li {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .live-url {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--paper-2);
    text-decoration: none;
    color: var(--ink);
    min-width: 0;
  }
  .live-url:hover {
    border-color: color-mix(in srgb, var(--accent, #7c5cff) 35%, var(--line));
  }
  .live-url-host {
    font-size: 14.5px;
    font-weight: 600;
    word-break: break-all;
    min-width: 0;
  }
  .live-url-go {
    flex-shrink: 0;
    color: var(--ink-faint);
    font-size: 14px;
  }
  .live-hint {
    margin: 12px 0 0;
    line-height: 1.45;
  }

  .domains {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .domain-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--paper);
  }
  .d-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }
  .d-host {
    font-size: 15px;
    font-weight: 600;
    color: var(--ink);
    text-decoration: none;
    word-break: break-all;
  }
  .d-host:hover {
    text-decoration: underline;
  }
  .d-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .d-actions form {
    margin: 0;
  }
  .badge {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 9px;
    border-radius: 999px;
    background: var(--paper-2);
    color: var(--ink-faint);
    border: 1px solid var(--line);
  }
  .badge.ok {
    background: #dcfce7;
    color: #166534;
    border-color: transparent;
  }
  .empty {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.5;
  }

  .add-card {
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 16px 18px;
    background: var(--paper-2);
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0;
  }
  .add-card label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .add-card input {
    font-size: 14px;
    padding: 11px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
    font-weight: 400;
    font-family: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  .add-card input:focus {
    outline: none;
    border-color: var(--accent, #7c5cff);
  }
  .add-card-actions {
    display: flex;
    justify-content: flex-end;
  }

  .dns-steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .dns-steps li {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .step-n {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--paper-2);
    border: 1px solid var(--line);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--ink-soft);
  }
  .step-body {
    min-width: 0;
    flex: 1;
    padding-top: 3px;
  }
  .step-body strong {
    display: block;
    font-size: 13.5px;
    font-weight: 650;
    color: var(--ink);
    margin-bottom: 4px;
  }
  .step-body p {
    margin: 0;
    font-size: 13.5px;
    color: var(--ink-soft);
    line-height: 1.55;
  }
  .tip {
    margin: 16px 0 0;
    padding-top: 14px;
    border-top: 1px solid var(--line);
    line-height: 1.45;
  }

  code {
    background: var(--paper-2);
    padding: 2px 6px;
    border-radius: 6px;
    font-size: 12.5px;
    word-break: break-all;
  }
  .muted {
    color: var(--ink-faint);
  }
  .small {
    font-size: 12px;
  }
  .btn {
    font-size: 13px;
    font-weight: 600;
    border-radius: 10px;
    padding: 10px 16px;
    cursor: pointer;
    border: 1px solid transparent;
    line-height: 1.2;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: inherit;
    white-space: nowrap;
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .btn.primary {
    background: var(--accent, #7c5cff);
    color: #fff;
  }
  .btn.ghost {
    background: transparent;
    color: var(--ink-soft);
    border-color: var(--line);
  }
  .btn.ghost.danger:hover {
    color: #dc2626;
    border-color: #dc2626;
  }
  .loading {
    position: relative;
    color: transparent !important;
    pointer-events: none;
  }
  .loading::after {
    content: '';
    position: absolute;
    inset: 0;
    margin: auto;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 2px solid var(--ink-faint);
    border-top-color: transparent;
    animation: spin 0.7s linear infinite;
  }
  .btn.primary.loading::after {
    border-color: rgba(255, 255, 255, 0.45);
    border-top-color: transparent;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 640px) {
    .panel-body {
      padding: 14px 14px 16px;
    }
    .domain-card {
      flex-direction: column;
      align-items: stretch;
      gap: 12px;
      padding: 14px;
    }
    .d-actions {
      flex-direction: column;
      width: 100%;
    }
    .d-actions .btn {
      width: 100%;
    }
    .add-card {
      padding: 14px;
    }
    .add-card-actions {
      justify-content: stretch;
    }
    .add-card-actions .btn {
      width: 100%;
    }
    .live-url {
      padding: 12px 14px;
    }
  }
</style>
