<script lang="ts">
	import { onMount } from 'svelte';
	import { _, locale } from 'svelte-i18n';
	import { localePath, type Locale } from '$lib/i18n/locale';
	import SiteNav from '$lib/components/SiteNav.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import MarcoWidget from '$lib/components/MarcoWidget.svelte';
	import { BOOKING_URL } from '$lib/links';
	import { TALENT_GENDER_ORDER, talentGenderLabel } from '$lib/talent-labels';
	import { marketingStartHref } from '$lib/start-href';
	import type { PageData } from './$types';
	import '$lib/styles/landing.css';

	let { data }: { data: PageData } = $props();

	const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
	const lang = $derived((($locale as Locale) ?? 'en') as Locale);
	const waitlistActive = $derived(data.waitlistActive);
	const cta = $derived(waitlistActive ? $_('landing.cta.waitlist') : $_('landing.cta.getStarted'));
	const loggedIn = $derived(Boolean(data.session));
	const startHref = $derived(marketingStartHref({ loggedIn, waitlistActive }));

	type GenderFilter = 'all' | string;
	let activeGender = $state<GenderFilter>('all');

	const genders = $derived(
		TALENT_GENDER_ORDER.filter((g) =>
			[...data.talents, ...data.lockedTalents].some((t) => t.gender === g)
		)
	);

	const gated = $derived(Boolean(data.gated));
	const registerHref = '/start';

	const filtered = $derived(
		activeGender === 'all'
			? data.talents
			: data.talents.filter((t) => t.gender === activeGender)
	);

	const lockedFiltered = $derived(
		!gated
			? []
			: activeGender === 'all'
				? data.lockedTalents
				: data.lockedTalents.filter((t) => t.gender === activeGender)
	);

	function faceUrl(talent: (typeof data.talents)[number] | (typeof data.lockedTalents)[number]) {
		return talent.views.find((v) => v.view_key === 'face-front')?.url ?? talent.views[0]?.url ?? null;
	}

	const pageTitle = 'AI Talents — Anomalia';
	const pageDesc = $derived(
		lang === 'it'
			? 'Libreria di talent AI per generare foto e video di prodotto. Identità coerenti, viste di riferimento, pronti per i tool interni.'
			: 'AI talent library for product photo and video generation. Consistent identities, reference views, ready for internal tools.'
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
	<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDesc} />
	<meta property="og:type" content="website" />
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">
	<section class="tl-hero">
		<div class="wrap tl-hero-inner">
			<span class="eyebrow reveal">{lang === 'it' ? 'Libreria creativa' : 'Creative library'}</span>
			<h1 class="tl-h1 reveal" data-d="1">AI Talents</h1>
			<p class="tl-sub reveal" data-d="2">
				{lang === 'it'
					? 'Persone AI coerenti da usare nei tool di generazione foto e video. Scegli un talent, abbinalo al prodotto, mantieni identità e stile.'
					: 'Consistent AI people for product photo and video tools. Pick a talent, pair it with a product, keep identity and style locked.'}
			</p>
		</div>
	</section>

	<section class="tl-directory">
		<div class="wrap">
			{#if genders.length > 0}
				<div class="tl-filters reveal" role="group" aria-label={lang === 'it' ? 'Filtra per genere' : 'Filter by gender'}>
					<button
						type="button"
						class="tl-filter"
						class:active={activeGender === 'all'}
						onclick={() => (activeGender = 'all')}
					>
						{lang === 'it' ? 'Tutti' : 'All'}
					</button>
					{#each genders as g}
						<button
							type="button"
							class="tl-filter"
							class:active={activeGender === g}
							onclick={() => (activeGender = g)}
						>
							{talentGenderLabel(g, lang)}
						</button>
					{/each}
				</div>
			{/if}

			{#if filtered.length === 0 && lockedFiltered.length === 0}
				<p class="tl-empty reveal">
					{lang === 'it' ? 'Nessun talent in questa categoria.' : 'No talents in this category.'}
				</p>
			{:else}
				{#if filtered.length > 0}
					<div class="tl-grid">
						{#each filtered as talent, i}
							{@const thumb = faceUrl(talent)}
							<a
								class="tl-card reveal"
								data-d={(i % 3) + 1}
								href={lp(`/talents/${talent.slug}`)}
							>
								<div class="tl-thumb">
									{#if thumb}
										<img src={thumb} alt={talent.name} loading="lazy" />
									{:else}
										<div class="tl-thumb-ph">{talent.name.slice(0, 1)}</div>
									{/if}
								</div>
								<h2 class="tl-card-title">{talent.name}</h2>
							</a>
						{/each}
					</div>
				{/if}

				{#if gated && lockedFiltered.length > 0}
					<div class="tl-gate reveal">
						<div class="tl-gate-grid" aria-hidden="true">
							{#each lockedFiltered as talent}
								{@const thumb = faceUrl(talent)}
								<div class="tl-card tl-card-locked">
									<div class="tl-thumb">
										{#if thumb}
											<img src={thumb} alt="" loading="lazy" />
										{:else}
											<div class="tl-thumb-ph">{talent.name.slice(0, 1)}</div>
										{/if}
									</div>
									<h2 class="tl-card-title">{talent.name}</h2>
								</div>
							{/each}
						</div>
						<div class="tl-gate-veil">
							<div class="tl-gate-copy">
								<p class="tl-gate-eyebrow">
									{lang === 'it' ? 'Solo per utenti registrati' : 'Members only'}
								</p>
								<h2>
									{lang === 'it'
										? 'I talent AI sono solo per utenti registrati'
										: 'AI Talents are only for registered users'}
								</h2>
								<p>
									{lang === 'it'
										? `Stai vedendo ${data.previewLimit} di ${data.totalCount}. Registrati gratis per sbloccare l’intera libreria.`
										: `You're seeing ${data.previewLimit} of ${data.totalCount}. Register free to unlock the full library.`}
								</p>
								<a class="btn btn-primary btn-hero" href={registerHref}>
									{lang === 'it' ? 'Registrati gratis' : 'Register free'}
									<span class="arr">→</span>
								</a>
							</div>
						</div>
					</div>
				{/if}
			{/if}
		</div>
	</section>

	<section class="tl-final">
		<div class="wrap tl-final-inner reveal">
			<h2>{lang === 'it' ? 'Scegli un talent. Genera lo shoot.' : 'Pick a talent. Generate the shoot.'}</h2>
			<p>
				{lang === 'it'
					? 'Questa libreria alimenterà i tool interni di foto e video prodotto. Identità bloccata, wardrobe coerente, viste di riferimento.'
					: 'This library will power internal product photo and video tools. Locked identity, consistent wardrobe, reference views.'}
			</p>
			<div class="gr-actions tl-final-actions">
				<a href={startHref} class="btn btn-primary btn-hero">
					{$_('landing.cta.getStarted')} <span class="arr">→</span>
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
	.tl-hero {
		padding: 120px 0 64px;
		text-align: center;
		background: var(--paper-2);
	}
	.tl-h1 {
		font-size: clamp(2.2rem, 5vw, 3.8rem);
		font-weight: var(--heading-weight);
		line-height: 1.08;
		letter-spacing: var(--heading-tracking);
		margin: 0 auto;
		max-width: 18ch;
		text-wrap: balance;
	}
	.tl-sub {
		color: var(--ink-soft);
		font-size: 1.15rem;
		max-width: 55ch;
		margin: 20px auto 0;
		line-height: 1.55;
	}

	.tl-directory {
		padding: 48px 0 96px;
	}
	.tl-filters {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: center;
		margin-bottom: 36px;
	}
	.tl-filter {
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
	.tl-filter:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.tl-filter.active {
		background: var(--invert-surface);
		color: #fff;
		border-color: var(--ink);
	}

	.tl-empty {
		text-align: center;
		color: var(--ink-soft);
		padding: 2rem 0;
	}

	.tl-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 20px;
	}

	.tl-card {
		display: flex;
		flex-direction: column;
		gap: 12px;
		background: transparent;
		border: none;
		border-radius: 0;
		overflow: visible;
		text-decoration: none;
		color: inherit;
		transition: transform 0.25s var(--ease);
	}
	.tl-card:hover {
		transform: translateY(-3px);
	}

	.tl-thumb {
		aspect-ratio: 4 / 5;
		background: var(--paper-2);
		overflow: hidden;
		border-radius: 16px;
		border: 1px solid var(--line);
	}
	.tl-thumb img {
		width: 100%;
		height: 100%;
		/* face-front assets vary (tight headshot ↔ waist-up). Zoom + top bias
		   so every card reads as a consistent head-and-shoulders crop. */
		object-fit: cover;
		object-position: center 12%;
		transform: scale(1.28);
		transform-origin: center top;
		display: block;
	}
	.tl-thumb-ph {
		width: 100%;
		height: 100%;
		display: grid;
		place-items: center;
		font-family: var(--serif);
		font-size: 3rem;
		color: var(--ink-faint);
	}

	.tl-card-title {
		font-family: var(--serif);
		font-size: 1.25rem;
		font-weight: var(--heading-weight);
		margin: 0;
		line-height: 1.2;
		letter-spacing: var(--heading-tracking);
		text-align: center;
	}

	.tl-gate {
		position: relative;
		margin-top: 20px;
		border-radius: 24px;
		overflow: hidden;
		isolation: isolate;
	}
	.tl-gate-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 20px;
		filter: blur(10px);
		transform: scale(1.02);
		pointer-events: none;
		user-select: none;
		max-height: 560px;
		overflow: hidden;
	}
	.tl-card-locked {
		cursor: default;
	}
	.tl-card-locked:hover {
		transform: none;
	}
	.tl-gate-veil {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 32px 20px;
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--paper) 15%, transparent) 0%,
				color-mix(in srgb, var(--paper) 72%, transparent) 38%,
				color-mix(in srgb, var(--paper) 92%, transparent) 100%
			);
		backdrop-filter: blur(2px);
		-webkit-backdrop-filter: blur(2px);
		z-index: 2;
	}
	.tl-gate-copy {
		max-width: 34rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
	}
	.tl-gate-eyebrow {
		margin: 0;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.tl-gate-copy h2 {
		margin: 0;
		font-size: clamp(1.5rem, 3.2vw, 2.1rem);
		font-weight: var(--heading-weight);
		letter-spacing: var(--heading-tracking);
		text-wrap: balance;
		line-height: 1.15;
	}
	.tl-gate-copy p {
		margin: 0;
		color: var(--ink-soft);
		font-size: 1.02rem;
		line-height: 1.55;
		max-width: 42ch;
	}
	.tl-gate-copy .btn {
		margin-top: 10px;
	}

	.tl-final {
		padding: 120px 0;
		text-align: center;
		background: var(--paper-2);
	}
	.tl-final-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.tl-final h2 {
		font-size: clamp(2rem, 4.5vw, 3.2rem);
		font-weight: var(--heading-weight);
		letter-spacing: var(--heading-tracking);
		margin: 0;
		max-width: 26ch;
		text-wrap: balance;
	}
	.tl-final p {
		color: var(--ink-soft);
		margin: 18px 0 0;
		font-size: 1.15rem;
		max-width: 50ch;
		line-height: 1.55;
	}
	.tl-final-actions {
		margin-top: 34px;
	}

	@media (max-width: 960px) {
		.tl-grid,
		.tl-gate-grid {
			grid-template-columns: repeat(2, 1fr);
		}
		.tl-gate-grid {
			max-height: 520px;
		}
	}
	@media (max-width: 720px) {
		.tl-hero {
			padding: 84px 0 48px;
		}
		.tl-directory {
			padding: 36px 0 64px;
		}
		.tl-grid,
		.tl-gate-grid {
			grid-template-columns: 1fr;
			max-width: 360px;
			margin: 0 auto;
		}
		.tl-gate-grid {
			max-height: 480px;
		}
		.tl-final {
			padding: 84px 0;
		}
	}
</style>
