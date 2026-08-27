import { describe, expect, it } from 'vitest';
import { VNC_PASSWORD_LEN, desktopPassword, desktopUrl, publishComputerRunning } from './agent-desktop';

const SECRET = 'un-segreto-di-prova-lungo-abbastanza';

describe('desktopPassword', () => {
	/**
	 * DEVE essere stabile: la password vive in due posti che non si parlano — il file `-rfbauth`
	 * dentro la VM e l'URL che diamo al browser. Se cambiasse a ogni chiamata, il secondo utente
	 * che apre il desktop troverebbe un login che rifiuta la password appena ricevuta.
	 */
	it('stessa coppia brand+segreto, stessa password', () => {
		expect(desktopPassword('brand-1', SECRET)).toBe(desktopPassword('brand-1', SECRET));
	});

	it('brand diversi non condividono la password: un membro non entra nella VM di un altro brand', () => {
		expect(desktopPassword('brand-1', SECRET)).not.toBe(desktopPassword('brand-2', SECRET));
	});

	it('cambiare il segreto invalida ogni desktop già aperto', () => {
		expect(desktopPassword('brand-1', SECRET)).not.toBe(desktopPassword('brand-1', `${SECRET}-2`));
	});

	/** VNC autentica su 8 caratteri: più lunga la tronca in silenzio, e la password non entrerebbe. */
	it('sta negli 8 caratteri che VNC guarda, e sono tutti stampabili', () => {
		const pw = desktopPassword('brand-1', SECRET);
		expect(pw).toHaveLength(VNC_PASSWORD_LEN);
		expect(pw).toMatch(/^[A-Za-z0-9]+$/);
	});

	/** Senza segreto una password derivata sarebbe indovinabile: e l'URL della porta è pubblico. */
	it('senza segreto non inventa una password: fallisce', () => {
		expect(() => desktopPassword('brand-1', '')).toThrow();
	});
});

describe('desktopUrl', () => {
	it('punta al client noVNC servito dalla VM e si connette da solo', () => {
		const url = desktopUrl('https://sb-abc123.vercel.run', 'pw123456');
		expect(url.startsWith('https://sb-abc123.vercel.run/vnc.html?')).toBe(true);
		expect(url).toContain('autoconnect=1');
		expect(url).toContain('password=pw123456');
	});

	it('la password viaggia codificata: un carattere speciale non deve rompere la query', () => {
		expect(desktopUrl('https://x.vercel.run', 'a+b&c=d')).toContain('password=a%2Bb%26c%3Dd');
	});
});


/**
 * La riga che il pannello legge per sapere se offrire lo schermo. Una per (brand, agente): la VM
 * ha un display solo, quindi due agenti non possono condividerla senza scriversi addosso.
 */
describe('publishComputerRunning', () => {
	function fakeDb(rows: Array<Record<string, unknown>>) {
		const calls: Array<Record<string, unknown>> = [];
		const builder = (table: string) => {
			let payload: Record<string, unknown> | null = null;
			let op: 'update' | 'insert' = 'update';
			const filters: Array<[string, unknown]> = [];
			const api = {
				update(p: Record<string, unknown>) { op = 'update'; payload = p; return api; },
				insert(p: Record<string, unknown>) { op = 'insert'; payload = p; calls.push({ table, op, ...p }); rows.push({ ...p }); return Promise.resolve({ error: null }); },
				eq(col: string, val: unknown) { filters.push([col, val]); return api; },
				select() {
					const hit = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
					for (const r of hit) Object.assign(r, payload);
					calls.push({ table, op, filters });
					return Promise.resolve({ data: hit.map(() => ({ id: 'x' })), error: null });
				}
			};
			return api;
		};
		return { db: { from: builder } as never, rows, calls };
	}

	it('aggiorna la riga di QUEL agente, non quella del brand', async () => {
		const { db, rows } = fakeDb([
			{ brand_id: 'b1', agent_id: '', state: 'stopped', provider_ref: 'vm-brand' },
			{ brand_id: 'b1', agent_id: 'motion', state: 'stopped', provider_ref: null }
		]);
		await publishComputerRunning(db, 'b1', 'vm-motion', 'motion');
		expect(rows.find((r) => r.agent_id === 'motion')?.state).toBe('running');
		expect(rows.find((r) => r.agent_id === '')?.state).toBe('stopped');
	});

	it('se quell’agente non ha una riga se la crea, invece di rubare quella di un altro', async () => {
		const { db, rows } = fakeDb([{ brand_id: 'b1', agent_id: '', state: 'running', provider_ref: 'vm-brand' }]);
		await publishComputerRunning(db, 'b1', 'vm-web', 'web');
		expect(rows).toHaveLength(2);
		expect(rows.find((r) => r.agent_id === 'web')?.provider_ref).toBe('vm-web');
	});
});
