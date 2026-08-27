<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import { SvelteSet } from 'svelte/reactivity';
  import { jpegIfHeicFormFiles } from '$lib/raster-image-client';
  import { RASTER_IMAGE_ACCEPT } from '$lib/raster-image';

  let { data, form } = $props();

  const busy = new SvelteSet<string>();
  const isBusy = (key: string) => busy.has(key);
  const withBusy = (key: string) => () => {
    busy.add(key);
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy.delete(key);
    };
  };

  const initials = $derived(
    [data.firstName, data.lastName]
      .filter(Boolean)
      .map((s: string) => s[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || (data.email?.[0]?.toUpperCase() ?? '?')
  );
</script>

{#if form?.profileSaved}
  <p class="banner ok">{$_('app.settings.profile.saved')}</p>
{:else if form?.avatarUploaded}
  <p class="banner ok">{$_('app.settings.profile.avatarSaved')}</p>
{:else if form?.avatarRemoved}
  <p class="banner ok">{$_('app.settings.profile.avatarRemoved')}</p>
{:else if form?.error === 'too_large'}
  <p class="banner err">{$_('app.settings.profile.tooLarge')}</p>
{:else if form?.error === 'not_image'}
  <p class="banner err">{$_('app.settings.profile.notImage')}</p>
{/if}

<section class="panel">
  <div class="panel-head"><div class="t">{$_('app.settings.profile.title')}</div></div>

  <div class="field avatar-field">
    <div class="avatar-preview">
      {#if data.avatarUrl}
        <img src={data.avatarUrl} alt="" />
      {:else}
        <span>{initials}</span>
      {/if}
    </div>
    <div class="ftxt">
      <div class="fh">{$_('app.settings.profile.photo')}</div>
      <div class="fs">{$_('app.settings.profile.photoDesc')}</div>
      <div class="avatar-actions">
        <form
          method="POST"
          action="?/uploadProfileAvatar"
          enctype="multipart/form-data"
          use:enhance={async ({ formData }) => {
            await jpegIfHeicFormFiles(formData, 'avatar');
            return withBusy('avatar')();
          }}
        >
          <label class="bbtn" class:busy={isBusy('avatar')}>
            {$_('app.settings.profile.uploadPhoto')}
            <input
              type="file"
              name="avatar"
              accept={RASTER_IMAGE_ACCEPT}
              hidden
              onchange={(e) => e.currentTarget.form?.requestSubmit()}
            />
          </label>
        </form>
        {#if data.hasCustomAvatar}
          <form method="POST" action="?/removeProfileAvatar" use:enhance={withBusy('avatar')}>
            <button class="bbtn" type="submit" disabled={isBusy('avatar')}
              >{$_('app.settings.profile.removePhoto')}</button
            >
          </form>
        {/if}
      </div>
    </div>
  </div>

  <form method="POST" action="?/updateProfile" use:enhance={withBusy('profile')} class="name-form">
    <div class="field col">
      <div class="ftxt">
        <div class="fh">{$_('app.settings.profile.name')}</div>
        <div class="fs">{$_('app.settings.profile.nameDesc')}</div>
      </div>
      <div class="name-row">
        <label>
          {$_('app.settings.profile.firstName')}
          <input
            type="text"
            name="firstName"
            value={data.firstName}
            maxlength="80"
            autocomplete="given-name"
            disabled={isBusy('profile')}
          />
        </label>
        <label>
          {$_('app.settings.profile.lastName')}
          <input
            type="text"
            name="lastName"
            value={data.lastName}
            maxlength="80"
            autocomplete="family-name"
            disabled={isBusy('profile')}
          />
        </label>
      </div>
      {#if data.email}
        <p class="email-line">{data.email}</p>
      {/if}
      <button class="bbtn primary" type="submit" disabled={isBusy('profile')}
        >{$_('app.settings.save')}</button
      >
    </div>
  </form>
</section>

<section class="panel">
  <div class="panel-head"><div class="t">{$_('app.settings.profile.session')}</div></div>
  <div class="field">
    <div class="ftxt">
      <div class="fh">{$_('app.account.signOut')}</div>
      <div class="fs">{$_('app.settings.profile.signOutDesc')}</div>
    </div>
    <form method="POST" action="/auth/signout">
      <button class="bbtn" type="submit">{$_('app.account.signOut')}</button>
    </form>
  </div>
</section>

<style>
  .banner {
    font-size: 13px;
    border-radius: 10px;
    padding: 10px 14px;
    margin: 0 0 16px;
  }
  .banner.ok {
    background: #dcfce7;
    color: #166534;
  }
  .banner.err {
    background: #fef2f2;
    color: #b91c1c;
  }
  .avatar-field {
    align-items: flex-start;
    gap: 16px;
  }
  .avatar-preview {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--paper-2);
    border: 1px solid var(--line);
    color: var(--ink-soft);
    font-size: 18px;
    font-weight: 700;
  }
  .avatar-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .avatar-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  .name-form {
    margin: 0;
  }
  .name-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .name-row label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .name-row input {
    font: inherit;
    font-size: 14px;
    font-weight: 400;
    padding: 9px 12px;
    border: 1px solid var(--line-2, var(--line));
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
    outline: none;
  }
  .name-row input:focus {
    border-color: var(--accent);
  }
  .email-line {
    margin: 0;
    font-size: 13px;
    color: var(--ink-faint);
  }
  .bbtn.busy {
    opacity: 0.55;
    pointer-events: none;
  }
  @media (max-width: 560px) {
    .name-row {
      grid-template-columns: 1fr;
    }
  }
</style>
