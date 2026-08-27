import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readChatDraft, writeChatDraft } from './chat-draft';

// Vitest gira in ambiente node: sessionStorage non esiste, lo si finge.
const store = new Map<string, string>();
vi.stubGlobal('sessionStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k)
});

beforeEach(() => store.clear());

describe('chat draft — il testo non inviato sopravvive a un refresh', () => {
	it('write → read restituisce lo stesso testo (il "refresh" è la coppia di chiamate)', () => {
		writeChatDraft('anomalia:chat-draft:t1', 'un messaggio lungo scritto con cura');
		expect(readChatDraft('anomalia:chat-draft:t1')).toBe('un messaggio lungo scritto con cura');
	});

	it("l'invio (value vuoto) RIMUOVE la chiave — il draft consumato non risorge", () => {
		writeChatDraft('k', 'ciao');
		writeChatDraft('k', '');
		expect(readChatDraft('k')).toBe('');
		// Mutazione pinnata: setItem('') al posto di removeItem lascerebbe la chiave viva.
		expect(store.has('k')).toBe(false);
	});

	it('storage rotto (privacy mode, quota) → mai un throw, draft vuoto', () => {
		vi.stubGlobal('sessionStorage', {
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
		expect(() => writeChatDraft('k', 'x')).not.toThrow();
		expect(readChatDraft('k')).toBe('');
	});
});
