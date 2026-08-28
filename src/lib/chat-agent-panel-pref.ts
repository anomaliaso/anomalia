/**
 * LA PREFERENZA DEL PANNELLO AGENTE, PER AGENTE.
 *
 * `agentPanelOpen` era uno `$state(false)` locale alla pagina del thread: ogni navigazione lo
 * riportava chiuso, e chi teneva il pannello aperto su un agente lo ritrovava chiuso a ogni
 * click dalla sidebar. La preferenza segue l'AGENTE (custom_agent_id ?? agent), non la scheda:
 * è il pannello di quel mestiere, e riapre dov'era rimasto.
 *
 * Chiuso = chiave assente (il default è già chiuso): nessuna riga "0" che nessuno legge.
 */
const KEY_PREFIX = 'anomalia:chat-agent-panel';

export function agentPanelKey(brandSlug: string, agent: string | null | undefined): string {
	return `${KEY_PREFIX}:${brandSlug}:${agent ?? 'none'}`;
}

export function readAgentPanelPref(brandSlug: string, agent: string | null | undefined): boolean {
	if (typeof localStorage === 'undefined') return false;
	try {
		return localStorage.getItem(agentPanelKey(brandSlug, agent)) === '1';
	} catch {
		return false;
	}
}

export function writeAgentPanelPref(brandSlug: string, agent: string | null | undefined, open: boolean): void {
	if (typeof localStorage === 'undefined') return;
	try {
		if (open) localStorage.setItem(agentPanelKey(brandSlug, agent), '1');
		else localStorage.removeItem(agentPanelKey(brandSlug, agent));
	} catch {
		/* quota / private mode: la preferenza non vale un errore */
	}
}
