<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionResult } from '@sveltejs/kit';
  import { SvelteSet } from 'svelte/reactivity';

  let {
    data,
    form
  }: {
    data: {
      shopify: {
        connected: boolean;
        active: boolean;
        store: string;
        blogId: string | null;
        author: string;
        publishImmediately: boolean;
        blogs: { id: string; title: string }[];
      } | null;
      webflow: {
        connected: boolean;
        active: boolean;
        collectionId: string | null;
        publishImmediately: boolean;
        collections: { id: string; name: string }[];
      } | null;
      wix: {
        connected: boolean;
        active: boolean;
        siteId: string;
        publishImmediately: boolean;
      } | null;
    };
    form?: Record<string, unknown> | null;
  } = $props();

  const busy = new SvelteSet<string>();
  const isBusy = (key: string) => busy.has(key);
  let shopifyDialog = $state<HTMLDialogElement>();
  let webflowDialog = $state<HTMLDialogElement>();
  let wixDialog = $state<HTMLDialogElement>();

  const withBusy = (key: string) => () => {
    busy.add(key);
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy.delete(key);
    };
  };
  const withClose =
    (key: string, getDialog: () => HTMLDialogElement | undefined = () => shopifyDialog) =>
    () => {
      busy.add(key);
      return async ({
        update,
        result
      }: {
        update: (o?: { reset?: boolean }) => Promise<void>;
        result: ActionResult;
      }) => {
        await update({ reset: false });
        busy.delete(key);
        if (result.type === 'success') getDialog()?.close();
      };
    };

  const activeCms = $derived(
    [
      data.shopify?.active && data.shopify?.blogId && 'Shopify',
      data.webflow?.active && data.webflow?.collectionId && 'Webflow',
      data.wix?.active && 'Wix'
    ].filter(Boolean)
  );
</script>

{#if form?.error === 'shopify_fields'}
  <p class="banner err">Compila nome store, Client ID e Client secret.</p>
{:else if form?.error === 'shopify_auth'}
  <p class="banner err">
    Connessione a Shopify non riuscita. {(form as { detail?: string }).detail ?? ''}
  </p>
{:else if form?.shopifyConnected}
  <p class="banner ok">Shopify connesso — scegli il blog di destinazione.</p>
{:else if form?.error === 'shopify_blog_required'}
  <p class="banner err">Scegli un blog di destinazione.</p>
{:else if form?.shopifyBlogSaved}
  <p class="banner ok">Destinazione Shopify salvata.</p>
{:else if form?.shopifyDisconnected}
  <p class="banner ok">Shopify scollegato.</p>
{:else if form?.shopifyToggled !== undefined}
  <p class="banner ok">Shopify {form.shopifyToggled ? 'attivato' : 'disattivato'}.</p>
{:else if form?.error === 'webflow_token'}
  <p class="banner err">Incolla il tuo API token di Webflow.</p>
{:else if form?.error === 'webflow_no_site'}
  <p class="banner err">Il token non vede nessun sito.</p>
{:else if form?.error === 'webflow_auth'}
  <p class="banner err">
    Connessione a Webflow non riuscita. {(form as { detail?: string }).detail ?? ''}
  </p>
{:else if form?.webflowConnected}
  <p class="banner ok">Webflow connesso — scegli la collection di destinazione.</p>
{:else if form?.error === 'webflow_collection_required'}
  <p class="banner err">Scegli una collection di destinazione.</p>
{:else if form?.webflowCollectionSaved}
  <p class="banner ok">Destinazione Webflow salvata.</p>
{:else if form?.webflowDisconnected}
  <p class="banner ok">Webflow scollegato.</p>
{:else if form?.webflowToggled !== undefined}
  <p class="banner ok">Webflow {form.webflowToggled ? 'attivato' : 'disattivato'}.</p>
{:else if form?.error === 'wix_fields'}
  <p class="banner err">Compila Site ID e API key.</p>
{:else if form?.error === 'wix_auth'}
  <p class="banner err">
    Connessione a Wix non riuscita. {(form as { detail?: string }).detail ?? ''}
  </p>
{:else if form?.wixConnected}
  <p class="banner ok">Wix connesso — attivalo con lo switch.</p>
{:else if form?.wixSaved}
  <p class="banner ok">Impostazioni Wix salvate.</p>
{:else if form?.wixDisconnected}
  <p class="banner ok">Wix scollegato.</p>
{:else if form?.wixToggled !== undefined}
  <p class="banner ok">Wix {form.wixToggled ? 'attivato' : 'disattivato'}.</p>
{/if}

<section class="panel">
  <div class="panel-head"><div class="t">Integrazioni CMS</div></div>
  <div class="panel-body">
  <p class="muted small intro">
    Pubblica gli articoli anche su piattaforme esterne.
    {#if activeCms.length}
      Attive: {activeCms.join(' + ')}.
    {/if}
  </p>

  <div class="integ-row">
    <div class="integ-mark shopify" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor"
        ><path
          d="M15.3 4.2c-.1 0-1.9.1-1.9.1s-1.3-1.3-1.4-1.4c-.1-.1-.4-.1-.5-.1 0 0-.3.1-.7.2-.4-1.1-1-2-2.2-2-1.5 0-2.8 1.7-3.2 3.4-.6.2-1 .3-1.1.3-.6.2-.6.2-.7.8C3.2 6.9 2 15.9 2 15.9L11 18l4.9-1.2s-.5-12.4-.6-12.6ZM10.4 3.4c-.3.1-.6.2-1 .3 0-.7-.1-1.6-.4-2.2.8.1 1.2 1 1.4 1.9Zm-1.7-1.6c.3.6.4 1.5.4 2.2-.6.2-1.2.4-1.8.5.4-1.3 1-2.3 1.4-2.7Zm-.7-.6c.1 0 .2 0 .3.1-.6.4-1.3 1.5-1.7 3-.5.1-.9.3-1.4.4C5.9 2.9 7 1.2 8 1.2Z"
        /></svg
      >
    </div>
    <div class="integ-info">
      <b>Shopify</b>
      <span class="muted small"
        >{#if data.shopify?.connected}store <code>{data.shopify.store}</code>{#if !data.shopify.blogId}
            · scegli un blog dal menu ⋮{/if}{:else}Non connesso — apri il menu ⋮ per configurare{/if}</span
      >
    </div>
    <form
      method="POST"
      action="?/toggleShopify"
      use:enhance={withBusy('shopify-toggle')}
      class="switch-form"
    >
      <label class="switch" class:disabled={!data.shopify?.connected || !data.shopify?.blogId}>
        <input
          type="checkbox"
          name="active"
          value="true"
          checked={data.shopify?.active && !!data.shopify?.blogId}
          disabled={isBusy('shopify-toggle') || !data.shopify?.connected || !data.shopify?.blogId}
          onchange={(e) => e.currentTarget.form?.requestSubmit()}
        />
        <span class="track"><span class="thumb"></span></span>
      </label>
    </form>
    <button
      type="button"
      class="dots"
      title="Configura"
      aria-label="Configura Shopify"
      onclick={() => shopifyDialog?.showModal()}>⋮</button
    >
  </div>

  <div class="integ-row">
    <div class="integ-mark webflow" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor"
        ><path d="M21 6.5 15.8 17h-2.4l-2.2-4.3L8.9 17H6.5L1.5 6.5H4l3 6.4 2.1-4.2H11l2 4.2 3-6.4h5Z" /></svg
      >
    </div>
    <div class="integ-info">
      <b>Webflow</b>
      <span class="muted small"
        >{#if data.webflow?.connected}connesso{#if !data.webflow.collectionId}
            · scegli una collection dal menu ⋮{/if}{:else}Non connesso — apri il menu ⋮ per configurare{/if}</span
      >
    </div>
    <form
      method="POST"
      action="?/toggleWebflow"
      use:enhance={withBusy('webflow-toggle')}
      class="switch-form"
    >
      <label class="switch" class:disabled={!data.webflow?.connected || !data.webflow?.collectionId}>
        <input
          type="checkbox"
          name="active"
          value="true"
          checked={data.webflow?.active && !!data.webflow?.collectionId}
          disabled={isBusy('webflow-toggle') || !data.webflow?.connected || !data.webflow?.collectionId}
          onchange={(e) => e.currentTarget.form?.requestSubmit()}
        />
        <span class="track"><span class="thumb"></span></span>
      </label>
    </form>
    <button
      type="button"
      class="dots"
      title="Configura"
      aria-label="Configura Webflow"
      onclick={() => webflowDialog?.showModal()}>⋮</button
    >
  </div>

  <div class="integ-row">
    <div class="integ-mark wix" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor"
        ><path
          d="M14.9 4.6c-.9.5-1.2 1.3-1.2 3.3 0 0 .5-.4 1.2-.7.5-.2.9-.5 1-.6.4-.3.5-.7.5-1.4 0-1.3-1-1.4-1.5-.6ZM10 5c-.7.3-1 .8-1.2 1.8L7.4 12l-1-4c-.2-1-.4-1.5-.8-1.8-.6-.4-1.7-.4-2.3 0-.4.3-.6.8-.8 1.8L1 16h1.9l1.4-6 1.5 6h2l1.4-6.2c.1-.5.2-.7.4-.7s.3.2.4.7L16.5 16h2l1.4-8c.1-.9.1-1.3-.1-1.7-.5-.9-2-.9-2.5 0-.2.3-.2.7-.1 1.6l-.7 4-1.2-5c-.2-1-.5-1.5-1.2-1.8-.6-.3-1.5-.3-2.1 0Zm4 4.6c-.7.4-1 .9-1 2.4V16h1.7v-6.7c-.2 0-.5.2-.7.3Z"
        /></svg
      >
    </div>
    <div class="integ-info">
      <b>Wix</b>
      <span class="muted small"
        >{#if data.wix?.connected}sito <code>{data.wix.siteId}</code>{:else}Non connesso — apri il menu ⋮ per
          configurare{/if}</span
      >
    </div>
    <form method="POST" action="?/toggleWix" use:enhance={withBusy('wix-toggle')} class="switch-form">
      <label class="switch" class:disabled={!data.wix?.connected}>
        <input
          type="checkbox"
          name="active"
          value="true"
          checked={data.wix?.active}
          disabled={isBusy('wix-toggle') || !data.wix?.connected}
          onchange={(e) => e.currentTarget.form?.requestSubmit()}
        />
        <span class="track"><span class="thumb"></span></span>
      </label>
    </form>
    <button
      type="button"
      class="dots"
      title="Configura"
      aria-label="Configura Wix"
      onclick={() => wixDialog?.showModal()}>⋮</button
    >
  </div>
  </div>
</section>

<dialog
  bind:this={shopifyDialog}
  class="integ-dialog"
  onclick={(e) => {
    if (e.target === shopifyDialog) shopifyDialog?.close();
  }}
>
  <div class="dlg-inner">
    <header class="dlg-head">
      <h3>Configura Shopify</h3>
      <button type="button" class="dlg-x" aria-label="Chiudi" onclick={() => shopifyDialog?.close()}
        >✕</button
      >
    </header>
    <p class="muted small">
      Crea una custom app con scope <code>read_content</code> e <code>write_content</code>.
      <a href="/docs/shopify" target="_blank" rel="noopener noreferrer">Guida →</a>
    </p>
    <form method="POST" action="?/connectShopify" use:enhance={withClose('shopify-connect')} class="dlg-form">
      <label
        >Nome store
        <input
          type="text"
          name="store"
          value={data.shopify?.store ?? ''}
          placeholder="es. na70yq-bn"
          disabled={isBusy('shopify-connect')}
        />
      </label>
      <label
        >Client ID
        <input type="text" name="client_id" placeholder="Client ID" disabled={isBusy('shopify-connect')} />
      </label>
      <label
        >Client secret
        <input
          type="password"
          name="client_secret"
          placeholder="Client secret"
          disabled={isBusy('shopify-connect')}
        />
      </label>
      <button
        class="btn primary"
        class:loading={isBusy('shopify-connect')}
        type="submit"
        disabled={isBusy('shopify-connect')}
        >{data.shopify?.connected ? 'Aggiorna credenziali' : 'Connetti'}</button
      >
    </form>
    {#if data.shopify?.connected}
      <hr />
      <form method="POST" action="?/saveShopifyBlog" use:enhance={withClose('shopify-save')} class="dlg-form">
        <label
          >Blog di destinazione
          <select name="blog_id" disabled={isBusy('shopify-save') || !data.shopify.blogs.length}>
            {#if !data.shopify.blogs.length}<option value="">Nessun blog trovato</option>{/if}
            {#each data.shopify.blogs as b}
              <option value={b.id} selected={data.shopify.blogId === b.id}>{b.title}</option>
            {/each}
          </select>
        </label>
        <label
          >Autore
          <input
            type="text"
            name="author"
            value={data.shopify.author}
            placeholder="Nome autore"
            disabled={isBusy('shopify-save')}
          />
        </label>
        <label class="chk">
          <input
            type="checkbox"
            name="publish_immediately"
            value="true"
            checked={data.shopify.publishImmediately}
            disabled={isBusy('shopify-save')}
          />
          Pubblica subito
        </label>
        <button
          class="btn primary"
          class:loading={isBusy('shopify-save')}
          type="submit"
          disabled={isBusy('shopify-save')}>Salva</button
        >
      </form>
      <form
        method="POST"
        action="?/disconnectShopify"
        use:enhance={withClose('shopify-disconnect')}
        class="dlg-form"
      >
        <button class="btn-link danger" type="submit" disabled={isBusy('shopify-disconnect')}
          >Scollega Shopify</button
        >
      </form>
    {/if}
  </div>
</dialog>

<dialog
  bind:this={webflowDialog}
  class="integ-dialog"
  onclick={(e) => {
    if (e.target === webflowDialog) webflowDialog?.close();
  }}
>
  <div class="dlg-inner">
    <header class="dlg-head">
      <h3>Configura Webflow</h3>
      <button type="button" class="dlg-x" aria-label="Chiudi" onclick={() => webflowDialog?.close()}
        >✕</button
      >
    </header>
    <p class="muted small">
      Genera un API token con <code>CMS: Read &amp; Write</code>.
      <a href="/docs/webflow" target="_blank" rel="noopener noreferrer">Guida →</a>
    </p>
    <form
      method="POST"
      action="?/connectWebflow"
      use:enhance={withClose('webflow-connect', () => webflowDialog)}
      class="dlg-form"
    >
      <label
        >API token
        <input
          type="password"
          name="token"
          placeholder="Site API token"
          disabled={isBusy('webflow-connect')}
        />
      </label>
      <button
        class="btn primary"
        class:loading={isBusy('webflow-connect')}
        type="submit"
        disabled={isBusy('webflow-connect')}
        >{data.webflow?.connected ? 'Aggiorna token' : 'Connetti'}</button
      >
    </form>
    {#if data.webflow?.connected}
      <hr />
      <form
        method="POST"
        action="?/saveWebflowCollection"
        use:enhance={withClose('webflow-save', () => webflowDialog)}
        class="dlg-form"
      >
        <label
          >Collection CMS
          <select
            name="collection_id"
            disabled={isBusy('webflow-save') || !data.webflow.collections.length}
          >
            {#if !data.webflow.collections.length}<option value="">Nessuna collection</option>{/if}
            {#each data.webflow.collections as c}
              <option value={c.id} selected={data.webflow.collectionId === c.id}>{c.name}</option>
            {/each}
          </select>
        </label>
        <label class="chk">
          <input
            type="checkbox"
            name="publish_immediately"
            value="true"
            checked={data.webflow.publishImmediately}
            disabled={isBusy('webflow-save')}
          />
          Pubblica subito
        </label>
        <button
          class="btn primary"
          class:loading={isBusy('webflow-save')}
          type="submit"
          disabled={isBusy('webflow-save')}>Salva</button
        >
      </form>
      <form
        method="POST"
        action="?/disconnectWebflow"
        use:enhance={withClose('webflow-disconnect', () => webflowDialog)}
        class="dlg-form"
      >
        <button class="btn-link danger" type="submit" disabled={isBusy('webflow-disconnect')}
          >Scollega Webflow</button
        >
      </form>
    {/if}
  </div>
</dialog>

<dialog
  bind:this={wixDialog}
  class="integ-dialog"
  onclick={(e) => {
    if (e.target === wixDialog) wixDialog?.close();
  }}
>
  <div class="dlg-inner">
    <header class="dlg-head">
      <h3>Configura Wix</h3>
      <button type="button" class="dlg-x" aria-label="Chiudi" onclick={() => wixDialog?.close()}>✕</button>
    </header>
    <p class="muted small">
      Aggiungi l'app Blog e genera un API key.
      <a href="/docs/wix" target="_blank" rel="noopener noreferrer">Guida →</a>
    </p>
    <form
      method="POST"
      action="?/connectWix"
      use:enhance={withClose('wix-connect', () => wixDialog)}
      class="dlg-form"
    >
      <label
        >Site ID
        <input
          type="text"
          name="site_id"
          value={data.wix?.siteId ?? ''}
          placeholder="dopo /dashboard/"
          disabled={isBusy('wix-connect')}
        />
      </label>
      <label
        >API key
        <input type="password" name="api_key" placeholder="API key" disabled={isBusy('wix-connect')} />
      </label>
      <button
        class="btn primary"
        class:loading={isBusy('wix-connect')}
        type="submit"
        disabled={isBusy('wix-connect')}
        >{data.wix?.connected ? 'Aggiorna credenziali' : 'Connetti'}</button
      >
    </form>
    {#if data.wix?.connected}
      <hr />
      <form
        method="POST"
        action="?/saveWix"
        use:enhance={withClose('wix-save', () => wixDialog)}
        class="dlg-form"
      >
        <label class="chk">
          <input
            type="checkbox"
            name="publish_immediately"
            value="true"
            checked={data.wix.publishImmediately}
            disabled={isBusy('wix-save')}
          />
          Pubblica subito
        </label>
        <button
          class="btn primary"
          class:loading={isBusy('wix-save')}
          type="submit"
          disabled={isBusy('wix-save')}>Salva</button
        >
      </form>
      <form
        method="POST"
        action="?/disconnectWix"
        use:enhance={withClose('wix-disconnect', () => wixDialog)}
        class="dlg-form"
      >
        <button class="btn-link danger" type="submit" disabled={isBusy('wix-disconnect')}
          >Scollega Wix</button
        >
      </form>
    {/if}
  </div>
</dialog>

<style>
  .panel-body {
    padding: 18px 22px 22px;
  }
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
  .intro {
    margin: 0 0 8px;
    line-height: 1.45;
  }
  .integ-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 0;
    border-bottom: 1px solid var(--line);
  }
  .integ-row:last-of-type {
    border-bottom: none;
  }
  .integ-mark {
    width: 38px;
    height: 38px;
    border-radius: 9px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .integ-mark.shopify {
    background: #95bf47;
    color: #fff;
  }
  .integ-mark.webflow {
    background: #146ef5;
    color: #fff;
  }
  .integ-mark.wix {
    background: #000;
    color: #fff;
  }
  .integ-mark svg {
    width: 22px;
    height: 22px;
  }
  .integ-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }
  .integ-info b {
    font-size: 14px;
    color: var(--ink);
  }
  .switch-form {
    display: flex;
    margin: 0;
  }
  .switch {
    display: inline-flex;
    cursor: pointer;
  }
  .switch.disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .switch input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  .switch .track {
    width: 40px;
    height: 23px;
    border-radius: 999px;
    background: var(--line);
    position: relative;
    transition: background 0.15s;
  }
  .switch .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 19px;
    height: 19px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    transition: transform 0.15s;
  }
  .switch input:checked + .track {
    background: #22c55e;
  }
  .switch input:checked + .track .thumb {
    transform: translateX(17px);
  }
  .dots {
    background: none;
    border: none;
    font-size: 20px;
    line-height: 1;
    color: var(--ink-faint);
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 8px;
  }
  .dots:hover {
    background: var(--paper-2);
    color: var(--ink);
  }
  .integ-dialog {
    border: none;
    border-radius: 16px;
    padding: 0;
    max-width: 440px;
    width: calc(100% - 32px);
    background: var(--paper);
    color: var(--ink);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }
  .integ-dialog::backdrop {
    background: rgba(0, 0, 0, 0.4);
  }
  .dlg-inner {
    padding: 20px 22px 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .dlg-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .dlg-head h3 {
    font-size: 17px;
    font-weight: 600;
    margin: 0;
  }
  .dlg-x {
    background: none;
    border: none;
    font-size: 16px;
    color: var(--ink-faint);
    cursor: pointer;
    padding: 4px;
  }
  .dlg-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0;
  }
  .dlg-form label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .dlg-form input[type='text'],
  .dlg-form input[type='password'],
  .dlg-form select {
    font-size: 14px;
    padding: 9px 11px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
    font-weight: 400;
    font-family: inherit;
  }
  .dlg-form label.chk {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    font-weight: 400;
  }
  .dlg-form label.chk input {
    width: auto;
  }
  .dlg-form .btn {
    align-self: flex-start;
  }
  .integ-dialog hr {
    border: none;
    border-top: 1px solid var(--line);
    margin: 2px 0;
  }
  .btn-link {
    background: none;
    border: none;
    color: var(--ink-faint);
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }
  .btn-link.danger {
    color: #dc2626;
  }
  code {
    background: var(--paper-2);
    padding: 2px 6px;
    border-radius: 6px;
    font-size: 12.5px;
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
    padding: 9px 16px;
    cursor: pointer;
    border: 1px solid transparent;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    background: transparent;
    color: inherit;
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .btn.primary {
    background: var(--accent, #7c5cff);
    color: #fff;
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
    border-color: #fff;
    border-top-color: transparent;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
