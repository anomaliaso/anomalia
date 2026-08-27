/**
 * LA CHIAVE DEL DESKTOP REMOTO — l'unica cosa fra un URL pubblico e la macchina del brand.
 *
 * `sandbox.domain(porta)` è raggiungibile da chiunque: non c'è sessione, non c'è cookie, non c'è
 * un nostro middleware davanti. Quello che c'è è l'autenticazione di VNC, quindi la password non è
 * una comodità — è il confine.
 *
 * Derivata e non conservata: niente colonna nuova, niente migration da applicare a mano (che qui
 * i deploy non eseguono), e nessuna password a riposo nel database. Il segreto dell'app la
 * ricostruisce identica a ogni chiamata, e cambiarlo invalida tutti i desktop già aperti.
 */
import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * L'autenticazione classica di VNC guarda 8 caratteri: quelli oltre non li legge nessuno, e una
 * password più lunga darebbe la falsa impressione di una chiave che non esiste. 8 caratteri
 * alfanumerici da un HMAC sono ~47 bit: fuori portata per un attacco a distanza su una VM che
 * vive un quarto d'ora.
 */
export const VNC_PASSWORD_LEN = 8;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function desktopPassword(brandId: string, secret: string): string {
	if (!secret) {
		throw new Error('APP_SECRET mancante: senza segreto la password del desktop sarebbe indovinabile');
	}
	const digest = createHmac('sha256', secret).update(`desktop:${brandId}`).digest();
	let out = '';
	for (let i = 0; i < VNC_PASSWORD_LEN; i++) {
		out += ALPHABET[digest[i] % ALPHABET.length];
	}
	return out;
}

/**
 * `autoconnect` e `resize=scale` perché chi apre il pannello vuole lo schermo, non il modulo di
 * connessione di noVNC: il desktop è già acceso quando questo URL viene costruito.
 */
export function desktopUrl(domain: string, password: string): string {
	const q = new URLSearchParams({ autoconnect: '1', resize: 'scale', password });
	return `${domain.replace(/\/+$/, '')}/vnc.html?${q.toString()}`;
}


/**
 * PUBBLICA LA MACCHINA COME ACCESA, per l'agente che l'ha chiesta.
 *
 * Il pannello legge `agent_computers` per sapere se offrire lo schermo: senza questa riga l'utente
 * apre il desktop e la card continua a dire «dorme». Una riga per (brand, agente) — lo schermo di
 * una VM è uno solo, quindi la macchina è dell'agente.
 *
 * Il service role e non la sessione: `agent_computers` è in sola lettura per i membri (0217).
 */
export async function publishComputerRunning(
	db: SupabaseClient,
	brandId: string,
	refName: string,
	agentId?: string
): Promise<void> {
	const stamp = new Date().toISOString();
	const row = { state: 'running', provider_ref: refName, last_touch_at: stamp, updated_at: stamp };
	const { data, error } = await db
		.from('agent_computers')
		.update(row)
		.eq('brand_id', brandId)
		.eq('agent_id', agentId ?? '')
		.select('id');
	if (error) throw new Error(`computer: pubblicazione fallita — ${error.message}`);
	if (data && data.length > 0) return;
	const { error: insErr } = await db
		.from('agent_computers')
		.insert({ brand_id: brandId, agent_id: agentId ?? '', ...row });
	if (insErr) throw new Error(`computer: creazione riga fallita — ${insErr.message}`);
}
