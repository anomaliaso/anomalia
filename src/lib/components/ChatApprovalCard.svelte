<script lang="ts">
  let {
    approvalId,
    toolName,
    input,
    status = 'pending',
    disabled = false,
    ondecision
  }: {
    approvalId: string;
    toolName: string;
    input: unknown;
    status?: string;
    disabled?: boolean;
    ondecision: (approved: boolean) => Promise<void> | void;
  } = $props();

  let busy = $state(false);

  function redact(value: unknown, key = ''): unknown {
    if (/api.?key|authorization|credential|password|secret|token/i.test(key)) return '[redacted]';
    if (Array.isArray(value)) return value.map((item) => redact(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  }

  async function decide(approved: boolean) {
    if (busy || disabled) return;
    busy = true;
    try {
      await ondecision(approved);
    } finally {
      busy = false;
    }
  }
</script>

<section class="approval-card" aria-label="Tool approval">
  <div class="approval-title">{status === 'approved' ? 'Approved' : status === 'denied' ? 'Denied' : 'Approval required'}</div>
  <div class="approval-tool">{toolName.replace(/_/g, ' ')}</div>
  <pre>{JSON.stringify(redact(input), null, 2)}</pre>
  {#if status === 'pending'}
    <div class="approval-actions">
      <button type="button" class="approval-deny" disabled={disabled || busy} onclick={() => decide(false)}>Deny</button>
      <button type="button" class="approval-allow" disabled={disabled || busy} onclick={() => decide(true)}>Allow</button>
    </div>
  {/if}
</section>

<style>
  .approval-card {
    margin: 0.65rem 0 0.9rem 2.35rem;
    max-width: 34rem;
    border: 1px solid var(--line, #d7d7d7);
    border-radius: 0.75rem;
    padding: 0.85rem;
    background: var(--paper, #fff);
  }

  .approval-title { font-weight: 650; }
  .approval-tool { margin-top: 0.2rem; color: var(--ink-faint, #666); font-size: 0.85rem; }
  pre { max-height: 12rem; overflow: auto; margin: 0.7rem 0; white-space: pre-wrap; font-size: 0.75rem; }
  .approval-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
  button { border: 0; border-radius: 0.5rem; padding: 0.45rem 0.75rem; cursor: pointer; }
  button:disabled { cursor: wait; opacity: 0.55; }
  .approval-deny { background: var(--paper-3, #eee); }
  .approval-allow { color: white; background: var(--accent, #2563eb); }
</style>
