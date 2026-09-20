/**
 * Il budget di un run non è una preferenza: è il muro della funzione che lo esegue.
 *
 * Un budget più lungo del muro non allunga il run — lo fa uccidere a metà, e la riga resta
 * `running` finché il reaper la chiude come «heartbeat lost». È così che si presenta un job
 * troppo ambizioso per il posto in cui gira: non come un timeout, come un guasto del processo.
 */
import { describe, expect, it } from 'vitest';
import { AUTOPILOT_RUN_BUDGET_MS } from './autopilot-thresholds';
import { CHAT_MAX_DURATION_MS } from './chat/turn-limits';

describe('AUTOPILOT_RUN_BUDGET_MS', () => {
	it('sta dentro il muro della funzione, con spazio per chiudere la riga', () => {
		expect(AUTOPILOT_RUN_BUDGET_MS).toBeLessThanOrEqual(CHAT_MAX_DURATION_MS - 60_000);
	});
});
