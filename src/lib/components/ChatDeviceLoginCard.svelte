<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { Check, Copy, ExternalLink } from '@lucide/svelte';
  import type { DeviceLoginState } from '$lib/chat-device-login';

  /**
   * La card del device login (tool `sandbox_device_login`), pattern ChatConnectCard: renderizzata
   * dalle tool-call parts su entrambe le superfici. Mostra il CODICE PUBBLICO che l'utente digita
   * su github.com/login/device — il codice in chiaro qui è il design del device flow, non una
   * svista; il token invece non arriva mai a questa card né a nessun'altra parte del client.
   *
   * Lo stato "authorized"/"expired" arriva da un secondo output del tool (action:"check"): la
   * card del codice intanto si dichiara scaduta da sola col countdown — niente polling verso il
   * server, non c'è nessun endpoint da interrogare e la verità ce l'ha solo il turno dell'agente.
   */
  let { login }: { login: DeviceLoginState } = $props();

  const PROVIDER_LABELS: Record<string, string> = { github: 'GitHub' };
  const providerLabel = PROVIDER_LABELS[login.provider] ?? login.provider;
  const host = (() => {
    try {
      return login.verification_uri ? new URL(login.verification_uri).host + new URL(login.verification_uri).pathname : '';
    } catch {
      return login.verification_uri ?? '';
    }
  })();

  let nowMs = $state(Date.now());
  let copied = $state(false);

  // Il countdown vive solo finché la card è "pending" con una scadenza: un timer al secondo,
  // fermato appena non serve più.
  $effect(() => {
    if (login.status !== 'pending' || !login.expires_at) return;
    const t = setInterval(() => (nowMs = Date.now()), 1000);
    return () => clearInterval(t);
  });

  const remainingMs = $derived(login.expires_at ? login.expires_at - nowMs : null);
  /** "pending" scaduto localmente = scaduto: il codice non funziona più, inutile fingere. */
  const status = $derived(
    login.status === 'pending' && remainingMs !== null && remainingMs <= 0 ? 'expired' : login.status
  );
  const countdown = $derived(
    remainingMs && remainingMs > 0
      ? `${Math.floor(remainingMs / 60_000)}:${String(Math.floor((remainingMs % 60_000) / 1000)).padStart(2, '0')}`
      : null
  );

  async function copyCode() {
    if (!login.user_code) return;
    try {
      await navigator.clipboard.writeText(login.user_code);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      /* clipboard negata: il codice resta comunque leggibile e selezionabile */
    }
  }
</script>

<div class="dl-card" class:done={status === 'authorized'}>
  <div class="dl-head">
    <span class="dl-title">{$_('app.shell.deviceLoginTitle', { values: { provider: providerLabel } })}</span>
    {#if status === 'authorized'}
      <span class="dl-badge ok"><Check size={14} strokeWidth={3} /> {$_('app.shell.deviceLoginAuthorized')}</span>
    {:else if status === 'expired'}
      <span class="dl-badge">{$_('app.shell.deviceLoginExpiredBadge')}</span>
    {/if}
  </div>

  {#if status === 'pending' && login.user_code}
    <p class="dl-hint">{$_('app.shell.deviceLoginHint', { values: { host: host || 'github.com/login/device' } })}</p>
    <div class="dl-code-row">
      <code class="dl-code">{login.user_code}</code>
      <button type="button" class="dl-copy" onclick={copyCode} aria-live="polite">
        {#if copied}
          <Check size={14} strokeWidth={2.5} /> {$_('app.shell.deviceLoginCopied')}
        {:else}
          <Copy size={14} strokeWidth={2} /> {$_('app.shell.deviceLoginCopy')}
        {/if}
      </button>
    </div>
    {#if login.verification_uri}
      <a class="dl-open" href={login.verification_uri} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={13} strokeWidth={2.2} />
        {$_('app.shell.deviceLoginOpen', { values: { host: host || login.verification_uri } })}
      </a>
    {/if}
    {#if countdown}
      <p class="dl-wait">{$_('app.shell.deviceLoginExpires', { values: { time: countdown } })}</p>
    {/if}
  {:else if status === 'expired'}
    <p class="dl-hint">{$_('app.shell.deviceLoginExpired')}</p>
  {:else if status === 'denied'}
    <p class="dl-hint">{$_('app.shell.deviceLoginDenied')}</p>
  {/if}
</div>

<style>
  /* Stesso idioma flat della ChatConnectCard ridisegnata: niente pannello, una riga di titolo
     quieta e il CODICE come unico protagonista. Solo token veri, light/dark gratis. */
  .dl-card {
    margin: 8px 0 4px;
    max-width: 420px;
  }
  .dl-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dl-title {
    font-size: 13px;
    font-weight: 650;
    color: var(--ink);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dl-badge {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-faint);
    flex: none;
  }
  .dl-badge.ok {
    color: var(--ink-soft);
  }
  .dl-hint {
    margin: 3px 0 0;
    font-size: 12px;
    color: var(--ink-soft);
    line-height: 1.4;
  }
  .dl-code-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }
  .dl-code {
    /* Il codice è la cosa da vedere: grande, monospazio, selezionabile con un tap. */
    flex: 1;
    min-width: 0;
    padding: 8px 12px;
    border: 1px dashed var(--line);
    border-radius: 10px;
    background: var(--paper-3);
    color: var(--ink);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-align: center;
    user-select: all;
  }
  /* Ghost, come la cta della connect card: bordo sottile, nessun riempimento. */
  .dl-copy {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 5px 11px;
    font-size: 12px;
    font-weight: 600;
    background: none;
    color: var(--ink-soft);
    cursor: pointer;
    flex: none;
    transition: border-color 0.12s ease, color 0.12s ease;
  }
  .dl-copy:hover {
    border-color: var(--accent);
    color: var(--ink);
  }
  .dl-open {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    text-decoration: none;
  }
  .dl-open:hover {
    text-decoration: underline;
  }
  .dl-wait {
    margin: 4px 0 0;
    font-size: 11.5px;
    color: var(--ink-faint);
  }
</style>
