<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount, onDestroy } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { isPlanKey, normalizeCycle } from '$lib/plans';
  import { track } from '$lib/analytics';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import MarcoWidget from '$lib/components/MarcoWidget.svelte';
  import { sanitizeWebsiteParam } from '$lib/website-param';
  import { clearGuestOnboarding, loadGuestOnboarding } from '$lib/guest-onboarding';
    import { pmeta, buildHandleList, requestRecommendedPlatforms } from './components/platform-utils';
  import { cancelPoll, type JobPoll } from './components/step-jobs';
  import { toGenPeople, toSavePeople, collectPersonPaths, applySignedUrls, snapshotDetected, type DetectedPerson } from './components/people';
  import { reportOnboardingError } from './components/error-report';
  import { postDraft } from './components/draft-client';
  import { fetchCustomAgents } from './components/brand-agents';
  import {
    earlyCreateFormData,
    resolveEarlyBrandName,
    submitEarlyCreate,
    type EarlyCreateSnapshot
  } from './components/early-create';
  import { createPublishFlow } from './components/publish-flow.svelte';
  import { guardUnload } from './components/unload-guard';
  import { guestAssignments } from './components/guest-funnel';
  import { asContinueBrand, decideResumePhase } from './components/continue-resume';
  import {
    TIMELINE_STEPS,
    PROGRESS_TOTAL,
    PHASE_STEP,
    backTargets,
    type Phase
  } from './components/phase';
import { restoreDraft } from './components/restore-draft';
import WizardChrome from './components/WizardChrome.svelte';
import PublishOverlay from './components/PublishOverlay.svelte';
import EntryInput from './components/EntryInput.svelte';
  import AnalysisScreen from './components/AnalysisScreen.svelte';
  import IntroCarousel, { INTRO_SCREENS } from './components/IntroCarousel.svelte';
  import AgentPick from './components/AgentPick.svelte';
  import PeopleStep from './components/PeopleStep.svelte';
  import CompetitorsStep from './components/CompetitorsStep.svelte';
  import StrategyStep from './components/StrategyStep.svelte';
  import PlanStep from './components/PlanStep.svelte';
  import PreviewStep from './components/PreviewStep.svelte';

  let { form, data } = $props();

  // Plan picked on /pricing: pre-selects the tier at the paywall and bounds the cadence the plan may propose.
  const planParam = $derived(isPlanKey($page.url.searchParams.get('plan')) ? $page.url.searchParams.get('plan')! : '');
  const cycleParam = $derived(planParam ? normalizeCycle($page.url.searchParams.get('cycle')) : '');
  const websiteParam = $derived(sanitizeWebsiteParam($page.url.searchParams.get('website')));

  // La prima metà crea il brand (input → analyzing → intro → pick); la seconda
  // (people → competitors → strategy → plan → preview) è opzionale e si riprende con ?continue=.
  let phase = $state<Phase>('input');
  // Entrata a schermo unico: niente sidebar né timeline, quelle valgono da 'people' in poi.
  const entryMode = $derived(
    phase === 'input' || phase === 'analyzing' || phase === 'intro' || phase === 'pick'
  );
  // Set when resuming the optional second half for an already-created brand (?continue=slug).
  let existingBrandSlug = $state<string | null>(null);
  const isContinueMode = $derived(!!existingBrandSlug);

  const progressStep = $derived(PHASE_STEP[phase]);

  // Titolo+lead identici per tre fasi: la mappa li dichiara accanto al modello delle fasi.
  const HEAD_COPY: Record<'people' | 'competitors' | 'plan', { title: string; lead: string }> = {
    people: { title: 'onboarding.people.title', lead: 'onboarding.people.sub' },
    competitors: { title: 'onboarding.competitors.title', lead: 'onboarding.competitors.sub' },
    plan: { title: 'onboarding.plan.title', lead: 'onboarding.plan.sub' }
  };

  let url = $state('');
  // Senza sito: nome + nicchia, e si sintetizza un profilo minimo perché la pipeline resti una sola.
  let noWebsite = $state(false);
  let brandName = $state('');
  let creatorNiche = $state('');
  let error = $state('');
  let progress = $state('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let profile = $state<any>(null);
  let language = $state(''); // '' = auto-detect; pre-filled from the analyzed site
  let additionalContext = $state('');

  const genProfile = $derived(
    profile ?? { name: brandName.trim(), about: creatorNiche.trim(), language: language || '', url: url.trim() }
  );

  // Id coniato dal client prima di tutto: ogni chiamata AI ci si attacca, e +page.server.ts lo
  // riusa come brands.id vero al submit.
  let brandId = $state<string | null>(null);

  // Handle da IMPARARE (scrape), deliberatamente indipendenti da dove si pubblica.
  let handles = $state<Record<string, string>>({});
  const handleList = $derived(buildHandleList(handles));
  // Dove PUBBLICARE: riempiti dai profili trovati sul sito e dalla raccomandazione qui sotto.
  let selectedPlatforms = $state<string[]>([]);

  let recommendedPlatforms = $state<string[]>([]);
  let platformRationale = $state('');
  let recommendedDone = false;
  async function recommendPlatforms() {
    if (recommendedDone || !brandId) return;
    if (!profile && !creatorNiche.trim()) return;
    recommendedDone = true;
    try {
      const d = await requestRecommendedPlatforms(brandId, genProfile);
      recommendedPlatforms = (d.recommended ?? []).filter((p) => pmeta(p));
      platformRationale = d.rationale ?? '';
      // Never override a real choice (typed handles, a resumed draft, a manual pick).
      if (!selectedPlatforms.length && recommendedPlatforms.length) selectedPlatforms = [...recommendedPlatforms];
    } catch {
      // non-fatale: lo step funziona anche senza raccomandazione
    }
  }

  let detectedPeople = $state<DetectedPerson[]>([]);
  let personName = $state('');
  let personRole = $state('');
  let showManualPerson = $state(false);
  let personImages = $state<{ path: string; url: string }[]>([]);

  const readyDetected = $derived(detectedPeople.filter((p) => p.selected && p.path && p.url));
  const peopleForGen = $derived(
    toGenPeople(readyDetected, { name: personName, role: personRole, images: personImages })
  );
  // Si salvano i path, non gli URL firmati (scadono). Il consenso NON è cosmetico:
  // resolvePeopleVisualRefs rifiuta un volto reale non attestato. Detected = scovato, quindi
  // consent:false finché Studio → People non conferma; uploaded = il titolare l'ha caricato, ed è
  // quella l'attestazione.
  const peopleForSave = $derived(
    toSavePeople(readyDetected, { name: personName, role: personRole, images: personImages })
  );

  type Competitor = { name: string; website: string; kind: 'direct' | 'indirect'; rationale: string; source: 'ai' | 'user' };
  let competitors = $state<Competitor[]>([]);
  let citations = $state<{ uri: string; title: string }[]>([]);
  let competitorJobId = $state<string | null>(null);
  let compDiscovering = $state(false);
  let compPoll = $state<JobPoll | undefined>(undefined);

  // Firma degli input: se cambiano, la ricerca si rifà invece di mostrare una strategia stantia.
  const namedCompetitors = $derived(competitors.filter((c) => c.name.trim()));
  const researchInputs = $derived(
    [
      namedCompetitors.map((c) => c.name.trim().toLowerCase()).sort().join('|'),
      additionalContext.trim(),
      [...selectedPlatforms].sort().join(',')
    ].join('::')
  );
  let researchedInputs = $state('');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let report = $state<any | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let researchData = $state<any | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let buyerPersonas = $state<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let researchSteps = $state<{ step: string; message: string; result?: any }[]>([]);
  let researching = $state(false);
  let researchBackground = $state(false);
  let researchJobId = $state<string | null>(null);
  let researchPoll = $state<JobPoll | undefined>(undefined);
  const userEmail = $derived(
    typeof (data as { userEmail?: string | null })?.userEmail === 'string'
      ? (data as { userEmail: string }).userEmail
      : ''
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function applyResearchResult(result: Record<string, any> | null | undefined) {
    if (!result) return;
    if (Array.isArray(result.steps)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      researchSteps = result.steps.map((s: any) => ({
        step: String(s.step ?? ''),
        message: String(s.message ?? ''),
        result: s.result
      }));
    }
    if (result.report) report = result.report;
    if (result.researchData) researchData = result.researchData;
    if (Array.isArray(result.buyerPersonas)) buyerPersonas = result.buyerPersonas;
    if (result.editorialPlan) {
      editorialPlan = result.editorialPlan;
      if (Array.isArray(result.allowedCadences) && result.allowedCadences.length) {
        allowedCadences = result.allowedCadences as string[];
      }
    }
    if (result.planVisualStyle !== undefined) {
      planVisualStyle = (result.planVisualStyle as string | null) ?? null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let editorialPlan = $state<any | null>(null);
  let allowedCadences = $state<string[]>(['3/week', '5/week']);
  // Passato ai job post/immagini: quegli endpoint non lo ri-derivano.
  let planVisualStyle = $state<string | null>(null);

  // Persistito com'è in brands.content_prefs: è la forma che lo scheduler sa leggere.
  const planPrefs = $derived({
    mood: editorialPlan?.voice?.mood ?? '',
    tone: editorialPlan?.voice?.tone ?? '',
    goal: editorialPlan?.voice?.goal ?? '',
    frequency: editorialPlan?.cadence ?? '5/week',
    language
  });

  let previewPhase = $state<'idle' | 'generating' | 'done'>('idle');
  let imagesRendering = $state(false);
  const previewBusy = $derived(previewPhase === 'generating' || imagesRendering);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let previewPosts = $state<any[]>([]);
  let planPostsJobId = $state<string | null>(null);
  let previewImagesJobId = $state<string | null>(null);
  let previewPoll = $state<JobPoll | undefined>(undefined);

  // I catch lato server chiamano già logOnboardingError: questo copre i fallimenti solo-client.
  function trackError(step: string, message: unknown, context?: Record<string, unknown>) {
    reportOnboardingError(
      step,
      message,
      {
        url: url || undefined,
        brandName: brandName || undefined,
        brandId: brandId || undefined,
        draftId: draftId || undefined,
        phase
      },
      context
    );
  }

  let setupSlug = $state('');
  let brandCustomAgents = $state<Array<{ id: string; name: string; face: string; color: string }>>([]);
  let introStep = $state(0);

  function enterIntro(slug: string) {
    setupSlug = slug;
    introStep = 0;
    phase = 'intro';
    track('onboarding_intro_start', { slug });
    fetchCustomAgents(slug)
      .then((list) => {
        if (list) brandCustomAgents = list;
      })
      .catch(() => {});
  }

  function pickBack() {
    phase = 'intro';
    introStep = INTRO_SCREENS.length - 1;
  }

  // Gli step figli montano col loro fase: l'azione che li accende parte dopo il mount,
  // tramite questa coda svuotata da un effect.
  function restartRecommendation() {
    recommendedDone = false;
    recommendPlatforms();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let previewApi = $state<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let entryApi = $state<any>(null);
  let pendingAction = $state<null | (() => void)>(null);

  $effect(() => {
    const action = pendingAction;
    if (!action) return;
    pendingAction = null;
    action();
  });

  function goCompetitors() {
    phase = 'competitors';
    pendingAction = () => void compApi?.discover();
  }
  function goStrategy() {
    const force = !!editorialPlan && researchedInputs !== researchInputs;
    phase = 'strategy';
    pendingAction = () => void stratApi?.research(force);
  }
  function goPlan() {
    if (!editorialPlan) return;
    phase = 'plan';
  }
  function approvePlan() {
    if (!editorialPlan) return;
    track('onboarding_plan_approved', { cadence: editorialPlan?.cadence });
    phase = 'preview';
    pendingAction = () => void previewApi?.planPosts();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let compApi = $state<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stratApi = $state<any>(null);

  const flow = createPublishFlow({
    getPostCount: () => previewPosts.length,
    getPlatformCount: () => selectedPlatforms.length,
    isContinueMode: () => isContinueMode
  });

  const BACK = $derived(backTargets(isContinueMode));
  const canGoBack = $derived(
    !flow.publishing &&
      (isContinueMode
        ? phase === 'people' || !!BACK[phase]
        : !!BACK[phase])
  );
  function back() {
    // Fermare il poll locale non ferma il job: si riattacca al ritorno. Cancellare risolve la
    // sleep, così il finally del runner gira e libera il suo flag busy.
    if (phase === 'competitors' && compDiscovering) cancelPoll(compPoll);
    if (phase === 'strategy' && researching) cancelPoll(researchPoll);
    // Il poll dell'anteprima si lascia vivo di proposito: `previewBusy` deve restare true, blocca
    // il bottone di fine finché i job girano davvero.
    if (isContinueMode && phase === 'people' && existingBrandSlug) {
      window.location.href = `/app/${existingBrandSlug}`;
      return;
    }
    const to = BACK[phase];
    if (to) phase = to;
  }

  function skipToDashboard() {
    if (!existingBrandSlug) return;
    track('onboarding_second_half_skipped', { step: phase });
    window.location.href = `/app/${existingBrandSlug}`;
  }

  // La ricerca no: è un job durevole con mail a fine lavoro, chiudere la scheda va bene.
  const leaveGuard = $derived(phase === 'analyzing' || previewBusy);
  $effect(() => guardUnload(() => leaveGuard));

  // FormData dallo stato vivo: i valori DOM di un form nascosto restano stantii per un tick  // dopo che analyze() ha scritto profile/brandName.
  function earlySnapshot(): EarlyCreateSnapshot {
    return {
      profile,
      url,
      creatorNiche,
      selectedPlatforms,
      handleList,
      brandId,
      draftId
    };
  }

  async function finishEarly() {
    const name = resolveEarlyBrandName(brandName, profile, url);
    if (!name) {
      error = $_('onboarding.brand.nameLabel');
      phase = 'input';
      return;
    }
    brandName = name;

    track('onboarding_early_create', { platforms: selectedPlatforms.length, has_profile: !!profile });
    flow.start(true);
    try {
      const { result, status } = await submitEarlyCreate(earlyCreateFormData(earlySnapshot(), name));
      if (result.type === 'redirect') {
        await new Promise((r) => setTimeout(r, 900));
        // `result.location` è `/app/{slug}/chat/{thread}` o `/app/{slug}`: lo slug è il secondo
        // segmento in entrambi i casi.
        const slug = result.location.split('/')[2] ?? '';
        if (slug) {
          flow.stop();
          enterIntro(slug);
          return;
        }
        await goto(result.location);
        return;
      }
      // Timeout di piattaforma / HTML non-action dopo un create lungo: la riga brand di solito c'è già.
      if ((result.type as string) === 'unknown') {
        trackError('early_create', `unknown status=${status}`);
        await goto('/app');
        return;
      }
      flow.stop();
      const failMsg =
        result.type === 'failure' && result.data && typeof result.data === 'object' && 'error' in result.data
          ? String((result.data as { error?: unknown }).error ?? '')
          : '';
      trackError('early_create', failMsg || result.type);
      error = failMsg === 'slotLimit' ? $_('onboarding.slotLimit') : failMsg || $_('onboarding.status.createFailed');
      phase = 'input';
    } catch (e) {
      flow.stop();
      trackError('early_create', e instanceof Error ? e.message : 'request failed');
      error = e instanceof Error ? e.message : $_('onboarding.status.createFailed');
      phase = 'input';
    }
  }

  // Ripresa: il wizard vive tutto nello stato del componente, quindi si salva un'istantanea a ogni
  // cambio e si reidrata al load. Senza un brand non esistono step oltre il form del sito: ogni
  // draft riparte da 'input' (i dati restano nel draft, non si perde niente).

  function serialize() {
    return {
      v: 3,
      brandId,
      url, noWebsite, brandName, creatorNiche,
      profile, researchData, report, citations, buyerPersonas, previewPosts,
      editorialPlan, allowedCadences, planVisualStyle,
      competitors, competitorJobId, researchJobId, planPostsJobId, previewImagesJobId,
      selectedPlatforms, handles,
      language, additionalContext,
      people: {
        personName, personRole,
        personImages: personImages.map((i) => ({ path: i.path })),
        detectedPeople: detectedPeople.map(snapshotDetected)
      }
    };
  }

  let hydrated = $state(false);
  // Ogni run "nuovo brand" ha il suo draft: non si sovrascrivono a vicenda.
  let draftId = $state<string | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSaved = '';

  async function flushSave(body: string) {
    if (body === lastSaved) return;
    lastSaved = body;
    const saved = await postDraft(body);
    if (!saved) {
      trackError('draft_save', 'save failed');
      return;
    }
    // Il server torna l'id della riga (creata al primo salvataggio) e preserva il brandId coniato qui.
    if (saved.id) draftId = saved.id;
    else if (saved.status !== 403) {
      // 403 = limite di slot: stato di business, non un guasto.
      trackError('draft_save', `HTTP ${saved.status}`);
    }
  }

  // serialize() legge ogni signal: è quello a far ripartire l'effect a ogni cambio di stato.
  $effect(() => {
    const body = JSON.stringify({ id: draftId, phase, draft: serialize() });
    if (!hydrated || phase === 'analyzing' || isContinueMode) return;
    // Niente gusci di draft vuoti a ogni visita: si persiste solo quando c'è qualcosa da riprendere.
    const hasContent = !!(url.trim() || brandName.trim() || creatorNiche.trim() || profile);
    if (!draftId && !hasContent) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => flushSave(body), 700);
  });

  // Gli URL firmati scadono: dopo una ripresa vanno ribattuti dai path salvati.
  async function resignPeople() {
    const paths = collectPersonPaths(personImages, detectedPeople);
    if (!paths.length) return;
    try {
      const res = await fetch('/app/onboarding/people/sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paths })
      });
      if (!res.ok) return;
      const { urls } = (await res.json()) as { urls: Record<string, string> };
      const next = applySignedUrls(personImages, detectedPeople, urls);
      personImages = next.personImages;
      detectedPeople = next.detectedPeople;
    } catch {
    }
  }

  function resumeWork() {
    if (phase === 'people') pendingAction = () => void peopleApi?.discover();
    else if (phase === 'competitors') pendingAction = () => void compApi?.discover();
    else if (phase === 'strategy') pendingAction = () => void stratApi?.research();
    else if (phase === 'preview') {
      // Prima ci si riattacca ai job vivi: si ripianifica solo se non gira niente e non c'è nulla.
      pendingAction = () =>
        void previewApi
          ?.resumeJobs()
          .then(() => {
            if (!previewBusy && !previewPosts.length) return previewApi?.planPosts();
            return undefined;
          });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let peopleApi = $state<any>(null);
  let peopleScanDone = $state(false);

  onMount(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cont = asContinueBrand((data as any)?.continueBrand);
    if (cont) {
      existingBrandSlug = cont.slug ?? null;
      brandId = cont.id ?? null;
      brandName = cont.name ?? '';
      url = cont.website ?? '';
      noWebsite = !cont.website;
      profile = cont.profile ?? null;
      selectedPlatforms = Array.isArray(cont.targetPlatforms) ? (cont.targetPlatforms as string[]) : [];
      handles = cont.handles && typeof cont.handles === 'object' ? (cont.handles as Record<string, string>) : {};

      const research = cont.research;
      const resumedAt = decideResumePhase(research, !!editorialPlan);
      if (research?.id) {
        researchJobId = research.id;
        if (research.result) applyResearchResult(research.result);
      }
      phase = resumedAt;
      hydrated = true;
      track('onboarding_second_half_resumed', {
        brand: cont.slug,
        ...(resumedAt !== 'people' ? { step: resumedAt } : {})
      });
      if (resumedAt === 'strategy') resumeWork();
      return;
    }

    // Il funnel ospite (/start) VINCE su un onboarding_draft più vecchio: chi torna per creare un
    // brand NUOVO non deve finire dentro un draft stantio.
    const guest = loadGuestOnboarding();
    if (guest?.readyForAnalysis && guest) {
      clearGuestOnboarding();
      ({ url, noWebsite, brandName, creatorNiche, selectedPlatforms, handles } = guestAssignments(guest));
      if (!brandId) brandId = crypto.randomUUID();
      hydrated = true;
      track('onboarding_started', { source: 'guest_funnel', step: 'analyzing' });
      if (noWebsite || !url.trim()) finishEarly();
      else void entryApi?.analyze();
      return;
    }

    const r = restoreDraft(data?.draft);
    if (r) {
      draftId = data?.draftId ?? null;
      ({
        brandId, url, noWebsite, brandName, creatorNiche, profile, researchData, report,
        citations, buyerPersonas, previewPosts, editorialPlan, planVisualStyle,
        competitors, competitorJobId, researchJobId, planPostsJobId, previewImagesJobId,
        researchSteps, selectedPlatforms, handles, language, additionalContext
      } = r);
      if (r.allowedCadences.length) allowedCadences = r.allowedCadences;
      personName = r.personName;
      personRole = r.personRole;
      personImages = r.personImages;
      detectedPeople = r.detectedPeople;
      if (previewPosts.length) previewPhase = 'done';
      peopleScanDone = detectedPeople.length > 0;
      showManualPerson = !!(personName.trim() || personImages.length);
      if (editorialPlan) researchedInputs = researchInputs;
      // Ogni draft senza brand riparte dal form del sito: il phase salvato serve solo alla telemetria.
      phase = 'input';
      lastSaved = JSON.stringify({ id: draftId, phase, draft: serialize() }); // suppress a duplicate save
      resignPeople();
      recommendPlatforms();
      track('onboarding_resumed', { step: phase, saved_step: String(data?.draftPhase ?? '') });
    } else if (websiteParam) {
      // Il sito è già noto (CTA della homepage, o login con ?website=): dritti all'analisi.
      url = websiteParam;
      noWebsite = false;
      track('onboarding_started', { source: 'homepage_url', step: 'analyzing' });
      void entryApi?.analyze();
    } else {
      track('onboarding_started');
    }
    if (!brandId) brandId = crypto.randomUUID();
    hydrated = true;
  });

  onDestroy(() => {
    cancelPoll(compPoll);
    cancelPoll(researchPoll);
    cancelPoll(previewPoll);
  });
</script>

<svelte:head><title>{$_('meta.onboarding.title')}</title></svelte:head>

{#if entryMode}
  <div class="ob-entry">
    <a class="ob-logo entry-logo" href="/app" aria-label="Anomalia"><BrandMark size={36} /></a>
    <div class="entry-stage">
      {#if phase === 'input'}
        <EntryInput
          bind:this={entryApi}
          bind:phase
          bind:url
          bind:noWebsite
          bind:brandName
          bind:creatorNiche
          bind:error
          bind:progress
          bind:profile
          bind:language
          bind:handles
          bind:selectedPlatforms
          formError={form?.error}
          onfinishearly={finishEarly}
          onanalyzed={restartRecommendation}
          onerror={trackError}
        />
      {:else if phase === 'intro'}
        <IntroCarousel bind:introStep onenterpick={() => (phase = 'pick')} />
      {:else if phase === 'pick'}
        <AgentPick slug={setupSlug} customs={brandCustomAgents} onback={pickBack} />
      {:else}
        <AnalysisScreen {progress} />
      {/if}
    </div>
  </div>
{:else}
<WizardChrome step={progressStep}>
  <main class="wrap">
      {#if canGoBack}
        <div class="ob-topnav">
          <button type="button" class="back asbtn" onclick={back}>{$_('onboarding.back')}</button>
        </div>
      {/if}

      <!-- {#key phase}: rimontare lo stage a ogni cambio fa ripartire la coreografia d'ingresso. -->
      {#key phase}
      <div class="ch-stage">
        <div class="ch-head">
          <div class="progress-bar-container">
            {#each Array.from({ length: PROGRESS_TOTAL }, (_v, i) => i + 1) as step (step)}
              <div class="progress-box" class:completed={step < progressStep} class:active={step === progressStep}></div>
            {/each}
          </div>
          {#if phase === 'people' || phase === 'competitors' || phase === 'plan'}
            {@const copy = HEAD_COPY[phase]}
            <h1 class="ch-title">{$_(copy.title)}</h1>
            <p class="ch-lead">{$_(copy.lead)}</p>
          {:else if phase === 'strategy'}
            <h1 class="ch-title">{$_('onboarding.strategy.title')}</h1>
            <p class="ch-lead">{$_('onboarding.strategy.sub')}</p>
            {#if researching || researchBackground}
              <p class="hint">
                {#if userEmail}
                  {$_('onboarding.strategy.bgEmail', { values: { email: userEmail } })}
                {:else}
                  {$_('onboarding.strategy.bgNote')}
                {/if}
              </p>
            {/if}
          {:else}
            <h1 class="ch-title">{$_('onboarding.preview.title')}</h1>
            <p class="ch-lead">
              {$_('onboarding.preview.subBefore')}<b>{brandName || $_('onboarding.timeline.brand')}</b>{$_('onboarding.preview.subAfter')}
            </p>
          {/if}
        </div>

        <!-- Questa shell parte da 'people': 'input'/'analyzing' vivono nell'entrata (entryMode). -->
        {#if phase === 'people'}
          <PeopleStep
            bind:this={peopleApi} bind:detectedPeople bind:personName bind:personRole
            bind:personImages bind:showManualPerson
            scanAlreadyDone={peopleScanDone} onmarkdone={() => (peopleScanDone = true)}
            profile={profile} handles={handleList} {isContinueMode}
            oncontinue={goCompetitors} onskip={skipToDashboard} onerror={trackError}
          />
        {:else if phase === 'competitors'}
          <CompetitorsStep
            bind:this={compApi} bind:competitors bind:citations bind:competitorJobId
            bind:additionalContext bind:discovering={compDiscovering} bind:pollRef={compPoll}
            {brandId} {draftId} profile={genProfile} platforms={selectedPlatforms}
            handles={handleList} {isContinueMode}
            oncontinue={goStrategy} onskip={skipToDashboard} onerror={trackError}
          />
        {:else if phase === 'strategy'}
          <StrategyStep
            bind:this={stratApi} bind:researchSteps bind:researching bind:researchBackground
            bind:researchJobId bind:pollRef={researchPoll} bind:editorialPlan
            bind:allowedCadences bind:planVisualStyle bind:report bind:researchData bind:buyerPersonas
            {brandId} {draftId} profile={genProfile} platforms={selectedPlatforms} {planParam}
            handles={handleList} competitors={namedCompetitors} {additionalContext}
            people={peopleForGen} {userEmail} {brandName} citations={citations} {isContinueMode}
            oncontinue={goPlan} onskip={skipToDashboard} onresult={applyResearchResult}
            onresearched={() => (researchedInputs = researchInputs)} onerror={trackError}
          />
        {:else if phase === 'plan'}
          <PlanStep
            plan={editorialPlan}
            {report}
            bind:language
            {allowedCadences}
            profileLanguage={profile?.language ?? ''}
            {isContinueMode}
            onapprove={approvePlan}
            onskip={skipToDashboard}
          />
        {:else}
          <PreviewStep
            bind:this={previewApi} bind:previewPhase bind:imagesRendering bind:previewPosts
            bind:planPostsJobId bind:previewImagesJobId bind:pollRef={previewPoll} bind:brandName
            {brandId} {draftId} {profile} {genProfile} {planVisualStyle}
            platforms={selectedPlatforms} prefs={planPrefs} plan={editorialPlan} people={peopleForGen}
            {url} {creatorNiche} {researchData} {citations}
            namedCompetitors={namedCompetitors} peopleForSave={peopleForSave} handles={handleList}
            {additionalContext} {planParam} {cycleParam} formError={form?.error}
            publishing={flow.publishing} {isContinueMode} publishEnhance={flow.enhance}
            onskip={skipToDashboard} onerror={trackError}
          />
        {/if}
      </div>
      {/key}
    </main>
</WizardChrome>
{/if}

<MarcoWidget />

{#if flow.publishing}
  <PublishOverlay
    index={flow.index}
    total={flow.total}
    label={flow.label}
    early={flow.earlyCreating}
    name={brandName}
    platformCount={selectedPlatforms.length}
  />
{/if}

<style>
  .ob-entry { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; background: var(--paper, #fff); text-align: center; position: relative; }

  button { background: var(--ink, #1d1d1f); color: #fff; border: none; border-radius: 12px; padding: 0 20px; font-size: 15px; font-weight: 600; cursor: pointer; white-space: nowrap; }

  /* Gli stage dei figli sono frammenti dentro .entry-stage/.ch-stage: la coreografia d'ingresso
     resta qui, in globale, perché i ritardi dipendono dalla posizione tra i fratelli. */
  :global(.entry-stage > *) { animation: rise 0.6s var(--ease, ease) both; }
  :global(.entry-stage > :nth-child(2)) { animation-delay: 0.14s; }
  :global(.entry-stage > :nth-child(n + 3)) { animation-delay: 0.28s; }
  @media (prefers-reduced-motion: reduce) { :global(.entry-stage > *) { animation: none; } }
  :global(.entry-stage .ch-lead) { margin-inline: auto; }

  .ob-logo { display: inline-flex; cursor: pointer; transition: opacity 0.15s, transform 0.15s; }
  .ob-logo:hover { opacity: 0.8; }
  .ob-logo:active { transform: scale(0.94); }
  .ob-logo :global(.brandmark path) { fill: var(--ink, #1d1d1f); }
  .entry-logo { position: absolute; top: 22px; left: 26px; }
  .entry-stage { width: 100%; max-width: 640px; display: flex; flex-direction: column; align-items: center; }

  @media (min-width: 861px) { .progress-bar-container { display: none; } }

  .ob-topnav { display: flex; align-items: center; gap: 16px; }
  .back { font-size: 13.5px; color: var(--ink-soft, #6e6e73); text-decoration: none; }
  .back.asbtn { background: none; border: none; padding: 0; cursor: pointer; font: inherit; font-size: 13.5px; }
  .back.asbtn:hover { color: var(--ink, #1d1d1f); }

  .ch-head { margin: 28px 0 8px; }
  .progress-bar-container { display: flex; align-items: center; gap: 8px; margin: 0 0 20px; }
  .progress-box { flex: 1; height: 8px; border-radius: 4px; background: var(--ink-faint, #86868b); transition: background 0.3s var(--ease, ease); }
  .progress-box.completed { background: var(--accent, #c485fe); }
  .progress-box.active { background: var(--accent, #c485fe); box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.2); }
  .ch-title { font-size: clamp(1.9rem, 4.5vw, 2.5rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); line-height: 1.1; margin: 10px 0 0; overflow-wrap: break-word; word-break: break-word; }
  .ch-lead { color: var(--ink-soft, #6e6e73); font-size: 1.02rem; line-height: 1.5; margin: 12px 0 0; max-width: 52ch; }
  .hint { font-size: 13px; color: var(--ink-soft, #6e6e73); margin: 2px 0 8px; line-height: 1.4; }

  @keyframes rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
  .ch-head .ch-title { animation: rise 0.6s var(--ease, ease) 0.16s both; }
  .ch-head .ch-lead { animation: rise 0.6s var(--ease, ease) 0.32s both; }
  :global(.ch-stage > :not(.ch-head)) { animation: rise 0.55s var(--ease, ease) 0.48s both; }
  :global(.ch-stage > :not(.ch-head):nth-child(3)) { animation-delay: 0.58s; }
  :global(.ch-stage > :not(.ch-head):nth-child(4)) { animation-delay: 0.68s; }
  :global(.ch-stage > :not(.ch-head):nth-child(n + 5)) { animation-delay: 0.78s; }
  /* Gli errori sono immediati, mai coreografati. */
  :global(.ch-stage > .err) { animation-delay: 0s; animation-duration: 0.25s; }
  @media (prefers-reduced-motion: reduce) {
    :global(.ch-stage > :not(.ch-head)), .ch-head .ch-title, .ch-head .ch-lead { animation: none; }
  }

  @media (max-width: 860px) {
    .ch-title { font-size: clamp(1.45rem, 5.5vw, 1.8rem); }
  }
</style>
