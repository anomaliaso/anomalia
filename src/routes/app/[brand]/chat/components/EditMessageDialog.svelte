<script lang="ts">
  let {
    text = $bindable(''),
    oncancel,
    onconfirm
  }: {
    text?: string;
    oncancel: () => void;
    onconfirm: () => void;
  } = $props();
</script>

<div class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" onclick={(e) => e.target === e.currentTarget && oncancel()}>
  <div class="bg-background border border-border rounded-lg shadow-lg max-w-md w-full max-h-[80vh] flex flex-col" onclick={(e) => e.stopPropagation()}>
    <div class="px-6 py-4 border-b border-border">
      <h2 class="text-lg font-semibold">Edit message</h2>
    </div>
    <div class="flex-1 overflow-y-auto px-6 py-4">
      <textarea
        bind:value={text}
        class="w-full h-40 p-3 border border-border rounded-lg font-[family-name:var(--sans)] text-sm outline-none focus:border-primary resize-none"
        placeholder="Edit your message..."
        autofocus
      ></textarea>
    </div>
    <div class="px-6 py-4 border-t border-border flex gap-2 justify-end">
      <button class="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors" onclick={oncancel}>
        Cancel
      </button>
      <button class="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity" onclick={onconfirm}>
        Update & Send
      </button>
    </div>
  </div>
</div>
