<script lang="ts">
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import { pageQuery } from '$lib/page-query';
  import { _, locale } from 'svelte-i18n';
  import PageHead from '$lib/components/PageHead.svelte';
  import TopbarCta from '$lib/components/TopbarCta.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Sheet from '$lib/components/ui/sheet';
  import Plus from '@lucide/svelte/icons/plus';
  import Play from '@lucide/svelte/icons/play';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Clock from '@lucide/svelte/icons/clock';
  import Calendar from '@lucide/svelte/icons/calendar';
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import LibraryBig from '@lucide/svelte/icons/library-big';
  import Search from '@lucide/svelte/icons/search';
  import Download from '@lucide/svelte/icons/download';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { DEFAULT_AGENT_ID, NEW_CHAT_AGENT_ID, agentMetaForBrand } from '$lib/agent-icons';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import {
    AGENT_AVATAR_COLORS,
    AGENT_AVATAR_FACES,
    BUILTIN_AGENT_AVATARS,
    DEFAULT_AGENT_AVATAR_COLOR,
    DEFAULT_AGENT_AVATAR_FACE,
    fallbackAvatarColor,
    fallbackAvatarFace,
    normalizeAvatarColor,
    normalizeAvatarFace
  } from '$lib/agent-avatars';
  import { JOB_OWNERS, TEAM_SPECIALIST_IDS, parseRoutineOwner, type TeamAgentId } from '$lib/agent-owners';
  import { MODEL_FAMILIES, type ModelFamilyId } from '$lib/models/catalog';
  import { hasWebHub } from '$lib/plans';
  import {
    AGENT_TEMPLATE_CATEGORIES,
    agentCategoryLabel,
    agentScheduleSummary,
    randomAgentAvatar,
    type AgentTemplate
  } from '$lib/agent-templates';
  import type { Locale } from '$lib/i18n/locale';

  let { data, form } = $props();
  // I parametri della pagina, non quelli dell'URL: nella modal l'URL non cambia.
  const q = pageQuery();

  type Schedule = (typeof data.schedules)[number];
  // Due entità, non una: l'agente è CHI lavora per il brand, la routine è COSA fa ogni tot.
  type Agent = (typeof data.agents)[number];

  const DAY_KEYS = ['0', '1', '2', '3', '4', '5', '6'] as const;
  const PRESETS: { key: 'everyday' | 'weekdays' | 'weekend'; days: number[] }[] = [
    { key: 'everyday', days: [0, 1, 2, 3, 4, 5, 6] },
    { key: 'weekdays', days: [1, 2, 3, 4, 5] },
    { key: 'weekend', days: [0, 6] }
  ];

  const webHubEnabled = $derived(hasWebHub($page.data.brand?.plan));
  const base = $derived(`/app/${$page.params.brand}`);

  let editorOpen = $state(false);
  let deleteOpen = $state(false);
  let libraryOpen = $state(false);
  let libQuery = $state('');
  let libCategory = $state<string>('all');
  let installingSlug = $state<string | null>(null);
  let editing = $state<Schedule | null>(null);
  let deleting = $state<Schedule | null>(null);
  /** Cosa sta modificando il pannello: una persona o un incarico. Stesso pannello, due form. */
  let editorKind = $state<'agent' | 'routine'>('agent');
  let editingAgent = $state<Agent | null>(null);
  let deletingAgent = $state<Agent | null>(null);
  /** Assumere include il PRIMO incarico: un collega assunto e mai chiamato è l'altro modo di
   * sbagliare questa pagina. In modifica la cadenza sparisce: da lì gli incarichi si gestiscono
   * uno per uno. */
  const showSchedule = $derived(editorKind === 'routine' || !editingAgent);
  let name = $state('');
  let prompt = $state('');
  let agent = $state(NEW_CHAT_AGENT_ID);
  // Il modello che esegue i suoi turni. '' = Default (niente preferenza salvata).
  let agentModel = $state('');
  // Chi ESEGUE la routine. Anomalia resta in lista solo per le righe già salvate così: continuano
  // a girare identiche finché non le si tocca.
  const agentOptions = $derived(agentMetaForBrand(webHubEnabled, agent));
  let avatarFace = $state<string>(DEFAULT_AGENT_AVATAR_FACE);
  let avatarColor = $state<string>(DEFAULT_AGENT_AVATAR_COLOR);
  let days = $state<number[]>([1, 2, 3, 4, 5]);
  let times = $state<string[]>(['09:00']);
  let enabled = $state(true);
  let reuseThread = $state(false);
  let busy = $state(false);
  let rowBusy = $state<string | null>(null);

  const lang = $derived((($locale as Locale) ?? 'en') as Locale);

  const libCategories = $derived(
    AGENT_TEMPLATE_CATEGORIES.filter((c) => data.templates.some((t) => t.category === c))
  );

  const libFiltered = $derived.by(() => {
    const q = libQuery.trim().toLowerCase();
    return data.templates.filter((t) => {
      if (libCategory !== 'all' && t.category !== libCategory) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.tagline.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  });

  /** Editor pre-riempito da un agente della libreria: "installa, ma prima fammelo cambiare". */
  function customizeTemplate(t: AgentTemplate) {
    editorKind = 'agent';
    editing = null;
    editingAgent = null;
    const avatar = randomAgentAvatar();
    editing = null;
    name = t.name;
    prompt = t.prompt;
    agent = t.agent || NEW_CHAT_AGENT_ID;
    agentModel = '';
    avatarFace = avatar.face;
    avatarColor = avatar.color;
    days = [...t.days_of_week].sort((a, b) => a - b);
    times = [...t.times];
    enabled = true;
    reuseThread = t.reuse_thread;
    libraryOpen = false;
    editorOpen = true;
  }

  // Ogni deep link atterra dove l'utente voleva andare, mai su una lista da ricercare.
  onMount(() => {
    if (q('new')) {
      openCreate();
      return;
    }
    // `?edit=<id>` è l'id dell'AGENTE (`chat_threads.custom_agent_id`): si guarda prima lì. La
    // ricerca fra le routine resta per i link vecchi.
    const editId = q('edit');
    if (editId) {
      const who = data.agents.find((a) => a.id === editId);
      if (who) {
        openEditAgent(who);
        return;
      }
      const row = data.schedules.find((s) => s.id === editId);
      if (row) {
        openEdit(row);
        return;
      }
    }
    const slug = data.installSlug;
    if (!slug) return;
    const target = data.templates.find((t) => t.slug === slug);
    if (target) customizeTemplate(target);
  });

  // Le righe salvate prima degli avatar non hanno un volto: se ne deriva uno stabile dall'id.
  type Faced = { id: string; avatar_face?: string | null; avatar_color?: string | null };
  function faceOf(s: Faced) {
    return s.avatar_face ? normalizeAvatarFace(s.avatar_face) : fallbackAvatarFace(s.id);
  }

  function colorOf(s: Faced) {
    return s.avatar_color ? normalizeAvatarColor(s.avatar_color) : fallbackAvatarColor(s.id);
  }

  /** La famiglia salvata sulla riga, o '' se non c'è / non è del catalogo. */
  function modelOf(a: { model?: unknown }): string {
    const family = (a.model as { family?: unknown } | null)?.family;
    return typeof family === 'string' && family in MODEL_FAMILIES ? family : '';
  }

  const modelPayload = $derived(
    agentModel
      ? JSON.stringify({ family: agentModel, thinking: MODEL_FAMILIES[agentModel as ModelFamilyId].defaultThinking })
      : ''
  );

  function sameDays(a: number[], b: number[]) {
    return a.length === b.length && a.every((d, i) => d === b[i]);
  }

  function openCreate() {
    // Volto e colore diversi per ognuno: col nero di default una lista di agenti sembrava lo
    // stesso agente ripetuto.
    const avatar = randomAgentAvatar();
    editorKind = 'agent';
    editing = null;
    editingAgent = null;
    name = '';
    prompt = '';
    agent = NEW_CHAT_AGENT_ID;
    agentModel = '';
    avatarFace = avatar.face;
    avatarColor = avatar.color;
    days = [1, 2, 3, 4, 5];
    times = ['09:00'];
    enabled = true;
    reuseThread = false;
    editorOpen = true;
  }

  function openEditAgent(a: Agent) {
    editorKind = 'agent';
    editing = null;
    editingAgent = a;
    name = a.name;
    prompt = a.prompt;
    agent = a.agent || DEFAULT_AGENT_ID;
    agentModel = modelOf(a);
    avatarFace = faceOf(a);
    avatarColor = colorOf(a);
    enabled = a.enabled;
    editorOpen = true;
  }

  function openCreateRoutine(a: Agent) {
    editorKind = 'routine';
    editing = null;
    editingAgent = null;
    name = '';
    prompt = '';
    // Il proprietario viaggia nel campo `agent` col prefisso ($lib/agent-owners): è così che la
    // riga finisce sulla card giusta e i suoi giri nel diario giusto.
    agent = `custom:${a.id}`;
    avatarFace = faceOf(a);
    avatarColor = colorOf(a);
    days = [1, 2, 3, 4, 5];
    times = ['09:00'];
    enabled = true;
    reuseThread = false;
    editorOpen = true;
  }

  function openEdit(s: Schedule) {
    editorKind = 'routine';
    editingAgent = null;
    editing = s;
    name = s.name;
    prompt = s.prompt;
    agent = s.agent || DEFAULT_AGENT_ID;
    avatarFace = faceOf(s);
    avatarColor = colorOf(s);
    days = [...(s.days_of_week ?? [])].sort((a, b) => a - b);
    times = [...(s.times ?? [])];
    enabled = s.enabled;
    reuseThread = s.reuse_thread;
    editorOpen = true;
  }

  function toggleDay(d: number) {
    days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b);
  }

  function applyPreset(presetDays: number[]) {
    days = [...presetDays];
  }

  function addTime() {
    if (times.length >= 12) return;
    times = [...times, '12:00'];
  }

  function removeTime(i: number) {
    if (times.length <= 1) return;
    times = times.filter((_, idx) => idx !== i);
  }

  function dayLabel(d: number) {
    return $_(`app.custom.day.${d}`);
  }

  function daysSummary(s: Schedule) {
    const ds = [...(s.days_of_week ?? [])].sort((a, b) => a - b);
    if (sameDays(ds, [0, 1, 2, 3, 4, 5, 6])) return $_('app.custom.preset.everyday');
    if (sameDays(ds, [1, 2, 3, 4, 5])) return $_('app.custom.preset.weekdays');
    if (sameDays(ds, [0, 6])) return $_('app.custom.preset.weekend');
    return ds.map(dayLabel).join(', ');
  }

  function timesSummary(s: Schedule) {
    return (s.times ?? []).join(' · ');
  }

  function agentLabel(id: string | null) {
    const key = id && id !== 'auto' ? id : 'auto';
    return $_(`chat.agents.${key}.label`);
  }

  const withBusy = () => {
    busy = true;
    return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
      await update();
      busy = false;
      if (result.type === 'success') editorOpen = false;
    };
  };

  const withInstall = (slug: string) => {
    installingSlug = slug;
    return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
      await update();
      installingSlug = null;
      if (result.type === 'success') libraryOpen = false;
    };
  };

  const withDelete = () => {
    rowBusy = deleting?.id ?? deletingAgent?.id ?? null;
    return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
      await update();
      rowBusy = null;
      if (result.type === 'success') {
        deleteOpen = false;
        deleting = null;
        deletingAgent = null;
      }
    };
  };

  // I lavori inclusi nel prodotto: stessa card, stesso avatar, stesso interruttore. L'unica
  // differenza è che non si modificano e non si cancellano — niente secondo linguaggio visivo.
  type Job = (typeof data.jobs)[number];

  /** Tre stati che non devono mai confondersi: spento da te / non girato (e perché) / fallito.
   * Il motivo è un CODICE dal server, e il `default` copre quello che domani arriverà senza
   * chiave — a schermo non deve mai finire una chiave grezza. */
  function jobState(j: Job): string {
    if (j.state === 'off') return $_('app.roster.state.off');
    if (j.state === 'never') return $_('app.roster.state.never');
    if (j.state === 'ok') return $_('app.roster.state.ok');
    const generic = $_(`app.roster.state.${j.state}`);
    return j.reason ? $_(`app.roster.reason.${j.reason}`, { default: generic }) : generic;
  }

  // JOB_OWNERS è la stessa mappa che decide in quale thread finiscono i report: "Weekly recap"
  // non è un collega, è la routine del lunedì dell'Analyst.
  function routinesOf(agentId: TeamAgentId): Job[] {
    return data.jobs.filter((j) => JOB_OWNERS[j.key as keyof typeof JOB_OWNERS] === agentId);
  }

  // OGNI routine ha un PROPRIETARIO in `custom_agent_schedules.agent`, col prefisso `team:` o
  // `custom:`: non è mai un collega nuovo, è una riga in più sulla card di chi la possiede.
  const ownedBy = $derived.by(() => {
    const map = new Map<string, Schedule[]>();
    for (const s of data.schedules) {
      const owner = parseRoutineOwner(s.agent);
      // Solo i sei di default: le routine dei custom le raccoglie `routinesOfAgent`, che parte
      // dall'AGENTE e non dalle schedulazioni.
      if (owner?.kind !== 'builtin') continue;
      map.set(owner.agentId, [...(map.get(owner.agentId) ?? []), s]);
    }
    return map;
  });

  const assignedTo = (key: string): Schedule[] => ownedBy.get(key) ?? [];

  /** `s.id === a.id` è il ponte finché la 0210 non è applicata ovunque: in quel mondo la riga
   * dell'agente È anche la sua unica routine.
   * ponytail: quella metà del predicato si cancella quando la migration è dappertutto. */
  function routinesOfAgent(a: Agent): Schedule[] {
    return data.schedules.filter((s) => {
      const owner = parseRoutineOwner(s.agent);
      return (owner?.kind === 'custom' && owner.scheduleId === a.id) || s.id === a.id;
    });
  }

  function scheduleState(s: Schedule): string {
    if (s.last_error) return $_('app.custom.error.' + s.last_error, { default: $_('app.custom.error.unknown') });
    if (s.nextRunLabel && s.enabled)
      return `${$_('app.custom.nextRun')}: ${s.nextRunLabel}${s.lastRunLabel ? ` · ${$_('app.custom.lastRun')}: ${s.lastRunLabel}` : ''}`;
    if (s.lastRunLabel) return `${$_('app.custom.lastRun')}: ${s.lastRunLabel}`;
    return $_('app.custom.paused');
  }
</script>

<!-- Routine ASSEGNATA: stessa grammatica dei lavori inclusi, più i bottoni che un incarico
     scritto dal cliente deve avere (si corregge e si cancella). -->
{#snippet assignedRoutine(s: Schedule)}
  <li class="routine-row" class:off={!s.enabled} title={s.prompt}>
    <div class="routine-info">
      <p class="routine-name">
        {s.name}
        <span class="routine-cadence">· {daysSummary(s)} · {timesSummary(s)}</span>
      </p>
      <p class="routine-state" class:err={!!s.last_error}>{scheduleState(s)}</p>
    </div>
    <div class="routine-tools">
      <!-- "Esegui ora" è della ROUTINE: un agente con due incarichi non saprebbe quale far partire. -->
      <form
        method="POST"
        action="?/runNow"
        use:enhance={() => {
          rowBusy = s.id;
          return async ({ update }) => {
            await update();
            rowBusy = null;
          };
        }}
      >
        <input type="hidden" name="id" value={s.id} />
        <button type="submit" class="icon-btn" disabled={rowBusy === s.id} title={$_('app.custom.runNow')}>
          <Play size={14} strokeWidth={2} />
        </button>
      </form>
      <button type="button" class="icon-btn" onclick={() => openEdit(s)} title={$_('app.custom.edit')}>
        <Pencil size={14} strokeWidth={2} />
      </button>
      <button
        type="button"
        class="icon-btn danger"
        title={$_('app.custom.delete')}
        onclick={() => {
          deleting = s;
          deletingAgent = null;
          deleteOpen = true;
        }}
      >
        <Trash2 size={14} strokeWidth={2} />
      </button>
      <form
        method="POST"
        action="?/toggle"
        use:enhance={() => {
          rowBusy = s.id;
          return async ({ update }) => {
            await update();
            rowBusy = null;
          };
        }}
      >
        <input type="hidden" name="id" value={s.id} />
        <label class="ios-switch" title={s.enabled ? $_('app.custom.enabled') : $_('app.custom.paused')}>
          <input
            type="checkbox"
            name="enabled"
            checked={s.enabled}
            disabled={rowBusy === s.id}
            onchange={(e) => e.currentTarget.form?.requestSubmit()}
          />
          <span class="ios-slider"></span>
        </label>
      </form>
    </div>
  </li>
{/snippet}

<svelte:head>
  <title>Anomalia — {$_('app.hub.automations.custom')}</title>
</svelte:head>

<PageHead title={$_('app.custom.title')} subtitle={$_('app.custom.sub')}>
  {#snippet actions()}
    {#if data.templates.length > 0}
      <TopbarCta type="button" variant="ghost" Icon={LibraryBig} onclick={() => (libraryOpen = true)}>
        {$_('app.custom.library.open')}
      </TopbarCta>
    {/if}
    <TopbarCta type="button" Icon={Plus} onclick={openCreate}>{$_('app.custom.new')}</TopbarCta>
  {/snippet}
</PageHead>

<div class="custom-page">
  {#if form?.error}
    <p class="banner err">{$_('app.custom.error.' + form.error)}</p>
  {:else if form?.saved}
    <p class="banner ok">{$_('app.custom.saved')}</p>
  {:else if form?.deleted}
    <p class="banner ok">{$_('app.custom.deleted')}</p>
  {:else if form?.installed}
    <p class="banner ok">{$_('app.custom.library.installed', { values: { name: form.name ?? '' } })}</p>
  {/if}

  <h2 class="group-head">{$_('app.custom.groupYours')}</h2>

  {#if data.agents.length === 0}
    <div class="empty-card">
      <h3>{$_('app.custom.emptyTitle')}</h3>
      <p>{$_('app.custom.emptyDesc')}</p>
      <div class="empty-actions">
        {#if data.templates.length > 0}
          <button type="button" class="btn primary" onclick={() => (libraryOpen = true)}>
            <LibraryBig size={15} strokeWidth={2} />
            <span>{$_('app.custom.library.browse', { values: { count: data.templates.length } })}</span>
          </button>
        {/if}
        <button type="button" class="btn ghost" onclick={openCreate}>{$_('app.custom.new')}</button>
      </div>
    </div>
  {:else}
    <ul class="sched-list">
      {#each data.agents as a (a.id)}
        {@const routines = routinesOfAgent(a)}
        <li class="sched-card" class:off={!a.enabled}>
          <div class="sched-top">
            <div class="sched-title-block">
              <AgentAvatar face={faceOf(a)} color={colorOf(a)} size={38} />
              <div class="sched-title-text">
                <h3>{a.name}</h3>
                <p class="sched-meta">{agentLabel(a.agent)}</p>
              </div>
            </div>
            <!-- Interruttore dell'AGENTE: spento, tutte le sue routine restano dove sono e
                 smettono di partire; riacceso, riparte quello che girava. -->
            <form method="POST" action="?/toggleAgent" use:enhance={() => { rowBusy = a.id; return async ({ update }) => { await update(); rowBusy = null; }; }}>
              <input type="hidden" name="id" value={a.id} />
              <label class="ios-switch" title={a.enabled ? $_('app.custom.enabled') : $_('app.custom.paused')}>
                <input
                  type="checkbox"
                  name="enabled"
                  checked={a.enabled}
                  disabled={rowBusy === a.id}
                  onchange={(e) => e.currentTarget.form?.requestSubmit()}
                />
                <span class="ios-slider"></span>
              </label>
            </form>
          </div>
          <p class="sched-prompt">{a.prompt}</p>
          <div class="routines">
            <h4 class="routines-head">{$_('app.roster.routinesHead')}</h4>
            {#if routines.length > 0}
              <ul class="routine-list">
                {#each routines as r (r.id)}
                  {@render assignedRoutine(r)}
                {/each}
              </ul>
            {:else}
              <p class="no-routines">{$_('app.custom.noRoutines')}</p>
            {/if}
          </div>
          <div class="sched-foot">
            <div class="sched-actions">
              <button type="button" class="btn ghost sm add-routine" onclick={() => openCreateRoutine(a)}>
                <Plus size={14} strokeWidth={2.2} />
                <span>{$_('app.custom.addRoutine')}</span>
              </button>
              <button type="button" class="icon-btn" onclick={() => openEditAgent(a)} title={$_('app.custom.edit')}>
                <Pencil size={15} strokeWidth={2} />
              </button>
              <button type="button" class="icon-btn danger" title={$_('app.custom.delete')}
                onclick={() => { deletingAgent = a; deleting = null; deleteOpen = true; }}>
                <Trash2 size={15} strokeWidth={2} />
              </button>
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <h2 class="group-head second">{$_('app.custom.groupIncluded')}</h2>

  <!-- La stessa squadra del composer della chat: stesse facce, stesse etichette (chat.agents.*).
       Un toggle per routine, sempre su brand_job_optouts, una job key per riga. -->
  <ul class="sched-list">
    {#each TEAM_SPECIALIST_IDS as id (id)}
      {@const routines = routinesOf(id)}
      {@const assigned = assignedTo(id)}
      <li
        class="sched-card"
        class:off={routines.length + assigned.length > 0 &&
          routines.every((j) => !j.enabled) &&
          assigned.every((s) => !s.enabled)}
      >
        <div class="sched-top">
          <div class="sched-title-block">
            <AgentAvatar
              face={BUILTIN_AGENT_AVATARS[id].face}
              color={BUILTIN_AGENT_AVATARS[id].color}
              size={38}
            />
            <div class="sched-title-text">
              <h3>{$_(`chat.agents.${id}.label`)}</h3>
              <p class="sched-meta">{$_('app.custom.includedTag')}</p>
            </div>
          </div>
        </div>
        <p class="sched-prompt">{$_(`chat.agents.${id}.desc`)}</p>
        {#if routines.length + assigned.length > 0}
          <div class="routines">
            <h4 class="routines-head">{$_('app.roster.routinesHead')}</h4>
            <ul class="routine-list">
              {#each routines as j (j.key)}
                <li class="routine-row" class:off={!j.enabled} title={$_(`app.roster.job.${j.key}.desc`)}>
                  <div class="routine-info">
                    <p class="routine-name">
                      {$_(`app.roster.job.${j.key}.name`)}
                      <span class="routine-cadence">· {$_(`app.roster.job.${j.key}.cadence`)}</span>
                    </p>
                    <p class="routine-state" class:err={j.state === 'failed'}>
                      {jobState(j)}{j.lastRunLabel ? ` · ${$_('app.custom.lastRun')}: ${j.lastRunLabel}` : ''}
                    </p>
                  </div>
                  <form
                    method="POST"
                    action="?/toggleJob"
                    use:enhance={() => { rowBusy = j.key; return async ({ update }) => { await update(); rowBusy = null; }; }}
                  >
                    <input type="hidden" name="job" value={j.key} />
                    <label class="ios-switch" title={j.enabled ? $_('app.custom.enabled') : $_('app.custom.paused')}>
                      <input
                        type="checkbox"
                        name="enabled"
                        checked={j.enabled}
                        disabled={rowBusy === j.key}
                        onchange={(e) => e.currentTarget.form?.requestSubmit()}
                      />
                      <span class="ios-slider"></span>
                    </label>
                  </form>
                </li>
              {/each}
              {#each assigned as s (s.id)}
                {@render assignedRoutine(s)}
              {/each}
            </ul>
          </div>
        {:else}
          <p class="no-routines">{$_('app.roster.noRoutines')}</p>
        {/if}
      </li>
    {/each}
  </ul>

  <p class="foot-note">{$_('app.roster.footNote')}</p>
</div>

<Sheet.Root bind:open={editorOpen}>
  <Sheet.Content
    side="right"
    style="width: min(calc(100vw - 1rem), 35rem); max-width: calc(100vw - 1rem); border-left: 1px solid var(--line); background: var(--paper); padding: 0; display: flex; flex-direction: column;"
  >
    <div class="agent-panel">
      <div class="sheet-top-header">
        <div class="sheet-icon-box">
          <AgentAvatar face={avatarFace} color={avatarColor} size={40} />
        </div>
        <div class="sheet-title-col">
          <Sheet.Title class="sheet-main-title">
            {#if editorKind === 'agent'}
              {editingAgent ? $_('app.custom.editTitle') : $_('app.custom.createTitle')}
            {:else}
              {editing ? $_('app.custom.editRoutineTitle') : $_('app.custom.newRoutineTitle')}
            {/if}
          </Sheet.Title>
          <Sheet.Description class="sheet-sub-desc">
            {editorKind === 'agent' ? $_('app.custom.agentEditorDesc') : $_('app.custom.editorDesc')}
          </Sheet.Description>
        </div>
      </div>

      <!-- UN pannello, due form: identità (`?/saveAgent`) e incarico (`?/save`). Le sezioni che
           non c'entrano non si renderizzano, così un campo non pertinente non finisce nel POST. -->
      <form
        method="POST"
        action={editorKind === 'agent' ? '?/saveAgent' : '?/save'}
        use:enhance={withBusy}
        class="editor-form"
      >
        {#if form?.error}
          <div class="form-banner-wrap">
            <p class="banner err">{$_('app.custom.error.' + form.error)}</p>
          </div>
        {/if}
        {#if editorKind === 'agent' ? editingAgent : editing}
          <input type="hidden" name="id" value={(editorKind === 'agent' ? editingAgent?.id : editing?.id) ?? ''} />
        {/if}

        <div class="editor-scroll-area">
          <div class="config-card">
            <div class="config-card-head">
              <span class="config-section-tag">Agente & Ruolo</span>
            </div>

            <div class="card-field">
              <label class="field-label" for="agent-name-input">
                <span>{$_('app.custom.field.name')}</span>
              </label>
              <input
                id="agent-name-input"
                type="text"
                name="name"
                bind:value={name}
                maxlength="80"
                required
                placeholder={$_('app.custom.field.namePh')}
                class="modern-input"
              />
            </div>

            <div class="card-field">
              <div class="field-label">
                <span>{$_('app.custom.field.avatar')}</span>
              </div>
              <div class="avatar-picker">
                <div class="avatar-faces">
                  {#each AGENT_AVATAR_FACES as f (f)}
                    <button
                      type="button"
                      class="avatar-face-btn"
                      class:active={avatarFace === f}
                      onclick={() => (avatarFace = f)}
                      title={$_(`app.custom.avatarFace.${f}`)}
                      aria-label={$_(`app.custom.avatarFace.${f}`)}
                      aria-pressed={avatarFace === f}
                    >
                      <AgentAvatar face={f} color={avatarColor} size={30} />
                    </button>
                  {/each}
                </div>
                <div class="avatar-colors">
                  {#each AGENT_AVATAR_COLORS as c (c)}
                    <button
                      type="button"
                      class="avatar-color-btn"
                      class:active={avatarColor === c}
                      style={`--swatch: ${c}`}
                      onclick={() => (avatarColor = c)}
                      aria-label={c}
                      aria-pressed={avatarColor === c}
                    ></button>
                  {/each}
                  <label class="avatar-color-custom" title={$_('app.custom.field.avatarCustomColor')}>
                    <input type="color" bind:value={avatarColor} aria-label={$_('app.custom.field.avatarCustomColor')} />
                  </label>
                </div>
              </div>
              <input type="hidden" name="avatar_face" value={avatarFace} />
              <input type="hidden" name="avatar_color" value={avatarColor} />
            </div>

            <!-- Su una routine ASSEGNATA lo specialista non si sceglie. Il campo nascosto porta il
                 valore col prefisso tale e quale, o un salvataggio le fa perdere il padrone. -->
            <div class="card-field" class:hidden={!!parseRoutineOwner(agent)}>
              <div class="field-label">
                <span>{$_('app.custom.field.agent')}</span>
              </div>
              <div class="agent-chips-grid">
                {#each agentOptions as a (a.id)}
                  {@const Icon = a.icon}
                  <button
                    type="button"
                    class="agent-select-chip"
                    class:active={agent === a.id}
                    onclick={() => (agent = a.id)}
                  >
                    <div class="agent-chip-icon" class:active={agent === a.id}>
                      <Icon size={15} strokeWidth={2} />
                    </div>
                    <span class="agent-chip-name">{$_(`chat.agents.${a.id}.label`)}</span>
                    {#if agent === a.id}
                      <Check size={14} class="agent-chip-check" strokeWidth={2.5} />
                    {/if}
                  </button>
                {/each}
              </div>
              <input type="hidden" name="agent" value={agent} />
            </div>

            {#if editorKind === 'agent'}
              <div class="card-field">
                <div class="field-label">
                  <span>{$_('app.custom.field.model')}</span>
                </div>
                <select bind:value={agentModel} class="modern-input" aria-label={$_('app.custom.field.model')}>
                  <option value="">{$_('app.custom.field.modelDefault')}</option>
                  {#each Object.keys(MODEL_FAMILIES) as f (f)}
                    <option value={f}>{$_(`chat.tier.modelFamily.${f}`)}</option>
                  {/each}
                </select>
                <input type="hidden" name="model" value={modelPayload} />
              </div>
            {/if}
          </div>

          <div class="config-card">
            <div class="config-card-head">
              <span class="config-section-tag">Istruzioni Task</span>
            </div>

            <div class="card-field">
              <label class="field-label" for="agent-prompt-textarea">
                <span>{$_('app.custom.field.prompt')}</span>
              </label>
              <div class="prompt-box">
                <textarea
                  id="agent-prompt-textarea"
                  name="prompt"
                  bind:value={prompt}
                  rows="5"
                  maxlength="8000"
                  required
                  placeholder={$_('app.custom.field.promptPh')}
                  class="modern-textarea"
                ></textarea>
                <div class="prompt-meta-bar">
                  <span class="prompt-tip">L'agente ha accesso agli strumenti del brand</span>
                  <span class="prompt-counter" class:warn={prompt.length > 7000}>
                    {prompt.length.toLocaleString()} / 8.000
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- SOLO su una routine: un agente non ha giorni e orari, o è indistinguibile dal suo incarico. -->
          {#if showSchedule}
          <div class="config-card">
            <div class="config-card-head">
              <span class="config-section-tag">Pianificazione</span>
            </div>

            <div class="card-field">
              <div class="field-label">
                <span>{$_('app.custom.field.days')}</span>
              </div>
              <div class="preset-segmented">
                {#each PRESETS as p (p.key)}
                  <button
                    type="button"
                    class="preset-tab"
                    class:active={sameDays(days, p.days)}
                    onclick={() => applyPreset(p.days)}
                  >
                    {$_(`app.custom.preset.${p.key}`)}
                  </button>
                {/each}
              </div>

              <div class="days-pill-grid">
                {#each DAY_KEYS as d (d)}
                  <button
                    type="button"
                    class="day-circle-btn"
                    class:selected={days.includes(+d)}
                    onclick={() => toggleDay(+d)}
                    title={dayLabel(+d)}
                  >
                    {$_(`app.custom.dayShort.${d}`)}
                  </button>
                {/each}
              </div>
              {#each days as d (d)}
                <input type="hidden" name="days" value={d} />
              {/each}
            </div>

            <div class="card-field times-subfield">
              <div class="times-header-row">
                <span class="field-label-text">{$_('app.custom.field.times')}</span>
                <div class="tz-chip">
                  <Clock size={11} />
                  <span>{data.timezone}</span>
                </div>
              </div>

              <div class="times-pills-wrap">
                {#each times as t, i (i)}
                  <div class="time-item-pill">
                    <Clock size={13} class="time-clock-icon" />
                    <input type="time" name="times" bind:value={times[i]} required class="time-native-input" />
                    {#if times.length > 1}
                      <button
                        type="button"
                        class="time-remove-icon-btn"
                        title={$_('app.custom.removeTime')}
                        onclick={() => removeTime(i)}
                      >
                        <X size={12} strokeWidth={2.5} />
                      </button>
                    {/if}
                  </div>
                {/each}

                {#if times.length < 12}
                  <button type="button" class="add-time-pill-btn" onclick={addTime}>
                    <Plus size={13} strokeWidth={2.2} />
                    <span>{$_('app.custom.addTime')}</span>
                  </button>
                {/if}
              </div>
            </div>
          </div>

          <div class="config-card options-card">
            <div class="config-card-head">
              <span class="config-section-tag">Comportamento</span>
            </div>

            <div class="toggle-option-row">
              <div class="toggle-option-info">
                <span class="toggle-option-name">{$_('app.custom.field.enabled')}</span>
                <span class="toggle-option-sub">Esegui automaticamente nei giorni e orari configurati</span>
              </div>
              <label class="ios-switch">
                <input type="checkbox" name="enabled" bind:checked={enabled} />
                <span class="ios-slider"></span>
              </label>
            </div>

            <div class="toggle-divider"></div>

            <div class="toggle-option-row">
              <div class="toggle-option-info">
                <span class="toggle-option-name">{$_('app.custom.field.reuseThread')}</span>
                <span class="toggle-option-sub">Conserva la cronologia della chat invece di aprirne una nuova</span>
              </div>
              <label class="ios-switch">
                <input type="checkbox" name="reuse_thread" bind:checked={reuseThread} />
                <span class="ios-slider"></span>
              </label>
            </div>
          </div>
          {/if}
        </div>

        <div class="sheet-bottom-bar">
          <div class="sheet-footer-status">
            {#if !showSchedule}
              <span class="status-summary">{$_('app.custom.agentHasNoCadence')}</span>
            {:else if days.length === 0}
              <span class="status-warning">Seleziona almeno un giorno</span>
            {:else}
              <span class="status-summary">
                {days.length} {days.length === 1 ? 'giorno' : 'giorni'} · {times.length} {times.length === 1 ? 'orario' : 'orari'}
              </span>
            {/if}
          </div>
          <div class="sheet-footer-actions">
            <button type="button" class="btn ghost" onclick={() => (editorOpen = false)}>
              {$_('app.custom.cancel')}
            </button>
            <button
              type="submit"
              class="btn primary save-btn"
              disabled={busy || (showSchedule && days.length === 0)}
            >
              {#if busy}
                <span>Salvataggio...</span>
              {:else}
                <Check size={15} strokeWidth={2.2} />
                <span>{$_('app.custom.save')}</span>
              {/if}
            </button>
          </div>
        </div>
      </form>
    </div>
  </Sheet.Content>
</Sheet.Root>

<!-- Agent Library: il catalogo pubblico (/agents) dentro l'app. Qui non c'è nulla del brand, le
     card sono in sola lettura finché una non viene installata. -->
<Sheet.Root bind:open={libraryOpen}>
  <Sheet.Content
    side="right"
    style="width: min(calc(100vw - 1rem), 42rem); max-width: calc(100vw - 1rem); border-left: 1px solid var(--line); background: var(--paper); padding: 0; display: flex; flex-direction: column;"
  >
    <div class="lib-panel">
      <div class="sheet-top-header">
        <div class="sheet-icon-box">
          <LibraryBig size={22} strokeWidth={1.9} />
        </div>
        <div class="sheet-title-col">
          <Sheet.Title class="sheet-main-title">{$_('app.custom.library.title')}</Sheet.Title>
          <Sheet.Description class="sheet-sub-desc">{$_('app.custom.library.desc')}</Sheet.Description>
        </div>
      </div>

      <div class="lib-controls">
        <div class="lib-search">
          <Search size={15} strokeWidth={2} />
          <input
            type="search"
            bind:value={libQuery}
            placeholder={$_('app.custom.library.searchPh')}
            aria-label={$_('app.custom.library.searchPh')}
          />
        </div>
        <div class="lib-chips">
          <button type="button" class="lib-chip" class:active={libCategory === 'all'} onclick={() => (libCategory = 'all')}>
            {$_('app.custom.library.all')}
          </button>
          {#each libCategories as c}
            <button type="button" class="lib-chip" class:active={libCategory === c} onclick={() => (libCategory = c)}>
              {agentCategoryLabel(c, lang)}
            </button>
          {/each}
        </div>
      </div>

      <div class="lib-scroll">
        {#if libFiltered.length === 0}
          <p class="lib-empty">{$_('app.custom.library.noResults')}</p>
        {:else}
          <ul class="lib-list">
            {#each libFiltered as t (t.slug)}
              <li class="lib-card">
                <div class="lib-card-top">
                  <AgentAvatar face={t.avatar_face} color={t.avatar_color} size={38} />
                  <div class="lib-card-head">
                    <h3>{t.name}</h3>
                    <p class="lib-card-meta">
                      {agentCategoryLabel(t.category, lang)}
                      · {agentScheduleSummary(t.days_of_week, t.times, lang)}
                    </p>
                  </div>
                  <a
                    class="icon-btn"
                    href={`/agents/${t.slug}`}
                    target="_blank"
                    rel="noopener"
                    title={$_('app.custom.library.details')}
                  >
                    <ExternalLink size={14} strokeWidth={2} />
                  </a>
                </div>
                <p class="lib-card-desc">{t.tagline}</p>
                <div class="lib-card-foot">
                  <button type="button" class="btn ghost sm" onclick={() => customizeTemplate(t)}>
                    <Pencil size={14} strokeWidth={2} />
                    <span>{$_('app.custom.library.customize')}</span>
                  </button>
                  <form method="POST" action="?/install" use:enhance={() => withInstall(t.slug)}>
                    <input type="hidden" name="slug" value={t.slug} />
                    <button type="submit" class="btn primary sm" disabled={installingSlug === t.slug}>
                      <Download size={14} strokeWidth={2} />
                      <span>{$_('app.custom.library.install')}</span>
                    </button>
                  </form>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </Sheet.Content>
</Sheet.Root>

<Dialog.Root bind:open={deleteOpen}>
  <Dialog.Content>
    <Dialog.Header class="pr-8">
      <Dialog.Title>{$_(deletingAgent ? 'app.custom.deleteAgentConfirm' : 'app.custom.deleteConfirm')}</Dialog.Title>
      <Dialog.Description>
        {$_(deletingAgent ? 'app.custom.deleteAgentDesc' : 'app.custom.deleteDesc', {
          values: { name: deletingAgent?.name ?? deleting?.name ?? '' }
        })}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <button type="button" class="btn ghost" onclick={() => (deleteOpen = false)}>{$_('app.custom.cancel')}</button>
      <form method="POST" action={deletingAgent ? '?/deleteAgent' : '?/delete'} use:enhance={withDelete}>
        <input type="hidden" name="id" value={deletingAgent?.id ?? deleting?.id ?? ''} />
        <button type="submit" class="btn danger" disabled={rowBusy === (deletingAgent?.id ?? deleting?.id)}>
          {$_('app.custom.delete')}
        </button>
      </form>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .lib-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .lib-controls {
    display: flex; flex-direction: column; gap: 10px;
    padding: 14px 20px; border-bottom: 1px solid var(--line);
  }
  .lib-search {
    display: flex; align-items: center; gap: 8px;
    border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px;
    background: var(--paper-2); color: var(--ink-faint);
  }
  .lib-search input {
    border: none; background: transparent; outline: none; flex: 1;
    font-size: 13.5px; color: var(--ink); font-family: inherit;
  }
  .lib-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .lib-chip {
    padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line);
    background: var(--paper); font-size: 12px; font-weight: 600; color: var(--ink-soft);
    cursor: pointer; font-family: inherit;
  }
  .lib-chip:hover { color: var(--ink); }
  .lib-chip.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }

  .lib-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px 24px; }
  .lib-empty { color: var(--ink-faint); font-size: 13.5px; text-align: center; padding: 32px 0; }
  .lib-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .lib-card {
    border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px;
    display: flex; flex-direction: column; gap: 9px; background: var(--paper);
  }
  .lib-card-top { display: flex; align-items: center; gap: 11px; }
  .lib-card-head { flex: 1; min-width: 0; }
  .lib-card-head h3 { margin: 0; font-size: 14.5px; font-weight: 600; letter-spacing: -0.02em; }
  .lib-card-meta { margin: 3px 0 0; font-size: 12px; color: var(--ink-faint); }
  .lib-card-desc { margin: 0; font-size: 13px; color: var(--ink-soft); line-height: 1.45; }
  .lib-card-foot { display: flex; gap: 8px; justify-content: flex-end; }
  .btn.sm { padding: 6px 12px; font-size: 12.5px; }

  .empty-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }

  .custom-page { padding: 0 0 40px; max-width: 760px; }
  .banner {
    margin: 0 0 16px; padding: 10px 14px; border-radius: 12px; font-size: 13.5px;
  }
  .banner.ok { background: #dcfce7; color: #166534; }
  .banner.err { background: #fef2f2; color: #b91c1c; }

  .empty-card {
    background: var(--paper); border: 1px solid var(--line); border-radius: 16px;
    padding: 36px 24px; text-align: center;
  }
  .empty-card h3 { margin: 0 0 6px; font-size: 17px; font-weight: 600; }
  .empty-card p { margin: 0 0 18px; color: var(--ink-soft); font-size: 14px; line-height: 1.5; }

  .group-head {
    margin: 0 2px 12px; font-size: 12px; font-weight: 600; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--ink-faint);
  }
  .group-head.second { margin-top: 28px; }
  .foot-note { margin: 18px 2px 0; font-size: 12.5px; color: var(--ink-faint); line-height: 1.5; }

  .sched-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  .sched-card {
    background: var(--paper); border: 1px solid var(--line); border-radius: 16px;
    padding: 16px 18px; display: flex; flex-direction: column; gap: 10px;
  }
  .sched-card.off { opacity: 0.72; }
  .sched-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .sched-title-block { display: flex; align-items: center; gap: 11px; min-width: 0; }
  .sched-title-text { min-width: 0; }
  .sched-title-block h3 { margin: 0; font-size: 15.5px; font-weight: 600; letter-spacing: -0.02em; }
  .sched-meta { margin: 4px 0 0; font-size: 12.5px; color: var(--ink-faint); }
  .sched-prompt {
    margin: 0; font-size: 13.5px; color: var(--ink-soft); line-height: 1.45;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  .sched-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .sched-when { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; color: var(--ink-faint); }
  .sched-when .err { color: #b91c1c; }

  .routines { display: flex; flex-direction: column; gap: 2px; }
  .routines-head {
    margin: 0; font-size: 10.5px; font-weight: 650; text-transform: uppercase;
    letter-spacing: 0.07em; color: var(--ink-faint);
  }
  .routine-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .routine-row {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 8px 0; border-bottom: 1px solid var(--line);
  }
  .routine-row:last-child { border-bottom: 0; padding-bottom: 2px; }
  .routine-row.off .routine-info { opacity: 0.55; }
  .routine-info { min-width: 0; }
  .routine-tools { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
  .card-field.hidden { display: none; }
  .routine-name { margin: 0; font-size: 13.5px; font-weight: 550; color: var(--ink); }
  .routine-cadence { font-weight: 400; font-size: 12.5px; color: var(--ink-faint); }
  .routine-state { margin: 2px 0 0; font-size: 12px; color: var(--ink-faint); }
  .routine-state.err { color: #b91c1c; }
  .no-routines { margin: 0; font-size: 12.5px; color: var(--ink-faint); font-style: italic; }
  .sched-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
  .add-routine { margin-right: auto; gap: 5px; }
  .icon-btn {
    width: 32px; height: 32px; border-radius: 9px; border: 1px solid var(--line);
    background: var(--paper); color: var(--ink-soft); display: inline-flex;
    align-items: center; justify-content: center; cursor: pointer; text-decoration: none;
  }
  .icon-btn:hover { background: var(--paper-2); color: var(--ink); }
  .icon-btn:disabled { opacity: 0.5; cursor: default; }
  .icon-btn.danger:hover { color: #b91c1c; background: #fef2f2; }

  .ios-switch { position: relative; display: inline-block; width: 44px; height: 26px; flex-shrink: 0; }
  .ios-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
  .ios-slider {
    position: absolute; cursor: pointer; inset: 0; background: var(--line, #e5e5ea); border-radius: 26px;
    transition: background 0.25s ease;
  }
  .ios-slider::before {
    content: ''; position: absolute; height: 20px; width: 20px; left: 3px; bottom: 3px;
    background: #fff; border-radius: 50%; transition: transform 0.25s ease;
    box-shadow: 0 1px 3px rgba(0,0,0,0.18);
  }
  .ios-switch input:checked + .ios-slider { background: #34c759; }
  .ios-switch input:checked + .ios-slider::before { transform: translateX(18px); }

  .btn {
    font-size: 13px; font-weight: 600; border-radius: 10px; padding: 8px 16px; cursor: pointer;
    border: 1px solid transparent; line-height: 1; display: inline-flex; align-items: center; gap: 6px;
  }
  .btn.primary { background: var(--accent); color: #fff; }
  .btn.primary:hover { opacity: 0.92; }
  .btn.ghost { background: var(--paper); color: var(--ink); border-color: var(--line); }
  .btn.ghost:hover { background: var(--paper-2); }
  .btn.danger { background: #b91c1c; color: #fff; }
  .btn.danger:hover { background: #991b1b; }
  .btn:disabled { opacity: 0.55; cursor: default; }

  .agent-panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .sheet-top-header {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 20px 48px 16px 20px;
    border-bottom: 1px solid var(--line);
    background: var(--paper);
    flex-shrink: 0;
  }

  .sheet-icon-box {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .sheet-title-col {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .agent-panel :global([data-slot='sheet-title']),
  .sheet-main-title {
    font-size: 17px;
    font-weight: 650;
    letter-spacing: -0.02em;
    color: var(--ink);
    margin: 0;
    line-height: 1.3;
  }

  .agent-panel :global([data-slot='sheet-description']),
  .sheet-sub-desc {
    font-size: 12.5px;
    color: var(--ink-soft);
    margin: 0;
    line-height: 1.4;
  }

  .editor-form {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .form-banner-wrap {
    padding: 12px 20px 0;
  }

  .form-banner-wrap .banner {
    margin: 0;
  }

  .editor-scroll-area {
    overflow-y: auto;
    overflow-x: hidden;
    flex: 1;
    min-height: 0;
    padding: 16px 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .config-card {
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .config-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .config-section-tag {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-faint);
  }

  .card-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
  }

  .modern-input {
    width: 100%;
    font-family: inherit;
    font-size: 13.5px;
    padding: 9px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .modern-input:focus,
  .modern-textarea:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .agent-chips-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  @media (max-width: 440px) {
    .agent-chips-grid {
      grid-template-columns: 1fr;
    }
  }

  .agent-select-chip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--paper);
    border: 1px solid var(--line);
    color: var(--ink-soft);
    cursor: pointer;
    font-size: 13px;
    font-weight: 550;
    text-align: left;
    transition: all 0.15s ease;
    position: relative;
    user-select: none;
  }

  .agent-select-chip:hover {
    border-color: var(--ink-faint);
    color: var(--ink);
  }

  .agent-select-chip.active {
    background: var(--paper);
    border-color: var(--accent);
    color: var(--ink);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .agent-chip-icon {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    background: var(--paper-2);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--ink-soft);
  }

  .agent-chip-icon.active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }

  .agent-chip-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-chip-check {
    color: var(--accent);
    flex-shrink: 0;
  }

  .prompt-box {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    overflow: hidden;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .prompt-box:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .modern-textarea {
    width: 100%;
    border: none;
    background: transparent;
    padding: 10px 12px;
    font-family: inherit;
    font-size: 13.5px;
    color: var(--ink);
    outline: none;
    resize: vertical;
    min-height: 100px;
    line-height: 1.5;
  }

  .prompt-meta-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px 8px;
    border-top: 1px dashed var(--line);
    background: var(--paper-2);
    font-size: 11.5px;
    color: var(--ink-faint);
  }

  .prompt-counter.warn {
    color: #b91c1c;
    font-weight: 600;
  }

  .preset-segmented {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    padding: 3px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 10px;
  }

  .preset-tab {
    padding: 6px 8px;
    font-size: 12px;
    font-weight: 550;
    color: var(--ink-soft);
    background: transparent;
    border: none;
    border-radius: 7px;
    cursor: pointer;
    text-align: center;
    transition: all 0.15s ease;
  }

  .preset-tab:hover {
    color: var(--ink);
  }

  .preset-tab.active {
    background: var(--paper-2);
    color: var(--ink);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }

  .days-pill-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 6px;
    margin-top: 4px;
  }

  .day-circle-btn {
    height: 36px;
    border-radius: 10px;
    font-size: 12.5px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--paper);
    border: 1px solid var(--line);
    color: var(--ink-soft);
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
  }

  .day-circle-btn:hover {
    border-color: var(--ink-faint);
    color: var(--ink);
  }

  .day-circle-btn.selected {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }

  .times-subfield {
    margin-top: 6px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }

  .times-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .field-label-text {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
  }

  .tz-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--ink-faint);
    background: var(--paper);
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid var(--line);
  }

  .times-pills-wrap {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .time-item-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 9px;
    padding: 4px 8px 4px 10px;
  }

  .time-clock-icon {
    color: var(--ink-faint);
  }

  .time-native-input {
    border: none;
    background: transparent;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    outline: none;
    font-family: inherit;
    width: 65px;
    padding: 0;
  }

  .time-remove-icon-btn {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    background: transparent;
    border: none;
    color: var(--ink-faint);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s;
  }

  .time-remove-icon-btn:hover {
    background: #fef2f2;
    color: #b91c1c;
  }

  .add-time-pill-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    background: var(--paper);
    border: 1px dashed color-mix(in srgb, var(--accent) 40%, var(--line));
    border-radius: 9px;
    padding: 6px 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .add-time-pill-btn:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    border-color: var(--accent);
  }

  .options-card {
    gap: 10px;
  }

  .toggle-option-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .toggle-option-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .toggle-option-name {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ink);
  }

  .toggle-option-sub {
    font-size: 12px;
    color: var(--ink-faint);
    line-height: 1.35;
  }

  .toggle-divider {
    height: 1px;
    background: var(--line);
  }

  .sheet-bottom-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 20px;
    background: var(--paper);
    border-top: 1px solid var(--line);
    flex-shrink: 0;
  }

  .sheet-footer-status {
    font-size: 12px;
    color: var(--ink-faint);
  }

  .status-summary {
    color: var(--ink-soft);
    font-weight: 500;
  }

  .status-warning {
    color: #b91c1c;
    font-weight: 500;
  }

  .sheet-footer-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .save-btn {
    padding: 8px 18px;
  }

  .avatar-picker { display: flex; flex-direction: column; gap: 12px; }
  .avatar-faces { display: flex; flex-wrap: wrap; gap: 8px; }
  .avatar-face-btn {
    width: 42px; height: 42px; border-radius: 12px; border: 1px solid var(--line);
    background: var(--paper); display: inline-flex; align-items: center; justify-content: center;
    cursor: pointer; padding: 0; transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
  }
  .avatar-face-btn:hover { transform: translateY(-1px); }
  .avatar-face-btn.active {
    border-color: var(--ink);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--ink) 12%, transparent);
  }
  .avatar-colors {
    display: grid; grid-template-columns: repeat(auto-fill, 22px); gap: 7px; align-items: center;
  }
  .avatar-color-btn {
    width: 22px; height: 22px; border-radius: 50%; padding: 0; cursor: pointer;
    background: var(--swatch); border: 1px solid color-mix(in srgb, var(--ink) 14%, transparent);
    transition: transform 0.15s, box-shadow 0.15s;
  }
  .avatar-color-btn:hover { transform: scale(1.08); }
  .avatar-color-btn.active {
    box-shadow: 0 0 0 2px var(--paper), 0 0 0 4px color-mix(in srgb, var(--ink) 45%, transparent);
  }
  .avatar-color-custom {
    width: 22px; height: 22px; border-radius: 50%; overflow: hidden; cursor: pointer;
    border: 1px dashed color-mix(in srgb, var(--ink) 30%, transparent);
    background: conic-gradient(#ef4444, #eab308, #10b981, #0ea5e9, #8b5cf6, #ef4444);
    display: inline-flex;
  }
  .avatar-color-custom input[type='color'] {
    width: 200%; height: 200%; margin: -50%; border: 0; padding: 0;
    background: transparent; cursor: pointer; opacity: 0;
  }
</style>
