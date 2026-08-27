/**
 * LO STATO — Svelte 5 runes, zero fetch: parla solo con l'AgentService.
 *
 * Il reply arriva GIÀ risolto dal server (turn.ts) e non si reimplementa qui. Quando è null —
 * qualunque reason, `waiting_input` incluso — si mostra `honestNotice`: una constatazione
 * fattuale, mai un riassunto inventato in questo file.
 */
import { honestNotice } from '@anomalia/agent-contracts/notice';
import type { RunStopReason } from '@anomalia/agent-kit/types';
import type { AgentService, ChatMessage, ChatRole, EventItem, TurnPayload } from './service';

export type Status = 'idle' | 'running' | 'waiting_input' | 'error';

export type ChatMsg = {
	role: ChatRole;
	content: string;
	events?: EventItem[];
};

export type PendingQuestion = { question?: string; options?: string[] } | null;

export class ChatStore {
	messages = $state<ChatMsg[]>([]);
	status = $state<Status>('idle');
	pendingQuestion = $state<PendingQuestion>(null);
	lastRun = $state<{ id: string; reason: string } | null>(null);
	error = $state<string | null>(null);

	#service: AgentService;
	#locale: 'en' | 'it';
	/** L'agente dell'ultimo `send()`: `answer()` lo riusa invece di richiederlo. */
	#agentId: string | null = null;
	#streamIdx: number | null = null;

	constructor(service: AgentService, locale: 'en' | 'it' = 'it') {
		this.#service = service;
		this.#locale = locale;
	}

	#history(): ChatMessage[] {
		return this.messages.map((m) => ({ role: m.role, content: m.content }));
	}

	#applyOutcome(out: TurnPayload) {
		this.lastRun = { id: out.runId, reason: out.reason };
		if (out.state === 'waiting_input') {
			this.pendingQuestion = (out.question as PendingQuestion) ?? null;
			this.status = 'waiting_input';
		} else {
			this.pendingQuestion = null;
			this.status = 'idle';
		}
		const content = out.reply?.message ?? honestNotice(out.reason as RunStopReason, this.#locale);
		const idx = this.#streamIdx;
		if (idx !== null) {
			const streamed = this.messages[idx];
			this.messages[idx] = { ...streamed, content };
			this.#streamIdx = null;
		} else {
			this.messages = [...this.messages, { role: 'assistant', content, events: out.events }];
		}
	}

	#onStreamEvent(e: EventItem) {
		const idx = this.#streamIdx;
		if (idx === null) return;
		const cur = this.messages[idx];
		this.messages[idx] = { ...cur, events: [...(cur.events ?? []), e] };
	}

	#dropStreamPlaceholder() {
		if (this.#streamIdx === null) return;
		this.messages = this.messages.filter((_, i) => i !== this.#streamIdx);
		this.#streamIdx = null;
	}

	async send(agentId: string, text: string) {
		if (!text.trim() || this.status === 'running') return;
		this.#agentId = agentId;
		const history = this.#history();
		this.messages = [...this.messages, { role: 'user', content: text }];
		this.#streamIdx = this.messages.length;
		this.messages = [...this.messages, { role: 'assistant', content: '', events: [] }];
		this.status = 'running';
		this.error = null;
		try {
			const out = await this.#service.sendTurn(
				{ agentId, messages: [...history, { role: 'user', content: text }] },
				(e) => this.#onStreamEvent(e)
			);
			this.#applyOutcome(out);
		} catch (e) {
			this.#dropStreamPlaceholder();
			this.status = 'error';
			this.error = e instanceof Error ? e.message : String(e);
		}
	}

	/** Riprende `lastRun.id` e riusa l'agente di `send()`. */
	async answer(text: string) {
		if (!text.trim() || this.status === 'running' || !this.lastRun || !this.#agentId) return;
		const agentId = this.#agentId;
		const resumeRunId = this.lastRun.id;
		const history = this.#history();
		this.messages = [...this.messages, { role: 'user', content: text }];
		this.#streamIdx = this.messages.length;
		this.messages = [...this.messages, { role: 'assistant', content: '', events: [] }];
		this.status = 'running';
		this.error = null;
		try {
			const out = await this.#service.sendTurn(
				{ agentId, messages: history, resumeRunId, answer: text },
				(e) => this.#onStreamEvent(e)
			);
			this.#applyOutcome(out);
		} catch (e) {
			this.#dropStreamPlaceholder();
			this.status = 'error';
			this.error = e instanceof Error ? e.message : String(e);
		}
	}

	reset() {
		this.messages = [];
		this.status = 'idle';
		this.pendingQuestion = null;
		this.lastRun = null;
		this.error = null;
		this.#agentId = null;
		this.#streamIdx = null;
	}

	abort() {
		this.#service.abort();
	}
}

export function createChatStore(service: AgentService, locale: 'en' | 'it' = 'it'): ChatStore {
	return new ChatStore(service, locale);
}
