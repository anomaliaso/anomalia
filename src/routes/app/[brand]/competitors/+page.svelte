<script lang="ts">
	import { enhance } from '$app/forms';
	import { _ } from 'svelte-i18n';
	import PageHead from '$lib/components/PageHead.svelte';
	import { page } from '$app/stores';
	import TopbarCta from '$lib/components/TopbarCta.svelte';
	import PlatformGlyph from '$lib/components/PlatformGlyph.svelte';
	import { Search, Plus, Swords, RefreshCw } from '@lucide/svelte';
	import type { CompetitorRow } from './+page.server';

	let { data, form } = $props();
	let busy = $state(false);
	let showAdd = $state(false);
	let editingId = $state<string | null>(null);

	const competitors = $derived(data.competitors as CompetitorRow[]);
	const market = $derived(data.market);
	const field = $derived(data.field);
	const withBusy = () => {
		busy = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			busy = false;
			showAdd = false;
			editingId = null;
		};
	};

	function host(url: string) {
		try {
			return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).host.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	function fmtNum(n: number) {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
		return `${Math.round(n)}`;
	}

	function formatMixLabel(mix: { image?: number; video?: number; text?: number } | undefined) {
		if (!mix) return null;
		const parts: string[] = [];
		if ((mix.video ?? 0) >= 0.05) parts.push(`${Math.round((mix.video ?? 0) * 100)}% video`);
		if ((mix.image ?? 0) >= 0.05) parts.push(`${Math.round((mix.image ?? 0) * 100)}% image`);
		if ((mix.text ?? 0) >= 0.05) parts.push(`${Math.round((mix.text ?? 0) * 100)}% text`);
		return parts.join(' · ') || null;
	}

	function metricChips(metrics: Record<string, unknown>, engagement: number) {
		const chips: { label: string; value: string }[] = [];
		for (const key of ['views', 'likes', 'comments', 'shares'] as const) {
			const v = Number(metrics?.[key] ?? 0);
			if (v > 0) chips.push({ label: key, value: fmtNum(v) });
		}
		if (!chips.length && engagement > 0) {
			chips.push({ label: 'eng', value: fmtNum(engagement) });
		}
		return chips;
	}
</script>

<div class="comp-page">
	<PageHead title={$_('app.competitors.title')} subtitle={$_('app.competitors.subtitle')}>
		{#snippet actions()}
			<form method="POST" action="?/researchCompetitors" use:enhance={withBusy} class="topbar-cta-wrap">
				<TopbarCta {busy} Icon={Search}>
					{busy ? $_('app.studio.competitors.researching') : $_('app.studio.competitors.research')}
				</TopbarCta>
			</form>
			<button
				type="button"
				class="btn ghost add-btn"
				onclick={() => (showAdd = !showAdd)}
				disabled={busy}
			>
				<Plus class="size-3.5" strokeWidth={2} />
				{$_('app.studio.competitors.addButton')}
			</button>
		{/snippet}
	</PageHead>

	{#if form?.researched}
		<p class="banner ok">
			{form.added
				? $_('app.studio.competitors.researchAdded', { values: { count: form.added } })
				: $_('app.studio.competitors.researchNone')}
		</p>
	{/if}
	{#if form?.marketRefreshed}
		<p class="banner ok">
			{$_('app.competitors.market.refreshed', {
				values: {
					formats: form.formats ?? 0,
					references: form.references ?? 0,
					ads: form.ads ?? 0
				}
			})}
		</p>
	{/if}
	{#if form?.error}
		<p class="banner err">{form.error}</p>
	{/if}

	<section class="panel market-panel">
		<div class="panel-head market-head">
			<div>
				<div class="t">{$_('app.competitors.market.title')}</div>
				<div class="s">
					{$_('app.competitors.market.subtitle', { values: { days: data.freshDays } })}
				</div>
				{#if market?.updatedAt}
					<div class="market-meta">
						{$_('app.competitors.market.updated', {
							values: { date: new Date(market.updatedAt).toLocaleDateString() }
						})}
					</div>
				{/if}
			</div>
			<form method="POST" action="?/refreshMarketReferences" use:enhance={withBusy}>
				<button class="btn ghost" type="submit" disabled={busy || competitors.length === 0}>
					<RefreshCw class="size-3.5" strokeWidth={2} />
					{busy
						? $_('app.competitors.market.refreshing')
						: $_('app.competitors.market.refresh')}
				</button>
			</form>
		</div>

		{#if !market}
			<p class="market-empty">{$_('app.competitors.market.empty')}</p>
		{:else}
			{#if market.summary}
				<p class="market-summary">{market.summary}</p>
			{/if}
			{#if market.formats?.length}
				<div class="format-grid">
					{#each market.formats as f}
						<div class="format-card">
							<div class="format-name">
								{f.name}
								<span class="format-media">{f.media}</span>
							</div>
							<p class="format-desc">{f.description}</p>
							<p class="format-adapt">{f.howToAdapt}</p>
						</div>
					{/each}
				</div>
			{/if}
			{#if market.hooks?.length}
				<div class="hooks">
					<div class="sub-t">{$_('app.competitors.market.hooks')}</div>
					<ul>
						{#each market.hooks as h}
							<li>
								<strong>{h.pattern}</strong>
								{#if h.example}<span class="hook-ex"> — {h.example}</span>{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
			{#if market.references?.length}
				<div class="sub-t">{$_('app.competitors.market.refs')}</div>
				<div class="posts-grid market-refs">
					{#each market.references as p}
						<article class="post-card">
							{#if p.thumb}
								<div class="thumb-wrap">
									<img src={p.thumb} alt="" loading="lazy" />
									{#if p.mediaType === 'video'}
										<span class="vid-badge">video</span>
									{/if}
								</div>
							{/if}
							<div class="post-body">
								<div class="post-meta">
									<PlatformGlyph platform={p.platform} />
									<span>{p.competitor}</span>
									{#if p.format}<span class="fmt-tag">{p.format}</span>{/if}
								</div>
								{#if p.hook}
									<p class="post-hook">{p.hook}</p>
								{/if}
								{#if p.content}
									<p class="post-cap">{p.content}</p>
								{/if}
							</div>
						</article>
					{/each}
				</div>
			{/if}
		{/if}
	</section>

	<!-- Campo: chi ottiene attenzione nel campo del brand, competitor schedati o no. Il pannello
	     sopra parte da chi conosciamo; questo da chi sta funzionando. -->
	<section class="panel market-panel field-panel">
		<div class="panel-head market-head">
			<div>
				<div class="t">{$_('app.competitors.field.title')}</div>
				<div class="s">{$_('app.competitors.field.subtitle')}</div>
			</div>
			<form method="POST" action="?/refreshField" use:enhance={withBusy}>
				<button class="btn ghost" type="submit" disabled={busy}>
					<RefreshCw class="size-3.5" strokeWidth={2} />
					{busy ? $_('app.competitors.market.refreshing') : $_('app.competitors.market.refresh')}
				</button>
			</form>
		</div>

		{#if !field?.playbook && !field?.posts?.length}
			<p class="market-empty">{$_('app.competitors.field.empty')}</p>
		{:else}
			{#if field.playbook?.summary}
				<p class="market-summary">{field.playbook.summary}</p>
			{/if}
			{#if field.playbook}
				<p class="field-temp">
					{$_('app.competitors.field.temperature', {
						values: { n: field.playbook.fieldRagebait ?? 0 }
					})}
				</p>
			{/if}
			{#if field.playbook?.moves?.length}
				<div class="sub-t">{$_('app.competitors.field.moves')}</div>
				<ul class="field-moves">
					{#each field.playbook.moves as m}
						<li>
							<span class="move">{m.move}</span>
							<span class="rage" data-hot={m.ragebait >= 6}>ragebait {m.ragebait}/10</span>
							{#if m.howToAdapt}<span class="adapt">{m.howToAdapt}</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if field.playbook?.avoid?.length}
				<p class="field-avoid">
					<strong>{$_('app.competitors.field.avoid')}</strong>
					{field.playbook.avoid.join(' · ')}
				</p>
			{/if}
			{#if field.posts?.length}
				<div class="sub-t">{$_('app.competitors.field.posts')}</div>
				<ul class="field-posts">
					{#each field.posts as p}
						<li>
							<div class="fp-head">
								<PlatformGlyph platform={p.platform} />
								{#if p.account}<span class="fp-account">{p.account}</span>{/if}
								{#if p.tone}<span class="fmt-tag">{p.tone}</span>{/if}
								{#if p.format}<span class="fmt-tag">{p.format}</span>{/if}
								{#if p.ragebait != null}
									<span class="rage" data-hot={p.ragebait >= 6}>ragebait {p.ragebait}/10</span>
								{/if}
								{#if p.url}
									<a class="fp-link" href={p.url} target="_blank" rel="noopener noreferrer">↗</a>
								{/if}
							</div>
							{#if p.content}<p class="post-cap">{p.content}</p>{/if}
							{#if p.why}<p class="fp-why">{p.why}</p>{/if}
							{#if p.spread?.length}<p class="fp-spread">{p.spread.join(' · ')}</p>{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</section>

	<section class="panel market-panel ads-panel">
		<div class="panel-head market-head">
			<div>
				<div class="t">{$_('app.competitors.ads.title')}</div>
				<div class="s">{$_('app.competitors.ads.subtitle')}</div>
			</div>
		</div>
		{#if !(market?.ads?.length)}
			<p class="market-empty">{$_('app.competitors.ads.empty')}</p>
		{:else}
			<div class="posts-grid market-refs">
				{#each market.ads as ad}
					<a class="post-card ad-card" href={ad.libraryUrl} target="_blank" rel="noopener noreferrer">
						{#if ad.thumb}
							<div class="thumb-wrap">
								<img src={ad.thumb} alt="" loading="lazy" />
								{#if ad.displayFormat === 'VIDEO'}
									<span class="vid-badge">video</span>
								{/if}
							</div>
						{/if}
						<div class="post-body">
							<div class="post-meta">
								<span class="ad-badge">{$_('app.competitors.ads.badge')}</span>
								{#if ad.competitor}<span>{ad.competitor}</span>{/if}
								{#if ad.platforms?.length}
									<span class="fmt-tag">{ad.platforms.slice(0, 2).join(' · ')}</span>
								{/if}
							</div>
							{#if ad.body}
								<p class="post-cap">{ad.body}</p>
							{/if}
							{#if ad.cta}
								<p class="post-hook">{ad.cta}</p>
							{/if}
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</section>

	{#if showAdd}
		<section class="panel add-panel">
			<div class="panel-head">
				<div class="t">{$_('app.studio.competitors.add')}</div>
				<div class="s">{$_('app.studio.competitors.addDesc')}</div>
			</div>
			<form class="add-form" method="POST" action="?/addCompetitor" use:enhance={withBusy}>
				<input name="name" type="text" placeholder={$_('app.studio.competitors.namePlaceholder')} required />
				<div class="row">
					<input
						name="website"
						type="text"
						placeholder={$_('app.studio.competitors.websitePlaceholder')}
					/>
					<select name="kind">
						<option value="direct">{$_('app.studio.competitors.kind.direct')}</option>
						<option value="indirect">{$_('app.studio.competitors.kind.indirect')}</option>
					</select>
				</div>
				<textarea
					name="rationale"
					rows="2"
					placeholder={$_('app.studio.competitors.rationalePlaceholder')}
				></textarea>
				<div class="form-actions">
					<button class="btn ghost" type="button" onclick={() => (showAdd = false)} disabled={busy}
						>{$_('app.studio.cancel')}</button
					>
					<button class="btn primary" type="submit" disabled={busy}
						>{busy ? $_('app.studio.saving') : $_('app.studio.competitors.addButton')}</button
					>
				</div>
			</form>
		</section>
	{/if}

	{#if competitors.length === 0}
		<section class="panel empty">
			<Swords class="empty-icon" strokeWidth={1.5} />
			<h3>{$_('app.competitors.emptyTitle')}</h3>
			{#if $page.data.flags?.navTeam}
				<!-- FEATURE_NAV_TEAM: si offre l'agente che osserva i competitor, non un "crea il primo". -->
			{:else}
				<p>{$_('app.competitors.emptyDesc')}</p>
			{/if}
			<form method="POST" action="?/researchCompetitors" use:enhance={withBusy}>
				<button class="btn primary" type="submit" disabled={busy}>
					{busy ? $_('app.studio.competitors.researching') : $_('app.studio.competitors.research')}
				</button>
			</form>
		</section>
	{:else}
		{#each competitors as c (c.id)}
			<section class="panel competitor">
				<div class="comp-head">
					<div class="comp-id">
						<div class="name-row">
							<span class="name">{c.name}</span>
							<span class="kind" class:indirect={c.kind === 'indirect'}
								>{c.kind === 'indirect'
									? $_('app.studio.competitors.kind.indirect')
									: $_('app.studio.competitors.kind.direct')}</span
							>
							{#if c.source === 'ai'}
								<span class="src">{$_('app.studio.competitors.sourceAi')}</span>
							{/if}
						</div>
						{#if c.website}
							<a class="site" href={c.website} target="_blank" rel="noopener noreferrer"
								>{host(c.website)}</a
							>
						{/if}
						{#if c.rationale}
							<p class="rationale">{c.rationale}</p>
						{/if}
						{#if c.handles?.length}
							<div class="handles">
								{#each c.handles as h (h.platform + h.handle)}
									<span class="handle">
										<PlatformGlyph platform={h.platform} />
										@{h.handle}
									</span>
								{/each}
							</div>
						{/if}
					</div>
					<div class="comp-actions">
						<button
							class="btn link"
							type="button"
							onclick={() => (editingId = editingId === c.id ? null : c.id)}
							disabled={busy}>{$_('app.studio.competitors.edit')}</button
						>
						<form method="POST" action="?/deleteCompetitor" use:enhance={withBusy}>
							<input type="hidden" name="id" value={c.id} />
							<button class="btn link danger" type="submit" disabled={busy}
								>{$_('app.studio.remove')}</button
							>
						</form>
					</div>
				</div>

				{#if editingId === c.id}
					<form class="add-form edit" method="POST" action="?/updateCompetitor" use:enhance={withBusy}>
						<input type="hidden" name="id" value={c.id} />
						<input
							name="name"
							type="text"
							value={c.name}
							placeholder={$_('app.studio.competitors.namePlaceholder')}
							required
						/>
						<div class="row">
							<input
								name="website"
								type="text"
								value={c.website ?? ''}
								placeholder={$_('app.studio.competitors.websitePlaceholder')}
							/>
							<select name="kind" value={c.kind}>
								<option value="direct">{$_('app.studio.competitors.kind.direct')}</option>
								<option value="indirect">{$_('app.studio.competitors.kind.indirect')}</option>
							</select>
						</div>
						<textarea
							name="rationale"
							rows="2"
							placeholder={$_('app.studio.competitors.rationalePlaceholder')}>{c.rationale ?? ''}</textarea
						>
						<div class="form-actions">
							<button class="btn ghost" type="button" onclick={() => (editingId = null)} disabled={busy}
								>{$_('app.studio.cancel')}</button
							>
							<button class="btn primary" type="submit" disabled={busy}
								>{busy ? $_('app.studio.saving') : $_('app.studio.save')}</button
							>
						</div>
					</form>
				{/if}

				{#if c.benchmark}
					{@const mix = formatMixLabel(c.benchmark.formatMix)}
					<div class="bench">
						{#if c.benchmark.count}
							<span>{$_('app.competitors.postsCount', { values: { count: c.benchmark.count } })}</span>
						{/if}
						{#if (c.benchmark.medianEngagement ?? 0) > 0}
							<span
								>{$_('app.competitors.medianEng', {
									values: { n: fmtNum(c.benchmark.medianEngagement ?? 0) }
								})}</span
							>
						{/if}
						{#if (c.benchmark.postsPerWeek ?? 0) > 0}
							<span
								>{$_('app.competitors.perWeek', {
									values: { n: (c.benchmark.postsPerWeek ?? 0).toFixed(1) }
								})}</span
							>
						{/if}
						{#if mix}<span>{mix}</span>{/if}
					</div>
				{/if}

				{#if c.topPosts.length}
					<div class="posts-label">{$_('app.competitors.topPosts')}</div>
					<div class="posts-grid">
						{#each c.topPosts as p, i (c.id + '-' + i)}
							{@const chips = metricChips(p.metrics ?? {}, p.engagement ?? 0)}
							<article class="post-card">
								<div
									class="thumb"
									style={p.thumb
										? `background-image:url(${p.thumb})`
										: undefined}
								>
									{#if p.platform}
										<span class="plat"><PlatformGlyph platform={p.platform} /></span>
									{/if}
								</div>
								<div class="post-body">
									<p class="cap">{p.content?.trim() || '—'}</p>
									{#if chips.length}
										<div class="metrics">
											{#each chips as m}
												<span>{m.value} {m.label}</span>
											{/each}
										</div>
									{/if}
								</div>
							</article>
						{/each}
					</div>
				{:else}
					<p class="no-posts">{$_('app.competitors.noPosts')}</p>
				{/if}

				{#if c.topAds.length}
					<div class="posts-label">{$_('app.competitors.ads.topAds')}</div>
					<div class="posts-grid">
						{#each c.topAds as ad, i (c.id + '-ad-' + ad.adArchiveId + '-' + i)}
							<a class="post-card ad-card" href={ad.libraryUrl} target="_blank" rel="noopener noreferrer">
								<div
									class="thumb"
									style={ad.thumb ? `background-image:url(${ad.thumb})` : undefined}
								>
									<span class="plat ad-plat">{$_('app.competitors.ads.badge')}</span>
								</div>
								<div class="post-body">
									<p class="cap">{ad.body?.trim() || ad.cta || '—'}</p>
									<div class="metrics">
										{#if ad.platforms?.length}
											<span>{ad.platforms.slice(0, 2).join(' · ')}</span>
										{/if}
										{#if ad.cta}<span>{ad.cta}</span>{/if}
									</div>
								</div>
							</a>
						{/each}
					</div>
				{:else}
					<p class="no-posts">{$_('app.competitors.ads.noAds')}</p>
				{/if}
			</section>
		{/each}
	{/if}
</div>

<style>
	.comp-page {
		max-width: var(--content-max, 960px);
		margin: 0 auto;
	}
	.topbar-cta-wrap {
		display: inline-flex;
	}
	.add-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 36px;
		padding: 0 12px;
		border-radius: 10px;
		border: 1px solid var(--line);
		background: transparent;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		color: var(--ink);
	}

	.banner {
		font-size: 13px;
		border-radius: 10px;
		padding: 10px 14px;
		margin: 0 0 14px;
	}
	.banner.ok {
		background: #dcfce7;
		color: #166534;
	}
	.banner.err {
		background: #fef2f2;
		color: #b91c1c;
	}

	.panel {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 16px;
		padding: 18px 22px;
		margin-bottom: 14px;
	}
	.panel-head {
		margin-bottom: 12px;
	}
	.t {
		font-size: 14px;
		font-weight: 600;
	}
	.s {
		font-size: 13px;
		color: var(--ink-faint);
		margin-top: 4px;
	}

	.add-form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.add-form input,
	.add-form select,
	.add-form textarea {
		width: 100%;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 10px 12px;
		font: inherit;
		font-size: 13.5px;
		background: var(--paper-2, var(--paper));
		color: var(--ink);
	}
	.add-form .row {
		display: grid;
		grid-template-columns: 1fr 140px;
		gap: 10px;
	}
	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.btn {
		height: 36px;
		padding: 0 14px;
		border-radius: 10px;
		border: 1px solid transparent;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.btn.primary {
		background: var(--accent, #7c5cff);
		color: #fff;
	}
	.btn.ghost {
		background: transparent;
		border-color: var(--line);
		color: var(--ink);
	}
	.btn.link {
		background: none;
		border: none;
		padding: 0;
		height: auto;
		font-size: 12.5px;
		color: var(--ink-soft);
		text-decoration: underline;
	}
	.btn.link.danger {
		color: #c0392b;
	}

	.empty {
		text-align: center;
		padding: 48px 24px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}
	.empty-icon {
		width: 36px;
		height: 36px;
		color: var(--ink-faint);
		margin-bottom: 8px;
	}
	.empty h3 {
		margin: 0;
		font-size: 1.1rem;
	}
	.empty p {
		margin: 0 0 12px;
		font-size: 14px;
		color: var(--ink-faint);
		max-width: 420px;
	}

	.comp-head {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		align-items: flex-start;
	}
	.name-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.name {
		font-size: 16px;
		font-weight: 650;
		letter-spacing: -0.01em;
	}
	.kind,
	.src {
		font-size: 11px;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--paper-2);
		color: var(--ink-soft);
	}
	.kind.indirect {
		opacity: 0.75;
	}
	.site {
		display: inline-block;
		margin-top: 4px;
		font-size: 13px;
		color: var(--accent);
		text-decoration: none;
	}
	.site:hover {
		text-decoration: underline;
	}
	.rationale {
		margin: 8px 0 0;
		font-size: 13.5px;
		color: var(--ink-soft);
		line-height: 1.45;
	}
	.handles {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 10px;
	}
	.handle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--ink-soft);
	}
	.handle :global(.pglyph) {
		width: 18px;
		height: 18px;
		border-radius: 5px;
	}
	.comp-actions {
		display: flex;
		gap: 12px;
		flex-shrink: 0;
	}

	.bench {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 14px;
		margin: 14px 0 4px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--ink-soft);
	}

	.posts-label {
		margin: 16px 0 10px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}
	.posts-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 12px;
	}
	.post-card {
		border: 1px solid var(--line);
		border-radius: 14px;
		overflow: hidden;
		background: var(--paper);
	}
	.thumb {
		position: relative;
		aspect-ratio: 16 / 10;
		background: var(--paper-2);
		background-size: cover;
		background-position: center;
	}
	.plat {
		position: absolute;
		top: 8px;
		left: 8px;
		width: 22px;
		height: 22px;
		border-radius: 7px;
		overflow: hidden;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
	}
	.plat :global(.pglyph) {
		width: 22px;
		height: 22px;
	}
	.post-body {
		padding: 10px 12px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.cap {
		margin: 0;
		font-size: 13px;
		line-height: 1.35;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
	}
	.metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		font-size: 12px;
		font-weight: 600;
		color: var(--accent);
	}
	.no-posts {
		margin: 12px 0 0;
		font-size: 13px;
		color: var(--ink-faint);
	}

	.ad-card {
		text-decoration: none;
		color: inherit;
		transition: border-color 0.15s ease;
	}
	.ad-card:hover {
		border-color: var(--ink-faint);
	}
	.ad-badge {
		display: inline-flex;
		align-items: center;
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		background: var(--ink);
		color: var(--paper);
	}
	.ad-plat {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 6px;
		width: auto !important;
		min-width: 22px;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		background: var(--ink);
		color: var(--paper);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
	}
	.ads-panel {
		margin-bottom: 16px;
	}

	.market-panel {
		margin-bottom: 16px;
	}
	.market-head {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		align-items: flex-start;
	}
	.market-head .btn.ghost {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}
	.market-meta {
		margin-top: 6px;
		font-size: 12px;
		color: var(--ink-faint);
	}
	.market-empty {
		margin: 8px 0 0;
		font-size: 13.5px;
		color: var(--ink-soft);
		line-height: 1.45;
	}
	.market-summary {
		margin: 12px 0 0;
		font-size: 14px;
		line-height: 1.5;
		color: var(--ink);
	}
	.format-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 12px;
		margin-top: 14px;
	}
	.format-card {
		padding: 12px 14px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--paper-2, transparent);
	}
	.format-name {
		font-size: 13.5px;
		font-weight: 650;
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.format-media {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-faint);
		padding: 2px 6px;
		border-radius: 999px;
		border: 1px solid var(--line);
	}
	.format-desc,
	.format-adapt {
		margin: 6px 0 0;
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--ink-soft);
	}
	.format-adapt {
		color: var(--accent);
	}
	.sub-t {
		margin: 16px 0 8px;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-faint);
	}
	.hooks ul {
		margin: 0;
		padding-left: 18px;
		font-size: 13px;
		line-height: 1.45;
		color: var(--ink-soft);
	}
	.hook-ex {
		font-weight: 400;
		color: var(--ink-faint);
	}
	.market-refs {
		margin-top: 4px;
	}
	.thumb-wrap {
		position: relative;
	}
	.vid-badge {
		position: absolute;
		top: 8px;
		left: 8px;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		background: rgba(0, 0, 0, 0.7);
		color: #fff;
		padding: 2px 6px;
		border-radius: 6px;
	}
	.fmt-tag {
		font-size: 11px;
		color: var(--accent);
		font-weight: 600;
	}
	.post-hook {
		margin: 4px 0 0;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--ink);
	}

	/* Campo — il ragebait è l'unico numero che cambia cosa scriverai, quindi è l'unico che porta
	   colore: sopra 6 il campo vive di scontro e vale saperlo a colpo d'occhio. */
	.field-temp {
		margin: 10px 0 0;
		font-size: 12.5px;
		color: var(--ink-soft);
	}
	.field-moves,
	.field-posts {
		list-style: none;
		margin: 10px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.field-moves li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 8px;
		font-size: 13px;
		line-height: 1.45;
	}
	.field-moves .move {
		font-weight: 650;
		color: var(--ink);
	}
	.field-moves .adapt {
		flex-basis: 100%;
		color: var(--ink-soft);
	}
	.rage {
		font-size: 10.5px;
		font-weight: 650;
		white-space: nowrap;
		padding: 1px 6px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--ink-faint) 12%, transparent);
		color: var(--ink-faint);
	}
	.rage[data-hot='true'] {
		background: color-mix(in srgb, #dc2626 16%, transparent);
		color: #b91c1c;
	}
	.field-avoid {
		margin: 10px 0 0;
		font-size: 12.5px;
		color: var(--ink-soft);
		line-height: 1.45;
	}
	.field-posts li {
		border-top: 1px solid var(--line, rgba(0, 0, 0, 0.08));
		padding-top: 10px;
	}
	.fp-head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		font-size: 12px;
		color: var(--ink-faint);
	}
	.fp-account {
		font-weight: 650;
		color: var(--ink-soft);
	}
	.fp-link {
		margin-left: auto;
		text-decoration: none;
		color: var(--ink-faint);
	}
	.fp-why,
	.fp-spread {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--ink-soft);
		line-height: 1.45;
	}
	.fp-spread {
		color: var(--ink-faint);
	}

	@container workbench (max-width: 640px) {
		.add-form .row {
			grid-template-columns: 1fr;
		}
		.comp-head,
		.market-head {
			flex-direction: column;
		}
	}
</style>
