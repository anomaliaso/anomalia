<script lang="ts">
  import { FileText, Image as ImageIcon, Table2, Code2, FileArchive, Download } from '@lucide/svelte';

  /**
   * Un artefatto consegnato dall'agente: un file che resta nella conversazione.
   *
   * La card mostra tre cose e basta — cosa è, quanto pesa, come si apre. L'anteprima esiste per i
   * formati leggibili perché la domanda vera davanti a un file è "devo aprirlo?", e due righe di
   * contenuto la risolvono meglio di qualunque titolo. Le immagini si vedono e basta.
   */
  type Artifact = {
    id: string;
    title: string;
    description?: string | null;
    kind: string;
    file_name: string;
    bytes?: number | null;
    preview?: string | null;
    url?: string | null;
    created_by?: string;
  };

  let { artifact }: { artifact: Artifact } = $props();

  const ICONS: Record<string, typeof FileText> = {
    image: ImageIcon,
    data: Table2,
    code: Code2,
    archive: FileArchive,
    document: FileText
  };
  const Icon = $derived(ICONS[artifact.kind] ?? FileText);

  const size = $derived(
    !artifact.bytes
      ? ''
      : artifact.bytes < 1024
        ? `${artifact.bytes} B`
        : artifact.bytes < 1024 * 1024
          ? `${Math.round(artifact.bytes / 1024)} KB`
          : `${(artifact.bytes / (1024 * 1024)).toFixed(1)} MB`
  );
</script>

<div class="artifact-card">
  {#if artifact.kind === 'image' && artifact.url}
    <!-- `download` di proposito anche qui: il contenuto lo ha scritto un modello, che può averlo
         copiato da una pagina appena letta. Si scarica, non si apre in un tab. -->
    <a class="art-image" href={artifact.url} download={artifact.file_name}>
      <img src={artifact.url} alt={artifact.title} loading="lazy" />
    </a>
  {/if}

  <div class="art-body">
    <div class="art-head">
      <Icon class="art-icon" strokeWidth={1.8} />
      <div class="art-titles">
        <span class="art-title">{artifact.title}</span>
        <span class="art-meta">{artifact.file_name}{size ? ` · ${size}` : ''}</span>
      </div>
      {#if artifact.url}
        <a class="art-open" href={artifact.url} target="_blank" rel="noopener noreferrer" download={artifact.file_name}>
          <Download class="art-dl" strokeWidth={2} />
        </a>
      {/if}
    </div>

    {#if artifact.description}
      <p class="art-desc">{artifact.description}</p>
    {/if}

    {#if artifact.preview && artifact.kind !== 'image'}
      <pre class="art-preview">{artifact.preview}</pre>
    {/if}
  </div>
</div>

<style>
  /* Niente cornice esterna: il media resta media (l'immagine ha il suo bordo), il resto è
     una riga quieta — icona, titolo, meta, download — con token veri, non alias shadcn. */
  .artifact-card {
    margin: 6px 0;
    max-width: 560px;
  }
  .art-image {
    display: block;
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden;
    background: var(--paper-2);
  }
  .art-image img {
    display: block;
    width: 100%;
    max-height: 340px;
    object-fit: contain;
  }
  .art-body {
    padding: 6px 0 0;
  }
  .art-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .art-titles {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .art-title {
    font-size: 13px;
    font-weight: 620;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .art-meta {
    font-size: 11px;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .art-open {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    color: var(--ink-faint);
    flex-shrink: 0;
  }
  .art-open:hover {
    color: var(--ink);
    background: color-mix(in oklab, var(--ink) 6%, transparent);
  }
  .art-desc {
    margin: 6px 0 0;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--ink-soft);
  }
  .art-preview {
    margin: 6px 0 0;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--paper-2);
    font-size: 11.5px;
    line-height: 1.45;
    max-height: 150px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--ink-soft);
  }
  :global(.artifact-card .art-icon) {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    color: var(--ink-soft);
  }
  :global(.artifact-card .art-dl) {
    width: 15px;
    height: 15px;
  }
</style>
