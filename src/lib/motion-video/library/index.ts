/**
 * LA LIBRERIA DELLE ANIMAZIONI — il codice e il video, nella stessa cartella.
 *
 * COS'È. Una voce = una cartella `<sezione>/<voce>/` con dentro `source.tsx` (il modulo Remotion
 * intero, che compila e RENDERIZZA), `preview.mp4` (la prova che renderizza), `stills/` (i
 * fotogrammi nel momento del movimento) e `meta.json` (la riga di intento).
 *
 * PERCHÉ NON È IL RICETTARIO CON UN NOME NUOVO. `transitions-cookbook.ts` tiene il codice in
 * stringhe dentro un file TypeScript: si legge male, non si renderizza, e nessuno può guardarlo.
 * Il risultato misurato il 22/8/2026 su 24 sorgenti in produzione: 1005 righe di ricettario nel
 * prompt a ogni passo, e UNA ricetta su undici usata davvero (`slide()`, 6 sorgenti su 24). Le
 * altre dieci non compaiono mai. Peggio: le uniche due apparizioni di `fade` e `slide` come
 * import diretto sono i DUE RENDER FALLITI con `(0, esm_namespaceObject.slide) is not a function`
 * — la prosa nel prompt non veniva solo saltata, insegnava l'import sbagliato.
 *
 * Qui il `source.tsx` è un file vero: lo apre l'agente con `read_file`, lo apre il proprietario
 * nel bucket, e lo cuoce `npm run bake:motion-library` — che è la stessa VM del render di
 * produzione. Una voce entra solo dopo aver prodotto un MP4, mai dopo aver compilato: i due
 * schianti in produzione avevano superato il compilatore.
 *
 * LE SEZIONI SONO LA DOMANDA, NON LA TECNICA. Un agente non cerca `clockWipe`: cerca «come passo
 * da una scena all'altra in modo che sembri violento». Tre sezioni, e un `ls` deve già dimezzare
 * la scelta.
 *
 * ATTENZIONE AL PESO: `?raw` inlinea ogni sorgente nel bundle di chi importa questo file. Oggi lo
 * importano solo il registro dei file dell'agente (server) e i test. Non importarlo da codice che
 * finisce nel browser.
 */

/** Le tre domande. La riga di sezione è l'unica cosa che si paga a ogni passo, quindi è corta. */
export const LIBRARY_SECTIONS = {
	transitions: 'come passo da questa scena alla prossima',
	text: 'come faccio arrivare una frase, parola per parola o riga per riga',
	posts: 'come trasformo un post o un carosello già approvato in movimento',
	// Le card sono FERME in un volume: si muove chi guarda. È la differenza fra queste voci e
	// `posts/`, dove a muoversi sono le card e la camera sta dov'è — e la ragione per cui una
	// sezione sola le avrebbe rese indistinguibili nell'indice.
	space: 'come muovo la camera dentro uno spazio in cui le card stanno ferme'
} as const;

export type LibrarySection = keyof typeof LIBRARY_SECTIONS;

export type MotionLibraryEntry = {
	section: LibrarySection;
	slug: string;
	/** `transitions/1-slide-up` — la chiave con cui si nomina la voce ovunque. */
	id: string;
	/** Una riga: a quale domanda risponde. L'indice si legge per intento, non per nome. */
	intent: string;
	/** Il modulo Remotion intero. */
	code: string;
	/** I fotogrammi cotti, per numero. */
	stills: number[];
	/** Il percorso della cartella nel repo, per chi vuole guardare il video. */
	dir: string;
};

type Meta = { intent: string; stills?: number[] };

const SOURCES = import.meta.glob('./*/*/source.tsx', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const METAS = import.meta.glob('./*/*/meta.json', { eager: true }) as Record<
	string,
	{ default: Meta } | Meta
>;

function parse(path: string): { section: LibrarySection; slug: string } | null {
	const m = /^\.\/([^/]+)\/([^/]+)\/source\.tsx$/.exec(path);
	if (!m || !(m[1] in LIBRARY_SECTIONS)) return null;
	return { section: m[1] as LibrarySection, slug: m[2] };
}

export const MOTION_LIBRARY: readonly MotionLibraryEntry[] = Object.entries(SOURCES)
	.map(([path, code]) => {
		const p = parse(path);
		if (!p) return null;
		const raw = METAS[path.replace('source.tsx', 'meta.json')];
		const meta = (raw && 'default' in raw ? raw.default : raw) as Meta | undefined;
		if (!meta?.intent) return null;
		return {
			section: p.section,
			slug: p.slug,
			id: `${p.section}/${p.slug}`,
			intent: meta.intent,
			code,
			stills: meta.stills ?? [],
			dir: `src/lib/motion-video/library/${p.section}/${p.slug}`
		} satisfies MotionLibraryEntry;
	})
	.filter((e): e is MotionLibraryEntry => e !== null)
	.sort((a, b) => a.id.localeCompare(b.id));

/**
 * L'INDICE PER INTENTO — la regola che lo governa: se dopo averlo letto bisogna aprire più di
 * DUE voci per scegliere, la riga è scritta male.
 *
 * Sta dentro `how/MAKE-MOTION-VIDEO.md`, che chi scrive un sorgente motion deve leggere comunque:
 * quindi l'indice non costa nessun passo in più, e il corpo di una voce si paga solo quando si
 * apre davvero. Il conto contro il vecchio ricettario: 1005 righe in prompt a OGNI passo prima,
 * ~20 righe di indice dentro una lettura già obbligatoria adesso.
 */
export function motionLibraryIndex(): string {
	const bySection = (Object.keys(LIBRARY_SECTIONS) as LibrarySection[]).map((s) => {
		const rows = MOTION_LIBRARY.filter((e) => e.section === s).map(
			(e) => `- \`${libraryFilePath(e)}\` — ${e.intent}`
		);
		return `**${s}/** — ${LIBRARY_SECTIONS[s]}\n${rows.join('\n')}`;
	});
	// La riga d'istruzione vive sulla stessa riga del primo header di sezione, non su una riga a sé:
	// `space/` ha portato le sezioni a quattro, e a riga propria l'indice sfondava il tetto di una
	// riga sola. Stesso testo, un carattere di andata a capo in meno.
	const [firstSection, ...restSections] = bySection;
	return [
		`ANIMATION LIBRARY — ogni voce è un modulo Remotion intero che COMPILA e RENDERIZZA, con il suo MP4 accanto al codice, cotto nella stessa VM del render di produzione. Aprine UNA con read_file, copiala e adattala: copy, palette, coordinate. Non riscrivere il meccanismo. ${firstSection}`,
		...restSections
	].join('\n\n');
}

/** Il path con cui l'agente apre la voce. */
export function libraryFilePath(e: MotionLibraryEntry): string {
	return `how/motion/library/${e.id}.md`;
}

/** Il corpo del file che l'agente legge: intento, dove sta il video, e il codice. */
export function libraryFileBody(e: MotionLibraryEntry): string {
	const stills = e.stills.length
		? `\nFotogrammi nel momento del movimento: ${e.stills.map((f) => `${e.dir}/stills/f-${String(f).padStart(4, '0')}.png`).join(', ')}`
		: '';
	return `# ${e.id}

${e.intent}

Video renderizzato: \`${e.dir}/preview.mp4\` (cotto con \`npm run bake:motion-library\`, stessa VM del render di produzione).${stills}

\`\`\`tsx
${e.code}
\`\`\``;
}
