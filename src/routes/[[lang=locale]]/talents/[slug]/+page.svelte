<script lang="ts">
	import { onMount } from 'svelte';
	import { _, locale } from 'svelte-i18n';
	import { localePath, type Locale } from '$lib/i18n/locale';
	import SiteNav from '$lib/components/SiteNav.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import MarcoWidget from '$lib/components/MarcoWidget.svelte';
	import { BOOKING_URL } from '$lib/links';
	import { marketingStartHref } from '$lib/start-href';
	import {
		talentBodyLabel,
		talentGenderLabel,
		talentHeightLabel
	} from '$lib/talent-labels';
	import type { PageData } from './$types';
	import '$lib/styles/landing.css';

	let { data }: { data: PageData } = $props();

	const talent = $derived(data.talent);
	const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
	const lang = $derived((($locale as Locale) ?? 'en') as Locale);
	const waitlistActive = $derived(data.waitlistActive);
	const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
	const loggedIn = $derived(Boolean(data.session));
	const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));

	const face = $derived(
		talent.views.find((v) => v.view_key === 'face-front') ?? talent.views[0] ?? null
	);
	const bodyFront = $derived(talent.views.find((v) => v.view_key === 'body-front') ?? null);
	const otherViews = $derived(
		talent.views.filter((v) => v.view_key !== 'face-front' && v.view_key !== 'body-front')
	);

	let activeView = $state<string | null>(null);
	const heroView = $derived(
		talent.views.find((v) => v.view_key === activeView) ?? face ?? talent.views[0] ?? null
	);

	const traitEntries = $derived.by(() => {
		const t = talent.traits ?? {};
		const rows: { label: string; value: string }[] = [];
		const push = (label: string, value: unknown) => {
			if (value == null || value === '') return;
			if (typeof value === 'string') rows.push({ label, value });
			else if (typeof value === 'object') {
				const parts = Object.entries(value as Record<string, unknown>)
					.filter(([, v]) => typeof v === 'string' && v)
					.map(([k, v]) => `${k}: ${v}`);
				if (parts.length) rows.push({ label, value: parts.join(' · ') });
			}
		};
		push(lang === 'it' ? 'Capelli' : 'Hair', t.hair);
		push(lang === 'it' ? 'Occhi' : 'Eyes', t.eyes);
		push(lang === 'it' ? 'Viso' : 'Face', t.face);
		push(lang === 'it' ? 'Pelle' : 'Skin', t.skin);
		push(lang === 'it' ? 'Corpo' : 'Body', t.body);
		push(lang === 'it' ? 'Segni' : 'Marks', t.marks);
		push(lang === 'it' ? 'Wardrobe' : 'Wardrobe', t.wardrobe);
		return rows;
	});

	const pageTitle = $derived(`${talent.name} — AI Talents — Anomalia`);
	const pageDesc = $derived(
		talent.summary ??
			(lang === 'it'
				? `Profilo AI talent di ${talent.name}: foto di riferimento e tratti per generazione foto/video.`
				: `AI talent profile for ${talent.name}: reference photos and traits for photo/video generation.`)
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
	<meta name="robots" content="index, follow, max-image-preview:large" />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDesc} />
	<meta property="og:type" content="profile" />
	{#if face?.url}
		<meta property="og:image" content={face.url} />
	{/if}
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">
	<nav class="tl-breadcrumb">
		<div class="wrap">
			<a href={lp('/talents')}>AI Talents</a>
			<span>›</span>
			<span>{talent.name}</span>
		</div>
	</nav>

	<section class="tl-hero">
		<div class="wrap tl-hero-grid">
			<div class="tl-hero-media reveal">
				{#if heroView?.url}
					<img src={heroView.url} alt={`${talent.name} — ${heroView.label}`} />
				{:else}
					<div class="tl-hero-ph">{talent.name.slice(0, 1)}</div>
				{/if}
				{#if talent.views.length > 1}
					<div class="tl-thumbs">
						{#each talent.views as view}
							<button
								type="button"
								class="tl-thumb"
								class:active={!activeView ? view.view_key === face?.view_key : activeView === view.view_key}
								onclick={() => (activeView = view.view_key)}
								aria-label={view.label}
							>
								{#if view.url}
									<img src={view.url} alt="" loading="lazy" />
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<div class="tl-hero-copy">
				<div class="tl-hero-cat reveal">
					{#if talent.gender}{talentGenderLabel(talent.gender, lang)}{/if}
					{#if talent.body_type}
						{#if talent.gender} · {/if}{talentBodyLabel(talent.body_type)}
					{/if}
				</div>
				<h1 class="tl-h1 reveal" data-d="1">{talent.name}</h1>
				{#if talent.summary}
					<p class="tl-desc reveal" data-d="2">{talent.summary}</p>
				{/if}

				<div class="tl-stats reveal" data-d="3">
					{#if talent.age}
						<div class="tl-stat">
							<span class="tl-stat-num">{talent.age}</span>
							<span class="tl-stat-lbl">{lang === 'it' ? 'Età' : 'Age'}</span>
						</div>
					{/if}
					{#if talent.height_band}
						<div class="tl-stat">
							<span class="tl-stat-num">{talentHeightLabel(talent.height_band, lang)}</span>
							<span class="tl-stat-lbl">{lang === 'it' ? 'Altezza' : 'Height'}</span>
						</div>
					{/if}
					{#if talent.ethnicity}
						<div class="tl-stat">
							<span class="tl-stat-num cap">{talent.ethnicity}</span>
							<span class="tl-stat-lbl">{lang === 'it' ? 'Etnia' : 'Ethnicity'}</span>
						</div>
					{/if}
					<div class="tl-stat">
						<span class="tl-stat-num">{talent.views.length}</span>
						<span class="tl-stat-lbl">{lang === 'it' ? 'Viste' : 'Views'}</span>
					</div>
				</div>
			</div>
		</div>
	</section>

	{#if traitEntries.length}
		<section class="tl-traits">
			<div class="wrap">
				<div class="sec-head reveal">
					<div class="kicker">{lang === 'it' ? 'Identità' : 'Identity'}</div>
					<h2>{lang === 'it' ? 'Tratti bloccati' : 'Locked traits'}</h2>
				</div>
				<div class="tl-traits-grid">
					{#each traitEntries as row, i}
						<div class="tl-trait reveal" data-d={(i % 3) + 1}>
							<strong>{row.label}</strong>
							<p>{row.value}</p>
						</div>
					{/each}
				</div>
			</div>
		</section>
	{/if}

	<section class="tl-gallery">
		<div class="wrap">
			<div class="sec-head reveal">
				<div class="kicker">{lang === 'it' ? 'Reference pack' : 'Reference pack'}</div>
				<h2>{lang === 'it' ? 'Tutte le viste' : 'All views'}</h2>
			</div>

			<div class="tl-gallery-grid">
				{#if bodyFront?.url}
					<figure class="tl-shot tl-shot-lg reveal">
						<img src={bodyFront.url} alt={`${talent.name} — ${bodyFront.label}`} loading="lazy" />
						<figcaption>{bodyFront.label}</figcaption>
					</figure>
				{/if}
				{#each otherViews as view, i}
					{#if view.url}
						<figure class="tl-shot reveal" data-d={(i % 3) + 1}>
							<img src={view.url} alt={`${talent.name} — ${view.label}`} loading="lazy" />
							<figcaption>{view.label}</figcaption>
						</figure>
					{/if}
				{/each}
			</div>
		</div>
	</section>

	<section class="tl-cta">
		<div class="wrap tl-cta-inner reveal">
			<h2>
				{lang === 'it'
					? 'Usa questo talent nel prossimo shoot.'
					: 'Use this talent in your next shoot.'}
			</h2>
			<p>
				{lang === 'it'
					? 'Identità coerente, wardrobe standard, viste di riferimento — pronto per i tool interni di generazione foto e video.'
					: 'Consistent identity, standard wardrobe, reference views — ready for internal photo and video generation tools.'}
			</p>
			<div class="gr-actions">
				<a href={lp('/talents')} class="btn btn-primary btn-hero">
					{lang === 'it' ? 'Torna alla libreria' : 'Back to library'} <span class="arr">→</span>
				</a>
				<a href={BOOKING_URL} target="_blank" rel="noopener" class="btn btn-ghost gr-ghost">
					{lang === 'it' ? 'Prenota una call' : 'Book a call'}
				</a>
			</div>
		</div>
	</section>
</main>

<SiteFooter />
<MarcoWidget />

<style>
	.tl-breadcrumb {
		padding: 100px 0 0;
	}
	.tl-breadcrumb .wrap {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.85rem;
		color: var(--ink-faint);
	}
	.tl-breadcrumb a {
		color: var(--ink-faint);
		text-decoration: none;
	}
	.tl-breadcrumb a:hover {
		color: var(--accent);
	}

	.tl-hero {
		padding: 32px 0 72px;
	}
	.tl-hero-grid {
		display: grid;
		grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
		gap: 48px;
		align-items: start;
	}
	.tl-hero-media {
		position: sticky;
		top: 80px;
	}
	.tl-hero-media > img,
	.tl-hero-ph {
		width: 100%;
		aspect-ratio: 4 / 5;
		object-fit: cover;
		object-position: center top;
		border-radius: 20px;
		background: var(--paper-2);
		border: 1px solid var(--line);
		display: block;
	}
	.tl-hero-ph {
		display: grid;
		place-items: center;
		font-family: var(--serif);
		font-size: 4rem;
		color: var(--ink-faint);
	}
	.tl-thumbs {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 8px;
		margin-top: 12px;
	}
	.tl-thumb {
		aspect-ratio: 1;
		border-radius: 10px;
		overflow: hidden;
		border: 2px solid transparent;
		padding: 0;
		background: var(--paper-2);
		cursor: pointer;
		opacity: 0.7;
		transition: opacity 0.15s, border-color 0.15s;
	}
	.tl-thumb:hover {
		opacity: 1;
	}
	.tl-thumb.active {
		opacity: 1;
		border-color: var(--accent);
	}
	.tl-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.tl-hero-cat {
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--accent);
		margin-bottom: 12px;
	}
	.tl-h1 {
		font-size: clamp(2.2rem, 5vw, 3.6rem);
		font-weight: var(--heading-weight);
		line-height: 1.08;
		letter-spacing: var(--heading-tracking);
		margin: 0;
		text-wrap: balance;
	}
	.tl-desc {
		font-size: 1.1rem;
		color: var(--ink-soft);
		max-width: 52ch;
		margin: 16px 0 0;
		line-height: 1.55;
	}
	.tl-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 28px;
		margin-top: 32px;
	}
	.tl-stat {
		display: flex;
		flex-direction: column;
	}
	.tl-stat-num {
		font-family: var(--serif);
		font-size: 1.35rem;
		font-weight: var(--heading-weight);
		color: var(--accent);
		text-transform: capitalize;
	}
	.tl-stat-num.cap {
		text-transform: capitalize;
	}
	.tl-stat-lbl {
		font-size: 0.8rem;
		color: var(--ink-faint);
		margin-top: 2px;
	}

	.tl-traits {
		padding: 72px 0;
		background: var(--paper-2);
	}
	.tl-traits-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
		max-width: 960px;
	}
	.tl-trait {
		padding: 22px 20px;
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 16px;
	}
	.tl-trait strong {
		display: block;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
		margin-bottom: 8px;
	}
	.tl-trait p {
		margin: 0;
		font-size: 0.92rem;
		color: var(--ink-soft);
		line-height: 1.5;
		text-transform: capitalize;
	}

	.tl-gallery {
		padding: 96px 0;
	}
	.tl-gallery-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
	}
	.tl-shot {
		margin: 0;
		border-radius: 16px;
		overflow: hidden;
		border: 1px solid var(--line);
		background: var(--paper);
	}
	.tl-shot-lg {
		grid-column: span 2;
		grid-row: span 2;
	}
	.tl-shot img {
		width: 100%;
		aspect-ratio: 4 / 5;
		object-fit: cover;
		object-position: center top;
		display: block;
	}
	.tl-shot-lg img {
		aspect-ratio: auto;
		height: 100%;
		min-height: 100%;
	}
	.tl-shot figcaption {
		padding: 12px 14px;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--ink-soft);
		border-top: 1px solid var(--line);
	}

	.tl-cta {
		padding: 120px 0;
		text-align: center;
		background: var(--paper-2);
	}
	.tl-cta-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.tl-cta h2 {
		font-size: clamp(1.8rem, 4vw, 2.8rem);
		font-weight: var(--heading-weight);
		margin: 0;
		max-width: 24ch;
		text-wrap: balance;
	}
	.tl-cta p {
		color: var(--ink-soft);
		margin: 16px 0 0;
		font-size: 1.1rem;
		max-width: 50ch;
		line-height: 1.55;
	}
	.tl-cta .gr-actions {
		margin-top: 34px;
	}

	@media (max-width: 920px) {
		.tl-hero-grid {
			grid-template-columns: 1fr;
			gap: 28px;
		}
		.tl-hero-media {
			position: static;
			max-width: 420px;
		}
		.tl-traits-grid {
			grid-template-columns: 1fr 1fr;
		}
		.tl-gallery-grid {
			grid-template-columns: 1fr 1fr;
		}
		.tl-shot-lg {
			grid-column: span 2;
			grid-row: auto;
		}
	}
	@media (max-width: 640px) {
		.tl-thumbs {
			grid-template-columns: repeat(4, 1fr);
		}
		.tl-traits-grid,
		.tl-gallery-grid {
			grid-template-columns: 1fr;
		}
		.tl-shot-lg {
			grid-column: auto;
		}
		.tl-cta {
			padding: 84px 0;
		}
	}
</style>
