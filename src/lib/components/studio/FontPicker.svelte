<script lang="ts">
  /**
   * Font picker that shows each face in its own face.
   *
   * The old control was `<input list>` + `<datalist>`: the browser draws those options in the UI
   * font, so picking typography meant reading twenty-six names and remembering what each one looks
   * like. Worse, the input previewed the CHOSEN value in its own family — but nothing ever loaded
   * that family, so the preview was the system font wearing a different name.
   *
   * Here the shortlist is grouped the way it is defined (sans / serif / display / mono) and every
   * option is rendered in the family it names. The categories are the point: the brief reads the
   * display slot as "the headline face", and a serif landing there by accident is exactly how a
   * kinetic ad ends up with serif headlines nobody asked for.
   *
   * Free text still works — anything typed that is not in the list stays as the value, same as the
   * datalist allowed.
   */
  import { FONT_SHORTLIST } from '$lib/design/typography';
  import { ensureFontPreviews } from '$lib/design/font-preview';

  type Props = {
    name: string;
    value: string;
    placeholder?: string;
    onchange?: (value: string) => void;
  };
  let { name, value = $bindable(), placeholder = 'Inter', onchange }: Props = $props();

  const GROUPS = [
    { key: 'sans', fonts: FONT_SHORTLIST.sans },
    { key: 'serif', fonts: FONT_SHORTLIST.serif },
    { key: 'display', fonts: FONT_SHORTLIST.display },
    { key: 'mono', fonts: FONT_SHORTLIST.mono }
  ] as const;

  let open = $state(false);
  let query = $state('');
  let root: HTMLDivElement | null = $state(null);

  const matches = (font: string) => font.toLowerCase().includes(query.trim().toLowerCase());
  const visible = $derived(
    GROUPS.map((g) => ({ ...g, fonts: g.fonts.filter(matches) })).filter((g) => g.fonts.length > 0)
  );

  function openPanel() {
    open = true;
    query = '';
    // Loaded on first open, never on page load: previews are worth a request only once someone
    // actually looks at them.
    void ensureFontPreviews();
  }

  function pick(font: string) {
    value = font;
    open = false;
    onchange?.(font);
  }

  function commitTyped() {
    const typed = query.trim();
    if (typed) pick(typed);
    else open = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      open = false;
      e.stopPropagation();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const first = visible[0]?.fonts[0];
      if (first) pick(first);
      else commitTyped();
    }
  }

  $effect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  });
</script>

<div class="fp" bind:this={root}>
  <input type="hidden" {name} {value} />
  <button
    type="button"
    class="fp-trigger"
    aria-haspopup="listbox"
    aria-expanded={open}
    onclick={() => (open ? (open = false) : openPanel())}
    style="font-family:'{value || placeholder}', system-ui;"
  >
    <span class="fp-value">{value || placeholder}</span>
    <span class="fp-caret" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="fp-panel" role="listbox" tabindex="-1">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="fp-search"
        type="text"
        autofocus
        placeholder={placeholder}
        bind:value={query}
        onkeydown={onKey}
      />
      <div class="fp-list">
        {#each visible as group (group.key)}
          <div class="fp-group">{group.key}</div>
          {#each group.fonts as font (font)}
            <button
              type="button"
              role="option"
              aria-selected={font === value}
              class="fp-option"
              class:sel={font === value}
              style="font-family:'{font}', system-ui;"
              onclick={() => pick(font)}
            >
              {font}
            </button>
          {/each}
        {/each}
        {#if !visible.length}
          <button type="button" class="fp-option fp-custom" onclick={commitTyped}>
            {query.trim() ? `Usa “${query.trim()}”` : '—'}
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .fp { position: relative; }
  .fp-trigger {
    width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 8px 10px; border: 1px solid var(--line, #e3e3e3); border-radius: 10px;
    background: var(--card, #fff); color: inherit; font-size: 15px; cursor: pointer; text-align: left;
  }
  .fp-trigger:hover { border-color: var(--ink, #111); }
  .fp-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fp-caret { opacity: 0.5; font-size: 11px; }
  .fp-panel {
    position: absolute; z-index: 40; top: calc(100% + 4px); left: 0; right: 0;
    background: var(--card, #fff); border: 1px solid var(--line, #e3e3e3); border-radius: 12px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12); padding: 8px; max-height: 320px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .fp-search {
    width: 100%; padding: 7px 9px; border: 1px solid var(--line, #e3e3e3);
    border-radius: 8px; font-size: 13px; font: inherit; font-size: 13px;
  }
  .fp-list { overflow-y: auto; display: flex; flex-direction: column; }
  .fp-group {
    font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
    opacity: 0.45; padding: 8px 8px 4px;
  }
  .fp-option {
    display: block; width: 100%; text-align: left; padding: 7px 9px; border: 0;
    background: transparent; color: inherit; font-size: 16px; border-radius: 8px; cursor: pointer;
  }
  .fp-option:hover { background: var(--hover, rgba(0, 0, 0, 0.05)); }
  .fp-option.sel { background: var(--hover, rgba(0, 0, 0, 0.07)); font-weight: 600; }
  .fp-custom { font-size: 13px; opacity: 0.8; }
</style>
