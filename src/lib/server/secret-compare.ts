import crypto from 'node:crypto';

/**
 * Timing-safe string comparison for cron secrets. The plain `===` comparison in the tick
 * routes leaks timing information over the wire; this digests both sides first so length
 * and byte position don't matter. Cheap hardening for all the /api/v1 tick routes.
 */
export function safeSecretEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
