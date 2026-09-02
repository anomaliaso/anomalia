/**
 * Un test non sveglia nessuno. La suite gira con il `.env` di chi la lancia — chiavi vere di
 * Sentry, PostHog e posta — e `reportChatError` spediva davvero: ops ha ricevuto segnalazioni con
 * dentro `thread: t-retry-no-sandbox` e uno stack che punta a un file di test. Il rumore non è il
 * danno peggiore: è che una segnalazione finta rende sospette anche quelle vere.
 *
 * La guardia sta nella sorgente e non nei mock dei singoli file, o il prossimo test che scorda il
 * mock ricomincia a spedire — ed è esattamente com'è successo.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/sveltekit', () => ({ captureException: (...a: unknown[]) => captureException(...a) }));
const sendEmail = vi.fn(async () => undefined);
vi.mock('$lib/server/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

const { reportChatError } = await import('./report-error');

describe('reportChatError sotto test', () => {
	beforeEach(() => {
		captureException.mockClear();
		sendEmail.mockClear();
		vi.restoreAllMocks();
	});

	it('non sveglia Sentry', async () => {
		await reportChatError(null, new Error('boom'), { kind: 'agent_kit_stream', notify: 'all' });
		expect(captureException).not.toHaveBeenCalled();
	});

	it('non manda la mail a ops', async () => {
		await reportChatError(null, new Error('boom'), { kind: 'agent_kit_stream', notify: 'all' });
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it('non chiama nessun servizio esterno', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		await reportChatError(null, new Error('boom'), { kind: 'agent_kit_stream', notify: 'all' });
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
