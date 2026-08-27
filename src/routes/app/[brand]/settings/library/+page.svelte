<script lang="ts">
	import { enhance } from '$app/forms';
	import { _ } from 'svelte-i18n';
	import { ScanSearch } from '@lucide/svelte';

	let { data, form } = $props();
	let busy = $state(false);
	let websiteEdit = $state(data.brandWebsite ?? '');
	$effect(() => {
		websiteEdit = data.brandWebsite ?? '';
	});

	const onScan = () => {
		busy = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			busy = false;
		};
	};
</script>

<section class="panel">
	<div class="panel-head">
		<div class="t">{$_('app.settings.library.website')}</div>
		<div class="s">{$_('app.settings.library.websiteDesc')}</div>
	</div>
	<form method="POST" action="?/setWebsite" use:enhance class="website-form">
		<input
			name="website"
			type="url"
			inputmode="url"
			autocomplete="url"
			placeholder={$_('app.settings.library.websitePlaceholder')}
			bind:value={websiteEdit}
			class="website-input"
		/>
		<button class="mini connect" type="submit">{$_('app.settings.save')}</button>
	</form>
	{#if form?.websiteSaved}
		<div class="fs ok">{$_('app.settings.library.websiteSaved')}</div>
	{/if}
	{#if form?.websiteError}
		<div class="fs err">{form.websiteError}</div>
	{/if}
</section>

<section class="panel">
	<div class="panel-head row">
		<div>
			<div class="t">{$_('app.settings.library.pages')}</div>
			<div class="s">{$_('app.settings.library.pagesDesc')}</div>
		</div>
		<form method="POST" action="?/scan" use:enhance={onScan}>
			<button class="btn primary" type="submit" disabled={busy || !websiteEdit.trim()}>
				<ScanSearch class="size-3.5" strokeWidth={2} />
				{busy
					? $_('app.settings.library.scanning')
					: data.pages.length
						? $_('app.settings.library.rescan')
						: $_('app.settings.library.scan')}
			</button>
		</form>
	</div>

	{#if form?.error}
		<p class="banner err">{$_('app.settings.library.scanFailed', { values: { error: form.error } })}</p>
	{:else if form?.scanned != null}
		<p class="banner ok">{$_('app.settings.library.scanOk', { values: { count: form.scanned } })}</p>
	{/if}

	{#if !data.brandWebsite && !websiteEdit.trim()}
		<p class="banner warn">{$_('app.settings.library.noWebsite')}</p>
	{/if}

	{#if data.pages.length}
		<ul class="items">
			{#each data.pages as p (p.url)}
				<li class="row-item">
					<div class="top">
						<span class="badge {(p.relevance_score ?? 0) >= 50 ? 'ok' : ''}"
							>{$_('app.settings.library.relevance', {
								values: { score: p.relevance_score ?? 0 }
							})}</span
						>
						<span class="used {p.last_used_at ? 'is-used' : ''}"
							>{p.last_used_at
								? $_('app.settings.library.used')
								: $_('app.settings.library.neverUsed')}</span
						>
					</div>
					<a href={p.url} target="_blank" rel="noopener noreferrer" class="title"
						>{p.title || p.url}</a
					>
					{#if p.topics?.length}<p class="topics">{p.topics.join(' · ')}</p>{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<div class="empty">
			<img class="empty-hero" src="/library-hero.webp" alt="" />
			<h3>{$_('app.settings.library.emptyTitle')}</h3>
			<p>{$_('app.settings.library.emptyDesc')}</p>
		</div>
	{/if}
</section>

<style>
	.panel {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 16px;
		padding: 18px 22px;
		margin-bottom: 16px;
	}
	.panel-head {
		margin-bottom: 14px;
	}
	.panel-head.row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}
	.t {
		font-size: 14px;
		font-weight: 600;
		color: var(--ink);
	}
	.s,
	.fs {
		font-size: 13px;
		color: var(--ink-faint);
		margin-top: 4px;
	}
	.fs.ok {
		color: var(--accent);
		margin-top: 10px;
	}
	.fs.err {
		color: #c0392b;
		margin-top: 10px;
	}

	.website-form {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
	}
	.website-input {
		flex: 1;
		min-width: 200px;
		height: 38px;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 0 12px;
		background: var(--paper-2, var(--paper));
		color: var(--ink);
		font-size: 13.5px;
	}
	.mini.connect {
		height: 38px;
		padding: 0 16px;
		border-radius: 10px;
		border: none;
		background: var(--accent, #7c5cff);
		color: #fff;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}

	.btn.primary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 36px;
		padding: 0 14px;
		border-radius: 10px;
		border: none;
		background: var(--accent, #7c5cff);
		color: #fff;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn.primary:disabled {
		opacity: 0.55;
		cursor: default;
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
	.banner.warn {
		background: #fef3c7;
		color: #92400e;
	}

	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.row-item {
		padding: 14px 0;
		border-bottom: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.row-item:last-child {
		border-bottom: none;
	}
	.top {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.badge {
		font-size: 11px;
		font-weight: 600;
		padding: 2px 9px;
		border-radius: 999px;
		background: var(--paper-2);
		color: var(--ink-faint);
	}
	.badge.ok {
		background: #dcfce7;
		color: #166534;
	}
	.used {
		font-size: 12px;
		color: var(--ink-faint);
	}
	.used.is-used {
		color: var(--ink-soft);
	}
	.title {
		font-size: 14px;
		color: var(--ink);
		text-decoration: none;
		font-weight: 500;
	}
	.title:hover {
		text-decoration: underline;
	}
	.topics {
		font-size: 12.5px;
		color: var(--ink-soft);
		margin: 0;
		line-height: 1.45;
	}
	.empty {
		text-align: center;
		padding: 16px 8px 8px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}
	.empty-hero {
		width: 100%;
		max-width: 420px;
		border-radius: 14px;
		margin: 0 auto 12px;
		display: block;
	}
	.empty h3 {
		margin: 0;
		font-size: 1.05rem;
	}
	.empty p {
		font-size: 13.5px;
		color: var(--ink-faint);
		margin: 0;
	}

	@container workbench (max-width: 640px) {
		.panel-head.row {
			flex-direction: column;
		}
	}
</style>
