<script lang="ts">
	import { onMount } from 'svelte';
	import { _, locale } from 'svelte-i18n';
	import { localePath, type Locale } from '$lib/i18n/locale';
	import SiteNav from '$lib/components/SiteNav.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import MarcoWidget from '$lib/components/MarcoWidget.svelte';
	import AgentAvatar from '$lib/components/AgentAvatar.svelte';
	import { BOOKING_URL } from '$lib/links';
	import { marketingStartHref } from '$lib/start-href';
	import {
		AGENT_TEMPLATE_CATEGORIES,
		agentCategoryLabel,
		agentScheduleSummary,
		integrationLabel
	} from '$lib/agent-templates';
	import { siteUrl } from '$lib/seo';
	import type { PageData } from './$types';
	import '$lib/styles/landing.css';

	let { data }: { data: PageData } = $props();

	const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
	const lang = $derived((($locale as Locale) ?? 'en') as Locale);
	const it = $derived(lang === 'it');
	const waitlistActive = $derived(data.waitlistActive);
	const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
	const loggedIn = $derived(Boolean(data.session));
	const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));

	let activeCategory = $state<string>('all');
	let query = $state('');

	// Only offer a filter for a category that actually has agents in it.
	const categories = $derived(
		AGENT_TEMPLATE_CATEGORIES.filter((c) => data.agents.some((a) => a.category === c))
	);

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return data.agents.filter((a) => {
			if (activeCategory !== 'all' && a.category !== activeCategory) return false;
			if (!q) return true;
			return (
				a.name.toLowerCase().includes(q) ||
				a.tagline.toLowerCase().includes(q) ||
				a.tags.some((t) => t.toLowerCase().includes(q)) ||
				a.integrations.some((t) => t.toLowerCase().includes(q))
			);
		});
	});

	const pageTitle = 'AI Agent Library — Anomalia';
	const pageDesc = $derived(
		it
			? `${data.agents.length} agenti AI pronti all'uso per social, SEO, lead e reporting. Prompt e schedulazione già scritti: scegli, installa, lavora in background.`
			: `${data.agents.length} ready-made AI agents for social, SEO, leads and reporting. Prompt and schedule already written: pick one, install it, let it run in the background.`
	);
	const canonical = $derived(siteUrl() + lp('/agents'));

	// One ItemList of SoftwareApplications: the directory is the entity, each agent is an item.
	const jsonLd = $derived(
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'CollectionPage',
			name: pageTitle,
			description: pageDesc,
			url: canonical,
			mainEntity: {
				'@type': 'ItemList',
				numberOfItems: data.agents.length,
				itemListElement: data.agents.map((a, i) => ({
					'@type': 'ListItem',
					position: i + 1,
					url: siteUrl() + lp(`/agents/${a.slug}`),
					name: a.name,
					description: a.tagline
				}))
			}
		})
	);

	onMount(() => {
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) {
						e.target.classList.add('in');
						io.unobserve(e.target);
					}
				}
			},
			{ threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
		);
		document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
		return () => io.disconnect();
	});
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDesc} />
	<link rel="canonical" href={canonical} />
	<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDesc} />
	<meta property="og:type" content="website" />
	{@html `<script type="application/ld+json">${jsonLd}<\/script>`}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">
	<section class="ag-hero">
		<div class="wrap ag-hero-inner">
			<span class="eyebrow reveal">{it ? 'Libreria agenti' : 'Agent library'}</span>
			<h1 class="ag-h1 reveal" data-d="1">
				{it ? 'Agenti AI già pronti' : 'AI agents, already written'}
			</h1>
			<p class="ag-sub reveal" data-d="2">
				{it
					? 'Il prompt, la schedulazione e lo specialista giusto sono già decisi. Scegli un agente, installalo sul tuo brand, e lavora in background mentre tu fai altro.'
					: 'The prompt, the schedule and the right specialist are already decided. Pick an agent, install it on your brand, and let it work in the background while you do something else.'}
			</p>
			<div class="ag-hero-stats reveal" data-d="3">
				<span><strong>{data.agents.length}</strong> {it ? 'agenti' : 'agents'}</span>
				<span class="dot">·</span>
				<span><strong>{categories.length}</strong> {it ? 'categorie' : 'categories'}</span>
				<span class="dot">·</span>
				<span>{it ? 'installazione in un click' : 'one-click install'}</span>
			</div>
		</div>
	</section>

	<section class="ag-directory">
		<div class="wrap">
			<div class="ag-controls reveal">
				<div class="ag-search">
					<input
						type="search"
						bind:value={query}
						placeholder={it ? 'Cerca un agente…' : 'Search an agent…'}
						aria-label={it ? 'Cerca un agente' : 'Search an agent'}
					/>
				</div>
				<div class="ag-filters" role="group" aria-label={it ? 'Filtra per categoria' : 'Filter by category'}>
					<button
						type="button"
						class="ag-filter"
						class:active={activeCategory === 'all'}
						onclick={() => (activeCategory = 'all')}
					>
						{it ? 'Tutti' : 'All'}
					</button>
					{#each categories as c}
						<button
							type="button"
							class="ag-filter"
							class:active={activeCategory === c}
							onclick={() => (activeCategory = c)}
						>
							{agentCategoryLabel(c, lang)}
						</button>
					{/each}
				</div>
			</div>

			{#if filtered.length === 0}
				<p class="ag-empty reveal">
					{it ? 'Nessun agente per questa ricerca.' : 'No agents match this search.'}
				</p>
			{:else}
				<div class="ag-grid">
					{#each filtered as agent, i (agent.slug)}
						<a class="ag-card reveal" data-d={(i % 3) + 1} href={lp(`/agents/${agent.slug}`)}>
							<div class="ag-card-top">
								<AgentAvatar face={agent.avatar_face} color={agent.avatar_color} size={44} />
								<div class="ag-card-heading">
									<h2 class="ag-card-title">{agent.name}</h2>
									<span class="ag-card-cat">{agentCategoryLabel(agent.category, lang)}</span>
								</div>
								{#if agent.featured}
									<span class="ag-star" title={it ? 'In evidenza' : 'Featured'}>★</span>
								{/if}
							</div>
							<p class="ag-card-desc">{agent.tagline}</p>
							<div class="ag-card-foot">
								<span class="ag-when">{agentScheduleSummary(agent.days_of_week, agent.times, lang)}</span>
								{#if agent.integrations.length > 0}
									<span class="ag-ints">
										{#each agent.integrations.slice(0, 3) as slug}
											<span class="ag-int">{integrationLabel(slug)}</span>
										{/each}
									</span>
								{/if}
							</div>
						</a>
					{/each}
				</div>
			{/if}
		</div>
	</section>

	<section class="ag-how">
		<div class="wrap">
			<h2 class="ag-how-title reveal">{it ? 'Come funziona' : 'How it works'}</h2>
			<div class="ag-steps">
				<div class="ag-step reveal" data-d="1">
					<span class="ag-step-n">1</span>
					<h3>{it ? 'Scegli un agente' : 'Pick an agent'}</h3>
					<p>
						{it
							? 'Ognuno arriva con il prompt scritto, i giorni e gli orari già impostati e lo specialista giusto selezionato.'
							: 'Each one arrives with the prompt written, the days and times already set and the right specialist selected.'}
					</p>
				</div>
				<div class="ag-step reveal" data-d="2">
					<span class="ag-step-n">2</span>
					<h3>{it ? 'Installalo sul brand' : 'Install it on your brand'}</h3>
					<p>
						{it
							? 'Un click da Automations › Agenti custom. Puoi modificare prompt e orari prima o dopo, quando vuoi.'
							: 'One click from Automations › Custom agents. You can edit the prompt and the schedule before or after, any time.'}
					</p>
				</div>
				<div class="ag-step reveal" data-d="3">
					<span class="ag-step-n">3</span>
					<h3>{it ? 'Lavora da solo' : 'It runs on its own'}</h3>
					<p>
						{it
							? 'Ogni run apre una chat in background sul tuo brand, con i tuoi dati. Torni sul thread quando vuoi.'
							: 'Every run opens a background chat on your brand, with your data. You come back to the thread whenever you like.'}
					</p>
				</div>
			</div>
		</div>
	</section>

	<section class="ag-final">
		<div class="wrap ag-final-inner reveal">
			<h2>{it ? 'Non partire da un prompt vuoto.' : "Don't start from an empty prompt."}</h2>
			<p>
				{it
					? 'Installa il primo agente in un minuto, poi modificalo come vuoi. Restano tuoi: prompt, orari, specialista.'
					: 'Install your first agent in a minute, then change anything. The prompt, the schedule and the specialist stay yours.'}
			</p>
			<div class="gr-actions ag-final-actions">
				<a href={startHref} class="btn btn-primary btn-hero">
					{cta} <span class="arr">→</span>
				</a>
				<a href={BOOKING_URL} target="_blank" rel="noopener" class="btn btn-ghost gr-ghost">
					{it ? 'Prenota una call' : 'Book a call'}
				</a>
			</div>
		</div>
	</section>
</main>

<SiteFooter />
<MarcoWidget />

<style>
	.ag-hero {
		padding: 120px 0 56px;
		text-align: center;
		background: var(--paper-2);
	}
	.ag-h1 {
		font-size: clamp(2.2rem, 5vw, 3.8rem);
		font-weight: var(--heading-weight);
		line-height: 1.08;
		letter-spacing: var(--heading-tracking);
		margin: 0 auto;
		max-width: 18ch;
		text-wrap: balance;
	}
	.ag-sub {
		color: var(--ink-soft);
		font-size: 1.15rem;
		max-width: 58ch;
		margin: 20px auto 0;
		line-height: 1.55;
	}
	.ag-hero-stats {
		margin-top: 22px;
		display: flex;
		gap: 10px;
		justify-content: center;
		flex-wrap: wrap;
		font-size: 0.9rem;
		color: var(--ink-soft);
	}
	.ag-hero-stats strong {
		color: var(--ink);
	}
	.ag-hero-stats .dot {
		opacity: 0.5;
	}

	.ag-directory {
		padding: 40px 0 96px;
	}
	.ag-controls {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 18px;
		margin-bottom: 36px;
	}
	.ag-search input {
		width: min(28rem, 92vw);
		padding: 11px 18px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--paper);
		color: var(--ink);
		font-family: var(--sans);
		font-size: 0.95rem;
	}
	.ag-search input:focus {
		outline: none;
		border-color: var(--accent);
	}
	.ag-filters {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: center;
	}
	.ag-filter {
		padding: 8px 18px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--paper);
		font-family: var(--sans);
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--ink-soft);
		cursor: pointer;
		transition: all 0.2s var(--ease);
	}
	.ag-filter:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.ag-filter.active {
		background: var(--invert-surface);
		color: #fff;
		border-color: var(--ink);
	}

	.ag-empty {
		text-align: center;
		color: var(--ink-soft);
		padding: 2rem 0;
	}

	.ag-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 18px;
	}
	.ag-card {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 22px;
		border: 1px solid var(--line);
		border-radius: 18px;
		background: var(--paper);
		text-decoration: none;
		color: inherit;
		transition:
			transform 0.25s var(--ease),
			border-color 0.25s var(--ease);
	}
	.ag-card:hover {
		transform: translateY(-3px);
		border-color: var(--ink);
	}
	.ag-card-top {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.ag-card-heading {
		min-width: 0;
		flex: 1;
	}
	.ag-card-title {
		font-family: var(--serif);
		font-size: 1.15rem;
		font-weight: var(--heading-weight);
		margin: 0;
		line-height: 1.2;
		letter-spacing: var(--heading-tracking);
	}
	.ag-card-cat {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.ag-star {
		color: var(--accent);
		font-size: 0.9rem;
		align-self: flex-start;
	}
	.ag-card-desc {
		margin: 0;
		color: var(--ink-soft);
		font-size: 0.94rem;
		line-height: 1.5;
		flex: 1;
	}
	.ag-card-foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
	}
	.ag-when {
		font-size: 0.76rem;
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}
	.ag-ints {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		margin-left: auto;
	}
	.ag-int {
		font-size: 0.7rem;
		padding: 3px 8px;
		border-radius: 999px;
		border: 1px solid var(--line);
		color: var(--ink-soft);
	}

	.ag-how {
		padding: 80px 0;
		background: var(--paper-2);
	}
	.ag-how-title {
		text-align: center;
		font-size: clamp(1.6rem, 3.4vw, 2.4rem);
		font-weight: var(--heading-weight);
		letter-spacing: var(--heading-tracking);
		margin: 0 0 40px;
	}
	.ag-steps {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 24px;
	}
	.ag-step h3 {
		margin: 12px 0 8px;
		font-size: 1.1rem;
		font-weight: var(--heading-weight);
	}
	.ag-step p {
		margin: 0;
		color: var(--ink-soft);
		line-height: 1.55;
		font-size: 0.96rem;
	}
	.ag-step-n {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 999px;
		border: 1px solid var(--line);
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--accent);
	}

	.ag-final {
		padding: 110px 0;
		text-align: center;
	}
	.ag-final-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.ag-final h2 {
		font-size: clamp(2rem, 4.5vw, 3.2rem);
		font-weight: var(--heading-weight);
		letter-spacing: var(--heading-tracking);
		margin: 0;
		max-width: 26ch;
		text-wrap: balance;
	}
	.ag-final p {
		color: var(--ink-soft);
		margin: 18px 0 0;
		font-size: 1.15rem;
		max-width: 50ch;
		line-height: 1.55;
	}
	.ag-final-actions {
		margin-top: 32px;
	}

	@media (max-width: 960px) {
		.ag-grid,
		.ag-steps {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (max-width: 720px) {
		.ag-hero {
			padding: 84px 0 44px;
		}
		.ag-directory {
			padding: 32px 0 64px;
		}
		.ag-grid,
		.ag-steps {
			grid-template-columns: 1fr;
		}
		.ag-final {
			padding: 80px 0;
		}
	}
</style>
