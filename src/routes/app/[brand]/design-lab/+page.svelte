<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import type { Design } from '$lib/design/schema';
  import { canvasSize } from '$lib/design/schema';
  import { photoOverlayTemplate, quoteTemplate, statTemplate } from '../../../../remotion/templates';

  let { data } = $props();

  let host: HTMLDivElement | undefined = $state();
  let template: 'quote' | 'stat' | 'photo' = $state('quote');
  let status = $state('Loading…');
  let fontCheck = $state('');
  let exportMeta = $state('');
  let exporting = $state(false);
  let previewUrl = $state<string | null>(null);
  let capable = $state(true);

  let player: { update: (doc: Design, slide?: number) => void; unmount: () => void } | null = null;
  let resolvedFontFamily = $state('Inter');

  function kit() {
    return { fonts: data.fonts, brand_colors: data.brandColors };
  }

  function buildDoc(): Design {
    if (template === 'quote') {
      return quoteTemplate(kit(), {
        quote: `${data.brandName} — composed, not screenshotted.`,
        attribution: `— ${data.brandName}`
      });
    }
    if (template === 'stat') {
      return statTemplate(kit(), {
        stat: '2160×2700',
        label: 'PNG still @ scale 2 (4:5)'
      });
    }
    // photo-overlay is the only template with an ImageLayer — without exporting it at least once
    // that layer ships unverified.
    return photoOverlayTemplate(kit(), {
      imageUrl: data.sampleImageUrl ?? undefined,
      kicker: 'IN EVIDENZA',
      title: `${data.brandName}: titolo leggibile sopra la foto`
    });
  }

  async function mountPlayer(doc: Design) {
    if (!browser || !host) return;
    const { mountDesignPlayer } = await import('../../../../remotion/mount');
    player?.unmount();
    player = mountDesignPlayer(host, doc, 0);
  }

  async function switchTemplate(next: 'quote' | 'stat' | 'photo') {
    template = next;
    const doc = buildDoc();
    player?.update(doc, 0);
    status = `Template: ${next}`;
  }

  async function exportPng() {
    if (!browser || exporting) return;
    exporting = true;
    status = 'Rendering still…';
    exportMeta = '';
    try {
      const { renderDesignSlide, verifyFontMetrics, checkDesignRenderCapability } = await import(
        '$lib/design/render'
      );
      const { resolveFontFamily, firstBrandFontName } = await import('../../../../remotion/fonts');

      const cap = await checkDesignRenderCapability();
      if (!cap.ok) {
        capable = false;
        status = cap.reason;
        return;
      }

      const preferred = firstBrandFontName(data.fonts) ?? 'Inter';
      const resolved = await resolveFontFamily(preferred);
      resolvedFontFamily = resolved.fontFamily;
      const metrics = await verifyFontMetrics(resolved.fontFamily);
      fontCheck = metrics.loaded && metrics.differsFromSystem
        ? `Font OK: "${resolved.fontFamily}" (source=${resolved.source}, Δw=${(metrics.brandWidth - metrics.systemWidth).toFixed(1)}px vs system)`
        : `Font WARN: "${resolved.fontFamily}" may be falling back (loaded=${metrics.loaded}, differs=${metrics.differsFromSystem})`;

      const doc = buildDoc();
      const blob = await renderDesignSlide(doc, 0, { scale: 2 });
      const size = canvasSize(doc.aspect);
      const expectedW = size.width * 2;
      const expectedH = size.height * 2;

      // Confirm pixel size via createImageBitmap
      const bmp = await createImageBitmap(blob);
      exportMeta = `PNG ${bmp.width}×${bmp.height} (expected ${expectedW}×${expectedH}), ${(blob.size / 1024).toFixed(0)} KB`;
      if (bmp.width !== expectedW || bmp.height !== expectedH) {
        status = `Export size mismatch: got ${bmp.width}×${bmp.height}`;
      } else {
        status = 'Export ready';
      }
      bmp.close();

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = previewUrl;
      a.download = `design-${template}-${expectedW}x${expectedH}.png`;
      a.click();
    } catch (e) {
      status = e instanceof Error ? e.message : String(e);
    } finally {
      exporting = false;
    }
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      const { checkDesignRenderCapability } = await import('$lib/design/render');
      const cap = await checkDesignRenderCapability();
      if (cancelled) return;
      capable = cap.ok;
      if (!cap.ok) {
        status = cap.reason;
        return;
      }
      const doc = buildDoc();
      await mountPlayer(doc);
      if (!cancelled) status = 'Player ready';
    })().catch((e) => {
      if (!cancelled) status = e instanceof Error ? e.message : String(e);
    });
    return () => {
      cancelled = true;
      player?.unmount();
      player = null;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  });
</script>

<svelte:head>
  <title>Design Lab — {data.brandName}</title>
</svelte:head>

<section class="lab">
  <header>
    <h1>Design Lab</h1>
    <p>Remotion Fase 1 — Player + still export (FEATURE_DESIGN_STUDIO)</p>
  </header>

  <div class="controls">
    <button type="button" class:active={template === 'quote'} onclick={() => switchTemplate('quote')}>
      Quote
    </button>
    <button type="button" class:active={template === 'stat'} onclick={() => switchTemplate('stat')}>
      Stat
    </button>
    <button type="button" class:active={template === 'photo'} onclick={() => switchTemplate('photo')}>
      Photo overlay
    </button>
    <button type="button" class="export" disabled={!capable || exporting} onclick={exportPng}>
      {exporting ? 'Exporting…' : 'Esporta PNG'}
    </button>
  </div>

  <p class="status">{status}</p>
  {#if fontCheck}<p class="font">{fontCheck}</p>{/if}
  {#if exportMeta}<p class="meta">{exportMeta}</p>{/if}

  <div class="stage" bind:this={host}></div>

  {#if previewUrl}
    <figure>
      <img src={previewUrl} alt="Exported design still" />
      <figcaption>Last export preview</figcaption>
    </figure>
  {/if}
</section>

<style>
  .lab {
    max-width: var(--content-max, 960px);
    margin: 0 auto;
    padding: 0;
    display: grid;
    gap: 1rem;
  }
  header h1 {
    margin: 0;
  }
  header p {
    margin: 0.35rem 0 0;
    opacity: 0.65;
    font-size: 0.9rem;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  button {
    border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
    background: transparent;
    color: inherit;
    padding: 0.45rem 0.85rem;
    border-radius: 8px;
    cursor: pointer;
    font: inherit;
  }
  button.active {
    background: color-mix(in oklab, currentColor 10%, transparent);
  }
  button.export {
    margin-left: auto;
    background: #111;
    color: #fff;
    border-color: #111;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .status,
  .font,
  .meta {
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.8;
  }
  .stage {
    width: 100%;
    border-radius: 12px;
    overflow: hidden;
    background: #eee;
    border: 1px solid color-mix(in oklab, currentColor 12%, transparent);
  }
  figure {
    margin: 0;
  }
  figure img {
    width: 100%;
    height: auto;
    border-radius: 12px;
    display: block;
  }
  figcaption {
    margin-top: 0.4rem;
    font-size: 0.8rem;
    opacity: 0.6;
  }
</style>
