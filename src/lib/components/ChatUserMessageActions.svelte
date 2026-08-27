<script lang="ts">
  /**
   * Backward-compatible re-export: user-message actions row.
   * New call sites should prefer ChatMessageActions with role="user"|"assistant".
   */
  import ChatMessageActions from '$lib/components/ChatMessageActions.svelte';

  let {
    showEdit = true,
    showResend = false,
    disabled = false,
    oncopy,
    onedit,
    onresend
  }: {
    showEdit?: boolean;
    showResend?: boolean;
    disabled?: boolean;
    oncopy: () => void;
    onedit?: () => void;
    onresend?: () => void;
  } = $props();
</script>

<ChatMessageActions
  role="user"
  {showEdit}
  {showResend}
  {disabled}
  {oncopy}
  {onedit}
  {onresend}
/>
