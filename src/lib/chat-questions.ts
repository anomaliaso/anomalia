/** Types + helpers for the ask_user_questions chat card. */

export type ChatQuestionOption = {
  id: string;
  label: string;
  /**
   * La riga sotto l'etichetta: cosa COMPORTA scegliere questa opzione ("Threads oggi, LinkedIn
   * domenica"). Senza, "Google Workspace" e "Altre app" sono due stringhe indistinguibili e la
   * scelta si fa a caso — è questa riga a rendere la domanda rispondibile. Opzionale nel tipo
   * perché le card già salvate nei thread non ce l'hanno; il modello ha istruzione di scriverla
   * sempre (vedi la descrizione del tool in chat/tools.ts).
   */
  description?: string;
};

export type ChatQuestion = {
  id: string;
  prompt: string;
  options: ChatQuestionOption[];
};

export type ChatQuestionsPayload = {
  questions: ChatQuestion[];
};

export type ChatQuestionsProgress = {
  /** questionId → selected option label */
  answers: Record<string, string>;
  /** Index of the question currently shown (sequential UI). */
  index: number;
  done: boolean;
  /**
   * L'utente ha chiuso TUTTA la card col ✕. Da quando il turno si ferma sulla domanda questo non
   * è più un "nascondi e basta": manda un messaggio esplicito di rinuncia, altrimenti la
   * conversazione resterebbe ferma per sempre su una domanda che non interessava.
   */
  dismissed?: boolean;
  /**
   * Le singole domande saltate dentro il wizard (id). Separate da `answers` di proposito: una
   * domanda saltata NON è una risposta vuota — nel messaggio finale si dice che è stata saltata,
   * e nel riepilogo si vede che l'utente ha scelto di non scegliere.
   */
  skipped?: string[];
};

const storageKey = (threadId: string, toolCallId: string) =>
  `anomalia:chat-q:${threadId}:${toolCallId}`;

export function loadQuestionsProgress(
  threadId: string,
  toolCallId: string
): ChatQuestionsProgress | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey(threadId, toolCallId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatQuestionsProgress;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      answers: parsed.answers && typeof parsed.answers === 'object' ? parsed.answers : {},
      index: typeof parsed.index === 'number' ? parsed.index : 0,
      done: !!parsed.done,
      dismissed: !!parsed.dismissed,
      skipped: Array.isArray(parsed.skipped) ? parsed.skipped.filter((x) => typeof x === 'string') : []
    };
  } catch {
    return null;
  }
}

export function saveQuestionsProgress(
  threadId: string,
  toolCallId: string,
  progress: ChatQuestionsProgress
): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(storageKey(threadId, toolCallId), JSON.stringify(progress));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Il messaggio utente che chiude il wizard: TUTTE le risposte insieme, una volta sola.
 *
 * Una domanda saltata compare comunque, con la sua etichetta — il modello deve sapere che è stata
 * saltata (e non riproporla), non trovarsi un buco che sembra una risposta vuota.
 */
export function formatQuestionAnswers(
  questions: ChatQuestion[],
  answers: Record<string, string>,
  skippedLabel = 'skipped'
): string {
  // Una domanda sola, risposta: il messaggio è l'etichetta e basta — è quello che l'utente ha
  // "detto", e nel transcript si legge come una risposta umana invece che come un modulo.
  if (questions.length === 1 && answers[questions[0].id]) {
    return answers[questions[0].id];
  }
  return questions
    .map((q, i) => `${i + 1}. ${q.prompt}\n→ ${answers[q.id] ?? `(${skippedLabel})`}`)
    .join('\n\n');
}

/**
 * Detect whether the user already answered this card from chat history
 * (survives leaving the browser — answers are normal user messages).
 */
export function detectQuestionsAnsweredFromHistory(
  questions: ChatQuestion[],
  followingUserTexts: string[]
): { done: boolean; answers: Record<string, string> } {
  const answers: Record<string, string> = {};
  if (!questions.length || !followingUserTexts.length) {
    return { done: false, answers };
  }

  const allLabels = new Map<string, { qid: string; label: string }>();
  for (const q of questions) {
    for (const opt of q.options) {
      allLabels.set(opt.label.trim().toLowerCase(), { qid: q.id, label: opt.label });
    }
  }

  for (const raw of followingUserTexts) {
    const text = (raw ?? '').trim();
    if (!text) continue;

    // Single-question: exact option label
    const hit = allLabels.get(text.toLowerCase());
    if (hit && questions.length === 1) {
      answers[hit.qid] = hit.label;
      return { done: true, answers };
    }

    // Blocchi "N. prompt\n→ label" — anche con UNA domanda sola, perché è la forma che esce
    // quando è stata saltata: senza questo ramo la card tornerebbe da rispondere a ogni reload.
    if (text.includes('→')) {
      for (const q of questions) {
        const re = new RegExp(
          `(?:^|\\n)\\d+\\.\\s*${escapeRegExp(q.prompt)}\\s*\\n→\\s*(.+)`,
          'i'
        );
        const m = text.match(re);
        if (m?.[1]) {
          const label = m[1].trim();
          const opt = q.options.find((o) => o.label.trim().toLowerCase() === label.toLowerCase());
          answers[q.id] = opt?.label ?? label;
        }
      }
      if (questions.every((q) => answers[q.id])) {
        return { done: true, answers };
      }
    }

    // Fallback: message is exactly one option label (partial / single click mid-flow)
    if (hit && !answers[hit.qid]) {
      answers[hit.qid] = hit.label;
    }
  }

  const done = questions.every((q) => !!answers[q.id]);
  return { done, answers };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normalize / validate tool output before attaching to tool_calls. */
export function normalizeQuestionsPayload(raw: unknown): ChatQuestionsPayload | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = raw as any;
  if (!out || !Array.isArray(out.questions) || !out.questions.length) return null;
  const questions: ChatQuestion[] = [];
  for (const q of out.questions) {
    if (!q || typeof q.prompt !== 'string' || !q.prompt.trim()) continue;
    if (!Array.isArray(q.options) || q.options.length < 2) continue;
    const options: ChatQuestionOption[] = [];
    for (const o of q.options) {
      if (!o || typeof o.label !== 'string' || !o.label.trim()) continue;
      const description = typeof o.description === 'string' ? o.description.trim() : '';
      options.push({
        id: typeof o.id === 'string' && o.id ? o.id : `opt-${options.length}`,
        label: o.label.trim(),
        ...(description ? { description } : {})
      });
    }
    if (options.length < 2) continue;
    questions.push({
      id: typeof q.id === 'string' && q.id ? q.id : `q-${questions.length}`,
      prompt: q.prompt.trim(),
      options
    });
  }
  if (!questions.length) return null;
  return { questions };
}
