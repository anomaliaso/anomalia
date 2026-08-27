<script lang="ts">
  /**
   * Gli sticker di un blocco di chiamate — l'unico posto che li disegna.
   *
   * Esiste per un difetto preciso: il blocco che leggeva `set_expression` e montava lo sticker
   * viveva solo dentro `ChatColumn`. La chat a pagina piena — quella dove il sidebar manda OGNI
   * thread — non ce l'aveva, quindi l'agente strizzava l'occhio nella colonna Overview e, aprendo
   * lo stesso thread dalla barra laterale, lo sticker diventava una chip maiuscola `SET_EXPRESSION`.
   * Non è il rigo mancante il difetto: è che ce n'erano due copie. Ora ce n'è una, e la usano
   * anche il turno in diretta e la pagina piena, così il turno non cambia forma fra lo streaming
   * e la riapertura.
   */
  import ChatExpressionSticker from '$lib/components/ChatExpressionSticker.svelte';
  import { expressionStickers } from '$lib/chat-expression';
  import { THEME_AVATAR_COLOR } from '$lib/agent-avatars';

  let {
    calls = [] as Array<{ toolName: string; toolCallId?: string; output?: unknown }>
  }: {
    calls?: Array<{ toolName: string; toolCallId?: string; output?: unknown }>;
  } = $props();

  const stickers = $derived(expressionStickers(calls));
</script>

{#each stickers as sticker (sticker.key)}
  <ChatExpressionSticker
    expression={sticker.expression}
    color={sticker.color ?? THEME_AVATAR_COLOR}
    note={sticker.note}
  />
{/each}
