/**
 * IL MODELLO DELL'AGENTE MOTION, in un punto solo.
 *
 * Era `google(geminiFlash())` costruito a mano in quattro punti del turno — la chiamata, i
 * delegati, i tool del muro e le righe di `ai_calls`. Due cose lo hanno smontato lo stesso
 * giorno: `@ai-sdk/google@3` risolve `provider-utils@4` mentre `ai@7` normalizza il prompt con
 * la 5, quindi ogni immagine allegata arrivava a Gemini come oggetto invece che base64 e il
 * turno moriva in un secondo; e Gemini era anche la voce di spesa piu` grossa del prodotto.
 *
 * Ora il modello esce dal provider attivo dell'harness, lo stesso che serve i turni di chat: un
 * posto solo decide su cosa gira il prodotto. `MOTION_VIDEO_MODEL` resta la scappatoia
 * esplicita, e senza nessun provider si cade sul centralino (`llm`) — dichiarandolo, perche` una riga di
 * `ai_calls` che mente sul provider e` un conto che non torna.
 */
import { env } from '$env/dynamic/private';
import type { LanguageModel } from 'ai';
import { craftAgentModel } from '$lib/server/craft-model';

export type MotionAgentModel = {
	model: LanguageModel;
	modelId: string;
	provider: 'gemini' | 'kie' | 'openrouter' | 'opencode' | 'llm';
};

/**
 * IL TIER DI QUESTO MESTIERE.
 *
 * Non e` quello veloce, e c'e` una misura dietro: il 26/8 il modello fast del provider
 * (`glm-5.3-flash`) ha girato 23 minuti su un brief e non ha scritto una riga di sorgente —
 * 247k token in ingresso, 77k in uscita di cui 73k di ragionamento, zero lavoro. Scrivere una
 * composizione Remotion e` la cosa piu` difficile che il prodotto chiede a un modello, e la chat
 * puo` restare sul veloce mentre questo no.
 */
export function motionAgentModel(): MotionAgentModel {
	// La fabbrica è condivisa (craft-model.ts): stessa misura delle rese UGC, un posto solo
	// che decide su cosa gira una resa. Il fallback sul centralino resta dichiarato.
	return craftAgentModel({ envModel: env.MOTION_VIDEO_MODEL });
}
