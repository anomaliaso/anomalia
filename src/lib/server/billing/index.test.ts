import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

// Il modulo `anomalia-provider` non esiste nel build aperto: si dichiara assente lanciando. Nel
// bundle esbuild del worker il corpo di un modulo gira UNA volta sola — dopo il primo throw (che
// il catch qui sotto assorbe) ogni import successivo restituisce un namespace vuoto invece di
// rilanciare, quindi `anomaliaBillingProvider` arriva `undefined`.
vi.mock('./anomalia-provider', () => ({ anomaliaBillingProvider: undefined }));

describe('billingProvider()', () => {
	it('ricade su open quando il modulo del provider non esporta niente', async () => {
		const { billingProvider } = await import('./index');
		const provider = await billingProvider();

		expect(provider.kind).toBe('open');
		await expect(provider.gate('credits', { brandId: 'brand-1' })).resolves.toBeUndefined();
	});
});
