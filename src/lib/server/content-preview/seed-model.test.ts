import { describe, expect, it } from 'vitest';
import { weekFromModel } from './seed-model';

describe('weekFromModel', () => {
	it('porta a zero la settimana che il modello conta da uno', () => {
		expect(weekFromModel(1)).toBe(0);
		expect(weekFromModel(2)).toBe(1);
	});

	it('non inventa niente per chi non la porta', () => {
		expect(weekFromModel(undefined)).toBeUndefined();
		expect(weekFromModel('non un numero')).toBeUndefined();
	});

	it('non scende sotto zero se il modello conta già da zero', () => {
		expect(weekFromModel(0)).toBe(0);
	});
});
