<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { enhance, applyAction, deserialize } from '$app/forms';
  import { goto } from '$app/navigation';
  import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
  import { createSupabaseBrowserClient } from '$lib/supabase/client';
  import { MAX_KNOWLEDGE_FILE_BYTES } from '$lib/chat-documents';
  import { ArrowLeft } from '@lucide/svelte';

  let { data, form } = $props();
  const brand = $derived((data as { brand?: { id: string; slug: string } }).brand);
  const session = $derived((data as { session?: { user?: { id: string } } }).session);
  const brandSlug = $derived(brand?.slug ?? $page.params.brand ?? '');
  const brandId = $derived(brand?.id ?? '');
  const userId = $derived(session?.user?.id ?? '');

  let busy = $state(false);
  let uploadError = $state('');
  let addTab = $state<'files' | 'url' | 'text'>('files');

  const withBusy: SubmitFunction = () => {
    busy = true;
    return async ({ result }) => {
      busy = false;
      await applyAction(result);
      if (result.type === 'redirect') await goto(result.location);
    };
  };

  const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const supabase = createSupabaseBrowserClient();

  async function handleUpload(event: SubmitEvent) {
    event.preventDefault();
    const formEl = event.currentTarget as HTMLFormElement;
    const input = formEl.querySelector('input[type=file]') as HTMLInputElement | null;
    const files = input?.files ? [...input.files] : [];
    if (!files.length) return;
    uploadError = '';
    busy = true;
    try {
      const fd = new FormData();
      for (const file of files) {
        if (file.size > MAX_KNOWLEDGE_FILE_BYTES) {
          throw new Error($_('app.knowledge.tooLarge'));
        }
        const path = `${userId}/${brandId}/${crypto.randomUUID()}-${safeName(file.name)}`;
        const up = await supabase.storage
          .from('brand-knowledge')
          .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
        if (up.error) throw new Error(up.error.message);
        fd.append('path', path);
        fd.append('file_name', file.name);
        fd.append('mime_type', file.type);
        fd.append('bytes', String(file.size));
      }
      const res = await fetch('?/uploadDocument', { method: 'POST', body: fd });
      const result: ActionResult = deserialize(await res.text());
      if (result.type === 'failure') {
        uploadError = (result.data?.error as string) ?? 'Upload failed';
      } else if (result.type === 'redirect') {
        await goto(result.location);
      } else {
        await goto(`/app/${brandSlug}/knowledge`);
      }
      applyAction(result);
    } catch (e) {
      uploadError = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Anomalia — {$_('app.knowledge.newDocTitle')}</title>
</svelte:head>

<div class="content knowledge-new">
  <a class="back" href={`/app/${brandSlug}/knowledge`}>
    <ArrowLeft size={16} strokeWidth={2} />
    {$_('app.knowledge.backToKnowledge')}
  </a>

  <header class="head">
    <h2>{$_('app.knowledge.newDocTitle')}</h2>
    <p class="muted">{$_('app.knowledge.newDocDesc')}</p>
  </header>

  {#if form?.error}
    <p class="banner err">{form.error}</p>
  {/if}

  <div class="subtabs" role="tablist">
    <button type="button" class="subtab" class:active={addTab === 'files'} onclick={() => (addTab = 'files')}>
      {$_('app.knowledge.tabFiles')}
    </button>
    <button type="button" class="subtab" class:active={addTab === 'url'} onclick={() => (addTab = 'url')}>
      {$_('app.knowledge.tabUrl')}
    </button>
    <button type="button" class="subtab" class:active={addTab === 'text'} onclick={() => (addTab = 'text')}>
      {$_('app.knowledge.tabNote')}
    </button>
  </div>

  {#if addTab === 'files'}
    <form class="stack" method="POST" action="?/uploadDocument" enctype="multipart/form-data" onsubmit={handleUpload}>
      <label class="dropzone">
        <input type="file" multiple accept=".pdf,.txt,.md,.csv,.html,.docx,.xlsx,.xls,.xml,.ipynb,text/plain,text/markdown,text/csv,text/html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
        <span>{$_('app.knowledge.dropHint')}</span>
      </label>
      {#if uploadError}<p class="banner err">{uploadError}</p>{/if}
      <button class="btn primary" type="submit" disabled={busy}>
        {busy ? $_('app.knowledge.uploading') : $_('app.knowledge.upload')}
      </button>
    </form>
  {:else if addTab === 'url'}
    <form class="stack" method="POST" action="?/addUrl" use:enhance={withBusy}>
      <label class="field">
        <span>{$_('app.knowledge.urlLabel')}</span>
        <input name="url" type="url" required placeholder="https://…" />
      </label>
      <label class="field">
        <span>{$_('app.knowledge.titleOptional')}</span>
        <input name="title" type="text" />
      </label>
      <button class="btn primary" type="submit" disabled={busy}>{$_('app.knowledge.addUrl')}</button>
    </form>
  {:else}
    <form class="stack" method="POST" action="?/addNote" use:enhance={withBusy}>
      <label class="field">
        <span>{$_('app.knowledge.titleOptional')}</span>
        <input name="title" type="text" />
      </label>
      <label class="field">
        <span>{$_('app.knowledge.noteLabel')}</span>
        <textarea name="content_text" rows="10" required placeholder={$_('app.knowledge.notePlaceholder')}></textarea>
      </label>
      <button class="btn primary" type="submit" disabled={busy}>{$_('app.knowledge.addNote')}</button>
    </form>
  {/if}
</div>

<style>
  .knowledge-new { max-width: 560px; }
  .back {
    display: inline-flex; align-items: center; gap: 6px;
    color: var(--ink-soft); text-decoration: none; font-size: 13px; font-weight: 600; margin-bottom: 16px;
  }
  .back:hover { color: var(--ink); }
  .head h2 { margin: 0 0 4px; }
  .muted { color: var(--ink-soft); font-size: 13px; margin: 0 0 20px; }
  .subtabs {
    display: inline-flex; gap: 2px; padding: 3px; margin-bottom: 14px; flex-wrap: wrap;
    border: 1px solid var(--line); border-radius: 10px; background: var(--paper-2);
  }
  .subtab {
    border: none; background: transparent; border-radius: 8px;
    padding: 7px 12px; font-size: 12px; font-weight: 600; cursor: pointer; color: var(--ink-soft);
  }
  .subtab.active {
    background: var(--paper); color: var(--ink);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }
  .stack { display: flex; flex-direction: column; gap: 12px; }
  .field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: var(--ink-soft); }
  .field input, .field textarea, .stack input, .stack textarea {
    border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px;
    background: var(--paper); color: var(--ink); font: inherit; font-weight: 400;
  }
  .dropzone {
    border: 1px dashed var(--line); border-radius: 14px; padding: 40px 20px; text-align: center;
    background: var(--paper-2); cursor: pointer; display: block; font-size: 14px; color: var(--ink-soft);
  }
  .dropzone input { display: none; }
  .banner.err { color: #a11; font-size: 13px; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    font-size: 13px; font-weight: 600; line-height: 1.2; border-radius: 10px;
    padding: 10px 16px; cursor: pointer; border: 1px solid transparent; font-family: inherit;
  }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn.primary { background: var(--invert-surface, #1d1d1f); color: #fff; border-color: var(--invert-surface, #1d1d1f); }
  :global(:root[data-theme='dark']) .btn.primary {
    background: var(--accent, #c485fe);
    color: #0a0a0a;
    border-color: var(--accent, #c485fe);
  }
</style>
