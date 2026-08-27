/**
 * Vive qui e non in turn.ts per essere importabile dal CLIENT senza trascinare run-store.ts ed
 * executor.ts nel bundle browser: zero import di runtime, `RunStopReason` sparisce a compile-time.
 * turn.ts la ri-esporta per chi la importava già da lì.
 */
import type { RunStopReason } from '@anomalia/agent-kit/types';

/** La riga per il turno davvero muto (né reply né testo): una constatazione, mai un riassunto. */
export function honestNotice(reason: RunStopReason, locale: 'en' | 'it'): string {
	const it: Record<RunStopReason, string> = {
		completed: 'Turno chiuso senza messaggio.',
		reply: 'Turno chiuso.',
		waiting_input: 'In attesa di una tua risposta.',
		step_limit: 'Turno fermato al limite di passi, senza messaggio.',
		token_budget: 'Turno fermato al limite di token, senza messaggio.',
		deadline: 'Turno fermato al limite di tempo, senza messaggio.',
		aborted: 'Turno interrotto.'
	};
	const en: Record<RunStopReason, string> = {
		completed: 'Turn ended without a message.',
		reply: 'Turn ended.',
		waiting_input: 'Waiting for your answer.',
		step_limit: 'Turn stopped at the step limit, no message.',
		token_budget: 'Turn stopped at the token limit, no message.',
		deadline: 'Turn stopped at the time limit, no message.',
		aborted: 'Turn interrupted.'
	};
	return (locale === 'it' ? it : en)[reason];
}
