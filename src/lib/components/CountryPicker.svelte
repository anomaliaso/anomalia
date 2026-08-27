<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { countryOptions, parseCountries } from '$lib/countries';

  // `value` stays the comma-separated "IT, US" string the form actions already parse, so this is a
  // drop-in for the text input it replaces — no server change.
  let {
    name,
    value = $bindable(''),
    placeholder = ''
  }: { name: string; value?: string; placeholder?: string } = $props();

  let query = $state('');
  let open = $state(false);
  let box = $state<HTMLDivElement | null>(null);

  const selected = $derived(parseCountries(value));
  const all = $derived(countryOptions($locale ?? 'en'));
  const chips = $derived(selected.map((c) => all.find((o) => o.code === c) ?? { code: c, name: c, flag: '' }));
  const results = $derived(
    all
      .filter((o) => !selected.includes(o.code))
      .filter((o) => {
        const q = query.trim().toLowerCase();
        return !q || o.name.toLowerCase().includes(q) || o.code.toLowerCase().startsWith(q);
      })
      // Long lists are the point of the search box, not of the scroll bar.
      .slice(0, 60)
  );

  function add(code: string) {
    if (!selected.includes(code)) value = [...selected, code].join(', ');
    query = '';
  }

  function remove(code: string) {
    value = selected.filter((c) => c !== code).join(', ');
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && results.length) {
      e.preventDefault();
      add(results[0].code);
    } else if (e.key === 'Escape') {
      open = false;
    } else if (e.key === 'Backspace' && !query && selected.length) {
      remove(selected[selected.length - 1]);
    }
  }
</script>

<div
  class="cp"
  bind:this={box}
  onfocusout={(e) => {
    if (!box?.contains(e.relatedTarget as Node)) open = false;
  }}
>
  <input type="hidden" {name} {value} />
  <div class="box" class:open>
    {#each chips as c (c.code)}
      <span class="chip">
        <span aria-hidden="true">{c.flag}</span>
        {c.name}
        <button
          type="button"
          aria-label={$_('app.settings.remove')}
          onpointerdown={(e) => {
            e.preventDefault();
            remove(c.code);
          }}
          onclick={() => remove(c.code)}
        >×</button>
      </span>
    {/each}
    <input
      class="q"
      type="text"
      role="combobox"
      aria-expanded={open}
      aria-controls="{name}-list"
      autocomplete="off"
      bind:value={query}
      placeholder={chips.length ? '' : placeholder}
      onfocus={() => (open = true)}
      oninput={() => (open = true)}
      onkeydown={onKey}
    />
  </div>

  {#if open}
    <ul class="menu" id="{name}-list" role="listbox">
      {#each results as o (o.code)}
        <li>
          <!-- pointerdown, not click: it fires before focus leaves the search box, so the option is
               picked instead of the menu closing under the cursor. onclick keeps keyboard
               activation working; add() is idempotent, so both firing is harmless. -->
          <button
            type="button"
            role="option"
            aria-selected="false"
            onpointerdown={(e) => {
              e.preventDefault();
              add(o.code);
            }}
            onclick={() => add(o.code)}
          >
            <span aria-hidden="true">{o.flag}</span>
            <span class="nm">{o.name}</span>
            <span class="code">{o.code}</span>
          </button>
        </li>
      {:else}
        <li class="none">{$_('app.settings.ads.noCountryMatch')}</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .cp { position: relative; width: 100%; }
  .box {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
    min-height: var(--control-h, 40px); padding: 6px 10px;
    border: 1px solid var(--line-2); border-radius: 12px;
    background: var(--paper); color: var(--ink); cursor: text;
  }
  .box.open { border-color: var(--accent); box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.1); }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 6px 3px 9px; border-radius: 980px;
    background: var(--paper-2); border: 1px solid var(--line);
    font-size: 12.5px; font-weight: 600; white-space: nowrap;
  }
  .chip button {
    border: 0; background: none; color: var(--ink-faint); cursor: pointer;
    font-size: 15px; line-height: 1; padding: 0 2px;
  }
  .chip button:hover { color: var(--ink); }
  .q {
    flex: 1; min-width: 90px; border: 0; outline: none; background: none;
    color: var(--ink); font: inherit; font-size: 14px; height: 28px;
  }
  .q::placeholder { color: var(--ink-faint); }

  .menu {
    position: absolute; z-index: 30; top: calc(100% + 4px); left: 0; right: 0;
    max-height: 260px; overflow-y: auto; margin: 0; padding: 4px; list-style: none;
    background: var(--paper); border: 1px solid var(--line-2); border-radius: 12px;
    box-shadow: 0 12px 28px -12px rgba(0, 0, 0, 0.35);
  }
  .menu li button {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 7px 10px; border: 0; border-radius: 8px; background: none;
    color: var(--ink); font: inherit; font-size: 13.5px; text-align: left; cursor: pointer;
  }
  .menu li button:hover, .menu li button:focus-visible { background: var(--paper-2); }
  .menu .nm { flex: 1; }
  .menu .code { color: var(--ink-faint); font-size: 12px; }
  .menu .none { padding: 10px; color: var(--ink-faint); font-size: 13px; }
</style>
