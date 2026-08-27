<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  let { form } = $props();
  let loading = $state(false);
  let show = $state(false);
</script>

<svelte:head><title>{$_('login.resetPage.title')}</title></svelte:head>

<div class="wrap">
  <div class="card">
    <a class="brand" href="/">Anomalia</a>
    <h1>{$_('login.resetPage.title')}</h1>
    <p class="sub">{$_('login.resetPage.sub')}</p>

    <form
      method="POST"
      class="form"
      use:enhance={() => {
        loading = true;
        return async ({ update }) => {
          await update();
          loading = false;
        };
      }}
    >
      <div class="pwfield">
        <input
          type={show ? 'text' : 'password'}
          name="password"
          placeholder={$_('login.resetPage.password')}
          autocomplete="new-password"
          minlength="6"
          disabled={loading}
          required
        />
        <button type="button" class="reveal" onclick={() => (show = !show)} tabindex="-1">
          {show ? $_('login.form.hide') : $_('login.form.show')}
        </button>
      </div>
      <input
        type={show ? 'text' : 'password'}
        name="confirm"
        placeholder={$_('login.resetPage.confirm')}
        autocomplete="new-password"
        minlength="6"
        disabled={loading}
        required
      />
      <button type="submit" disabled={loading}>
        {#if loading}<span class="spinner" aria-hidden="true"></span>{$_('login.resetPage.saving')}{:else}{$_('login.resetPage.button')}{/if}
      </button>
    </form>

    {#if form?.errorCode}<p class="err">{$_('login.error.' + form.errorCode)}</p>{:else if form?.error}<p class="err">{form.error}</p>{/if}
  </div>
</div>

<style>
  .wrap {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--paper, #fff);
  }
  .card {
    width: 100%;
    max-width: 400px;
  }
  .brand {
    font-size: 22px;
    font-weight: 600;
    text-decoration: none;
    color: var(--ink, #1d1d1f);
    display: inline-block;
    margin-bottom: 28px;
  }
  .brand .mid {
    color: var(--accent, #7c5cff);
  }
  h1 {
    font-size: clamp(1.6rem, 3vw, 2rem);
    font-weight: var(--heading-weight);
    letter-spacing: var(--heading-tracking);
    margin: 0;
  }
  .sub {
    color: var(--ink-soft, #6e6e73);
    margin: 12px 0 0;
    line-height: 1.5;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 24px;
  }
  .pwfield {
    position: relative;
  }
  input {
    width: 100%;
    box-sizing: border-box;
    font-size: 16px;
    padding: 14px 18px;
    border-radius: 14px;
    border: 1px solid var(--line-2, #d2d2d7);
    outline: none;
  }
  input:focus {
    border-color: var(--accent, #7c5cff);
    box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.12);
  }
  input:disabled {
    opacity: 0.6;
  }
  .reveal {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    color: var(--ink-soft, #6e6e73);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    padding: 6px 8px;
  }
  button[type='submit'] {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: var(--ink, #1d1d1f);
    color: #fff;
    border: none;
    border-radius: 14px;
    padding: 14px 22px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }
  button[type='submit']:disabled {
    cursor: default;
    opacity: 0.7;
  }
  .spinner {
    width: 15px;
    height: 15px;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .err {
    color: #c0392b;
    font-size: 14px;
    margin-top: 14px;
  }
</style>
