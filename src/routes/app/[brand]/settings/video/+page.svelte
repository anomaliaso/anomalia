<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';

  let { data, form } = $props();

  // Length rungs come from the server, filtered to the active model's maxDuration — Seedance 2.5
  // unlocks 20s/30s; Grok stays at 10/13/15. Never a hardcoded global ceiling.
  const LENGTHS = $derived(data.durationOptions?.length ? data.durationOptions : [10, 13, 15]);
  // Unset = Auto (AI / script chooses per clip). Do not pretend 13s is selected when unset.
  const storedDuration = $derived(
    typeof data.brand?.content_prefs?.videoDuration === 'number'
      ? Number(data.brand.content_prefs.videoDuration)
      : null
  );
  const current = $derived(storedDuration);

  const SLOTS = $derived(data.modelSlots ?? []);

  // 720p costs exactly double per second and every draft is billed, shipped or not — so 480p is
  // the recommendation, not merely the default. Kept a two-rung choice: kie offers nothing between.
  const RESOLUTIONS = ['480p', '720p'];
  const DEFAULT_RESOLUTION = '480p';
  const currentRes = $derived(String(data.brand?.content_prefs?.videoResolution ?? DEFAULT_RESOLUTION));

  // Mirrors VIDEO_INSTRUCTIONS_MAX in studio-actions.ts — the server truncates regardless, this is
  // just so the box tells the user before they lose the tail of what they typed.
  const MAX = 600;
  let instructions = $state('');
  $effect(() => {
    instructions = String(data.brand?.content_prefs?.videoInstructions ?? '');
  });
</script>

<section class="panel">
  <div class="panel-head"><div class="t">{$_('app.settings.video.title')}</div></div>
  {#each SLOTS as slot (slot.id)}
    <div class="field">
      <div class="ftxt">
        <div class="fh">{$_(`app.settings.video.slots.${slot.i18n}`)}</div>
        <div class="fs">{$_(`app.settings.video.slots.${slot.i18n}Desc`)}</div>
      </div>
      <form method="POST" action="?/updateMediaModel" use:enhance class="vd-form">
        <input type="hidden" name="slot" value={slot.id} />
        <select name="model" class="vd-select">
          <option value="" selected={!slot.current}>{$_('app.settings.video.modelDefault')}</option>
          {#each slot.choices as m (m.id)}
            <option value={m.id} selected={m.id === slot.current}>{m.label}</option>
          {/each}
        </select>
        <button class="mini connect" type="submit">{$_('app.settings.save')}</button>
      </form>
    </div>
  {/each}
  <div class="field">
    <div class="ftxt">
      <div class="fh">{$_('app.settings.video.clipLength')}</div>
      <div class="fs">{$_('app.settings.video.clipLengthDesc')}</div>
    </div>
    <form method="POST" action="?/updateVideoDuration" use:enhance class="vd-form">
      <select name="videoDuration" class="vd-select">
        <option value="" selected={current == null}>{$_('app.settings.video.clipLengthAuto')}</option>
        {#each LENGTHS as s (s)}
          <option value={s} selected={current === s}>{s}s</option>
        {/each}
      </select>
      <button class="mini connect" type="submit">{$_('app.settings.save')}</button>
    </form>
  </div>
  <div class="field">
    <div class="ftxt">
      <div class="fh">{$_('app.settings.video.resolution')}</div>
      <div class="fs">{$_('app.settings.video.resolutionDesc')}</div>
    </div>
    <form method="POST" action="?/updateVideoResolution" use:enhance class="vd-form">
      <select name="videoResolution" class="vd-select">
        {#each RESOLUTIONS as r (r)}
          <option value={r} selected={r === currentRes}>
            {r}{r === DEFAULT_RESOLUTION ? ` · ${$_('app.settings.video.recommended')}` : ''}
          </option>
        {/each}
      </select>
      <button class="mini connect" type="submit">{$_('app.settings.save')}</button>
    </form>
  </div>
  <div class="field vi-field">
    <div class="ftxt">
      <div class="fh">{$_('app.settings.video.instructions')}</div>
      <div class="fs">{$_('app.settings.video.instructionsDesc')}</div>
    </div>
    <form method="POST" action="?/updateVideoInstructions" use:enhance class="vi-form">
      <textarea
        name="videoInstructions"
        class="vi-text"
        rows="4"
        maxlength={MAX}
        bind:value={instructions}
        placeholder={$_('app.settings.video.instructionsPlaceholder')}
      ></textarea>
      <div class="vi-foot">
        <span class="fs">{instructions.length}/{MAX}</span>
        <button class="mini connect" type="submit">{$_('app.settings.save')}</button>
      </div>
    </form>
  </div>
  {#if form?.saved}<div class="field"><div class="fs" style="color:var(--accent);">{$_('app.settings.video.saved')}</div></div>{/if}
  {#if form?.error}<div class="field"><div class="fs" style="color:#c0392b;">{form.error}</div></div>{/if}
</section>

<style>
  .vd-form { display: flex; align-items: center; gap: 8px; }
  .vi-field { flex-direction: column; align-items: stretch; gap: 10px; }
  .vi-form { display: flex; flex-direction: column; gap: 8px; width: 100%; }
  .vi-text {
    width: 100%; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--line);
    background: var(--paper); color: var(--ink); font: inherit; font-size: 13px;
    line-height: 1.5; resize: vertical; min-height: 88px;
  }
  .vi-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .vd-select {
    padding: 7px 10px; border-radius: 8px; border: 1px solid var(--line);
    background: var(--paper); color: var(--ink); font: inherit; font-size: 13px;
  }
</style>
