import { choiceForPolicy, policyForChoice } from '$lib/chat-model-policy';
import { setThreadModel } from '$lib/stores/chat';
import { defaultReasoningFor, type ChatReasoning } from '$lib/chat-reasoning';
import { coerceChatTier, type ChatTier } from '$lib/chat-tiers';

export type ModelChoice = { tier: ChatTier | null; reasoning: ChatReasoning };

/** Cosa mostrare nel picker dato il model salvato sul thread; senza preferenza vale il default del brand. */
export function choiceForThread(model: unknown, fallbackTier: unknown): ModelChoice {
  const restored = choiceForPolicy(model);
  const tier = coerceChatTier(restored?.tier ?? fallbackTier);
  return { tier, reasoning: restored?.reasoning ?? defaultReasoningFor(tier) };
}

/**
 * Il salvataggio cross-device della scelta di modello: fire-and-forget ottimistico col rollback
 * all'ultima scelta confermata. Il DB è la fonte di verità — nessuna copia in localStorage.
 */
export function createModelChoiceSave(ops: {
  brandSlug: () => string;
  threadId: () => string | null | undefined;
  fallbackTier: () => ChatTier | null;
}) {
  let confirmed: ModelChoice | null = null;
  let seq = 0;

  function revertTo(anchor: ModelChoice | null): ModelChoice {
    const back = anchor ?? choiceForThread(null, ops.fallbackTier());
    confirmed = anchor;
    return back;
  }

  return {
    hydrate(threadModel: unknown): ModelChoice {
      confirmed = choiceForThread(threadModel, ops.fallbackTier());
      return confirmed;
    },
    save(choice: ModelChoice, apply: (c: ModelChoice) => void): void {
      const threadId = ops.threadId();
      // Nessun thread ancora (composer della home prima del primo invio): la scelta viaggia nel
      // payload del turno e il thread nasce senza preferenza.
      if (!threadId) return;
      const turn = ++seq;
      const anchor = confirmed;
      void setThreadModel(ops.brandSlug(), threadId, policyForChoice(choice.tier, choice.reasoning)).then(
        (ok) => {
          if (turn !== seq) return;
          if (ok) {
            confirmed = choice;
            return;
          }
          apply(revertTo(anchor));
        }
      );
    }
  };
}
