import * as Sentry from '@sentry/sveltekit';

function report(reason: string, err: unknown) {
	const message = err instanceof Error ? err.message : String(err);
	console.error(`[swallowed] ${reason}:`, message);
	Sentry.captureException(err instanceof Error ? err : new Error(`${reason}: ${message}`));
}

export function swallow(reason: string): (err: unknown) => void;
export function swallow(reason: string, err: unknown): void;
export function swallow(reason: string, err?: unknown): void | ((err: unknown) => void) {
	if (err === undefined) return (caught) => report(reason, caught);
	report(reason, err);
}
