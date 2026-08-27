<script lang="ts">
  import PageHead from '$lib/components/PageHead.svelte';
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import type { SubmitFunction } from '@sveltejs/kit';

  let { data, form } = $props();

  // One in-flight action at a time; the label switches to its busy copy (same pattern as /voice).
  let busy = $state('');
  const working = (name: string): SubmitFunction => () => {
    busy = name;
    return async ({ update }) => {
      busy = '';
      await update();
    };
  };

  // Local selection state for the approve form (checkbox per proposed rubric).
  let picked = $state<Record<string, boolean>>({});
  const pickedCount = $derived(Object.values(picked).filter(Boolean).length);

  const FORMATS = ['single_image', 'carousel', 'text_post', 'link_post', 'video'];
</script>

<svelte:head><title>Anomalia — {$_('rubrics.title')}</title></svelte:head>

<div class="content">
  <PageHead title={$_('rubrics.title')} subtitle={$_('rubrics.subtitle')} />

  {#if form?.error === 'propose_failed'}<p class="err">{$_('rubrics.proposeFailed')}</p>{/if}
  {#if form?.error === 'approve_failed'}<p class="err">{$_('rubrics.approveFailed')}</p>{/if}
  {#if form?.error === 'none_selected'}<p class="err">{$_('rubrics.approveNone')}</p>{/if}
  {#if form?.approved}<p class="saved-note">{$_('rubrics.approved')}</p>{/if}

  <!-- Active set: what currently drives the planners -->
  {#if data.approved.length}
    <section class="card">
      <h3 class="card-t">{$_('rubrics.approvedTitle')}</h3>
      <p class="card-s">{$_('rubrics.approvedHint')}</p>
      <div class="rlist">
        {#each data.approved as r (r.id)}
          <article class="rrow">
            <div class="rrow-top">
              <span class="rname">{r.name}</span>
              <span class="rchips">
                <span class="fmt-chip">{$_('rubrics.formats.' + r.format)}</span>
                {#if r.cadence}<span class="cad-chip">{r.cadence}</span>{/if}
              </span>
            </div>
            {#if r.promise}<p class="rpromise">{r.promise}</p>{/if}
            {#if r.strategic_role}<p class="rmeta"><b>{$_('rubrics.fields.role')}:</b> {r.strategic_role}</p>{/if}
            {#if r.differentiation}<p class="rmeta"><b>{$_('rubrics.fields.differentiation')}:</b> {r.differentiation}</p>{/if}
          </article>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Pending proposals: the client edits and approves -->
  {#if data.proposed.length}
    <section class="card">
      <h3 class="card-t">{$_('rubrics.proposedTitle')}</h3>
      <p class="card-s">{$_('rubrics.proposedHint')}</p>
      {#if data.approved.length}<p class="note-warn">{$_('rubrics.replaceWarning')}</p>{/if}

      <form method="POST" action="?/approve" use:enhance={working('approve')}>
        <div class="plist">
          {#each data.proposed as r (r.id)}
            <article class="prop" class:picked={picked[r.id ?? '']}>
              <label class="pick">
                <input type="checkbox" name="pick" value={r.id} bind:checked={picked[r.id ?? '']} />
                <span>{$_('rubrics.select')}</span>
              </label>
              <div class="grid2">
                <label class="field">
                  <span>{$_('rubrics.fields.name')}</span>
                  <input type="text" name={`name_${r.id}`} value={r.name} />
                </label>
                <label class="field">
                  <span>{$_('rubrics.fields.role')}</span>
                  <input type="text" name={`role_${r.id}`} value={r.strategic_role} />
                </label>
                <label class="field">
                  <span>{$_('rubrics.fields.format')}</span>
                  <select name={`format_${r.id}`} value={r.format}>
                    {#each FORMATS as f (f)}<option value={f}>{$_('rubrics.formats.' + f)}</option>{/each}
                  </select>
                </label>
                <label class="field">
                  <span>{$_('rubrics.fields.cadence')}</span>
                  <input type="text" name={`cadence_${r.id}`} value={r.cadence} placeholder="1/week" />
                </label>
                <label class="field wide">
                  <span>{$_('rubrics.fields.promise')}</span>
                  <textarea name={`promise_${r.id}`} rows="2">{r.promise}</textarea>
                </label>
                <label class="field wide">
                  <span>{$_('rubrics.fields.differentiation')}</span>
                  <textarea name={`diff_${r.id}`} rows="2">{r.differentiation}</textarea>
                </label>
              </div>
              {#if r.rationale}
                <p class="rmeta why"><b>{$_('rubrics.fields.rationale')}:</b> {r.rationale}</p>
              {/if}
            </article>
          {/each}
        </div>
        <div class="save-row">
          <button class="btn-primary" disabled={busy !== '' || pickedCount === 0}>
            {busy === 'approve' ? $_('rubrics.approving') : `${$_('rubrics.approve')}${pickedCount ? ` (${pickedCount})` : ''}`}
          </button>
        </div>
      </form>

      <form method="POST" action="?/propose" use:enhance={working('propose')}>
        <button class="btn-ghost" disabled={busy !== ''}>
          {busy === 'propose' ? $_('rubrics.proposing') : $_('rubrics.proposeAgain')}
        </button>
      </form>
    </section>
  {:else if !data.approved.length}
    <!-- Blank slate: nothing proposed, nothing approved -->
    <section class="card empty">
      <p class="muted">{$_('rubrics.empty')}</p>
      <form method="POST" action="?/propose" use:enhance={working('propose')}>
        <button class="btn-primary" disabled={busy !== ''}>
          {busy === 'propose' ? $_('rubrics.proposing') : $_('rubrics.propose')}
        </button>
      </form>
    </section>
  {:else}
    <!-- Active set exists, no pending batch: allow proposing a replacement set -->
    <div class="save-row">
      <form method="POST" action="?/propose" use:enhance={working('propose')}>
        <button class="btn-ghost" disabled={busy !== ''}>
          {busy === 'propose' ? $_('rubrics.proposing') : $_('rubrics.proposeAgain')}
        </button>
      </form>
    </div>
  {/if}
</div>

<style>
  /* Head metrics identical to /voice (the sibling strategy tab). */
  .page-head h2 { margin: 0; }
  .page-sub { margin: 6px 0 0; color: var(--ink-soft, #6e6e73); font-size: 14px; }

  /* Box metrics identical to /voice's .card (which mirrors the Analytics .panel/.panel-head). */
  .card { border: 1px solid var(--line, #e3e3e6); border-radius: 20px; padding: 18px 22px; background: var(--paper, #fff); margin-top: 16px; }
  .card-t { margin: -18px -22px 0; padding: 18px 22px 0; font-size: 15.5px; font-weight: 700; letter-spacing: -0.03em; }
  .card-s { margin: 4px -22px 18px; font-size: 13px; color: var(--ink-soft, #6e6e73);
    padding: 0 22px 16px; border-bottom: 1px solid var(--line, #e3e3e6); }

  /* Approved rubric rows: the .post-row/.acct rhythm (divider rows inside a panel). */
  .rlist { margin: 0 -22px -18px; }
  .rrow { padding: 16px 22px; border-bottom: 1px solid var(--line, #e3e3e6); }
  .rrow:last-child { border-bottom: none; }
  .rrow-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .rname { font-size: 14.5px; font-weight: 600; }
  .rchips { display: inline-flex; gap: 6px; }
  .fmt-chip { font-size: 12px; font-weight: 600; padding: 5px 11px; border-radius: 980px;
    background: rgba(var(--accent-rgb), 0.09); color: var(--accent, #7c5cff); }
  .cad-chip { font-size: 12px; font-weight: 500; padding: 5px 11px; border-radius: 980px;
    background: var(--paper-2, #f9f9f9); border: 1px solid var(--line, #e3e3e6); color: var(--ink-soft, #6e6e73); }
  .rpromise { margin: 6px 0 0; font-size: 13.5px; line-height: 1.45; }
  .rmeta { margin: 4px 0 0; font-size: 12.5px; color: var(--ink-soft, #6e6e73); line-height: 1.45; }

  /* Proposal cards: inner bordered blocks; selection highlight = the .price-card.sel treatment. */
  .plist { display: flex; flex-direction: column; gap: 14px; }
  .prop { border: 1px solid var(--line, #e3e3e6); border-radius: 14px; padding: 16px 18px;
    transition: border-color .25s var(--ease), box-shadow .25s var(--ease); }
  .prop.picked { border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.14); }
  .pick { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600;
    color: var(--ink-soft, #6e6e73); margin: 0 0 12px; cursor: pointer; user-select: none; }
  .pick input { accent-color: var(--accent, #7c5cff); width: 15px; height: 15px; }
  .prop.picked .pick { color: var(--accent, #7c5cff); }
  .why { margin-top: 12px; }

  /* Field metrics identical to /voice's .field/.grid2. */
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 22px; }
  .field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
  .field.wide { grid-column: 1 / -1; }
  .field > span { font-size: 12.5px; font-weight: 600; color: var(--ink-soft, #6e6e73); }
  .field input[type='text'], .field textarea, .field select { font-size: 14px; padding: 10px 12px; border-radius: 10px;
    border: 1px solid var(--line-2, #d2d2d7); font-family: inherit; line-height: 1.5; color: var(--ink, #1d1d1f);
    background: var(--paper, #fff); resize: vertical; box-sizing: border-box; width: 100%; }
  .field input:focus, .field textarea:focus, .field select:focus { outline: none; border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1); }

  /* Buttons: /voice's pill .btn-primary + the global .btn-ghost look at the same metrics. */
  .save-row { display: flex; align-items: center; gap: 12px; margin-top: 18px; }
  .btn-primary { background: var(--ink, #1d1d1f); color: #fff; border: none; border-radius: 980px;
    padding: 12px 22px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .btn-primary:disabled { opacity: 0.4; cursor: default; }
  .btn-ghost { background: var(--paper, #fff); color: var(--ink, #1d1d1f); border: 1px solid var(--line-2, #d2d2d7);
    border-radius: 980px; padding: 12px 22px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 14px; }
  .btn-ghost:hover { background: var(--paper-2, #f9f9f9); }
  .btn-ghost:disabled { opacity: 0.4; cursor: default; }

  /* Notes: /voice's .saved-note/.err + the trial-banner amber for the replace warning. */
  .saved-note { font-size: 13px; color: var(--accent, #7c5cff); font-weight: 600; margin: 12px 0 0; }
  .err { color: #c0392b; font-size: 13.5px; margin: 12px 0 0; }
  .note-warn { background: #fff3d6; border: 1px solid #f0d79a; color: #8a6d12; border-radius: 14px;
    padding: 12px 18px; font-size: 13.5px; margin: 0 0 16px; }
  .muted { color: var(--ink-soft, #6e6e73); font-size: 13.5px; }

  .empty { text-align: center; padding: 40px 22px; }
  .empty p { margin: 0 0 16px; }

  @container workbench (max-width: 700px) { .grid2 { grid-template-columns: 1fr; } }

  /* Dark mode parity with /voice (variables do most of it; amber note needs the override). */
  :global([data-theme='dark']) .note-warn { background: rgba(163, 112, 10, 0.12); border-color: rgba(163, 112, 10, 0.25); color: #fbbf24; }
</style>
