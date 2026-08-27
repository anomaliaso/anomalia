import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { agentPanelKey, readAgentPanelPref, writeAgentPanelPref } from './chat-agent-panel-pref';

// Vitest gira in ambiente node: localStorage non esiste, lo si finge.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k)
});

beforeEach(() => store.clear());

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('la preferenza del pannello segue l’AGENTE, non la scheda', () => {
	it('la chiave è per brand e per agente (custom prima dello specialista)', () => {
		expect(agentPanelKey('demo', 'custom-uuid')).toBe('anomalia:chat-agent-panel:demo:custom-uuid');
		expect(agentPanelKey('demo', 'content')).toBe('anomalia:chat-agent-panel:demo:content');
		expect(agentPanelKey('demo', null)).toBe('anomalia:chat-agent-panel:demo:none');
	});

	it('write → read: aperto per un agente resta aperto, chiuso resta chiuso', () => {
		writeAgentPanelPref('demo', 'content', true);
		expect(readAgentPanelPref('demo', 'content')).toBe(true);
		// L'altro agente non eredita: la preferenza è PER AGENTE.
		expect(readAgentPanelPref('demo', 'motion')).toBe(false);
		writeAgentPanelPref('demo', 'motion', true);
		writeAgentPanelPref('demo', 'content', false);
		expect(readAgentPanelPref('demo', 'content')).toBe(false);
		expect(readAgentPanelPref('demo', 'motion')).toBe(true);
		// Chiuso = chiave assente, non "0": il default già è chiuso.
		expect(store.has(agentPanelKey('demo', 'content'))).toBe(false);
	});

	it('storage rotto (privacy, quota) → mai un throw, default chiuso', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			},
			removeItem: () => {
				throw new Error('denied');
			}
		});
		expect(() => writeAgentPanelPref('demo', 'content', true)).not.toThrow();
		expect(readAgentPanelPref('demo', 'content')).toBe(false);
	});
});

describe('la pagina del thread legge la preferenza e la riscrive a ogni cambio', () => {
	const page = read('../routes/app/[brand]/chat/[thread]/+page.svelte');

	it('agentPanelOpen parte chiuso e viene riallineato alla preferenza per agente', () => {
		expect(page).toMatch(/agentPanelOpen = \$state\(false\)/);
		expect(page).toMatch(/readAgentPanelPref\(/);
		expect(page).toMatch(/custom_agent_id \?\? data\.thread\.agent/);
	});

	it('ogni cambio di stato (toggle, X del pannello) passa dalla scrittura', () => {
		expect(page).toMatch(/writeAgentPanelPref\(/);
		// Gli Unici due punti che toccano agentPanelOpen fuori dall'init sono il toggle e l'$effect.
		const touches = page.match(/agentPanelOpen = !agentPanelOpen|agentPanelOpen = false/g) ?? [];
		expect(touches.length).toBeGreaterThanOrEqual(2);
	});
});
