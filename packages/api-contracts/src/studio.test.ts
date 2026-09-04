import { describe, expect, it } from 'vitest';
import { pathFor, statusForFailure } from './index';
import {
  CREATE_PRODUCT,
  DELETE_PRODUCT,
  GET_BIO,
  SET_BIO,
  UPDATE_COMPETITOR,
  UPDATE_PERSON,
  UPDATE_PRODUCT
} from './studio';

const STUDIO_WRITES = [
  CREATE_PRODUCT,
  UPDATE_PRODUCT,
  DELETE_PRODUCT,
  UPDATE_PERSON,
  UPDATE_COMPETITOR,
  GET_BIO,
  SET_BIO
];

describe('i contratti dello studio', () => {
  it('crea un prodotto solo con un titolo', () => {
    expect(CREATE_PRODUCT.input.safeParse({ title: 'Blend Milano' }).success).toBe(true);
    expect(CREATE_PRODUCT.input.safeParse({ pricing: '18,50 €' }).success).toBe(false);
    expect(CREATE_PRODUCT.input.safeParse({ title: '' }).success).toBe(false);
  });

  it('non lascia scrivere il brand di appartenenza di una riga', () => {
    for (const endpoint of STUDIO_WRITES) {
      expect(endpoint.input.safeParse({ id: 'r1', title: 'x', brand_id: 'brand-2' }).success,
        endpoint.tool
      ).toBe(false);
    }
  });

  it('modifica un prodotto con un campo solo, senza doverli ripetere tutti', () => {
    expect(UPDATE_PRODUCT.input.safeParse({ id: 'p1', pricing: '19,90 €' }).success).toBe(true);
    expect(UPDATE_PRODUCT.input.safeParse({ pricing: '19,90 €' }).success).toBe(false);
  });

  it('una modifica di persona non tocca consenso, tipo o foto', () => {
    for (const forbidden of [{ consent: true }, { kind: 'ai' }, { images: [] }, { consent_source: 'owner_attested' }]) {
      expect(
        UPDATE_PERSON.input.safeParse({ id: 'per1', ...forbidden }).success,
        Object.keys(forbidden)[0]
      ).toBe(false);
    }
    expect(UPDATE_PERSON.input.safeParse({ id: 'per1', role: 'Co-fondatrice' }).success).toBe(true);
  });

  it('un competitor è direct o indirect, come dice il CHECK del database', () => {
    expect(UPDATE_COMPETITOR.input.safeParse({ id: 'c1', kind: 'indirect' }).success).toBe(true);
    expect(UPDATE_COMPETITOR.input.safeParse({ id: 'c1', kind: 'laterale' }).success).toBe(false);
  });

  it('ogni scrittura su una riga dichiara il 404 e nessuna lo lascia diventare un 500', () => {
    for (const endpoint of [UPDATE_PRODUCT, DELETE_PRODUCT, UPDATE_PERSON, UPDATE_COMPETITOR]) {
      expect(statusForFailure(endpoint, 'not_found'), endpoint.tool).toBe(404);
    }
  });

  it('solo la cancellazione si dichiara distruttiva', () => {
    expect(DELETE_PRODUCT.destructive).toBe(true);
    for (const endpoint of STUDIO_WRITES.filter((e) => e.tool !== 'delete_product')) {
      expect(endpoint.destructive, endpoint.tool).toBe(false);
    }
  });

  it('ogni contratto indirizza il percorso REST che esiste già', () => {
    expect(pathFor(CREATE_PRODUCT, 'demo')).toBe('/api/v1/brands/demo/studio/products');
    expect(pathFor(UPDATE_PRODUCT, 'demo', 'p1')).toBe('/api/v1/brands/demo/products/p1');
    expect(pathFor(DELETE_PRODUCT, 'demo', 'p1')).toBe('/api/v1/brands/demo/products/p1');
    expect(pathFor(UPDATE_PERSON, 'demo', 'per1')).toBe('/api/v1/brands/demo/people/per1');
    expect(pathFor(UPDATE_COMPETITOR, 'demo', 'c1')).toBe(
      '/api/v1/brands/demo/studio/competitors/c1'
    );
    expect(pathFor(GET_BIO, 'demo')).toBe('/api/v1/brands/demo/bio');
    expect(pathFor(SET_BIO, 'demo')).toBe('/api/v1/brands/demo/bio');
  });

  it('il link in bio si legge senza argomenti e si svuota con la stringa vuota', () => {
    expect(GET_BIO.input.safeParse({}).success).toBe(true);
    expect(SET_BIO.input.safeParse({ bio_url: '' }).success).toBe(true);
    expect(SET_BIO.input.safeParse({}).success).toBe(false);
  });
});
