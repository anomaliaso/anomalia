<script lang="ts">
  import PageHead from '$lib/components/PageHead.svelte';
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import { _ } from 'svelte-i18n';

  let { data, form } = $props();

  const PLATFORM_LABELS: Record<string, string> = {
    instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', facebook: 'Facebook',
    tiktok: 'TikTok', threads: 'Threads', bluesky: 'Bluesky', reddit: 'Reddit'
  };
  const platformLabel = (k: string) => PLATFORM_LABELS[k] ?? k.charAt(0).toUpperCase() + k.slice(1);

  const TONES = ['friendly', 'neutral', 'authoritative'];
  const SYNTAXES = ['short', 'mixed', 'long'];
  const RULE_COLS = ['tone', 'length', 'emoji', 'hashtags', 'structure'] as const;

  // Local editable state, re-synced when a save reloads the data.
  let mode = $state<'auto' | 'manual'>('auto');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let vf = $state<any>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rules = $state<Record<string, any>>({});
  let avoid = $state('');
  $effect(() => {
    mode = data.voiceMode as 'auto' | 'manual';
    vf = { register: 50, ...JSON.parse(JSON.stringify(data.voiceFramework ?? {})) };
    const r: Record<string, Record<string, string>> = {};
    for (const p of data.platforms) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cur = (data.platformRules as any)[p] ?? {};
      r[p] = { tone: cur.tone ?? '', length: cur.length ?? '', emoji: cur.emoji ?? '', hashtags: cur.hashtags ?? '', structure: cur.structure ?? '' };
    }
    rules = r;
    avoid = data.avoid.join(', ');
  });

  // Manual fields are editable only in 'manual' mode — 'auto' reads everything from the Studio.
  const locked = $derived(mode === 'auto');

  let busy = $state(false);
  const withBusy = () => {
    busy = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy = false;
    };
  };
</script>

<svelte:head><title>Anomalia — {$_('voicePage.title')}</title></svelte:head>

<div class="content">
  <PageHead title={$_('voicePage.title')} subtitle={$_('voicePage.subtitle')} />

  <form method="POST" action="?/save" use:enhance={withBusy}>
    <!-- Mode: Auto (recommended, reads from the Studio) vs Manual (this page is authoritative) -->
    <section class="card mode-card">
      <div class="mode-row">
        <div class="seg">
          <button type="button" class="seg-btn" class:on={mode === 'auto'} onclick={() => (mode = 'auto')}>{$_('voicePage.mode.auto')}</button>
          <button type="button" class="seg-btn" class:on={mode === 'manual'} onclick={() => (mode = 'manual')}>{$_('voicePage.mode.manual')}</button>
        </div>
        <span class="reads-from">
          {$_('voicePage.readsFrom')} <a href={`/app/${$page.params.brand}/settings/brand`}>Studio →</a>
        </span>
      </div>
      {#if data.studioPct < 100}
        <p class="studio-note">
          ⓘ {$_('voicePage.studioNote', { values: { pct: data.studioPct } })}
          <a href={`/app/${$page.params.brand}/settings/brand`}>{$_('voicePage.studioCta')}</a>
        </p>
      {/if}
      <input type="hidden" name="mode" value={mode} />
    </section>

    <!-- Voice framework: the style manual Anomalia writes with -->
    <section class="card" class:locked>
      <h3 class="card-t">{$_('voicePage.framework.title')}</h3>
      <p class="card-s">{$_('voicePage.framework.sub')}</p>

      <div class="grid2">
        <label class="field">
          <span>{$_('voicePage.framework.purpose')}</span>
          <textarea name="purpose" rows="2" disabled={locked} placeholder={$_('voicePage.framework.purposePh')}>{vf.purpose ?? ''}</textarea>
        </label>
        <label class="field">
          <span>{$_('voicePage.framework.audience')}</span>
          <textarea name="audience" rows="2" disabled={locked} placeholder={$_('voicePage.framework.audiencePh')}>{vf.audience ?? ''}</textarea>
        </label>

        <div class="field">
          <span>{$_('voicePage.framework.tone')}</span>
          <div class="chips">
            {#each TONES as t (t)}
              <button type="button" class="chip" class:on={vf.tone === t} disabled={locked} onclick={() => (vf.tone = vf.tone === t ? '' : t)}>
                {$_('voicePage.tones.' + t)}
              </button>
            {/each}
          </div>
          <input type="hidden" name="tone" value={vf.tone ?? ''} />
        </div>
        <div class="field">
          <span>{$_('voicePage.framework.register')}</span>
          <input class="slider" type="range" name="register" min="0" max="100" step="5" bind:value={vf.register} disabled={locked} />
          <div class="slider-ends"><small>{$_('voicePage.framework.informal')}</small><small>{$_('voicePage.framework.formal')}</small></div>
        </div>

        <label class="field">
          <span>{$_('voicePage.framework.emotion')}</span>
          <input name="emotion" type="text" value={vf.emotion ?? ''} disabled={locked} placeholder={$_('voicePage.framework.emotionPh')} />
        </label>
        <label class="field">
          <span>{$_('voicePage.framework.character')}</span>
          <input name="character" type="text" value={vf.character ?? ''} disabled={locked} placeholder={$_('voicePage.framework.characterPh')} />
        </label>

        <div class="field">
          <span>{$_('voicePage.framework.syntax')}</span>
          <div class="chips">
            {#each SYNTAXES as s (s)}
              <button type="button" class="chip" class:on={vf.syntax === s} disabled={locked} onclick={() => (vf.syntax = vf.syntax === s ? '' : s)}>
                {$_('voicePage.syntaxes.' + s)}
              </button>
            {/each}
          </div>
          <input type="hidden" name="syntax" value={vf.syntax ?? ''} />
        </div>
        <label class="field">
          <span>{$_('voicePage.framework.terminology')}</span>
          <textarea name="terminology" rows="2" disabled={locked} placeholder={$_('voicePage.framework.terminologyPh')}>{vf.terminology ?? ''}</textarea>
        </label>
      </div>
    </section>

    <!-- Per-platform caption rules: one row per channel, real columns -->
    <section class="card">
      <h3 class="card-t">{$_('voicePage.rules.title')}</h3>
      <p class="card-s">{$_('voicePage.rules.sub')}</p>
      {#if data.platforms.length}
        <div class="rules-table" role="table">
          <div class="rt-row rt-head" role="row">
            <span>{$_('voicePage.rules.platform')}</span>
            {#each RULE_COLS as c (c)}<span>{$_('voicePage.rules.' + c)}</span>{/each}
          </div>
          {#each data.platforms as p (p)}
            <div class="rt-row" role="row">
              <span class="rt-plat">{platformLabel(p)}</span>
              {#each RULE_COLS as c (c)}
                <input
                  type="text"
                  value={rules[p]?.[c] ?? ''}
                  placeholder="—"
                  oninput={(e) => (rules = { ...rules, [p]: { ...rules[p], [c]: e.currentTarget.value } })}
                />
              {/each}
            </div>
          {/each}
        </div>
      {:else}
        <p class="muted">{$_('voicePage.rules.noPlatforms')}</p>
      {/if}
      <input type="hidden" name="platform_rules" value={JSON.stringify(rules)} />

      <label class="field avoid-field">
        <span>{$_('voicePage.avoidLabel')}</span>
        <input name="avoid" type="text" bind:value={avoid} placeholder={$_('voicePage.avoidPh')} />
      </label>
    </section>

    <div class="save-row">
      <button class="btn-primary" disabled={busy}>{busy ? $_('voicePage.saving') : $_('voicePage.save')}</button>
      {#if form?.saved}<span class="saved-note">{$_('voicePage.saved')}</span>{/if}
      {#if form?.error}<span class="err">{$_('voicePage.failed')}</span>{/if}
    </div>
  </form>
</div>

<style>

  .page-head h2 { margin: 0; }
  .page-sub { margin: 6px 0 0; color: var(--ink-soft, #6e6e73); font-size: 14px; }

  /* Box metrics identical to the Analytics .panel/.panel-head (radius 20, 18px 22px paddings):
     the title + sub form the head, closed by an edge-to-edge divider. */
  .card { border: 1px solid var(--line, #e3e3e6); border-radius: 20px; padding: 18px 22px; background: var(--paper, #fff); margin-top: 16px; }
  .card-t { margin: -18px -22px 0; padding: 18px 22px 0; font-size: 15.5px; font-weight: 700; letter-spacing: -0.03em; }
  .card-s { margin: 4px -22px 18px; font-size: 13px; color: var(--ink-soft, #6e6e73);
    padding: 0 22px 16px; border-bottom: 1px solid var(--line, #e3e3e6); }
  .card.locked .grid2 { opacity: 0.55; }

  .mode-card { padding: 14px 18px; }
  .mode-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
  .seg { display: inline-flex; border: 1px solid var(--line-2, #d2d2d7); border-radius: 12px; overflow: hidden; }
  .seg-btn { padding: 9px 16px; font-size: 13px; font-weight: 600; background: var(--paper, #fff); color: var(--ink-soft, #6e6e73);
    border: none; cursor: pointer; }
  .seg-btn.on { background: rgba(var(--accent-rgb), 0.1); color: var(--accent, #7c5cff); }
  .reads-from { font-size: 13px; color: var(--ink-soft, #6e6e73); }
  .reads-from a { color: var(--accent, #7c5cff); font-weight: 600; }
  .studio-note { margin: 12px 0 0; font-size: 12.5px; color: var(--ink-soft, #6e6e73); }
  .studio-note a { color: var(--accent, #7c5cff); font-weight: 600; }

  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 22px; }
  .field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
  .field > span { font-size: 12.5px; font-weight: 600; color: var(--ink-soft, #6e6e73); }
  .field input[type='text'], .field textarea { font-size: 14px; padding: 10px 12px; border-radius: 10px;
    border: 1px solid var(--line-2, #d2d2d7); font-family: inherit; line-height: 1.5; color: var(--ink, #1d1d1f);
    background: var(--paper, #fff); resize: vertical; box-sizing: border-box; width: 100%; }
  .field input:focus, .field textarea:focus { outline: none; border-color: var(--accent, #7c5cff); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1); }

  .chips { display: flex; gap: 8px; flex-wrap: wrap; }
  .chip { padding: 8px 15px; border-radius: 980px; border: 1px solid var(--line-2, #d2d2d7); background: var(--paper, #fff);
    color: var(--ink-soft, #6e6e73); font-size: 13px; font-weight: 500; cursor: pointer; }
  .chip.on { border-color: var(--accent, #7c5cff); background: rgba(var(--accent-rgb), 0.08); color: var(--accent, #7c5cff); font-weight: 600; }
  .chip:disabled { cursor: default; }

  .slider { width: 100%; accent-color: var(--accent, #7c5cff); }
  .slider-ends { display: flex; justify-content: space-between; color: var(--ink-faint, #86868b); }

  /* rules table */
  .rules-table { border: 1px solid var(--line, #e3e3e6); border-radius: 12px; overflow-x: auto; }
  .rt-row { display: grid; grid-template-columns: 110px repeat(4, minmax(110px, 1fr)) minmax(160px, 1.4fr); gap: 0;
    border-top: 1px solid var(--line, #e3e3e6); min-width: 720px; }
  .rt-row:first-child { border-top: none; }
  .rt-head span { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--ink-faint, #86868b); padding: 10px 12px; }
  .rt-plat { font-size: 13.5px; font-weight: 600; padding: 12px; display: flex; align-items: center; }
  .rt-row input { border: none; border-left: 1px solid var(--line, #e3e3e6); padding: 12px; font-size: 13px;
    font-family: inherit; color: var(--ink, #1d1d1f); background: transparent; min-width: 0; }
  .rt-row input:focus { outline: none; background: rgba(var(--accent-rgb), 0.05); }
  .muted { color: var(--ink-soft, #6e6e73); font-size: 13.5px; }
  .avoid-field { margin-top: 18px; }

  .save-row { display: flex; align-items: center; gap: 12px; margin-top: 18px; }
  .btn-primary { background: var(--ink, #1d1d1f); color: #fff; border: none; border-radius: 980px;
    padding: 12px 22px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .btn-primary:disabled { opacity: 0.4; cursor: default; }
  .saved-note { font-size: 13px; color: var(--accent, #7c5cff); font-weight: 600; }
  .err { color: #c0392b; font-size: 13.5px; }

  @container workbench (max-width: 700px) { .grid2 { grid-template-columns: 1fr; } }
</style>
