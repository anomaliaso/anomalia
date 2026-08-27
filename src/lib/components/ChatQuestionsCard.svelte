<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { untrack } from 'svelte';
  import { ArrowLeft, Check, PenLine, Send, X } from '@lucide/svelte';
  import {
    type ChatQuestion,
    type ChatQuestionsProgress,
    detectQuestionsAnsweredFromHistory,
    formatQuestionAnswers,
    loadQuestionsProgress,
    saveQuestionsProgress
  } from '$lib/chat-questions';

  let {
    questions,
    toolCallId = '',
    threadId = '',
    followingUserTexts = [] as string[],
    disabled = false,
    onanswer
  }: {
    questions: ChatQuestion[];
    toolCallId?: string;
    threadId?: string;
    /** User messages that came after this assistant card (for reload detection). */
    followingUserTexts?: string[];
    disabled?: boolean;
    onanswer: (text: string) => void;
  } = $props();

  /** A, B, C… — la lettera è anche la scorciatoia da tastiera, quindi una sola fonte. */
  const LETTERS = 'ABCDEF';

  let progress = $state<ChatQuestionsProgress>({ answers: {}, index: 0, done: false, skipped: [] });
  /** I bottoni della domanda corrente, per muovere il fuoco con le frecce. */
  let rowEls = $state<Array<HTMLButtonElement | null>>([]);
  /** Il campo libero è aperto? (una risposta che non era fra le opzioni) */
  let customOpen = $state(false);
  let customText = $state('');

  function sameProgress(a: ChatQuestionsProgress, b: ChatQuestionsProgress): boolean {
    if (a.done !== b.done || a.index !== b.index || !!a.dismissed !== !!b.dismissed) return false;
    if ((a.skipped ?? []).join('|') !== (b.skipped ?? []).join('|')) return false;
    const ak = Object.keys(a.answers);
    const bk = Object.keys(b.answers);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => a.answers[k] === b.answers[k]);
  }

  $effect(() => {
    const fromHistory = detectQuestionsAnsweredFromHistory(questions, followingUserTexts);
    const stored =
      threadId && toolCallId ? loadQuestionsProgress(threadId, toolCallId) : null;

    let next: ChatQuestionsProgress;
    if (fromHistory.done) {
      // Le risposte sono già nel thread come messaggio utente: la card è chiusa per sempre,
      // in questa sessione e in ogni riapertura della chat.
      next = { answers: fromHistory.answers, index: questions.length, done: true, skipped: [] };
      if (threadId && toolCallId) saveQuestionsProgress(threadId, toolCallId, next);
    } else if (stored?.done || stored?.dismissed) {
      next = stored;
    } else {
      // Card ANCORA IN ATTESA: si riprende esattamente dove il wizard era rimasto — il turno del
      // modello è fermo su questa domanda e nessuno risponderà al posto dell'utente.
      const answers = { ...(stored?.answers ?? {}), ...fromHistory.answers };
      const skipped = stored?.skipped ?? [];
      // Il passo del wizard salvato si rispetta com'è: se l'utente è tornato INDIETRO su una
      // domanda già risposta, ricalcolarlo lo spingerebbe di nuovo avanti e "Indietro" non
      // funzionerebbe mai. Si ricalcola solo quando non c'è uno stato salvato — cioè quando le
      // risposte arrivano dal thread (altra scheda, altro dispositivo).
      let index = stored?.index ?? 0;
      if (!stored) {
        while (index < questions.length && answers[questions[index].id]) index += 1;
      }
      next = { answers, index, done: false, skipped };
    }

    // Don't subscribe to `progress` — only write when the computed value actually changes.
    const prev = untrack(() => progress);
    if (!sameProgress(prev, next)) progress = next;
  });

  const settled = $derived(progress.done || !!progress.dismissed);
  const current = $derived(
    !settled && progress.index < questions.length ? questions[progress.index] : null
  );
  /** Ultimo passo del wizard: tutte viste, si rilegge e si invia in un colpo solo. */
  const reviewing = $derived(!settled && progress.index >= questions.length);

  function commit(next: ChatQuestionsProgress) {
    progress = next;
    if (threadId && toolCallId) saveQuestionsProgress(threadId, toolCallId, next);
  }

  /** Il messaggio che riapre il turno: TUTTE le risposte insieme, saltate incluse. */
  function submit(answers: Record<string, string>) {
    const text = formatQuestionAnswers(questions, answers, $_('app.shell.questionsSkipped'));
    const anySkipped = questions.some((q) => !answers[q.id]);
    onanswer(anySkipped ? `${text}\n\n${$_('app.shell.questionsSkipNote')}` : text);
  }

  function advance(answers: Record<string, string>, skipped: string[]) {
    // La prossima domanda ancora aperta, non semplicemente quella dopo: così correggere una
    // risposta dal riepilogo riporta al riepilogo, invece di rifare tutto il giro.
    let nextIndex = progress.index + 1;
    while (nextIndex < questions.length) {
      const q = questions[nextIndex];
      if (!answers[q.id] && !skipped.includes(q.id)) break;
      nextIndex += 1;
    }
    // Una domanda sola: nessun riepilogo da rileggere, la risposta parte subito.
    const finish = questions.length === 1;
    commit({ answers, skipped, index: nextIndex, done: finish, dismissed: false });
    customOpen = false;
    customText = '';
    rowEls = [];
    if (finish) submit(answers);
  }

  function pick(label: string) {
    if (disabled || settled || !current) return;
    advance(
      { ...progress.answers, [current.id]: label },
      (progress.skipped ?? []).filter((id) => id !== current.id)
    );
  }

  function useCustom() {
    const text = customText.trim();
    if (!text) return;
    pick(text);
  }

  /** Salta UNA domanda: non è una risposta vuota, il messaggio finale dirà che è stata saltata. */
  function skipOne() {
    if (disabled || settled || !current) return;
    const answers = { ...progress.answers };
    delete answers[current.id];
    const skipped = [...(progress.skipped ?? []).filter((id) => id !== current.id), current.id];
    advance(answers, skipped);
  }

  function back() {
    if (disabled || settled || progress.index === 0) return;
    customOpen = false;
    customText = '';
    rowEls = [];
    commit({ ...progress, index: progress.index - 1, done: false });
  }

  /**
   * Il ✕ salta TUTTO il resto e manda comunque un messaggio. Da quando il turno si chiude sulla
   * domanda, chiudere la card in silenzio lascerebbe la conversazione ferma per sempre.
   */
  function skipAll() {
    if (disabled || settled) return;
    const skipped = questions.filter((q) => !progress.answers[q.id]).map((q) => q.id);
    commit({ ...progress, index: questions.length, done: true, dismissed: true, skipped });
    submit(progress.answers);
  }

  function send() {
    if (disabled || settled) return;
    commit({ ...progress, index: questions.length, done: true });
    submit(progress.answers);
  }

  /** Frecce per scorrere, lettera per scegliere: le stesse due cose che si vedono sulla riga. */
  function onKeydown(e: KeyboardEvent) {
    if (!current || disabled || customOpen) return;
    const rows = rowEls.filter((el): el is HTMLButtonElement => !!el);
    if (!rows.length) return;
    const here = rows.indexOf(document.activeElement as HTMLButtonElement);

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const from = here === -1 ? (step === 1 ? -1 : 0) : here;
      rows[(from + step + rows.length) % rows.length].focus();
      return;
    }
    if (e.key.length === 1) {
      const idx = LETTERS.indexOf(e.key.toUpperCase());
      if (idx >= 0 && idx < current.options.length) {
        e.preventDefault();
        pick(current.options[idx].label);
      }
    }
  }

  function answerOf(q: ChatQuestion): string | null {
    return progress.answers[q.id] ?? null;
  }
</script>

{#if questions.length}
  <div class="q-card" class:done={settled} data-tool-call={toolCallId || undefined}>
    {#if settled}
      <div class="q-recap-head">
        <Check class="size-3.5" strokeWidth={2.2} />
        <span>
          {progress.dismissed ? $_('app.shell.questionsDismiss') : $_('app.shell.questionsAnswered')}
        </span>
      </div>
      <ul class="q-recap">
        {#each questions as q (q.id)}
          {@const chosen = q.options.findIndex((o) => o.label === answerOf(q))}
          <li>
            <span class="q-recap-prompt">{q.prompt}</span>
            <span class="q-row q-row-static" class:picked={!!answerOf(q)}>
              <span class="q-badge">{chosen >= 0 ? LETTERS[chosen] : answerOf(q) ? '✎' : '—'}</span>
              <span class="q-text">
                <span class="q-label" class:muted={!answerOf(q)}>
                  {answerOf(q) ?? $_('app.shell.questionsSkipped')}
                </span>
                {#if chosen >= 0 && q.options[chosen].description}
                  <span class="q-desc">{q.options[chosen].description}</span>
                {/if}
              </span>
              {#if answerOf(q)}
                <Check class="size-3.5 q-tick" strokeWidth={2.4} />
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    {:else if reviewing}
      <div class="q-head">
        <p class="q-prompt">{$_('app.shell.questionsReview')}</p>
        <button
          type="button"
          class="q-skip"
          title={$_('app.shell.questionsSkip')}
          aria-label={$_('app.shell.questionsSkip')}
          onclick={skipAll}
          {disabled}
        >
          <X class="size-3.5" strokeWidth={2.2} />
        </button>
      </div>
      <ul class="q-recap q-recap-live">
        {#each questions as q, qi (q.id)}
          {@const chosen = q.options.findIndex((o) => o.label === answerOf(q))}
          <li>
            <span class="q-recap-prompt">{qi + 1}. {q.prompt}</span>
            <button
              type="button"
              class="q-row"
              {disabled}
              onclick={() => commit({ ...progress, index: qi })}
            >
              <span class="q-badge">{chosen >= 0 ? LETTERS[chosen] : answerOf(q) ? '✎' : '—'}</span>
              <span class="q-text">
                <span class="q-label" class:muted={!answerOf(q)}>
                  {answerOf(q) ?? $_('app.shell.questionsSkipped')}
                </span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
      <div class="q-foot">
        <button type="button" class="q-ctl" onclick={back} {disabled}>
          <ArrowLeft class="size-3" strokeWidth={2.2} />
          {$_('app.shell.questionsBack')}
        </button>
        <button type="button" class="q-ctl q-ctl-go" onclick={send} {disabled}>
          <Send class="size-3" strokeWidth={2.2} />
          {$_('app.shell.questionsSend')}
        </button>
      </div>
    {:else if current}
      <div class="q-head">
        <p class="q-prompt" id={`qp-${toolCallId}`}>{current.prompt}</p>
        <button
          type="button"
          class="q-skip"
          title={$_('app.shell.questionsSkip')}
          aria-label={$_('app.shell.questionsSkip')}
          onclick={skipAll}
          {disabled}
        >
          <X class="size-3.5" strokeWidth={2.2} />
        </button>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div class="q-rows" role="group" aria-labelledby={`qp-${toolCallId}`} onkeydown={onKeydown}>
        {#each current.options as opt, idx (opt.id)}
          <button
            type="button"
            class="q-row"
            class:picked={progress.answers[current.id] === opt.label}
            {disabled}
            bind:this={rowEls[idx]}
            onclick={() => pick(opt.label)}
          >
            <span class="q-badge">{LETTERS[idx] ?? '•'}</span>
            <span class="q-text">
              <span class="q-label">{opt.label}</span>
              {#if opt.description}
                <span class="q-desc">{opt.description}</span>
              {/if}
            </span>
            {#if progress.answers[current.id] === opt.label}
              <Check class="size-3.5 q-tick" strokeWidth={2.4} />
            {/if}
          </button>
        {/each}

        <!-- Nessuna delle opzioni è la risposta vera: si scrive. Senza questa riga la card
             costringe a mentire scegliendo la meno sbagliata. -->
        {#if customOpen}
          <div class="q-row q-custom">
            <span class="q-badge"><PenLine class="size-3" strokeWidth={2.2} /></span>
            <span class="q-text">
              <!-- svelte-ignore a11y_autofocus -->
              <textarea
                class="q-input"
                rows="2"
                autofocus
                bind:value={customText}
                placeholder={$_('app.shell.questionsCustomPlaceholder')}
                {disabled}
                onkeydown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    useCustom();
                  }
                  if (e.key === 'Escape') customOpen = false;
                }}
              ></textarea>
              <button
                type="button"
                class="q-ctl q-ctl-go q-custom-go"
                onclick={useCustom}
                disabled={disabled || !customText.trim()}
              >
                <Check class="size-3" strokeWidth={2.2} />
                {$_('app.shell.questionsCustomConfirm')}
              </button>
            </span>
          </div>
        {:else}
          <button
            type="button"
            class="q-row q-row-alt"
            {disabled}
            onclick={() => {
              customOpen = true;
            }}
          >
            <span class="q-badge"><PenLine class="size-3" strokeWidth={2.2} /></span>
            <span class="q-text">
              <span class="q-label">{$_('app.shell.questionsCustom')}</span>
            </span>
          </button>
        {/if}
      </div>
      <div class="q-foot">
        <div class="q-foot-left">
          {#if progress.index > 0}
            <button type="button" class="q-ctl" onclick={back} {disabled}>
              <ArrowLeft class="size-3" strokeWidth={2.2} />
              {$_('app.shell.questionsBack')}
            </button>
          {/if}
          <button type="button" class="q-ctl" onclick={skipOne} {disabled}>
            {$_('app.shell.questionsSkipOne')}
          </button>
        </div>
        {#if questions.length > 1}
          <span class="q-progress">
            {$_('app.shell.questionsProgress', {
              values: { current: progress.index + 1, total: questions.length }
            })}
          </span>
        {:else}
          <span class="q-progress">{$_('app.shell.questionsWaiting')}</span>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Una scheda, non un gruppo di pillole: le righe arrivano ai bordi e sono separate da un
     capello, così la scelta si legge come un elenco e non come una barra di bottoni. */
  .q-card {
    margin: 0.4rem 0 0.7rem;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--paper-2);
    overflow: hidden;
    max-width: 34rem;
  }
  .q-card.done {
    opacity: 0.9;
  }
  .q-head {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.8rem 0.9rem 0.7rem;
  }
  .q-prompt {
    margin: 0;
    flex: 1;
    font-size: 14.5px;
    font-weight: 550;
    line-height: 1.35;
    color: var(--ink);
  }
  .q-skip {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--ink-faint);
    padding: 0.2rem;
    margin: -0.15rem -0.15rem 0 0;
    border-radius: 8px;
    cursor: pointer;
    display: inline-flex;
    line-height: 0;
    flex: 0 0 auto;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .q-skip:hover:not(:disabled) {
    background: var(--paper-3);
    color: var(--ink);
  }
  .q-skip:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .q-rows {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--line);
  }
  .q-row {
    appearance: none;
    border: 0;
    border-radius: 0;
    background: transparent;
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    text-align: left;
    padding: 0.6rem 0.9rem;
    cursor: pointer;
    color: var(--ink);
    transition: background 0.12s ease;
  }
  .q-rows .q-row + .q-row,
  .q-rows .q-custom {
    border-top: 1px solid var(--line);
  }
  .q-row:hover:not(:disabled),
  .q-row:focus-visible {
    background: var(--paper-3);
    outline: none;
  }
  .q-row:focus-visible .q-badge {
    border-color: var(--accent);
    color: var(--ink);
  }
  .q-row:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .q-row-alt .q-label {
    color: var(--ink-soft);
  }
  .q-badge {
    flex: 0 0 auto;
    width: 1.15rem;
    height: 1.15rem;
    margin-top: 0.08rem;
    border: 1px solid var(--line-2);
    border-radius: 6px;
    background: var(--paper);
    color: var(--ink-soft);
    font-size: 10.5px;
    font-weight: 650;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .q-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
    flex: 1;
  }
  .q-label {
    font-size: 13.5px;
    font-weight: 550;
    line-height: 1.3;
    color: var(--ink);
  }
  .q-label.muted {
    color: var(--ink-faint);
    font-style: italic;
    font-weight: 500;
  }
  /* La riga che rende la scelta comprensibile: cosa comporta scegliere questa opzione. */
  .q-desc {
    font-size: 12px;
    line-height: 1.35;
    color: var(--ink-soft);
  }
  .q-custom {
    cursor: default;
    background: var(--paper-3);
  }
  .q-input {
    width: 100%;
    resize: vertical;
    border: 1px solid var(--line-2);
    border-radius: 8px;
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    line-height: 1.35;
    padding: 0.4rem 0.5rem;
  }
  .q-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .q-custom-go {
    align-self: flex-start;
    margin-top: 0.35rem;
  }
  .q-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.45rem 0.6rem 0.5rem 0.9rem;
    border-top: 1px solid var(--line);
  }
  .q-foot-left {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    margin-left: -0.5rem;
  }
  .q-progress {
    flex: 0 0 auto;
    padding-right: 0.3rem;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .q-ctl {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--ink-soft);
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.3rem 0.5rem;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 550;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .q-ctl:hover:not(:disabled) {
    background: var(--paper-3);
    color: var(--ink);
  }
  .q-ctl:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .q-ctl-go {
    border: 1px solid var(--line-2);
    background: var(--paper);
    color: var(--ink);
  }
  .q-recap-head {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.7rem 0.9rem 0;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--ink-faint);
  }
  .q-recap {
    list-style: none;
    margin: 0;
    padding: 0.5rem 0 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .q-recap-live {
    border-top: 1px solid var(--line);
    padding-top: 0.6rem;
  }
  .q-recap-prompt {
    display: block;
    padding: 0 0.9rem 0.25rem;
    font-size: 11.5px;
    color: var(--ink-faint);
  }
  .q-row-static {
    cursor: default;
    align-items: center;
  }
  /* La scelta fatta resta visibile nel transcript, evidenziata — riaperta la chat si vede ancora. */
  .q-row.picked {
    background: color-mix(in srgb, var(--accent) 10%, var(--paper-2));
  }
  .q-row.picked .q-badge {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--line-2));
    color: var(--ink);
  }
  :global(.q-tick) {
    margin-left: auto;
    flex: 0 0 auto;
    color: var(--ink-soft);
  }
</style>
