<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { Check, LoaderCircle } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Sheet from '$lib/components/ui/sheet';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte';

  /**
   * Il ragionamento di un turno, salvato o ancora in streaming.
   *
   * Prima era un box espandibile col bordo accent, il logo Anomalia e la parola "thinking":
   * un riquadro colorato sopra ogni risposta, più vistoso del messaggio che introduceva.
   * Ora è una RIGA quieta e centrata ("Ho pensato") che al click apre il testo intero —
   * dialog su desktop, bottom sheet su mobile: la stessa grammatica di ChatToolChips e
   * ChatSources, così le tre righe di servizio di un turno si leggono come una cosa sola.
   *
   * ponytail: il guscio dialog/sheet è ora copiato in tre file (qui, ChatToolChips,
   * ChatSources) — ~14 righe di markup che differiscono per titolo, corpo e max-width.
   * Estrarlo vorrebbe dire riscrivere gli altri due mentre ci lavorano altri; si estrae
   * quando arriva la quarta copia o quando quei due file sono fermi.
   */
  let {
    reasoning,
    live = false
  }: {
    reasoning: string;
    /** Keep the reasoning collapsed while the model is still producing it. */
    live?: boolean;
  } = $props();

  let open = $state(false);

  /** Il breakpoint mobile della chat (lo stesso di ChatToolChips/ChatSources). */
  const isMobile = new IsMobile();

  const label = $derived(live ? $_('chat.thinking') : $_('chat.thought'));
  // The stream uses a zero-width placeholder so the row can appear before the first delta.
  const body = $derived(reasoning.replace(/\u200b/g, '').trim());
</script>

{#if live || body}
  <button
    type="button"
    class="th-row"
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={() => (open = true)}
  >
    {#if live}
      <LoaderCircle class="th-icon spin" strokeWidth={2.2} />
    {:else}
      <Check class="th-icon" strokeWidth={2.4} />
    {/if}
    {label}
  </button>

  {#if isMobile.current}
    <Sheet.Root bind:open>
      <Sheet.Content side="bottom" class="flex flex-col gap-0 rounded-t-xl p-0">
        <Sheet.Header class="p-4 pb-2">
          <Sheet.Title class="text-sm font-semibold">{label}</Sheet.Title>
        </Sheet.Header>
        <div class="th-body">{body}</div>
      </Sheet.Content>
    </Sheet.Root>
  {:else}
    <Dialog.Root bind:open>
      <Dialog.Content class="flex flex-col gap-0 p-0 sm:max-w-xl">
        <Dialog.Header class="p-4 pb-2">
          <Dialog.Title class="text-sm font-semibold">{label}</Dialog.Title>
        </Dialog.Header>
        <div class="th-body">{body}</div>
      </Dialog.Content>
    </Dialog.Root>
  {/if}
{/if}

<style>
  /* Evento di sistema: riga quieta CENTRATA, senza box/bordo/sfondo/logo né chevron —
     identica alla riga "N fonti usate" di ChatSources. */
  .th-row {
    appearance: none;
    background: none;
    border: none;
    padding: 0.15rem 0;
    margin: 2px 0;
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-family: inherit;
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--ink-soft);
    cursor: pointer;
    transition: color 0.12s ease;
  }
  .th-row:hover,
  .th-row:focus-visible {
    color: var(--ink);
  }

  /* :global, come .tc-icon in ChatToolChips: l'svg lo emette il componente Lucide, quindi
     lo scope di Svelte non lo raggiunge — senza :global queste regole non si applicavano
     MAI e l'icona usciva a 24px grezza, diversa dai chip dei tool. */
  :global(.th-icon) {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    color: var(--ink-faint);
  }
  :global(.th-icon.spin) {
    animation: th-spin 0.85s linear infinite;
  }

  /* Il ragionamento per intero dentro dialog/sheet: tipografia dei messaggi, a capo
     rispettati, e lo scroll è suo — non della pagina sotto. */
  .th-body {
    padding: 0 1rem 1rem;
    font-size: 13px;
    line-height: 1.6;
    color: var(--ink-soft);
    white-space: pre-wrap;
    word-break: break-word;
    overflow-y: auto;
    max-height: min(65vh, 520px);
  }

  @keyframes th-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.th-icon.spin) {
      animation: none;
    }
  }
</style>
