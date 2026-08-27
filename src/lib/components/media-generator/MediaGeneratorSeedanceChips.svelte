<script lang="ts">
  import { _ } from 'svelte-i18n';

  type SeedancePanelKind = 'start' | 'end' | 'video' | 'audio';

  interface Props {
    loading: boolean;
    firstFrameUrl: string;
    lastFrameUrl: string;
    seedancePanel: SeedancePanelKind | null;
    seedanceVideoN: number;
    seedanceAudioN: number;
    onOpenPanel: (which: SeedancePanelKind) => void;
  }

  let {
    loading,
    firstFrameUrl,
    lastFrameUrl,
    seedancePanel,
    seedanceVideoN,
    seedanceAudioN,
    onOpenPanel
  }: Props = $props();
</script>

<div class="mg-seedance-chips">
  <button
    type="button"
    class="mg-dd-btn"
    class:on={!!firstFrameUrl || seedancePanel === 'start'}
    disabled={loading}
    onclick={() => onOpenPanel('start')}
    aria-label={$_('app.media.generator.firstFrame')}
    title={$_('app.media.generator.firstFrame')}
  >
    {#if firstFrameUrl}
      <span class="mg-seedance-chip-thumb" style={`background-image:url(${firstFrameUrl})`}></span>
    {/if}
    <span>{$_('app.media.generator.chipStart')}</span>
  </button>
  <button
    type="button"
    class="mg-dd-btn"
    class:on={!!lastFrameUrl || seedancePanel === 'end'}
    disabled={loading}
    onclick={() => onOpenPanel('end')}
    aria-label={$_('app.media.generator.lastFrame')}
    title={$_('app.media.generator.lastFrame')}
  >
    {#if lastFrameUrl}
      <span class="mg-seedance-chip-thumb" style={`background-image:url(${lastFrameUrl})`}></span>
    {/if}
    <span>{$_('app.media.generator.chipEnd')}</span>
  </button>
  <button
    type="button"
    class="mg-dd-btn"
    class:on={seedanceVideoN > 0 || seedancePanel === 'video'}
    disabled={loading}
    onclick={() => onOpenPanel('video')}
    aria-label={$_('app.media.generator.refVideoUrls')}
    title={$_('app.media.generator.refVideoUrls')}
  >
    <span>{$_('app.media.generator.chipVideo')}</span>
    {#if seedanceVideoN}
      <span class="mg-seedance-chip-n">{seedanceVideoN}</span>
    {/if}
  </button>
  <button
    type="button"
    class="mg-dd-btn"
    class:on={seedanceAudioN > 0 || seedancePanel === 'audio'}
    disabled={loading}
    onclick={() => onOpenPanel('audio')}
    aria-label={$_('app.media.generator.refAudioUrls')}
    title={$_('app.media.generator.refAudioUrls')}
  >
    <span>{$_('app.media.generator.chipAudio')}</span>
    {#if seedanceAudioN}
      <span class="mg-seedance-chip-n">{seedanceAudioN}</span>
    {/if}
  </button>
</div>

<style>
  .mg-seedance-chips {
    grid-area: seedance;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .mg-seedance-chips .mg-dd-btn {
    height: 26px;
    padding: 0 8px;
    font-size: 11.5px;
  }
  .mg-dd-btn {
    appearance: none;
    border: 1px solid var(--line);
    background: var(--paper-2, #f5f5f7);
    color: var(--ink-soft);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 8px 0 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.01em;
    cursor: pointer;
    line-height: 1;
  }
  .mg-dd-btn.on,
  .mg-dd-btn:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
    color: var(--ink);
  }
  .mg-dd-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .mg-seedance-chip-thumb {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    background-size: cover;
    background-position: center;
    flex-shrink: 0;
  }
  .mg-seedance-chip-n {
    min-width: 16px;
    height: 16px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--ink);
    color: var(--paper);
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
  }
</style>
