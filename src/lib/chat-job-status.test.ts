import { describe, expect, it } from 'vitest';
import { CHAT_JOB_STATUS, isChatJobLive, isChatJobSettled } from './chat-job-status';

describe('gli stati di chat_jobs dicono di CHI e` il lavoro', () => {
	it('pending e running sono entrambi vivi, e sono cose diverse', () => {
		// pending = nessuno lo esegue, il drain lo reclama. running = qualcuno lo sta gia` facendo.
		expect(isChatJobLive(CHAT_JOB_STATUS.pending)).toBe(true);
		expect(isChatJobLive(CHAT_JOB_STATUS.running)).toBe(true);
		expect(CHAT_JOB_STATUS.pending).not.toBe(CHAT_JOB_STATUS.running);
	});

	it('done, failed e cancelled sono chiuse: la UI smette di mostrarle vive', () => {
		for (const s of [CHAT_JOB_STATUS.done, CHAT_JOB_STATUS.failed, CHAT_JOB_STATUS.cancelled]) {
			expect(isChatJobSettled(s)).toBe(true);
			expect(isChatJobLive(s)).toBe(false);
		}
	});

	it('uno stato sconosciuto non e` ne` vivo ne` chiuso: non si indovina', () => {
		expect(isChatJobLive('boh')).toBe(false);
		expect(isChatJobSettled(undefined)).toBe(false);
	});
});
