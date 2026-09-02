/**
 * IL DOMINIO in Zod: un agente è UNA riga (nome, istruzioni, colore), senza toolKeys — quelli li
 * decide il montaggio dei plugin — e senza prompt a strati. L'unico campo che cambia il
 * comportamento è `instructions`, tappato in caratteri e non in prosa.
 *
 * `waiting_input` è PERSISTITO: un turno che aspetta l'umano resta vivo nel database e
 * sopravvive al reload, invece di finire e ripartire a freddo.
 */
import { z } from 'zod';

export const INSTRUCTIONS_MAX = 20_000;

export const MODEL_FAMILY_IDS = ['luna', 'grok', 'gemini-flash', 'deepseek-pro', 'gpt-terra', 'gpt-sol'] as const;
export type ModelFamilyId = (typeof MODEL_FAMILY_IDS)[number];

/**
 * Non un id wire grezzo: una chiave di `MODEL_FAMILIES` nel catalogo (`src/lib/models/catalog.ts`).
 * Auto risolve su `family`; Fast/Pro restano la scelta esplicita dell'utente.
 */
export const AgentModelPolicy = z.object({
	family: z.enum(MODEL_FAMILY_IDS),
	thinking: z.enum(['off', 'low', 'medium', 'high', 'max']).default('medium'),
	/**
	 * L'id del modello sul gateway (`anthropic/claude-opus-5`), quando l'utente ne ha scelto uno dal
	 * catalogo invece di un preset. `family` resta a dire quali gradini di ragionamento offrire: le
	 * righe salvate prima di questo campo non ce l'hanno e continuano a valere.
	 */
	model: z.string().min(1).max(120).optional()
});
export type AgentModelPolicy = z.infer<typeof AgentModelPolicy>;

export const AgentSpec = z.object({
	id: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
	name: z.string().min(1).max(80),
	title: z.string().max(120).default(''),
	instructions: z.string().max(INSTRUCTIONS_MAX),
	color: z.string().max(32).default(''),
	model: AgentModelPolicy.nullable().default(null)
});
export type AgentSpec = z.infer<typeof AgentSpec>;

/** Il default quando lo spec non dichiara un modello. Motion sovrascrive con Grok (specs.ts). */
export const DEFAULT_AGENT_MODEL: AgentModelPolicy = { family: 'luna', thinking: 'high' };

export const RUN_STATES = [
	'queued',
	'running',
	'waiting_input', // domanda posta, run vivo, si riprende da qui
	'waiting_takeover', // l'umano ha la mano (login, giudizio)
	'done',
	'failed',
	'aborted'
] as const;
export type RunState = (typeof RUN_STATES)[number];

/**
 * Tutto ciò che non è qui è un bug che DEVE esplodere subito nominando i due stati, non tre
 * giorni dopo come una riga fantasma nel database.
 */
const TRANSITIONS: Record<RunState, readonly RunState[]> = {
	queued: ['running', 'aborted'],
	running: ['waiting_input', 'waiting_takeover', 'done', 'failed', 'aborted'],
	waiting_input: ['running', 'aborted'],
	waiting_takeover: ['running', 'aborted'],
	done: [],
	failed: [],
	aborted: []
};

export function assertTransition(from: RunState, to: RunState): void {
	if (!TRANSITIONS[from].includes(to)) {
		throw new Error(`run: transizione illecita ${from} → ${to}`);
	}
}

export function isResumable(state: RunState): boolean {
	return state === 'waiting_input' || state === 'waiting_takeover';
}

export function isTerminal(state: RunState): boolean {
	return TRANSITIONS[state].length === 0;
}

/**
 * Tetto del prompt di sistema FISSO, verificato dai test. 4.000 e non i ~1.800 del riferimento di
 * mercato perché il nostro porta anche il contratto di consegna. Il numero vive solo qui, così
 * chi lo sfora trova un test rosso che nomina questa riga.
 */
export const SYSTEM_PROMPT_MAX_CHARS = 4_000;
