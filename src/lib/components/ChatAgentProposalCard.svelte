<script lang="ts">
  /**
   * "Vuoi assumerlo?" — the card `propose_custom_agent` puts in the chat.
   *
   * Everything needed to decide is ON the card, including the brief in full: what gets created is
   * what is written here, so hiding it behind "trust me" would make the confirm button meaningless.
   * The brief is long, so it opens rather than shouting — but it opens.
   *
   * Confirm does not go back through the model. It posts the thread id and this tool call id, and
   * the server re-reads the proposal from the saved message: a card that says 09:00 on Monday
   * cannot create something that runs at 03:00 on Sunday, whatever the browser sends.
   */
  import { _, locale } from 'svelte-i18n';
  import { Check, X, Loader2, CalendarClock } from '@lucide/svelte';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import { BUILTIN_AGENT_AVATARS, fallbackAvatarColor, fallbackAvatarFace } from '$lib/agent-avatars';
  import { parseRoutineOwner } from '$lib/agent-owners';
  import {
    describeSchedule,
    loadProposalDecision,
    saveProposalDecision,
    type ChatAgentProposal
  } from '$lib/chat-agent-proposal';

  let {
    proposal,
    toolCallId = '',
    threadId = '',
    brandSlug,
    disabled = false,
    ondecline
  }: {
    proposal: ChatAgentProposal;
    toolCallId?: string;
    threadId?: string;
    brandSlug: string;
    disabled?: boolean;
    /** Declining speaks back into the chat — it is the start of the next proposal. */
    ondecline: (text: string) => void;
  } = $props();

  type Phase = 'idle' | 'creating' | 'created' | 'declined' | 'error';

  const stored = $derived(loadProposalDecision(threadId, toolCallId));
  let local = $state<Phase | null>(null);
  let createdId = $state<string | null>(null);
  let errorMsg = $state('');
  let showPrompt = $state(false);

  // NB: not named `state` — in a .svelte file that would turn every `$state` rune below into a
  // store subscription on it.
  const phase = $derived<Phase>(
    local ?? (stored?.state === 'created' ? 'created' : stored?.state === 'declined' ? 'declined' : 'idle')
  );
  const schedule = $derived(describeSchedule(proposal.days, proposal.times, String($locale ?? 'en')));

  /**
   * DUE SCHEDE, NON UNA. Con un proprietario questa non è un'assunzione: è una routine in più per
   * un agente che il cliente ha già. La differenza deve VEDERSI, o si continua a leggere "assumi
   * questo" e a immaginarsi un collega nuovo — che è esattamente il difetto segnalato: proposta
   * di creare un agente SEO/GEO mentre il Web Specialist stava lì a farlo.
   *
   * Quindi cambiano faccia (quella del proprietario, non una tirata a sorte dal nome del compito),
   * titolo, bottone e nota. Restano identici il brief integrale e i due pulsanti: il consenso è
   * la stessa cosa in tutti e due i casi.
   */
  const owner = $derived(parseRoutineOwner(proposal.agent));
  const builtinAvatar = $derived(owner?.kind === 'builtin' ? BUILTIN_AGENT_AVATARS[owner.agentId] : null);
  const face = $derived(builtinAvatar?.face ?? fallbackAvatarFace(proposal.ownerName || proposal.name));
  const color = $derived(builtinAvatar?.color ?? fallbackAvatarColor(proposal.ownerName || proposal.name));
  const ownerName = $derived(proposal.ownerName || '');

  async function confirm() {
    if (disabled || phase !== 'idle' || !threadId || !toolCallId) return;
    local = 'creating';
    errorMsg = '';
    try {
      const res = await fetch(`/app/${brandSlug}/chat/agents/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: threadId, tool_call_id: toolCallId })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.id) {
        local = 'error';
        errorMsg = body?.message || $_('app.shell.agentProposal.failed');
        return;
      }
      createdId = body.id;
      local = 'created';
      saveProposalDecision(threadId, toolCallId, { state: 'created', id: body.id });
    } catch {
      local = 'error';
      errorMsg = $_('app.shell.agentProposal.failed');
    }
  }

  function decline() {
    if (disabled || phase !== 'idle') return;
    local = 'declined';
    saveProposalDecision(threadId, toolCallId, { state: 'declined' });
    ondecline($_('app.shell.agentProposal.declineMessage', { values: { name: proposal.name } }));
  }
</script>

<div class="ap-card" class:settled={phase === 'created' || phase === 'declined'} data-tool-call={toolCallId || undefined}>
  {#if proposal.because && phase === 'idle'}
    <p class="ap-because">{proposal.because}</p>
  {/if}

  {#if owner && ownerName}
    <p class="ap-forwhom">{$_('app.shell.agentProposal.routineFor', { values: { name: ownerName } })}</p>
  {/if}

  <div class="ap-head">
    <AgentAvatar {face} {color} size={34} title={ownerName || proposal.name} />
    <div class="ap-id">
      <strong>{proposal.name}</strong>
      <span class="ap-when"><CalendarClock class="size-3" strokeWidth={2} />{schedule}</span>
    </div>
    <!-- Senza proprietario resta l'hub che la esegue; con un proprietario il nome sta già
         nell'intestazione qui sopra (`team:analyst` non ha nemmeno una chiave sotto agents.*). -->
    {#if !owner}
      <span class="ap-agent">{$_(`app.shell.agentProposal.agents.${proposal.agent}`)}</span>
    {/if}
  </div>

  {#if phase === 'created'}
    <div class="ap-settled ok">
      <Check class="size-3.5" strokeWidth={2.2} />
      <span>{owner ? $_('app.shell.agentProposal.createdRoutine') : $_('app.shell.agentProposal.created')}</span>
      <a href={`/app/${brandSlug}/agents${createdId ? `?agent=${createdId}` : ''}`}>{$_('app.shell.agentProposal.manage')}</a>
    </div>
  {:else if phase === 'declined'}
    <div class="ap-settled">
      <X class="size-3.5" strokeWidth={2.2} />
      <span>{$_('app.shell.agentProposal.declined')}</span>
    </div>
  {:else}
    {#if proposal.outputs.length}
      <div class="ap-outputs">
        {#each proposal.outputs as o (o)}<span>{o}</span>{/each}
      </div>
    {/if}

    <button type="button" class="ap-toggle" onclick={() => (showPrompt = !showPrompt)}>
      {showPrompt ? $_('app.shell.agentProposal.hideBrief') : $_('app.shell.agentProposal.showBrief')}
    </button>
    {#if showPrompt}
      <p class="ap-prompt">{proposal.prompt}</p>
    {/if}

    <p class="ap-note">
      {owner && ownerName
        ? $_('app.shell.agentProposal.noteRoutine', { values: { name: ownerName } })
        : $_('app.shell.agentProposal.note')}
    </p>

    {#if phase === 'error'}
      <p class="ap-error">{errorMsg}</p>
    {/if}

    <div class="ap-actions">
      <button type="button" class="ap-yes" disabled={disabled || phase === 'creating'} onclick={confirm}>
        {#if phase === 'creating'}
          <Loader2 class="size-3.5 animate-spin" strokeWidth={2.2} />
        {:else}
          <Check class="size-3.5" strokeWidth={2.2} />
        {/if}
        {owner ? $_('app.shell.agentProposal.confirmRoutine') : $_('app.shell.agentProposal.confirm')}
      </button>
      <button type="button" class="ap-no" disabled={disabled || phase === 'creating'} onclick={decline}>
        {$_('app.shell.agentProposal.decline')}
      </button>
    </div>
  {/if}
</div>

<style>
  .ap-card {
    margin: 0.35rem 0 0.6rem;
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--line, color-mix(in oklab, var(--border) 80%, transparent));
    border-radius: 12px;
    background: color-mix(in oklab, var(--muted) 35%, var(--background));
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    max-width: 30rem;
  }
  .ap-card.settled { opacity: 0.92; }
  .ap-forwhom {
    margin: 0 0 6px; font-size: 12px; font-weight: 600; letter-spacing: 0.01em;
    color: var(--ink-faint);
  }
  .ap-because {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--muted-foreground);
  }
  .ap-head { display: flex; align-items: center; gap: 0.6rem; }
  .ap-id { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; flex: 1; }
  .ap-id strong { font-size: 13.5px; font-weight: 650; line-height: 1.2; }
  .ap-when {
    display: inline-flex; align-items: center; gap: 0.25rem;
    font-size: 11.5px; color: var(--muted-foreground);
  }
  .ap-agent {
    font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--muted-foreground); border: 1px solid var(--border);
    border-radius: 999px; padding: 0.15rem 0.5rem; white-space: nowrap;
  }
  .ap-outputs { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .ap-outputs span {
    font-size: 11.5px; color: var(--foreground);
    background: var(--background); border: 1px solid var(--border);
    border-radius: 999px; padding: 0.15rem 0.55rem;
  }
  .ap-toggle {
    align-self: flex-start; appearance: none; background: none; border: 0; padding: 0;
    font-size: 11.5px; font-weight: 600; color: var(--muted-foreground);
    text-decoration: underline; cursor: pointer;
  }
  .ap-prompt {
    margin: 0; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap;
    color: var(--foreground); background: var(--background);
    border: 1px solid var(--border); border-radius: 10px; padding: 0.55rem 0.65rem;
    max-height: 16rem; overflow-y: auto;
  }
  .ap-note { margin: 0; font-size: 11px; color: var(--muted-foreground); line-height: 1.4; }
  .ap-error { margin: 0; font-size: 11.5px; color: #b91c1c; }
  .ap-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .ap-yes, .ap-no {
    appearance: none; border-radius: 999px; padding: 0.4rem 0.9rem;
    font-size: 12.5px; font-weight: 600; line-height: 1.2; cursor: pointer;
    display: inline-flex; align-items: center; gap: 0.3rem;
    transition: background 0.12s ease, border-color 0.12s ease;
  }
  .ap-yes { border: 1px solid var(--foreground); background: var(--foreground); color: var(--background); }
  .ap-no { border: 1px solid var(--border); background: var(--background); color: var(--foreground); }
  .ap-no:hover:not(:disabled) { border-color: color-mix(in oklab, var(--foreground) 18%, var(--border)); }
  .ap-yes:disabled, .ap-no:disabled { opacity: 0.55; cursor: not-allowed; }
  .ap-settled {
    display: flex; align-items: center; gap: 0.35rem;
    font-size: 11.5px; font-weight: 600; color: var(--muted-foreground);
  }
  .ap-settled.ok { color: var(--foreground); }
  .ap-settled a { color: inherit; text-decoration: underline; font-weight: 600; }
</style>
