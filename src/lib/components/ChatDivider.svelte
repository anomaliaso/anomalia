<script lang="ts">
  /**
   * La riga di servizio fra due bolle: il giorno ("Oggi 12:56") o il confine dei non letti.
   *
   * Stessa grammatica degli altri widget del transcript (ChatToolChips, ChatSources,
   * ChatThought): testo piccolo, nessuna cornice, niente sfondo. Un componente solo e non due
   * perché le due varianti differiscono per un colore e due filetti — e perché così le due
   * superfici della chat ne montano uno, non ne copiano il markup.
   *
   * `tone`:
   *  - `muted` — il giorno. Solo testo centrato, come nello screenshot di riferimento: è un
   *    orario, non un confine, e una linea gli darebbe un peso che non ha.
   *  - `accent` — "Nuovi messaggi". Qui la linea serve: è il punto in cui l'utente deve
   *    riprendere a leggere, e i due filetti la tagliano attraverso la conversazione. Il colore
   *    è quello dei badge numerici in sidebar (`--accent`), così il "3" che ha cliccato e il
   *    punto dove si ferma il vecchio sono la stessa cosa.
   */
  let { label, tone = 'muted' }: { label: string; tone?: 'muted' | 'accent' } = $props();
</script>

<!-- role="separator": in mezzo ai messaggi è un confine, non una bolla senza mittente. -->
<div class="chat-divider" class:accent={tone === 'accent'} role="separator" aria-label={label}>
  {#if tone === 'accent'}<span class="chat-divider-rule"></span>{/if}
  <span class="chat-divider-label">{label}</span>
  {#if tone === 'accent'}<span class="chat-divider-rule"></span>{/if}
</div>

<style>
  .chat-divider {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.625rem;
    width: 100%;
    padding: 0.375rem 0;
    user-select: none;
  }
  /* --ink-soft e --accent sono token veri (app.css): stesso testo in chiaro e scuro senza una
     seconda palette da tenere allineata. --ink-soft e non --ink-faint: su tema scuro quest'ultimo
     è #666 su #111, cioè 3.3:1 — sotto la soglia, e qui il testo è da 11px. --ink-soft sta a
     5.6:1 in chiaro e 7.3:1 in scuro. */
  .chat-divider-label {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .chat-divider.accent .chat-divider-label {
    /* --accent-ink: l'accento puro a 11px su carta chiara sta a 2,58:1 (app.css). */
    color: var(--accent-ink);
    font-weight: 600;
  }
  /* Il filetto è l'accent smorzato: alla stessa intensità del testo ruberebbe l'occhio a lui. */
  .chat-divider-rule {
    flex: 1;
    height: 1px;
    background: var(--accent);
    opacity: 0.35;
  }
</style>
