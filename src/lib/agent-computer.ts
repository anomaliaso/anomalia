/**
 * DI CHI È IL COMPUTER — una regola sola, letta dal pannello e da chi monta la sandbox.
 *
 * Lo schermo `:1` è uno per macchina e la macchina è dell'agente (`sandboxName`), quindi il
 * pannello e il turno devono nominare lo STESSO agente: quando divergevano, l'utente guardava il
 * computer di un agente mentre il turno lavorava su un'altra VM, e lo schermo restava vuoto per
 * tutta la ricerca.
 *
 * Un agente custom è un'identità a sé: ha la sua macchina, non quella dell'hub che lo ospita.
 */
export function computerOwner(
	customAgentId?: string | null,
	agentId?: string | null
): string | undefined {
	return customAgentId || agentId || undefined;
}
