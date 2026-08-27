/**
 * IL CATALOGO — solo nome, descrizione e JSON Schema: l'esecuzione sta in `executor.ts`.
 * Tetto di 14 tool, verificato da un test.
 *
 * Il prefisso `brand_` non è decorazione: gli harness Vercel (codex, claude-code, grok-build, pi)
 * portano builtin `ls`/`read`/`grep`/`write` propri, sul filesystem VERO della VM invece che
 * sull'albero logico del brand. Su quel nome duplicato codex esplode, grok-build rifiuta, pi
 * lascia vincere il primo — in silenzio. Rinominando i NOSTRI ogni harness resta montabile e il
 * modello ha entrambe le capacità nello stesso turno: per questo ogni descrizione qui sotto dice
 * esplicitamente "il brand, non la macchina".
 */
import type { ToolSpec } from '@anomalia/agent-kit';

export const BUILTIN_TOOLS: ToolSpec[] = [
	{
		name: 'brand_ls',
		description:
			"Elenca i file dell'albero del brand (studio, piano, post, artefatti) a un path — NON il filesystem della macchina, per quello c'è `shell`. Usalo per orientarti prima di leggere; recursive:true per l'albero intero.",
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path da elencare, default la radice' },
				recursive: { type: 'boolean', description: "Scende nell'albero invece di fermarsi al primo livello" }
			}
		}
	},
	{
		name: 'brand_read',
		description:
			"Legge per intero un file dell'albero del brand (studio, piano, post, artefatti) — NON il filesystem della macchina, per quello c'è `shell`. Non indovinare il contenuto: leggilo.",
		inputSchema: {
			type: 'object',
			properties: { path: { type: 'string' } },
			required: ['path']
		}
	},
	{
		name: 'brand_grep',
		description:
			"Cerca un pattern nei file dell'albero del brand (studio, piano, post, artefatti) — NON il filesystem della macchina, per quello c'è `shell`. Più economico di leggere tutto quando cerchi una cosa sola; path limita la ricerca a un sottoalbero.",
		inputSchema: {
			type: 'object',
			properties: {
				pattern: { type: 'string' },
				path: { type: 'string', description: 'Sottoalbero in cui cercare, default tutto' }
			},
			required: ['pattern']
		}
	},
	{
		name: 'brand_write',
		requiresMode: 'plan',
		description:
			"Scrive un file dove l'albero del brand lo consente (studio, piano, post, artefatti) — NON il filesystem della macchina, per quello c'è `shell`. Fallisce se il path non è scrivibile: non è un errore da nascondere, è un permesso.",
		inputSchema: {
			type: 'object',
			properties: { path: { type: 'string' }, content: { type: 'string' } },
			required: ['path', 'content']
		}
	},
	{
		name: 'query',
		description: "Legge dal database coi permessi dell'utente corrente. Usalo per dati strutturati (post, metriche); per file usa brand_ls/brand_read/brand_grep.",
		inputSchema: {
			type: 'object',
			properties: {
				table: { type: 'string' },
				columns: { type: 'array', items: { type: 'string' } },
				filters: { type: 'object' },
				limit: { type: 'number' }
			}
		}
	},
	{
		name: 'shell',
		requiresMode: 'agent',
		description:
			"Esegue un comando nella VM del brand (si accende da sola al primo uso). Rete CHIUSA: passano solo i registry dei pacchetti (npm, pip) — internet no. Un fetch verso un sito qualsiasi fallisce per firewall, non per guasto DNS: non riprovarlo, e per leggere il web usa i tool di lettura del brand invece della shell.",
		inputSchema: {
			type: 'object',
			properties: { command: { type: 'string' }, cwd: { type: 'string' } },
			required: ['command']
		}
	},
	{
		name: 'attach',
		description: 'Allega un file o un media alla chat, così resta visibile senza incollarne il contenuto nel testo.',
		inputSchema: {
			type: 'object',
			properties: { path: { type: 'string' }, media_id: { type: 'string' } }
		}
	},
	{
		name: 'remember',
		requiresMode: 'plan',
		description: 'Scrive un fatto in memoria durevole: sopravvive al turno e ai run successivi. Non per appunti temporanei del piano.',
		inputSchema: {
			type: 'object',
			properties: {
				content: { type: 'string' },
				path: { type: 'string', description: 'Sezione di memoria, default una nota generica' }
			},
			required: ['content']
		}
	},
	{
		name: 'reply',
		description: "L'atto esplicito di parlare all'utente: cosa esiste adesso (con gli id), cosa non è riuscito, cosa serve da lui. Il turno finisce SOLO qui o con ask_user — mai in silenzio dopo un tool.",
		terminal: true,
		inputSchema: {
			type: 'object',
			properties: {
				message: { type: 'string' },
				delivered: { type: 'array', items: { type: 'string' }, description: 'Id delle cose consegnate in questo turno' }
			},
			required: ['message']
		}
	},
	{
		name: 'ask_user',
		description: "Domanda bloccante: il run va in waiting_input e RESTA VIVO in attesa della risposta. Usalo solo quando non puoi procedere senza saperlo, non per confermare l'ovvio.",
		terminal: true,
		inputSchema: {
			type: 'object',
			properties: {
				question: { type: 'string' },
				options: { type: 'array', items: { type: 'string' } }
			},
			required: ['question']
		}
	},
	{
		name: 'plan',
		description: 'Dichiara il piano del turno per la UI. Facoltativo: non serve per turni di un solo passo.',
		inputSchema: {
			type: 'object',
			properties: { steps: { type: 'array', items: { type: 'string' } } },
			required: ['steps']
		}
	},
	{
		name: 'observe',
		description: "Scatta uno screenshot dello schermo grafico della VM del brand (desktop reale, non un'immagine finta). Accende il modo grafico da solo se non è già attivo — la primissima volta può volerci qualche minuto, e il risultato lo dice. Usalo prima di 'act' per vedere dove cliccare.",
		inputSchema: { type: 'object', properties: {} }
	},
	{
		name: 'act',
		requiresMode: 'agent',
		description: "Esegue fino a 24 azioni sullo schermo grafico della VM e torna uno screenshot aggiornato. Accende il modo grafico da solo se serve. kind:'click'/'move' vogliono x,y (pixel); 'type' vuole text; 'key' vuole key (es. 'Return', 'ctrl+l'); 'scroll' vuole amount (righe, negativo = verso l'alto); 'wait' vuole ms.",
		inputSchema: {
			type: 'object',
			properties: {
				actions: {
					type: 'array',
					maxItems: 24,
					items: {
						type: 'object',
						properties: {
							kind: { type: 'string', enum: ['click', 'move', 'type', 'key', 'scroll', 'wait'] },
							x: { type: 'number' },
							y: { type: 'number' },
							text: { type: 'string' },
							key: { type: 'string' },
							amount: { type: 'number' },
							ms: { type: 'number' }
						},
						required: ['kind']
					}
				}
			},
			required: ['actions']
		}
	}
];

/** I tool che chiudono il turno: reply parla, ask_user aspetta. Nessun altro può farlo. */
export const TERMINAL_TOOL_NAMES = BUILTIN_TOOLS.filter((t) => t.terminal).map((t) => t.name);
