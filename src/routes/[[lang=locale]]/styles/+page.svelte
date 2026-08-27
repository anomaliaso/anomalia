<script lang="ts">
	import { onMount } from 'svelte';
	import { _, locale } from 'svelte-i18n';
	import { localePath, type Locale } from '$lib/i18n/locale';
	import SiteNav from '$lib/components/SiteNav.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import MarcoWidget from '$lib/components/MarcoWidget.svelte';
	import StyleGridThumb from '$lib/components/StyleGridThumb.svelte';
	import { BOOKING_URL } from '$lib/links';
	import { STYLE_PRESETS, PRESET_SLIDES } from '$lib/design/presets';
	import { styleAssetUrl } from '$lib/design/presets/urls';
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

	const pageTitle = 'Style Library — Anomalia';
	const pageDesc = $derived(
		lang === 'it'
			? 'Libreria di stili: caroselli 3:4 e story 9:16. Scegli una forma, il tuo brand ci entra dentro.'
			: 'Style library: 3:4 carousels and 9:16 stories. Pick a form, your brand drops into it.'
	);

	/** Per-preset index into PRESET_SLIDES — browse the whole carousel from the grid. */
	let slideAt = $state<Record<string, number>>({});

	function slideIndex(slug: string) {
		return slideAt[slug] ?? 0;
	}

	function slideKind(slug: string) {
		return PRESET_SLIDES[slideIndex(slug)]!;
	}

	function step(slug: string, dir: -1 | 1, e?: Event) {
		e?.preventDefault();
		e?.stopPropagation();
		const next = (slideIndex(slug) + dir + PRESET_SLIDES.length) % PRESET_SLIDES.length;
		slideAt = { ...slideAt, [slug]: next };
		const warm = (i: number) => {
			const kind = PRESET_SLIDES[(i + PRESET_SLIDES.length) % PRESET_SLIDES.length];
			if (!kind) return;
			const img = new Image();
			img.src = styleAssetUrl(slug, kind, 540);
		};
		warm(next + 1);
		warm(next - 1);
	}

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
	<link rel="preload" as="image" href={styleAssetUrl(STYLE_PRESETS[0]!.slug, 'cover', 540)} fetchpriority="high" />
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">
	<section class="sl-hero">
		<div class="wrap sl-hero-inner">
			<span class="eyebrow reveal">{lang === 'it' ? 'Libreria creativa' : 'Creative library'}</span>
			<h1 class="sl-h1 reveal" data-d="1">{lang === 'it' ? 'Stili' : 'Styles'}</h1>
			<p class="sl-sub reveal" data-d="2">
				{lang === 'it'
					? 'Ogni stile è un sistema completo: otto slide 3:4 e tre layout story 9:16. I testi qui sono finti apposta — quello che scegli è la forma.'
					: 'Each style is a complete system: eight 3:4 slides and three 9:16 story layouts. The words here are placeholder on purpose — what you pick is the form.'}
			</p>
		</div>
	</section>

	<section class="sl-directory">
		<div class="wrap">
			<div class="sl-grid">
				{#each STYLE_PRESETS as preset, i}
					{@const idx = slideIndex(preset.slug)}
					{@const kind = slideKind(preset.slug)}
					<article class="sl-card reveal" data-d={(i % 3) + 1}>
						<StyleGridThumb
							{preset}
							{kind}
							{idx}
							href={lp(`/styles/${preset.slug}`)}
							lang={lang === 'it' ? 'it' : 'en'}
							priority={i < 3}
							onStep={(dir, e) => step(preset.slug, dir, e)}
						/>
						<a class="sl-meta" href={lp(`/styles/${preset.slug}`)}>
							<h2 class="sl-card-title">{preset.name}</h2>
							<p class="sl-card-desc">{preset.thesis[lang === 'it' ? 'it' : 'en']}</p>
							<span class="sl-card-more">
								{lang === 'it' ? 'Apri lo stile' : 'Open style'}
								<span class="arr">→</span>
							</span>
						</a>
					</article>
				{/each}
			</div>
		</div>
	</section>

	<section class="sl-final">
		<div class="wrap sl-final-inner reveal">
			<h2>
				{lang === 'it' ? 'Scegli la forma. Il resto lo scrive lui.' : 'Pick the form. It writes the rest.'}
			</h2>
			<p>
				{lang === 'it'
					? 'Il colore, i font e il logo arrivano dal tuo sito. Lo stile decide dove sta il titolo, quanto è grande e come si comporta sopra una fotografia — le tre cose che rendono un feed riconoscibile.'
					: 'Colour, fonts and logo come from your site. The style decides where the headline sits, how big it gets and how it behaves over a photograph — the three things that make a feed recognisable.'}
			</p>
			<div class="gr-actions sl-final-actions">
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
	.sl-hero {
		padding: 120px 0 64px;
		text-align: center;
		background: var(--paper-2);
	}
	.sl-h1 {
		font-size: clamp(2.2rem, 5vw, 3.8rem);
		font-weight: var(--heading-weight);
		line-height: 1.08;
		letter-spacing: var(--heading-tracking);
		margin: 0 auto;
		max-width: 18ch;
		text-wrap: balance;
	}
	.sl-sub {
		color: var(--ink-soft);
		font-size: 1.15rem;
		max-width: 58ch;
		margin: 20px auto 0;
		line-height: 1.55;
	}

	.sl-directory {
		padding: 48px 0 96px;
	}
	.sl-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 28px;
	}

	.sl-card {
		display: flex;
		flex-direction: column;
		gap: 10px;
		color: inherit;
		transition: transform 0.25s var(--ease);
	}
	.sl-card:hover {
		transform: translateY(-3px);
	}

	.sl-meta {
		display: flex;
		flex-direction: column;
		gap: 10px;
		text-decoration: none;
		color: inherit;
	}
	.sl-card-title {
		font-family: var(--serif);
		font-size: 1.35rem;
		font-weight: var(--heading-weight);
		letter-spacing: var(--heading-tracking);
		line-height: 1.2;
		margin: 0;
	}
	.sl-card-desc {
		margin: 0;
		color: var(--ink-soft);
		font-size: 0.96rem;
		line-height: 1.5;
	}
	.sl-card-more {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--accent);
		margin-top: 2px;
	}
	.sl-meta:hover .sl-card-more .arr {
		transform: translateX(3px);
		display: inline-block;
	}

	.sl-final {
		padding: 120px 0;
		text-align: center;
		background: var(--paper-2);
	}
	.sl-final-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.sl-final h2 {
		font-size: clamp(2rem, 4.5vw, 3.2rem);
		font-weight: var(--heading-weight);
		letter-spacing: var(--heading-tracking);
		margin: 0;
		max-width: 26ch;
		text-wrap: balance;
	}
	.sl-final p {
		color: var(--ink-soft);
		margin: 18px 0 0;
		font-size: 1.15rem;
		max-width: 54ch;
		line-height: 1.55;
	}
	.sl-final-actions {
		margin-top: 34px;
	}

	@media (max-width: 960px) {
		.sl-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (max-width: 720px) {
		.sl-hero {
			padding: 84px 0 48px;
		}
		.sl-directory {
			padding: 36px 0 64px;
		}
		.sl-grid {
			grid-template-columns: 1fr;
			max-width: 360px;
			margin: 0 auto;
		}
		.sl-final {
			padding: 84px 0;
		}
	}
</style>
