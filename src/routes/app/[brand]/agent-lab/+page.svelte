<script lang="ts">
	// GUSCIO UI VUOTO: invia le risposte dell'utente allo store e si ridisegna in base al suo
	// stato. Nessun fetch, nessun merge, nessuna conoscenza del contratto JSON del lab —
	// quello vive in $lib/agent/client/service.ts, letto solo da $lib/agent/client/store.svelte.ts.
	import { createAgentService } from '$lib/agent/client/service';
	import { createChatStore } from '$lib/agent/client/store.svelte';

	let { data } = $props();

	const service = createAgentService({ baseUrl: `/app/${data.brand.slug}/agent-lab` });
	const store = createChatStore(service);

	let agentId = $state<string>(data.specialists[0]?.id ?? '');
	let input = $state('');
	let answerInput = $state('');

	const activeAgent = $derived(
		data.specialists.find((s: { id: string }) => s.id === agentId) ?? data.specialists[0]
	);
	// Variabile separata invece di ripetere `store.status === 'running'`: dentro un blocco
	// `{#if store.status === 'waiting_input'}` TS altrimenti restringe lo status a quel solo
	// valore letterale e segnala il confronto con 'running' come impossibile (falso: lo
	// status cambia sotto, il narrowing statico no).
	const running = $derived(store.status === 'running');

	function send() {
		if (!input.trim() || running) return;
		const text = input;
		input = '';
		void store.send(agentId, text);
	}

	function answer() {
		if (!answerInput.trim() || running) return;
		const text = answerInput;
		answerInput = '';
		void store.answer(text);
	}

	function pickAgent(id: string) {
		agentId = id;
		store.reset();
	}
</script>

<div class="mx-auto max-w-3xl p-6 font-sans">
	<header class="mb-4 flex items-center justify-between">
		<h1 class="text-lg font-semibold">{data.brand.name}</h1>
		<span class="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
			LAB — nuovo sistema agenti (kie/grok)
		</span>
	</header>

	<div class="mb-4 flex flex-wrap gap-2">
		{#each data.specialists as s (s.id)}
			<button
				class="rounded-full border px-3 py-1 text-sm transition"
				style={s.id === agentId ? `background:${s.color};color:white;border-color:${s.color}` : 'border-color:#ddd'}
				onclick={() => pickAgent(s.id)}
			>
				{s.name}
			</button>
		{/each}
	</div>
	{#if activeAgent?.title}
		<p class="mb-4 text-sm text-gray-500">{activeAgent.title}</p>
	{/if}

	<div class="mb-4 min-h-[200px] space-y-3 rounded-lg border p-4">
		{#each store.messages as m}
			<div>
				<div class="text-xs font-semibold uppercase text-gray-400">{m.role}</div>
				{#if m.content}
					<div class="whitespace-pre-wrap text-sm" class:font-medium={m.role === 'assistant'}>{m.content}</div>
				{/if}
				{#if m.events?.length}
					<div class="mt-1 space-y-0.5 font-mono text-xs">
						{#each m.events as ev}
							{#if ev.type === 'tool'}
								<div class="text-blue-600">→ {ev.name} {ev.args}</div>
							{:else if ev.type === 'result'}
								<div class={ev.isError ? 'text-red-600' : 'text-gray-500'}>← {ev.preview}</div>
							{:else if ev.type === 'reasoning'}
								<div class="italic text-gray-400">… {ev.text}</div>
							{:else if ev.type === 'text'}
								<span class="text-sm">{ev.text}</span>
							{:else if ev.type === 'error'}
								<div class="text-red-600">! {ev.message}</div>
							{/if}
						{/each}
					</div>
				{/if}
			</div>
		{/each}
		{#if store.status === 'running'}
			<div class="text-sm text-gray-400">il turno gira…</div>
		{/if}
	</div>

	{#if store.status === 'error' && store.error}
		<div class="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{store.error}</div>
	{/if}

	{#if store.status === 'waiting_input' && store.pendingQuestion}
		<div class="mb-4 rounded border border-amber-300 bg-amber-50 p-3">
			<div class="mb-2 text-sm font-medium">{store.pendingQuestion.question}</div>
			<div class="flex gap-2">
				<input
					class="flex-1 rounded border px-2 py-1 text-sm"
					bind:value={answerInput}
					placeholder="Rispondi…"
					onkeydown={(e) => e.key === 'Enter' && answer()}
				/>
				<button
					class="rounded bg-amber-600 px-3 py-1 text-sm text-white"
					onclick={answer}
					disabled={running}
				>
					Rispondi
				</button>
			</div>
		</div>
	{:else}
		<div class="flex gap-2">
			<input
				class="flex-1 rounded border px-3 py-2 text-sm"
				bind:value={input}
				placeholder="Scrivi un messaggio…"
				onkeydown={(e) => e.key === 'Enter' && send()}
				disabled={running}
			/>
			<button
				class="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
				onclick={send}
				disabled={running}
			>
				Invia
			</button>
		</div>
	{/if}

	{#if store.lastRun}
		<footer class="mt-4 text-xs text-gray-400">
			reason: {store.lastRun.reason} · runId: {store.lastRun.id}
		</footer>
	{/if}
</div>
