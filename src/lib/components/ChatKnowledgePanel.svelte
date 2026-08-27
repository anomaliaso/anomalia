<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { marked } from 'marked';
  import * as Sheet from '$lib/components/ui/sheet';

  /**
   * Il documento della knowledge base LETTO dalla chat, in un pannello a destra.
   *
   * Prima cliccare una fonte `knowledge` faceva `goto('/app/<slug>/knowledge?doc=…')`: la
   * conversazione spariva per leggere due paragrafi. Qui vale la stessa regola di PageModal —
   * niente percorsi veri, l'URL non cambia, la pagina sotto resta viva.
   *
   * È un pannello di LETTURA: l'editor markdown, i chunk e la gestione delle fonti restano
   * sulla pagina Knowledge, raggiungibile dal link in testata.
   */
  let {
    open = $bindable(false),
    brandSlug,
    documentId,
    title = '',
    headingPath = ''
  }: {
    open?: boolean;
    brandSlug: string;
    documentId: string | null;
    /** L'etichetta della fonte: il titolo mostrato finché il documento non è arrivato. */
    title?: string;
    /** `"Sezione > Sottosezione"`, come lo scrive il chunker (knowledge.ts). */
    headingPath?: string;
  } = $props();

  type Detail = {
    document: { id: string; title: string | null; markdown: string | null };
  };

  let detail = $state<Detail | null>(null);
  let loading = $state(false);
  let failed = $state(false);
  let bodyEl = $state<HTMLElement | null>(null);
  /** Non reattivo apposta: scarta le risposte fuori ordine. */
  let seq = 0;

  // Stesso endpoint della pagina Knowledge (`GET /app/<brand>/knowledge/<id>`): il markdown
  // non viaggia mai nella lista, si prende solo quando un documento si apre davvero.
  $effect(() => {
    if (!open || !documentId) return;
    const id = documentId;
    const mine = ++seq;
    detail = null;
    failed = false;
    loading = true;
    fetch(`/app/${brandSlug}/knowledge/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Detail) => {
        if (mine === seq) detail = d;
      })
      .catch(() => {
        if (mine === seq) failed = true;
      })
      .finally(() => {
        if (mine === seq) loading = false;
      });
  });

  const html = $derived.by(() => {
    const md = detail?.document?.markdown ?? '';
    if (!md) return '';
    try {
      return marked.parse(md, { async: false }) as string;
    } catch {
      return md;
    }
  });

  const docHref = $derived.by(() => {
    if (!documentId) return `/app/${brandSlug}/knowledge`;
    const q = new URLSearchParams({ doc: documentId });
    if (headingPath) q.set('section', headingPath);
    return `/app/${brandSlug}/knowledge?${q}`;
  });

  // La fonte cita UNA sezione: su un documento lungo aprirlo in cima equivale a non averla
  // indicata. Si cerca il titolo (l'ultimo segmento del path) fra gli heading resi e ci si
  // salta sopra, evidenziandolo. Se non lo si trova, si resta in cima: mai un salto sbagliato.
  // ponytail: match sul testo dell'heading, non su id generati — `marked` qui non ne mette.
  $effect(() => {
    const el = bodyEl;
    if (!el || !html) return;
    const wanted = headingPath.split('>').pop()?.trim().toLowerCase();
    // Un frame di attesa: quando `html` cambia, l'effetto scatta prima che `{@html}` abbia
    // committato i nodi — cercare gli heading subito trova una lista vuota (misurato: la
    // sezione non veniva mai evidenziata).
    const raf = requestAnimationFrame(() => {
      el.querySelector('.kp-hit')?.classList.remove('kp-hit');
      el.scrollTop = 0;
      if (!wanted) return;
      const target = [...el.querySelectorAll('h1, h2, h3, h4, h5, h6')].find(
        (h) => (h.textContent ?? '').trim().toLowerCase() === wanted
      );
      if (!(target instanceof HTMLElement)) return;
      target.classList.add('kp-hit');
      el.scrollTop = Math.max(0, target.offsetTop - 12);
    });
    return () => cancelAnimationFrame(raf);
  });
</script>

<Sheet.Root bind:open>
  <Sheet.Content
    side="right"
    showCloseButton={false}
    style="width: min(calc(100vw - 1rem), 38rem); max-width: calc(100vw - 1rem); border-left: 1px solid var(--line); background: var(--paper); padding: 0; display: flex; flex-direction: column; gap: 0;"
  >
    <div class="kp-head">
      <div class="kp-head-title">
        <Sheet.Title class="kp-title">
          {detail?.document?.title || title || $_('chat.sourceKind.knowledge')}
        </Sheet.Title>
        <Sheet.Description class="kp-sub">
          {headingPath || $_('chat.docPanel.subtitle')}
        </Sheet.Description>
      </div>
      <div class="kp-head-actions">
        <a class="kp-link" href={docHref} onclick={() => (open = false)}>
          {$_('chat.docPanel.openInKnowledge')}
        </a>
        <Sheet.Close class="kp-close" aria-label={$_('app.settings.close')}>×</Sheet.Close>
      </div>
    </div>

    <div class="kp-body" bind:this={bodyEl}>
      {#if loading}
        <p class="kp-note">{$_('chat.docPanel.loading')}</p>
      {:else if failed}
        <p class="kp-note">{$_('chat.docPanel.failed')}</p>
      {:else if html}
        <!-- Stesso trattamento della pagina Knowledge: il markdown del documento, reso. -->
        {@html html}
      {:else if detail}
        <p class="kp-note">{$_('chat.docPanel.empty')}</p>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>

<style>
  .kp-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 18px 12px;
    border-bottom: 1px solid var(--line);
    flex: 0 0 auto;
  }
  .kp-head-title {
    min-width: 0;
  }
  .kp-head :global(.kp-title) {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kp-head :global(.kp-sub) {
    margin-top: 2px;
    font-size: 11.5px;
    line-height: 1.35;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kp-head-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
  }
  .kp-link {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    text-decoration: none;
    white-space: nowrap;
  }
  .kp-link:hover {
    text-decoration: underline;
  }
  .kp-head :global(.kp-close) {
    appearance: none;
    border: none;
    background: transparent;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    font-size: 20px;
    line-height: 1;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .kp-head :global(.kp-close:hover) {
    background: color-mix(in srgb, var(--ink) 8%, transparent);
    color: var(--ink);
  }

  .kp-body {
    position: relative; /* offsetTop degli heading è relativo a QUESTO contenitore */
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 16px 18px 32px;
    font-size: 13.5px;
    line-height: 1.62;
    color: var(--ink);
  }
  .kp-note {
    margin: 0;
    font-size: 13px;
    color: var(--ink-soft);
  }

  .kp-body :global(h1),
  .kp-body :global(h2),
  .kp-body :global(h3),
  .kp-body :global(h4) {
    margin: 18px 0 6px;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--ink);
    scroll-margin-top: 12px;
  }
  .kp-body :global(h1) {
    font-size: 16px;
  }
  .kp-body :global(p),
  .kp-body :global(ul),
  .kp-body :global(ol) {
    margin: 0 0 10px;
  }
  /* Il reset di Tailwind azzera i marcatori: qui il markdown deve leggersi come un elenco. */
  .kp-body :global(ul),
  .kp-body :global(ol) {
    padding-left: 20px;
    list-style: revert;
  }
  .kp-body :global(li) {
    display: list-item;
  }
  .kp-body :global(a) {
    color: var(--accent);
  }
  .kp-body :global(code) {
    font-size: 12px;
    background: var(--paper-2);
    border-radius: 4px;
    padding: 1px 4px;
  }
  .kp-body :global(pre) {
    background: var(--paper-2);
    border-radius: 10px;
    padding: 10px 12px;
    overflow-x: auto;
  }
  .kp-body :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  .kp-body :global(th),
  .kp-body :global(td) {
    border: 1px solid var(--line);
    padding: 5px 8px;
    text-align: left;
  }
  .kp-body :global(img) {
    max-width: 100%;
  }
  /* La sezione citata dalla fonte: un rilievo, non una selezione permanente. */
  .kp-body :global(.kp-hit) {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    border-radius: 6px;
    box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 16%, transparent);
  }
</style>
