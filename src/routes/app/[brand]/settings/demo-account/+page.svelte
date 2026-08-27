<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';

  let { data, form } = $props();

  const demo = $derived(data.demo);
  let pagesText = $state('');
  let instructionsText = $state('');
  $effect(() => {
    pagesText = (demo?.pages ?? []).join('\n');
    instructionsText = demo?.instructions ?? '';
  });

  let saving = $state(false);
  let harvesting = $state(false);
  let clearing = $state(false);

  const withFlag = (set: (v: boolean) => void) => () => {
    set(true);
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      set(false);
    };
  };

  const errorKey = $derived(typeof form?.error === 'string' ? form.error : '');
  const errorText = $derived.by(() => {
    if (!errorKey) return '';
    const known = [
      'invalid_login_url',
      'missing_username',
      'missing_password',
      'no_demo_account',
      'unauthorized'
    ];
    if (known.includes(errorKey)) return $_(`app.settings.demoAccount.errors.${errorKey}`);
    // `platform_login_not_allowed:Instagram` — the platform name rides along in the error.
    if (errorKey.startsWith('platform_login_not_allowed')) {
      const platform = errorKey.split(':')[1] ?? '';
      return $_('app.settings.demoAccount.errors.platform_login_not_allowed', {
        values: { platform }
      });
    }
    return errorKey;
  });
</script>

<section class="panel">
  <div class="panel-head">
    <div class="t">{$_('app.settings.demoAccount.title')}</div>
  </div>
  <p class="lede">{$_('app.settings.demoAccount.lede')}</p>
  <p class="warn-note">{$_('app.settings.demoAccount.ssoNote')}</p>
  <p class="warn-note">{$_('app.settings.demoAccount.tosNote')}</p>

  {#if form?.saved}
    <div class="field"><div class="fs" style="color:var(--accent);">{$_('app.settings.demoAccount.saved')}</div></div>
  {/if}
  {#if form?.cleared}
    <div class="field"><div class="fs" style="color:var(--accent);">{$_('app.settings.demoAccount.cleared')}</div></div>
  {/if}
  {#if form?.harvested}
    <div class="field">
      <div class="fs" style="color:var(--accent);">
        {$_('app.settings.demoAccount.harvested', { values: { count: form.count ?? 0 } })}
      </div>
    </div>
  {/if}
  {#if errorText}
    <div class="field"><div class="fs" style="color:#c0392b;">{errorText}</div></div>
  {/if}

  <form method="POST" action="?/save" use:enhance={withFlag((v) => (saving = v))} class="form-grid cols-2">
    <div class="fld wide">
      <label class="lb" for="login_url">{$_('app.settings.demoAccount.loginUrl')}</label>
      <input
        id="login_url"
        name="login_url"
        type="url"
        inputmode="url"
        autocomplete="off"
        required
        placeholder="https://app.example.com/login"
        value={demo?.loginUrl ?? ''}
      />
      <div class="hint">{$_('app.settings.demoAccount.loginUrlHint')}</div>
    </div>
    <div class="fld">
      <label class="lb" for="username">{$_('app.settings.demoAccount.username')}</label>
      <input
        id="username"
        name="username"
        type="text"
        autocomplete="off"
        required
        placeholder="demo@example.com"
        value={demo?.username ?? ''}
      />
    </div>
    <div class="fld">
      <label class="lb" for="password">{$_('app.settings.demoAccount.password')}</label>
      <input
        id="password"
        name="password"
        type="password"
        autocomplete="new-password"
        placeholder={demo?.hasPassword
          ? $_('app.settings.demoAccount.passwordKeep')
          : $_('app.settings.demoAccount.passwordPlaceholder')}
        required={!demo?.hasPassword}
      />
      <div class="hint">
        {demo?.hasPassword
          ? $_('app.settings.demoAccount.passwordStored')
          : $_('app.settings.demoAccount.passwordHint')}
      </div>
    </div>
    <div class="fld wide">
      <label class="lb" for="pages">{$_('app.settings.demoAccount.pages')}</label>
      <textarea
        id="pages"
        name="pages"
        rows="5"
        placeholder={$_('app.settings.demoAccount.pagesPlaceholder')}
        bind:value={pagesText}
      ></textarea>
      <div class="hint">{$_('app.settings.demoAccount.pagesHint')}</div>
    </div>
    <div class="fld wide">
      <label class="lb" for="instructions">{$_('app.settings.demoAccount.instructions')}</label>
      <textarea
        id="instructions"
        name="instructions"
        rows="8"
        placeholder={$_('app.settings.demoAccount.instructionsPlaceholder')}
        bind:value={instructionsText}
      ></textarea>
      <div class="hint">{$_('app.settings.demoAccount.instructionsHint')}</div>
    </div>

    <details class="fld wide advanced">
      <summary>{$_('app.settings.demoAccount.advanced')}</summary>
      <div class="form-grid cols-2 nested">
        <div class="fld">
          <label class="lb" for="email_selector">{$_('app.settings.demoAccount.emailSelector')}</label>
          <input
            id="email_selector"
            name="email_selector"
            type="text"
            autocomplete="off"
            placeholder="input[type=email]"
            value={demo?.emailSelector ?? ''}
          />
        </div>
        <div class="fld">
          <label class="lb" for="password_selector">{$_('app.settings.demoAccount.passwordSelector')}</label>
          <input
            id="password_selector"
            name="password_selector"
            type="text"
            autocomplete="off"
            placeholder="input[type=password]"
            value={demo?.passwordSelector ?? ''}
          />
        </div>
        <div class="fld">
          <label class="lb" for="submit_selector">{$_('app.settings.demoAccount.submitSelector')}</label>
          <input
            id="submit_selector"
            name="submit_selector"
            type="text"
            autocomplete="off"
            placeholder="button[type=submit]"
            value={demo?.submitSelector ?? ''}
          />
        </div>
        <div class="fld">
          <label class="lb" for="success_selector">{$_('app.settings.demoAccount.successSelector')}</label>
          <input
            id="success_selector"
            name="success_selector"
            type="text"
            autocomplete="off"
            placeholder="[data-testid=dashboard]"
            value={demo?.successSelector ?? ''}
          />
        </div>
      </div>
    </details>

    <div class="form-foot">
      <div class="note">{$_('app.settings.demoAccount.vaultNote')}</div>
      <div class="acts">
        <button class="mini connect" type="submit" disabled={saving}>
          {saving ? $_('app.settings.demoAccount.saving') : $_('app.settings.save')}
        </button>
      </div>
    </div>
  </form>
</section>

<section class="panel">
  <div class="panel-head">
    <div class="t">{$_('app.settings.demoAccount.captureTitle')}</div>
  </div>
  <div class="field col">
    <div class="ftxt">
      <div class="fh">{$_('app.settings.demoAccount.captureHead')}</div>
      <div class="fs">{$_('app.settings.demoAccount.captureDesc')}</div>
      {#if demo?.lastHarvestedAt}
        <div class="fs">
          {$_('app.settings.demoAccount.lastHarvest', {
            values: {
              when: demo.lastHarvestedAt.slice(0, 16).replace('T', ' '),
              count: demo.lastHarvestCount ?? 0
            }
          })}
        </div>
      {/if}
      {#if demo?.lastError}
        <div class="fs" style="color:#c0392b;">{demo.lastError}</div>
      {/if}
      {#if !data.captureReady}
        <div class="fs" style="color:#b45309;">{$_('app.settings.demoAccount.noBrowserless')}</div>
      {/if}
    </div>
    <div class="row-acts">
      <form method="POST" action="?/harvest" use:enhance={withFlag((v) => (harvesting = v))}>
        <button
          class="mini connect"
          type="submit"
          disabled={harvesting || !demo?.hasPassword || !data.captureReady}
        >
          {harvesting
            ? $_('app.settings.demoAccount.capturing')
            : $_('app.settings.demoAccount.captureCta')}
        </button>
      </form>
      {#if demo}
        <form method="POST" action="?/clear" use:enhance={withFlag((v) => (clearing = v))}>
          <button class="mini ghost" type="submit" disabled={clearing}>
            {$_('app.settings.demoAccount.clear')}
          </button>
        </form>
      {/if}
    </div>
  </div>
</section>

<style>
  .lede {
    margin: 0;
    padding: 16px 22px 0;
    font-size: 13.5px;
    color: var(--ink-soft);
    line-height: 1.5;
    max-width: 62ch;
  }
  .warn-note {
    margin: 8px 22px 0;
    font-size: 12.5px;
    color: var(--ink-faint);
    line-height: 1.45;
    max-width: 62ch;
  }
  .advanced {
    margin: 0;
  }
  .advanced summary {
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-soft);
    padding: 4px 0;
  }
  .nested {
    padding: 12px 0 0;
  }
  .row-acts {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
</style>
