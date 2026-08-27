<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import type { Snippet } from 'svelte';

  // Reusable "old versions" history, shared by the Strategia (GTM) and the editorial-plan pages.
  // Every regeneration supersedes the previous active version (status 'superseded') instead of
  // deleting it — this surfaces that trail behind a toggle, read-only. Each row expands to its
  // full detail, rendered by the page via the `detail` snippet (phases / editorial cards).
  type V = {
    id: string;
    activated_at?: string | null;
    created_at?: string | null;
    source?: string | null;
    changes_summary?: string[] | null;
  };
  // `deleteAction` (optional): a form action (e.g. '?/deleteVersion') that hard-deletes a version
  // by id. When set, each row shows a trash → confirm.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { versions, detail, deleteAction }: { versions: V[]; detail: Snippet<[any]>; deleteAction?: string } = $props();

  let open = $state(false);
  let expanded = $state<string | null>(null);
  let delId = $state<string | null>(null);

  const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const when = (v: V) => {
    const d = v.activated_at ?? v.created_at;
    return d ? fmt.format(new Date(d)) : '';
  };
  const SOURCE_KEY: Record<string, string> = {
    manual: 'manual', revision: 'revision', phase_review: 'phaseReview', analysis: 'analysis'
  };
  const sourceLabel = (s?: string | null) => {
    const k = SOURCE_KEY[s ?? ''];
    return k ? $_('history.source.' + k) : (s ?? '');
  };
</script>

{#if versions.length}
  <section class="hist">
    <button type="button" class="hist-toggle" onclick={() => (open = !open)} aria-expanded={open}>
      <span class="caret" class:open>▸</span>
      {$_('history.title', { values: { n: versions.length } })}
    </button>

    {#if open}
      <ul class="hist-list">
        {#each versions as v (v.id)}
          <li class="hist-item">
            <div class="hist-row">
              <button
                type="button"
                class="hist-head"
                aria-expanded={expanded === v.id}
                onclick={() => (expanded = expanded === v.id ? null : v.id)}
              >
                <span class="hi-when">{when(v)}</span>
                {#if v.source}<span class="hi-src">{sourceLabel(v.source)}</span>{/if}
                {#if v.changes_summary?.length}<span class="hi-sum">{v.changes_summary[0]}</span>{/if}
                <span class="hi-caret" class:open={expanded === v.id} aria-hidden="true">▾</span>
              </button>
              {#if deleteAction}
                {#if delId === v.id}
                  <form method="POST" action={deleteAction} use:enhance={() => async ({ update }) => { await update(); delId = null; }}>
                    <input type="hidden" name="id" value={v.id} />
                    <button type="submit" class="hi-del confirm">{$_('history.confirmDelete')}</button>
                  </form>
                  <button type="button" class="hi-del cancel" onclick={() => (delId = null)} aria-label={$_('history.cancel')}>×</button>
                {:else}
                  <button type="button" class="hi-del" onclick={() => (delId = v.id)} aria-label={$_('history.delete')} title={$_('history.delete')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  </button>
                {/if}
              {/if}
            </div>
            {#if expanded === v.id}
              <div class="hist-detail">{@render detail(v)}</div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .hist { margin-top: 22px; }
  .hist-toggle {
    display: inline-flex; align-items: center; gap: 9px; background: none; border: none; cursor: pointer;
    font: inherit; font-size: 14px; font-weight: 600; color: var(--ink-soft); padding: 8px 0;
  }
  .hist-toggle:hover { color: var(--ink); }
  .caret { font-size: 11px; color: var(--ink-faint); transition: transform 0.15s ease; }
  .caret.open { transform: rotate(90deg); }

  .hist-list { list-style: none; margin: 8px 0 0; padding: 0; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .hist-item { border-top: 1px solid var(--line); }
  .hist-item:first-child { border-top: none; }
  .hist-row { display: flex; align-items: center; padding-right: 8px; gap: 4px; }
  .hist-row form { margin: 0; display: inline-flex; }
  .hist-head {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; background: none; border: none; cursor: pointer;
    font: inherit; text-align: left; padding: 13px 16px; color: var(--ink);
  }
  .hist-head:hover { background: var(--paper-2); }
  /* trash → confirm: small, centered, on-brand (no full-height red block). */
  .hi-del {
    flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; background: none; border: none;
    cursor: pointer; color: var(--ink-faint); padding: 8px; font: inherit; line-height: 1; border-radius: 9px;
  }
  .hi-del svg { width: 16px; height: 16px; }
  .hi-del:hover { color: #c0392b; background: var(--paper-2); }
  .hi-del.confirm {
    background: #c0392b; color: #fff; font-size: 12.5px; font-weight: 600; border-radius: 999px; padding: 6px 14px;
  }
  .hi-del.confirm:hover { background: #a93226; color: #fff; }
  .hi-del.cancel { font-size: 16px; color: var(--ink-faint); padding: 6px 9px; }
  .hi-del.cancel:hover { color: var(--ink); background: var(--paper-2); }
  .hi-when { font-size: 13px; font-weight: 700; white-space: nowrap; }
  .hi-src {
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: var(--accent);
    background: rgba(var(--accent-rgb), 0.1); border-radius: 999px; padding: 3px 9px; white-space: nowrap;
  }
  .hi-sum { font-size: 13px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
  .hi-caret { margin-left: auto; color: var(--ink-faint); font-size: 12px; transition: transform 0.15s ease; }
  .hi-caret.open { transform: rotate(180deg); }
  .hist-detail { padding: 4px 16px 18px; background: var(--paper-2); }
</style>
