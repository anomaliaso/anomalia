<script lang="ts">
  /**
   * Lo sticker animato dell'avatar in chat.
   *
   * Non disegna niente di nuovo: usa `AgentAvatar`, che sa già dissolvere da un'espressione
   * all'altra invece di tagliare. Qui c'è solo il ciclo — riposo → espressione → riposo — e vive
   * come un messaggio qualunque, quindi resta lì riaprendo la conversazione fra un mese.
   *
   * `prefers-reduced-motion` ferma il loop e lascia l'espressione: chi ha chiesto meno movimento
   * vuole meno movimento, non meno messaggio.
   */
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import {
    EXPRESSION_HOLD_MS,
    EXPRESSION_REST_MS,
    EXPRESSION_STICKER_SIZE,
    faceAtElapsed
  } from '$lib/chat-expression';
  import { DEFAULT_AGENT_AVATAR_FACE, type AgentAvatarFace } from '$lib/agent-avatars';

  let {
    expression,
    color = null,
    size = EXPRESSION_STICKER_SIZE,
    note = null
  }: {
    expression: AgentAvatarFace;
    color?: string | null;
    size?: number;
    note?: string | null;
  } = $props();

  let face = $state<AgentAvatarFace>(DEFAULT_AGENT_AVATAR_FACE);

  $effect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      face = expression;
      return;
    }
    const started = Date.now();
    face = DEFAULT_AGENT_AVATAR_FACE;
    // Un solo timer per lo sticker, e la faccia calcolata dal tempo trascorso invece che da un
    // contatore: una tab in background salta i tick, e un contatore ne uscirebbe sfasato.
    const id = setInterval(
      () => {
        face = faceAtElapsed(expression, Date.now() - started);
      },
      Math.min(EXPRESSION_REST_MS, EXPRESSION_HOLD_MS) / 4
    );
    return () => clearInterval(id);
  });
</script>

<div class="ces" title={note ?? undefined} aria-label={note ?? expression}>
  <AgentAvatar {face} {color} {size} />
</div>

<style>
  .ces {
    display: inline-flex;
    align-items: center;
    /* Allineato al testo dell'agente, non centrato: è un gesto dentro il discorso, non un blocco. */
    margin: 2px 0 6px;
    line-height: 0;
  }
</style>
