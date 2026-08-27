/** Una mappa tipata per famiglia di adapter: non registrato = errore, mai un undefined a runtime. */
export class Registry<T> {
	private readonly items = new Map<string, T>();

	constructor(private readonly family: string) {}

	register(id: string, item: T): void {
		if (this.items.has(id)) throw new Error(`${this.family}: '${id}' registrato due volte`);
		this.items.set(id, item);
	}

	resolve(id: string): T {
		const item = this.items.get(id);
		if (!item) {
			const known = [...this.items.keys()].join(', ') || '(vuoto)';
			throw new Error(`${this.family}: '${id}' non registrato — disponibili: ${known}`);
		}
		return item;
	}

	ids(): string[] {
		return [...this.items.keys()];
	}
}
