import { describe, expect, it } from 'vitest';
import { pathFor } from './index';
import { ADS_ACTION } from './ads';

describe('il contratto delle azioni sugli annunci', () => {
  it('porta i campi propri dell’azione dentro extra, senza inventarne di nuovi', () => {
    expect(ADS_ACTION.input.safeParse({ action: 'sync' }).success).toBe(true);
    expect(
      ADS_ACTION.input.safeParse({ action: 'toggle', campaignId: 'c1', extra: { next: 'paused' } })
        .success
    ).toBe(true);
    expect(ADS_ACTION.input.safeParse({ action: 'toggle', next: 'paused' }).success).toBe(false);
    expect(ADS_ACTION.input.safeParse({ action: '' }).success).toBe(false);
  });

  it('si dichiara distruttivo: spegne e cancella campagne vere', () => {
    expect(ADS_ACTION.destructive).toBe(true);
    expect(pathFor(ADS_ACTION, 'demo')).toBe('/api/v1/brands/demo/ads');
  });
});
