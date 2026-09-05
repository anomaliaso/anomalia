import { describe, expect, it } from 'vitest';
import { safeProviderReason } from './provider-reason';

describe('il motivo del fornitore prima di ripassarlo', () => {
  it('taglia la query string, dove vive il token di firma', () => {
    const out = safeProviderReason(
      'Invalid reference URL: https://x.supabase.co/storage/v1/object/sign/media/a.png?token=eyJhbGciOi.SECRET is unreachable'
    );

    expect(out).toContain('https://x.supabase.co/storage/v1/object/sign/media/a.png');
    // Il pezzo che non deve finire nel log di un cliente.
    expect(out).not.toContain('token=');
    expect(out).not.toContain('SECRET');
  });

  it('tiene l URL: sapere QUALE riferimento e stato rifiutato e meta della diagnosi', () => {
    const out = safeProviderReason('Localhost URLs are not allowed: http://localhost:8000/a.png');

    expect(out).toBe('Localhost URLs are not allowed: http://localhost:8000/a.png');
  });

  it('taglia piu di un URL nello stesso messaggio', () => {
    const out = safeProviderReason('bad https://a/x?sig=1 and https://b/y?sig=2');

    expect(out).toBe('bad https://a/x and https://b/y');
  });

  it('mette un tetto alla lunghezza', () => {
    const out = safeProviderReason('x'.repeat(900))!;

    expect(out.length).toBeLessThanOrEqual(401);
    expect(out.endsWith('…')).toBe(true);
  });

  it('un motivo vuoto resta assente, non diventa una stringa vuota', () => {
    expect(safeProviderReason('')).toBeUndefined();
    expect(safeProviderReason(null)).toBeUndefined();
    expect(safeProviderReason('   ')).toBeUndefined();
  });
});
