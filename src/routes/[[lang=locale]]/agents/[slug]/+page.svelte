<script lang="ts">
	import { onMount } from 'svelte';
	import { _, locale } from 'svelte-i18n';
	import { localePath, type Locale } from '$lib/i18n/locale';
	import SiteNav from '$lib/components/SiteNav.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import MarcoWidget from '$lib/components/MarcoWidget.svelte';
	import AgentAvatar from '$lib/components/AgentAvatar.svelte';
	import { marketingStartHref } from '$lib/start-href';
	import { agentCategoryLabel, agentScheduleSummary, integrationLabel } from '$lib/agent-templates';
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

	const agent = $derived(data.agent);
	// Signed in → straight to the install flow. Guests sign up first; the slug rides along in a
	// cookie so the editor still opens on this agent once they land in the app.
	const installHref = $derived(`/app/install-agent/${agent.slug}`);

	// Which hub specialist runs it. `null` is Anomalia with the full tool set.
	const specialist = $derived(
		agent.agent ? $_(`chat.agents.${agent.agent}.label`) : $_('chat.agents.auto.label')
	);

	const pageTitle = $derived(`${agent.name} — ${it ? 'Agente AI' : 'AI agent'} | Anomalia`);
	const pageDesc = $derived(agent.tagline);
	const canonical = $derived(siteUrl() + lp(`/agents/${agent.slug}`));

	const jsonLd = $derived(
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'SoftwareApplication',
			name: agent.name,
			applicationCategory: 'BusinessApplication',
			operatingSystem: 'Web',
			description: agent.description || agent.tagline,
			url: canonical,
			offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
			isPartOf: { '@type': 'CollectionPage', name: 'Anomalia Agent Library', url: siteUrl() + lp('/agents') }
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
	<section class="ad-hero">
		<div class="wrap ad-hero-inner">
			<a class="ad-back" href={lp('/agents')}>← {it ? 'Libreria agenti' : 'Agent library'}</a>

			<div class="ad-head reveal">
				<AgentAvatar face={agent.avatar_face} color={agent.avatar_color} size={92} />
				<div class="ad-head-text">
					<span class="ad-cat">{agentCategoryLabel(agent.category, lang)}</span>
					<h1 class="ad-h1">{agent.name}</h1>
					<p class="ad-tagline">{agent.tagline}</p>
				</div>
			</div>

			<div class="ad-actions reveal" data-d="1">
				<a href={installHref} class="btn btn-primary btn-hero">
					{it ? 'Usa questo agente' : 'Use this agent'} <span class="arr">→</span>
				</a>
				<a href={lp('/agents')} class="btn btn-ghost gr-ghost">
					{it ? 'Vedi tutti gli agenti' : 'Browse all agents'}
				</a>
			</div>
		</div>
	</section>

	<section class="ad-body">
		<div class="wrap ad-cols">
			<div class="ad-main">
				{#if agent.description}
					<p class="ad-lead reveal">{agent.description}</p>
				{/if}

				{#if agent.highlights.length > 0}
					<div class="ad-block reveal">
						<h2>{it ? 'Cosa fa' : 'What it does'}</h2>
						<ul class="ad-list">
							{#each agent.highlights as h}
								<li>{h}</li>
							{/each}
						</ul>
					</div>
				{/if}

				<div class="ad-block reveal">
					<h2>{it ? 'Il prompt' : 'The prompt'}</h2>
					<p class="ad-note">
						{it
							? 'È quello che viene installato. Puoi modificarlo prima o dopo, è tuo.'
							: 'This is what gets installed. Edit it before or after — it is yours.'}
					</p>
					<pre class="ad-prompt">{agent.prompt}</pre>
				</div>

				{#if agent.outputs.length > 0}
					<div class="ad-block reveal">
						<h2>{it ? 'Cosa lascia dietro' : 'What it leaves behind'}</h2>
						<ul class="ad-list">
							{#each agent.outputs as o}
								<li>{o}</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>

			<aside class="ad-side">
				<div class="ad-spec reveal">
					<h3>{it ? 'Scheda' : 'Spec'}</h3>
					<dl>
						<div>
							<dt>{it ? 'Schedulazione' : 'Schedule'}</dt>
							<dd>{agentScheduleSummary(agent.days_of_week, agent.times, lang)}</dd>
						</div>
						<div>
							<dt>{it ? 'Specialista' : 'Specialist'}</dt>
							<dd>{specialist}</dd>
						</div>
						<div>
							<dt>{it ? 'Thread' : 'Thread'}</dt>
							<dd>
								{agent.reuse_thread
									? it
										? 'Sempre la stessa chat'
										: 'Always the same chat'
									: it
										? 'Una chat nuova per run'
										: 'A fresh chat per run'}
							</dd>
						</div>
						{#if agent.integrations.length > 0}
							<div>
								<dt>{it ? 'Integrazioni' : 'Integrations'}</dt>
								<dd class="ad-badges">
									{#each agent.integrations as slug}
										<span class="ad-badge">{integrationLabel(slug)}</span>
									{/each}
								</dd>
							</div>
						{/if}
						{#if agent.tags.length > 0}
							<div>
								<dt>{it ? 'Tag' : 'Tags'}</dt>
								<dd class="ad-badges">
									{#each agent.tags as t}
										<span class="ad-badge">{t}</span>
									{/each}
								</dd>
							</div>
						{/if}
					</dl>
					<a href={installHref} class="btn btn-primary ad-side-cta">
						{it ? 'Usa questo agente' : 'Use this agent'}
					</a>
				</div>
			</aside>
		</div>
	</section>

	{#if data.related.length > 0}
		<section class="ad-related">
			<div class="wrap">
				<h2 class="ad-related-title reveal">{it ? 'Agenti simili' : 'More like this'}</h2>
				<div class="ad-related-grid">
					{#each data.related as r, i (r.slug)}
						<a class="ad-rel-card reveal" data-d={(i % 3) + 1} href={lp(`/agents/${r.slug}`)}>
							<AgentAvatar face={r.avatar_face} color={r.avatar_color} size={38} />
							<div>
								<h3>{r.name}</h3>
								<p>{r.tagline}</p>
							</div>
						</a>
					{/each}
				</div>
			</div>
		</section>
	{/if}
</main>

<SiteFooter />
<MarcoWidget />

<style>
	.ad-hero {
		padding: 104px 0 56px;
		background: var(--paper-2);
	}
	.ad-back {
		display: inline-block;
		font-size: 0.86rem;
		color: var(--ink-soft);
		text-decoration: none;
		margin-bottom: 28px;
	}
	.ad-back:hover {
		color: var(--accent);
	}
	.ad-head {
		display: flex;
		align-items: center;
		gap: 24px;
		flex-wrap: wrap;
	}
	.ad-cat {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.ad-h1 {
		font-size: clamp(2rem, 4.6vw, 3.2rem);
		font-weight: var(--heading-weight);
		line-height: 1.08;
		letter-spacing: var(--heading-tracking);
		margin: 6px 0 0;
	}
	.ad-tagline {
		color: var(--ink-soft);
		font-size: 1.1rem;
		line-height: 1.5;
		margin: 12px 0 0;
		max-width: 52ch;
	}
	.ad-actions {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		margin-top: 32px;
	}

	.ad-body {
		padding: 64px 0 88px;
	}
	.ad-cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 20rem;
		gap: 48px;
		align-items: start;
	}
	.ad-lead {
		font-size: 1.08rem;
		line-height: 1.65;
		color: var(--ink-soft);
		margin: 0 0 40px;
	}
	.ad-block {
		margin-bottom: 40px;
	}
	.ad-block h2 {
		font-size: 1.25rem;
		font-weight: var(--heading-weight);
		letter-spacing: var(--heading-tracking);
		margin: 0 0 14px;
	}
	.ad-note {
		margin: -6px 0 14px;
		font-size: 0.88rem;
		color: var(--ink-faint);
	}
	.ad-list {
		margin: 0;
		padding-left: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 10px;
		color: var(--ink-soft);
		line-height: 1.55;
	}
	.ad-prompt {
		margin: 0;
		padding: 20px;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--paper-2);
		font-family: var(--mono, ui-monospace, monospace);
		font-size: 0.86rem;
		line-height: 1.65;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--ink);
	}

	.ad-side {
		position: sticky;
		top: 96px;
	}
	.ad-spec {
		border: 1px solid var(--line);
		border-radius: 18px;
		padding: 22px;
		background: var(--paper);
	}
	.ad-spec h3 {
		margin: 0 0 16px;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}
	.ad-spec dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.ad-spec dt {
		font-size: 0.76rem;
		color: var(--ink-faint);
		margin-bottom: 3px;
	}
	.ad-spec dd {
		margin: 0;
		font-size: 0.92rem;
		color: var(--ink);
	}
	.ad-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.ad-badge {
		font-size: 0.72rem;
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid var(--line);
		color: var(--ink-soft);
	}
	.ad-side-cta {
		display: block;
		text-align: center;
		margin-top: 20px;
	}

	.ad-related {
		padding: 72px 0 96px;
		background: var(--paper-2);
	}
	.ad-related-title {
		font-size: 1.4rem;
		font-weight: var(--heading-weight);
		letter-spacing: var(--heading-tracking);
		margin: 0 0 24px;
	}
	.ad-related-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
	}
	.ad-rel-card {
		display: flex;
		gap: 14px;
		align-items: flex-start;
		padding: 18px;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: var(--paper);
		text-decoration: none;
		color: inherit;
		transition:
			transform 0.25s var(--ease),
			border-color 0.25s var(--ease);
	}
	.ad-rel-card:hover {
		transform: translateY(-3px);
		border-color: var(--ink);
	}
	.ad-rel-card h3 {
		margin: 0 0 4px;
		font-size: 1rem;
		font-weight: var(--heading-weight);
	}
	.ad-rel-card p {
		margin: 0;
		font-size: 0.86rem;
		color: var(--ink-soft);
		line-height: 1.45;
	}

	@media (max-width: 960px) {
		.ad-cols {
			grid-template-columns: 1fr;
			gap: 32px;
		}
		.ad-side {
			position: static;
		}
		.ad-related-grid {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 720px) {
		.ad-hero {
			padding: 84px 0 44px;
		}
		.ad-body {
			padding: 44px 0 64px;
		}
	}
</style>
