<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { enhance, applyAction } from '$app/forms';
  import { goto } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { ArrowLeft } from '@lucide/svelte';

  let { data, form } = $props();
  const brand = $derived((data as { brand?: { slug: string } }).brand);
  const brandSlug = $derived(brand?.slug ?? $page.params.brand ?? '');

  let busy = $state(false);

  const CATEGORIES = [
    { id: 'fact', labelKey: 'fact' },
    { id: 'constraint', labelKey: 'constraint' },
    { id: 'preference', labelKey: 'preference' },
    { id: 'voice', labelKey: 'voice' },
    { id: 'insight', labelKey: 'insight' },
    { id: 'skill', labelKey: 'skill' }
  ] as const;

  // A skill is a procedure, not a fact: the first line is the trigger the AI matches on, the rest
  // are the steps it follows. Same form, different shape of value — so just swap the hints.
  let category = $state('fact');
  const isSkill = $derived(category === 'skill');

  const withBusy: SubmitFunction = () => {
    busy = true;
    return async ({ result }) => {
      busy = false;
      await applyAction(result);
      if (result.type === 'redirect') await goto(result.location);
    };
  };
</script>

<svelte:head>
  <title>Anomalia — {$_('app.knowledge.newMemoryTitle')}</title>
</svelte:head>

<div class="content knowledge-new">
  <a class="back" href={`/app/${brandSlug}/knowledge`}>
    <ArrowLeft size={16} strokeWidth={2} />
    {$_('app.knowledge.backToKnowledge')}
  </a>

  <section class="panel">
    <header class="panel-head">
      <h2>{$_('app.knowledge.newMemoryTitle')}</h2>
      <p class="muted">{$_('app.knowledge.newMemoryDesc')}</p>
    </header>

    {#if form?.error}
      <p class="banner err">{form.error}</p>
    {/if}

    <form class="form" method="POST" use:enhance={withBusy}>
      <div class="field">
        <label for="mem-value">{$_('app.knowledge.memValue')}</label>
        <p class="hint">{$_(isSkill ? 'app.knowledge.memSkillHint' : 'app.knowledge.memValueHint')}</p>
        <textarea
          id="mem-value"
          name="value"
          rows={isSkill ? 10 : 5}
          required
          placeholder={$_(
            isSkill ? 'app.knowledge.memSkillPlaceholder' : 'app.knowledge.memValuePlaceholder'
          )}
        ></textarea>
      </div>

      <div class="row">
        <div class="field">
          <label for="mem-key">{$_('app.knowledge.memKey')}</label>
          <p class="hint">{$_('app.knowledge.memKeyHint')}</p>
          <input id="mem-key" name="key" required placeholder={$_('app.knowledge.memKeyPlaceholder')} />
        </div>

        <div class="field">
          <label for="mem-category">{$_('app.knowledge.memCategory')}</label>
          <p class="hint">{$_('app.knowledge.memCategoryHint')}</p>
          <select id="mem-category" name="category" bind:value={category}>
            {#each CATEGORIES as cat}
              <option value={cat.id}>{cat.labelKey}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="actions">
        <a class="btn ghost" href={`/app/${brandSlug}/knowledge`}>{$_('app.knowledge.backToKnowledge')}</a>
        <button class="btn primary" type="submit" disabled={busy}>{$_('app.knowledge.addMemory')}</button>
      </div>
    </form>
  </section>
</div>

<style>
  .knowledge-new { max-width: 560px; }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--ink-soft);
    text-decoration: none;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 16px;
  }
  .back:hover { color: var(--ink); }

  .panel {
    border: 1px solid var(--line, #e5e5e8);
    border-radius: 14px;
    background: var(--paper, #fff);
    padding: 22px;
  }
  .panel-head {
    padding-bottom: 16px;
    margin-bottom: 18px;
    border-bottom: 1px solid var(--line, #e5e5e8);
  }
  .panel-head h2 {
    margin: 0 0 6px;
    font-size: 1.2rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--ink);
  }
  .muted {
    margin: 0;
    color: var(--ink-soft);
    font-size: 13px;
    line-height: 1.45;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .row {
    display: grid;
    grid-template-columns: 1.2fr 0.8fr;
    gap: 14px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .field label {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--ink);
  }
  .hint {
    margin: 0;
    font-size: 12px;
    line-height: 1.35;
    color: var(--ink-soft);
    font-weight: 400;
  }
  .field input,
  .field textarea,
  .field select {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 12px;
    background: var(--paper-2, #f5f5f7);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
    font-weight: 400;
    box-sizing: border-box;
    width: 100%;
  }
  .field textarea {
    resize: vertical;
    min-height: 120px;
    line-height: 1.45;
  }
  .field input:focus,
  .field textarea:focus,
  .field select:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--ink) 35%, var(--line));
    background: var(--paper, #fff);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    flex-wrap: wrap;
    padding-top: 6px;
    border-top: 1px solid var(--line, #e5e5e8);
    margin-top: 4px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
    border-radius: 10px;
    padding: 10px 16px;
    cursor: pointer;
    border: 1px solid transparent;
    font-family: inherit;
    text-decoration: none;
  }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn.primary {
    background: var(--invert-surface, #1d1d1f);
    color: #fff;
    border-color: var(--invert-surface, #1d1d1f);
  }
  .btn.ghost {
    background: var(--paper, #fff);
    color: var(--ink);
    border-color: var(--line);
  }
  .btn.ghost:hover { background: var(--paper-2); }
  :global(:root[data-theme='dark']) .btn.primary {
    background: var(--accent, #c485fe);
    color: #0a0a0a;
    border-color: var(--accent, #c485fe);
  }
  .banner.err {
    color: #a11;
    font-size: 13px;
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, #a11 8%, var(--paper));
    border: 1px solid color-mix(in srgb, #a11 22%, var(--line));
  }

  @media (max-width: 560px) {
    .panel { padding: 16px; }
    .row { grid-template-columns: 1fr; }
    .actions { justify-content: stretch; }
    .actions .btn { flex: 1; }
  }
</style>
