/**
 * La storia riparicata porta `providerOptions`/`providerMetadata` con gli `itemId` della
 * risposta precedente: il provider Responses li ritraduce in `item_reference`, che kie
 * rifiuta con un 422 («unknown item type "item_reference"»). La storia riparte pulita:
 * il contenuto resta, i riferimenti no.
 *
 * LE PARTI IMMAGINE SOPRAVVIVONO AL GIRO: un `URL` oggetto attraversa Object.entries
 * come un oggetto vuoto e l'adattatore pi lo scarta in silenzio — il modello riceve solo
 * il testo `[attached: url]`. Qui l'URL si conserva (come stringa https, che
 * `extractUserImages` scarica).
 */
export function stripProviderRefs<T>(value: T): T {
	if (Array.isArray(value)) return value.map(stripProviderRefs) as T;
	if (value instanceof URL) return value.toString() as T;
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			if (k === 'providerOptions' || k === 'providerMetadata') continue;
			out[k] = stripProviderRefs(v);
		}
		return out as T;
	}
	return value;
}

/**
 * IL RILANCIO (verdetto, anti-ripetizione) appende un messaggio utente testuale a una catena
 * in cui le immagini stanno su un turno PRECEDENTE: l'harness collassa i messaggi all'ULTIMO
 * turno utente, così le immagini non arrivano e l'agente smentisce («l'immagine non mi è mai
 * arrivata») dopo averla vista. Il messaggio di continuazione porta con sé le parti immagine
 * dell'ultimo turno utente che le ha.
 */
export function carryImagesToContinuation(messages: unknown[], prompt: string): unknown {
	const images: unknown[] = [];
	for (const m of messages) {
		const rec = m as { role?: string; content?: unknown };
		if (rec?.role !== 'user' || !Array.isArray(rec.content)) continue;
		for (const part of rec.content as Array<{ type?: string }>) {
			if (part?.type === 'image') images.push(part);
		}
	}
	if (!images.length) return { role: 'user', content: prompt };
	return { role: 'user', content: [{ type: 'text', text: prompt }, ...images] };
}
