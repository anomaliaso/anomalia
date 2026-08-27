<script lang="ts">
	import { onMount } from 'svelte';
	import { _, locale } from 'svelte-i18n';
	import { localePath, type Locale } from '$lib/i18n/locale';
	import SiteNav from '$lib/components/SiteNav.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import MarcoWidget from '$lib/components/MarcoWidget.svelte';
	import { BOOKING_URL } from '$lib/links';
	import {
		PRESET_SLIDES,
		STORY_VARIANTS,
		STYLE_PRESETS,
		findPreset,
		type PresetSlide,
		type StoryVariant
	} from '$lib/design/presets';
	import { styleAssetSrcSet, styleAssetUrl } from '$lib/design/presets/urls';
	import { marketingStartHref } from '$lib/start-href';
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

	const preset = $derived(findPreset(data.slug)!);
	const others = $derived(STYLE_PRESETS.filter((p) => p.slug !== data.slug));

	const SLIDE_LABELS: Record<PresetSlide, { it: string; en: string }> = {
		cover: { it: 'Copertina', en: 'Cover' },
		fotopiena: { it: 'Foto piena', en: 'Full photo' },
		citazione: { it: 'Citazione', en: 'Quote' },
		lista: { it: 'Lista', en: 'List' },
		confronto: { it: 'Confronto', en: 'Comparison' },
		fotoparziale: { it: 'Foto parziale', en: 'Partial photo' },
		numero: { it: 'Numero', en: 'Number' },
		cta: { it: 'Chiusura', en: 'Closing slide' }
	};

	const STORY_LABELS: Record<StoryVariant, { it: string; en: string }> = {
		a: { it: 'Claim', en: 'Claim' },
		b: { it: 'Foto + type', en: 'Photo + type' },
		c: { it: 'Invert', en: 'Invert' }
	};

	const pageTitle = $derived(`${preset.name} — ${it ? 'Stili' : 'Styles'} — Anomalia`);
	const pageDesc = $derived(preset.thesis[it ? 'it' : 'en']);
	const coverThumb = $derived(styleAssetUrl(preset.slug, 'cover', 720));

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
	<meta property="og:type" content="article" />
	<meta property="og:image" content={`/styles/${preset.slug}/cover.png`} />
	<link rel="preload" as="image" href={coverThumb} fetchpriority="high" />
</svelte:head>

<SiteNav {cta} ctaHref={startHref} />

<main id="top">
	<section class="sd-hero">
		<div class="wrap sd-hero-inner">
			<a class="sd-back" href={lp('/styles')}>← {it ? 'Tutti gli stili' : 'All styles'}</a>
			<h1 class="sd-h1 reveal">{preset.name}</h1>
			<p class="sd-thesis reveal" data-d="1">{preset.thesis[it ? 'it' : 'en']}</p>
			<p class="sd-suits reveal" data-d="2">
				<span>{it ? 'Sta bene a' : 'Suits'}</span>
				{preset.suits[it ? 'it' : 'en']}
			</p>

			<dl class="sd-spec reveal" data-d="3">
				{#each preset.spec as item}
					<div>
						<dt>{item.label[it ? 'it' : 'en']}</dt>
						<dd>{item.value[it ? 'it' : 'en']}</dd>
					</div>
				{/each}
			</dl>
		</div>
	</section>

	<section class="sd-slides">
		<div class="wrap">
			<div class="sd-grid">
				{#each PRESET_SLIDES as kind, i}
					<figure class="sd-slide reveal" data-d={(i % 3) + 1}>
						<img
							src={styleAssetUrl(preset.slug, kind, i < 3 ? 720 : 540)}
							srcset={styleAssetSrcSet(preset.slug, kind)}
							sizes="(max-width: 720px) 360px, (max-width: 960px) 45vw, 30vw"
							alt={`${preset.name} — ${SLIDE_LABELS[kind][it ? 'it' : 'en']}`}
							width="720"
							height="960"
							loading={i < 3 ? 'eager' : 'lazy'}
							decoding="async"
							fetchpriority={i === 0 ? 'high' : 'auto'}
						/>
						<figcaption>
							<span class="sd-num">{String(i + 1).padStart(2, '0')}</span>
							{SLIDE_LABELS[kind][it ? 'it' : 'en']}
						</figcaption>
					</figure>
				{/each}
			</div>

			<p class="sd-note reveal">
				{it
					? 'Le fotografie sono segnaposto, uguali in tutti gli stili: così l’unica differenza che vedi è come ogni stile tratta un’immagine che non ha scelto.'
					: 'The photographs are placeholders, identical across every style: so the only difference you see is how each style handles an image it did not choose.'}
			</p>
		</div>
	</section>

	<section class="sd-stories">
		<div class="wrap">
			<h2 class="sd-section-title reveal">{it ? 'Stories 9:16' : '9:16 stories'}</h2>
			<p class="sd-section-sub reveal">
				{it
					? 'Tre layout verticali, stessa voce tipografica. Non sono crop del carosello: tre composizioni diverse.'
					: 'Three vertical layouts, same typographic voice. Not crops of the carousel — three different compositions.'}
			</p>
			<div class="sd-stories-grid">
				{#each STORY_VARIANTS as variant, i}
					<figure class="sd-story reveal" data-d={(i % 3) + 1}>
						<img
							src={styleAssetUrl(preset.slug, `story-${variant}`, 540)}
							srcset={styleAssetSrcSet(preset.slug, `story-${variant}`)}
							sizes="(max-width: 720px) 360px, (max-width: 960px) 30vw, 22vw"
							alt={`${preset.name} — story ${variant.toUpperCase()}`}
							width="540"
							height="960"
							loading="lazy"
							decoding="async"
						/>
						<figcaption>
							<span class="sd-num">{variant.toUpperCase()}</span>
							{STORY_LABELS[variant][it ? 'it' : 'en']}
						</figcaption>
					</figure>
				{/each}
			</div>
		</div>
	</section>

	<section class="sd-others">
		<div class="wrap">
			<h2 class="sd-others-title reveal">{it ? 'Gli altri stili' : 'The other styles'}</h2>
			<div class="sd-others-grid">
				{#each others as other, i}
					<a class="sd-other reveal" data-d={i + 1} href={lp(`/styles/${other.slug}`)}>
						<div class="sd-other-thumb">
							<img
								src={styleAssetUrl(other.slug, 'cover', 360)}
								srcset={styleAssetSrcSet(other.slug, 'cover', [360, 540])}
								sizes="(max-width: 720px) 360px, 280px"
								alt={other.name}
								width="360"
								height="480"
								loading="lazy"
								decoding="async"
							/>
						</div>
						<h3>{other.name}</h3>
						<p>{other.thesis[it ? 'it' : 'en']}</p>
					</a>
				{/each}
			</div>
		</div>
	</section>

	<section class="sd-final">
		<div class="wrap sd-final-inner reveal">
			<h2>{it ? `Vuoi questo stile sul tuo brand?` : `Want this style on your brand?`}</h2>
			<p>
				{it
					? 'Colore, font e logo li legge dal tuo sito. Tu scegli la forma, lui produce il resto ogni settimana.'
					: 'It reads colour, fonts and logo from your site. You pick the form, it produces the rest every week.'}
			</p>
			<div class="gr-actions sd-final-actions">
				<a href={startHref} class="btn btn-primary btn-hero">
					{$_('landing.cta.getStarted')} <span class="arr">→</span>
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

	.sd-hero {
		padding: 104px 0 56px;
		background: var(--paper-2);
	}
	.sd-hero-inner {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
	}
	.sd-back {
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--ink-soft);
		text-decoration: none;
		margin-bottom: 20px;
	}
	.sd-back:hover {
		color: var(--accent);
	}
	.sd-h1 {
		font-size: clamp(2.2rem, 5vw, 3.6rem);
		font-weight: var(--heading-weight);
		line-height: 1.06;
		letter-spacing: var(--heading-tracking);
		margin: 0;
	}
	.sd-thesis {
		color: var(--ink-soft);
		font-size: 1.15rem;
		line-height: 1.55;
		max-width: 52ch;
		margin: 16px 0 0;
	}
	.sd-suits {
		margin: 12px 0 0;
		font-size: 0.95rem;
		color: var(--ink-faint);
		max-width: 52ch;
		line-height: 1.5;
	}
	.sd-suits span {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
		margin-right: 8px;
	}

	.sd-spec {
		margin: 30px 0 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 1px;
		background: var(--line);
		border: 1px solid var(--line);
		border-radius: 12px;
		overflow: hidden;
		width: 100%;
	}
	.sd-spec > div {
		background: var(--paper);
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.sd-spec dt {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}
	.sd-spec dd {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--ink);
	}

	.sd-slides {
		padding: 64px 0 40px;
	}
	.sd-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 24px;
		width: 100%;
	}
	.sd-slide {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
		max-width: 100%;
	}
	.sd-slide img {
		width: 100%;
		max-width: 100%;
		height: auto;
		aspect-ratio: 3 / 4;
		object-fit: cover;
		display: block;
		border-radius: 14px;
		border: 1px solid var(--line);
		background: var(--paper-2);
	}
	.sd-slide figcaption {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--ink-soft);
		display: flex;
		gap: 8px;
	}
	.sd-num {
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}

	.sd-note {
		margin: 40px auto 0;
		max-width: 56ch;
		text-align: center;
		color: var(--ink-faint);
		font-size: 0.95rem;
		line-height: 1.6;
	}

	.sd-section-title {
		font-size: clamp(1.4rem, 3vw, 2rem);
		font-weight: var(--heading-weight);
		letter-spacing: var(--heading-tracking);
		margin: 0;
	}
	.sd-section-sub {
		margin: 10px 0 28px;
		color: var(--ink-soft);
		font-size: 1rem;
		line-height: 1.5;
		max-width: 52ch;
	}

	.sd-stories {
		padding: 48px 0 40px;
		background: var(--paper-2);
	}
	.sd-stories-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 24px;
		width: 100%;
	}
	.sd-story {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
		max-width: 100%;
	}
	.sd-story img {
		width: 100%;
		max-width: 100%;
		height: auto;
		aspect-ratio: 9 / 16;
		object-fit: cover;
		display: block;
		border-radius: 14px;
		border: 1px solid var(--line);
		background: var(--paper);
	}
	.sd-story figcaption {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--ink-soft);
		display: flex;
		gap: 8px;
	}

	.sd-slide,
	.sd-story,
	.sd-other {
		content-visibility: auto;
		contain-intrinsic-size: auto 480px;
	}

	.sd-others {
		padding: 72px 0 96px;
	}
	.sd-others-title {
		font-size: clamp(1.4rem, 3vw, 2rem);
		font-weight: var(--heading-weight);
		letter-spacing: var(--heading-tracking);
		margin: 0 0 28px;
	}
	.sd-others-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 28px;
		width: 100%;
	}
	.sd-other {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
		max-width: 100%;
		text-decoration: none;
		color: inherit;
		transition: transform 0.25s var(--ease);
	}
	.sd-other:hover {
		transform: translateY(-3px);
	}
	.sd-other-thumb {
		width: 100%;
		aspect-ratio: 3 / 4;
		max-height: 420px;
		overflow: hidden;
		border-radius: 16px;
		border: 1px solid var(--line);
		background: var(--paper-2);
	}
	.sd-other-thumb img {
		width: 100%;
		max-width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: top;
		display: block;
	}
	.sd-other h3 {
		font-family: var(--serif);
		font-size: 1.2rem;
		font-weight: var(--heading-weight);
		letter-spacing: var(--heading-tracking);
		margin: 4px 0 0;
	}
	.sd-other p {
		margin: 0;
		color: var(--ink-soft);
		font-size: 0.94rem;
		line-height: 1.5;
	}

	.sd-final {
		padding: 120px 0;
		text-align: center;
		background: var(--paper-2);
	}
	.sd-final-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.sd-final h2 {
		font-size: clamp(2rem, 4.5vw, 3.2rem);
		font-weight: var(--heading-weight);
		letter-spacing: var(--heading-tracking);
		margin: 0;
		max-width: 24ch;
		text-wrap: balance;
	}
	.sd-final p {
		color: var(--ink-soft);
		margin: 18px 0 0;
		font-size: 1.15rem;
		max-width: 50ch;
		line-height: 1.55;
	}
	.sd-final-actions {
		margin-top: 34px;
	}

	@media (max-width: 960px) {
		.sd-grid,
		.sd-stories-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (max-width: 720px) {
		.sd-hero {
			padding: 76px 0 40px;
		}
		.sd-slides {
			padding: 44px 0 28px;
		}
		.sd-grid,
		.sd-stories-grid,
		.sd-others-grid {
			grid-template-columns: 1fr;
			width: 100%;
			max-width: 100%;
			margin: 0;
		}
		.sd-others {
			padding: 56px 0 72px;
		}
		.sd-final {
			padding: 84px 0;
		}
	}
</style>
