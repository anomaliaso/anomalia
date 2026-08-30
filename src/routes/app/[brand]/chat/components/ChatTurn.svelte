<script lang="ts">
  import { goto } from '$app/navigation';
  import { openPageModal } from '$lib/components/PageModal.svelte';
  import { openPlanDocument } from '$lib/stores/plan-panel';
  import { _, locale } from 'svelte-i18n';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import PostCard from '$lib/components/PostCard.svelte';
  import ChatThought from '$lib/components/ChatThought.svelte';
  import ChatToolChips from '$lib/components/ChatToolChips.svelte';
  import ChatArtifactCard from '$lib/components/ChatArtifactCard.svelte';
  import ChatExpressionStickers from '$lib/components/ChatExpressionStickers.svelte';
  import ChatDmChip from '$lib/components/ChatDmChip.svelte';
  import ChatMediaCard from '$lib/components/ChatMediaCard.svelte';
  import ChatGoalStatusCard from '$lib/components/ChatGoalStatusCard.svelte';
  import ChatRoutineEventRow from '$lib/components/ChatRoutineEventRow.svelte';
  import ChatPlanCard from '$lib/components/ChatPlanCard.svelte';
  import ChatConnectCard from '$lib/components/ChatConnectCard.svelte';
  import ChatDeviceLoginCard from '$lib/components/ChatDeviceLoginCard.svelte';
  import ChatQuestionsCard from '$lib/components/ChatQuestionsCard.svelte';
  import ChatApprovalCard from '$lib/components/ChatApprovalCard.svelte';
  import ChatTeamCard from '$lib/components/ChatTeamCard.svelte';
  import ChatMessageActions from '$lib/components/ChatMessageActions.svelte';
  import ChatSources from '$lib/components/ChatSources.svelte';
  import ChatSpeakerTag from './ChatSpeakerTag.svelte';
  import ChatAttStrip from './ChatAttStrip.svelte';
  import { messageBlocks, previewsByCall, textBubbleRange } from '$lib/chat-parts';
  import { mediaFromToolCall, splitTextMedia, showMediaUrls } from '$lib/chat-media';
  import { renderMd } from '$lib/chat-markdown';
  import ChatAgentProposalCard from '$lib/components/ChatAgentProposalCard.svelte';
  import { normalizeConnectPayload } from '$lib/chat-connect';
  import { normalizeTeamPayload } from '$lib/chat-team';
  import { ROUTINE_EVENT_TOOLS, normalizeRoutineEvent } from '$lib/chat-routine-event';
  import { normalizeDeviceLoginPayload } from '$lib/chat-device-login';
  import { normalizeAgentProposal } from '$lib/chat-agent-proposal';
  import { splitGoalStatus } from '$lib/goal-status';
  import { planByKey, monthlyPrice, CURRENCY_SYMBOL } from '$lib/plans';
  import { workbenchTabLabel } from '$lib/workbench-paths';
  import type { AgentAvatarFace } from '$lib/agent-avatars';
  import type { ChatArtifactUi, ChatMessage, ToolCallUi, OpenTabProposal, PostPreview } from './transcript';

  type SpeakerWho = { face: AgentAvatarFace; color: string };

  let {
    msg,
    index: i,
    isLast,
    loading,
    brandSlug,
    threadId,
    dmPair,
    roomKeys,
    speakerLabel,
    speakerAvatar,
    artifactsByCall = new Map(),
    followingUserTexts,
    oncopy,
    onredo,
    onfeedback,
    onsend,
    onpreview,
    approvalStatuses,
    onapproval
  }: {
    msg: ChatMessage;
    index: number;
    isLast: boolean;
    loading: boolean;
    brandSlug: string;
    threadId: string;
    dmPair: boolean;
    roomKeys: string[];
    speakerLabel: (name: string | null | undefined) => string;
    speakerAvatar: (name: string | null | undefined) => SpeakerWho;
    artifactsByCall: Map<string, ChatArtifactUi[]>;
    followingUserTexts: string[];
    oncopy: (content: string) => void;
    onredo: (index: number) => void;
    onfeedback: (messageId: string | undefined, value: 1 | -1 | null, note?: string) => void;
    onsend: (text: string) => void;
    onpreview: (p: PostPreview) => void;
    approvalStatuses: Record<string, string>;
    onapproval: (approvalId: string, approved: boolean) => void;
  } = $props();

  const blocks = $derived(messageBlocks(msg.content, msg.tool_calls));
  const previewsOf = $derived(previewsByCall(blocks));
  const shownUrls = $derived(showMediaUrls(blocks));
  const bubbles = $derived(textBubbleRange(blocks));
  const hasPositionedReasoning = $derived(blocks.some((b) => b.type === 'reasoning'));

  /** I piani già noti non si riaprono da soli: la scelta resta all'utente. */
  let confirmedTabs = $state<Set<string>>(new Set());

  function tabLabelFor(pathOrHref: string): string {
    const base = `/app/${brandSlug}`;
    const pathname = pathOrHref.startsWith(base)
      ? pathOrHref.split('?')[0]
      : `${base}${pathOrHref.startsWith('/') ? pathOrHref : `/${pathOrHref}`}`.split('?')[0];
    return workbenchTabLabel(pathname, base, (k) => $_(k));
  }

  function confirmOpenTab(tab: OpenTabProposal, key: string) {
    confirmedTabs = new Set([...confirmedTabs, key]);
    // La modal apre la pagina SOPRA la chat. Se la rotta è classificata `page` (o siamo su
    // mobile) `openPageModal` rifiuta e si naviga davvero.
    if (openPageModal(tab.href)) return;
    void goto(tab.href, { noScroll: true, keepFocus: true });
  }

  function openPlan(href: string) {
    const id = href.split('/plans/')[1]?.split(/[?#]/)[0];
    if (!id) return;
    openPlanDocument({ brandSlug, planId: id, href });
  }
</script>

{#if msg.attachments?.length}
  <!-- I video vanno in <video>, non in una thumb: un mp4 dentro un <img> è un quadrato rotto. -->
  <ChatAttStrip urls={msg.attachments} video />
{/if}
{#if (dmPair || roomKeys.length >= 2) && msg.name}
  <ChatSpeakerTag label={speakerLabel(msg.name)} />
{/if}
{#if msg.reasoning && !hasPositionedReasoning}
  <!-- Fallback SOLO per righe vecchie (colonna piatta): un turno nuovo porta i suoi
       segmenti dentro `blocks`, e mostrare anche questo raddoppierebbe il pensiero. -->
  <ChatThought reasoning={msg.reasoning} />
{/if}
<!-- Il turno rigiocato nell'ordine in cui il modello l'ha prodotto. Le righe vecchie (senza
     parti di testo salvate) ricadono su tool-poi-testo dentro messageBlocks. -->
{#each blocks as block, bi (bi)}
{#if block.type === 'text'}
{@const gs = splitGoalStatus(block.text)}
{@const tm = splitTextMedia(gs.text, shownUrls)}
{#if tm.text.trim()}
<div class="chat-turn-line">
{#if bi === bubbles.first}
  <!-- Il volto sta sulla PRIMA bolla, non in cima al turno: se la risposta comincia con un
       ragionamento o una chip, l'avatar deve scendere fin qui invece di stare accanto al vuoto. -->
  {@const who = speakerAvatar(msg.name)}
  <span class="chat-turn-face" aria-hidden="true">
    <AgentAvatar face={who.face} color={who.color} size={28} />
  </span>
{/if}
<div class="chat-msg-cell chat-msg">{@html renderMd(tm.text)}</div>
{#if bi === bubbles.last}
  <!-- Le azioni vanno sotto l'ULTIMA bolla: card e chip successive restano al loro posto
       cronologico senza portarsi via la riga copia/rigenera. -->
  <ChatMessageActions
    role="assistant"
    disabled={loading}
    feedback={msg.feedback ?? null}
    durationMs={msg.duration_ms ?? null}
    model={msg.model ?? null}
    tier={msg.tier ?? null}
    inputTokens={msg.input_tokens ?? null}
    outputTokens={msg.output_tokens ?? null}
    oncopy={() => oncopy(msg.content)}
    onredo={() => onredo(i)}
    onfeedback={(value, note) => onfeedback(msg.id, value, note)}
  />
{/if}
</div>
{/if}
{#if tm.media}
  <ChatMediaCard media={tm.media} />
{/if}
{#if gs.status}
  <ChatGoalStatusCard status={gs.status} live={isLast} />
{/if}
{:else if block.type === 'reasoning'}
<ChatThought reasoning={block.text} />
{:else}
{@const calls = block.calls as ToolCallUi[]}
<!-- Quali tool restino muti lo decide `chipCalls` dentro ChatToolChips: mai un elenco
     copiato a mano qui, o una chip nuda compare al posto di una card. -->
<ChatToolChips {calls} />
{#each calls.filter((tc) => tc.approval) as tc (tc.toolCallId)}
  <ChatApprovalCard
    approvalId={tc.approval!.approvalId}
    toolName={tc.toolName}
    input={tc.input}
    status={approvalStatuses[tc.approval!.approvalId] ?? 'pending'}
    disabled={loading}
    ondecision={(approved) => onapproval(tc.approval!.approvalId, approved)}
  />
{/each}
<ChatExpressionStickers {calls} />
<ChatDmChip {calls} {brandSlug} />
{@const arts = calls.flatMap((tc) => {
  if (mediaFromToolCall(tc)) return [];
  return tc.toolCallId ? artifactsByCall.get(tc.toolCallId) ?? [] : [];
})}
{#each arts as a (a.id)}
  <ChatArtifactCard artifact={a} />
{/each}
{#each calls.filter((tc) => ROUTINE_EVENT_TOOLS.includes(tc.toolName)) as tc (tc.toolCallId)}
  {@const ev = normalizeRoutineEvent(tc.routineEvent ?? tc.output)}
  {#if ev}
    <ChatRoutineEventRow event={ev} />
  {/if}
{/each}
{@const previews = calls.flatMap((tc) => previewsOf.get(tc) ?? [])}
{#if previews.length}
  <div class="post-previews">
    {#each previews as p (p.post_id)}
      <!-- La CTA del lightbox porta ?post=, che apre l'editor di QUESTO post invece di
           scaricare l'utente sul calendario a cercare la card che ha appena cliccato. -->
      <button type="button" class="post-preview-link" onclick={() => onpreview(p)}>
        {#if p.media_urls && p.media_urls.length > 1}
          <span class="carousel-badge">◱ {p.media_urls.length} slide</span>
        {/if}
        <PostCard
          post={{
            platform: p.platform,
            caption: p.caption,
            status: p.status,
            thumbnail: p.media_url || p.media_urls?.[0] || undefined
          }}
          compact
        />
      </button>
    {/each}
  </div>
{/if}
{@const checklist = calls.map((tc) => tc.checklist).find(Boolean)}
{#if checklist}
  <div class="setup-checklist">
    <div class="sc-head">
      <span class="sc-title">{$_('app.checklist.title')}</span>
      <span class="sc-count">{checklist.doneCount}/{checklist.total}</span>
    </div>
    <div class="sc-bar"><span style={`width:${(checklist.doneCount / checklist.total) * 100}%`}></span></div>
    <ul class="sc-list">
      {#each checklist.items as item (item.key)}
        <li class:done={item.done}>
          <span class="sc-check">
            {#if item.done}<svg viewBox="0 0 20 20" fill="currentColor"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>{/if}
          </span>
          {#if item.done}
            <span class="sc-label done">{$_(`app.checklist.items.${item.key}`)}</span>
          {:else}
            <a class="sc-label" href={item.href}>{$_(`app.checklist.items.${item.key}`)}</a>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}
{@const upgrade = calls.map((tc) => tc.upgrade).find(Boolean)}
{#if upgrade}
  {#if upgrade.is_top || !upgrade.offers.length}
    <div class="upgrade-card top">
      <div class="uc-top-msg">{$_('pricing.card.topPlan')}</div>
    </div>
  {:else}
    <div class="upgrade-cards">
      {#each upgrade.offers as offer (offer.key)}
        {@const plan = planByKey(offer.key)}
        <div class="upgrade-card" class:popular={plan.popular}>
          {#if plan.popular}<span class="uc-badge">{$_('pricing.card.mostPopular')}</span>{/if}
          <div class="uc-name">{plan.name}</div>
          <div class="uc-price"><span class="uc-amt">{CURRENCY_SYMBOL.eur}{monthlyPrice(plan, 'eur')}</span><span class="uc-per">{$_('pricing.card.perMo')}</span></div>
          <div class="uc-tag">{$_(`pricing.plans.${plan.key}.tagline`)}</div>
          <ul class="uc-feats">
            <li>{$_('pricing.card.credits', { values: { credits: plan.credits.toLocaleString($locale ?? 'en') } })}</li>
            {#each $_(`pricing.plans.${plan.key}.highlights`).split('|').map((s) => s.trim()).filter(Boolean).slice(0, 4) as h (h)}<li>{h}</li>{/each}
          </ul>
          <a class="uc-cta" href={`/app/${upgrade.slug}/upgrade?plan=${offer.key}`}>{$_('pricing.card.upgradeTo', { values: { plan: plan.name } })}</a>
        </div>
      {/each}
    </div>
  {/if}
{/if}
{#each calls.filter((tc) => tc.openTab) as tc, ti (`${tc.toolCallId ?? 'ot'}-${bi}-${ti}`)}
  {@const tab = tc.openTab!}
  {@const key = `${tc.toolCallId ?? `${bi}-${ti}`}:${tab.href}`}
  {@const label = tabLabelFor(tab.path || tab.href)}
  <div class="open-tab-card">
    <p class="ot-reason">{tab.reason || $_('app.shell.openTabReason')}</p>
    {#if confirmedTabs.has(key)}
      <span class="ot-done">{$_('app.shell.openTabOpened')}</span>
    {:else}
      <button type="button" class="ot-cta" onclick={() => confirmOpenTab(tab, key)}>
        {$_('app.shell.openTabCta', { values: { label } })}
      </button>
    {/if}
  </div>
{/each}
{#each calls.filter((tc) => tc.plan) as tc, ti (`${tc.toolCallId ?? 'pl'}-${bi}-${ti}`)}
  <ChatPlanCard plan={tc.plan!} {brandSlug} onopen={openPlan} />
{/each}
{#each calls.filter((tc) => tc.toolName === 'propose_app_connection') as tc, ti (`${tc.toolCallId ?? 'cn'}-${bi}-${ti}`)}
  {@const connect = normalizeConnectPayload(tc.connect ?? tc.output)}
  {#if connect}
    <ChatConnectCard {connect} {brandSlug} />
  {/if}
{/each}
<!-- Device login: si mostra il codice pubblico, mai il token. -->
{#each calls.filter((tc) => tc.toolName === 'sandbox_device_login') as tc, ti (`${tc.toolCallId ?? 'dl'}-${bi}-${ti}`)}
  {@const deviceLogin = normalizeDeviceLoginPayload(tc.deviceLogin ?? tc.output)}
  {#if deviceLogin}
    <ChatDeviceLoginCard login={deviceLogin} />
  {/if}
{/each}
{#each calls.filter((tc) => tc.questions?.length) as tc, ti (`${tc.toolCallId ?? 'qq'}-${bi}-${ti}`)}
  <ChatQuestionsCard
    questions={tc.questions!}
    toolCallId={tc.toolCallId ?? `qq-${i}-${bi}-${ti}`}
    {threadId}
    followingUserTexts={followingUserTexts}
    disabled={loading}
    onanswer={(text) => onsend(text)}
  />
{/each}
{#each calls.filter((tc) => tc.toolName === 'show_team') as tc, ti (`${tc.toolCallId ?? 'tm'}-${bi}-${ti}`)}
  {@const team = normalizeTeamPayload(tc.team ?? tc.output)}
  {#if team}
    <ChatTeamCard {team} {brandSlug} />
  {/if}
{/each}
{#each calls as tc, ti (`${tc.toolCallId ?? 'md'}-${bi}-${ti}`)}
  {@const shown = mediaFromToolCall(tc)}
  {#if shown}
    <ChatMediaCard media={shown} />
  {/if}
{/each}
{#each calls.filter((tc) => tc.toolName === 'propose_custom_agent') as tc, ti (`${tc.toolCallId ?? 'ap'}-${bi}-${ti}`)}
  {@const proposal = normalizeAgentProposal(tc.agentProposal ?? tc.output)}
  {#if proposal}
    <ChatAgentProposalCard
      {proposal}
      toolCallId={tc.toolCallId ?? `ap-${i}-${bi}-${ti}`}
      {threadId}
      {brandSlug}
      disabled={loading}
      ondecline={(text) => onsend(text)}
    />
  {/if}
{/each}
{/if}
{/each}
{#if msg.sources?.length}
  <ChatSources sources={msg.sources} {brandSlug} />
{/if}

<style>
  /* Stessa grammatica di ChatColumn: i due blocchi vanno tenuti identici. */
  .setup-checklist {
    align-self: flex-start; max-width: 380px; width: 100%;
    margin: 6px 0; padding: 14px 16px;
    background: var(--paper, #fff); border: 1px solid var(--line, #e3e3e6); border-radius: 14px;
  }
  .sc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .sc-title { font-size: 13px; font-weight: 650; color: var(--ink, #1d1d1f); }
  .sc-count { font-size: 12px; font-weight: 600; color: var(--ink-faint, #86868b); }
  .sc-bar { height: 5px; border-radius: 999px; background: var(--paper-2, #f0f0f2); overflow: hidden; margin-bottom: 10px; }
  .sc-bar span { display: block; height: 100%; background: var(--accent, #7c5cff); border-radius: 999px; transition: width 0.4s ease; }
  .sc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .sc-list li { display: flex; align-items: center; gap: 9px; padding: 5px 0; }
  .sc-check { width: 18px; height: 18px; flex: 0 0 auto; border-radius: 50%; border: 1.5px solid var(--line-2, #d2d2d7);
    display: inline-flex; align-items: center; justify-content: center; color: #fff; }
  .sc-list li.done .sc-check { background: var(--accent, #7c5cff); border-color: var(--accent, #7c5cff); }
  .sc-check svg { width: 12px; height: 12px; }
  .sc-label { font-size: 13.5px; color: var(--accent, #7c5cff); text-decoration: none; font-weight: 550; }
  .sc-label:hover { text-decoration: underline; }
  .sc-label.done { color: var(--ink-faint, #86868b); text-decoration: line-through; font-weight: 500; }

  .open-tab-card {
    align-self: center;
    margin: 6px 0 2px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    max-width: 420px;
    text-align: center;
  }
  .ot-reason { margin: 0; font-size: 0.76rem; color: var(--ink-soft, #6b6b70); line-height: 1.4; }
  .ot-cta {
    appearance: none; border: none; background: none; padding: 0;
    font-size: 0.76rem; font-weight: 600; color: var(--accent, #7c5cff); cursor: pointer;
  }
  .ot-cta:hover,
  .ot-cta:focus-visible { text-decoration: underline; }
  .ot-done { display: inline-block; font-size: 0.74rem; font-weight: 600; color: var(--ink-faint, #86868b); }

  .upgrade-cards { align-self: flex-start; display: flex; flex-wrap: wrap; gap: 12px; margin: 6px 0; max-width: 460px; }
  .upgrade-card { position: relative; flex: 1 1 200px; min-width: 200px; padding: 16px 16px 18px;
    background: var(--paper, #fff); border: 1px solid var(--line, #e3e3e6); border-radius: 16px; }
  .upgrade-card.popular { border-color: var(--accent, #7c5cff); box-shadow: 0 8px 30px -12px rgba(124, 92, 255, 0.35); }
  .upgrade-card.top { align-self: flex-start; max-width: 380px; padding: 16px; background: var(--paper-2, #f5f5f7); border: 1px solid var(--line, #e3e3e6); border-radius: 14px; }
  .uc-top-msg { font-size: 13.5px; color: var(--ink-soft, #6e6e73); }
  .uc-badge { position: absolute; top: -9px; right: 12px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em;
    color: #fff; background: var(--accent, #7c5cff); padding: 3px 8px; border-radius: 999px; }
  .uc-name { font-size: 15px; font-weight: 700; color: var(--ink, #1d1d1f); }
  .uc-price { display: flex; align-items: baseline; gap: 3px; margin: 6px 0 2px; }
  .uc-amt { font-size: 26px; font-weight: 750; color: var(--ink, #1d1d1f); }
  .uc-per { font-size: 12px; color: var(--ink-faint, #86868b); }
  .uc-tag { font-size: 12.5px; color: var(--ink-faint, #86868b); margin-bottom: 10px; }
  .uc-feats { list-style: none; margin: 0 0 14px; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .uc-feats li { font-size: 12.5px; color: var(--ink-soft, #6e6e73); line-height: 1.4; padding-left: 16px; position: relative; }
  .uc-feats li::before { content: '✓'; position: absolute; left: 0; color: var(--accent, #7c5cff); font-weight: 700; }
  .uc-cta { display: block; text-align: center; text-decoration: none; font-size: 13.5px; font-weight: 650;
    color: #fff; background: var(--ink, #1d1d1f); padding: 9px 14px; border-radius: 10px; }
  .upgrade-card.popular .uc-cta { background: var(--accent, #7c5cff); }
  .uc-cta:hover { opacity: 0.9; }

  .post-previews {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
    margin: 6px 0;
    max-width: 520px;
  }
  .post-preview-link { position: relative; text-decoration: none; color: inherit; display: block;
    width: 100%; padding: 0; border: 0; background: none; font: inherit; text-align: left; cursor: pointer; }
  .carousel-badge {
    position: absolute; top: 8px; left: 8px; z-index: 1;
    font-family: var(--mono, monospace); font-size: 11px; font-weight: 600;
    color: #fff; background: rgba(0, 0, 0, 0.6); padding: 3px 8px; border-radius: 999px;
    backdrop-filter: blur(4px);
  }
</style>
