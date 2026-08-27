import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { safeSecretEqual } from './secret-compare';

export function cronAuthorized(request: Request): boolean {
  if (dev) return true;
  const bearer = request.headers.get('authorization');
  if (env.CRON_SECRET && bearer?.startsWith('Bearer ') && safeSecretEqual(bearer.slice(7), env.CRON_SECRET)) return true;
  const provided = request.headers.get('x-autopilot-secret');
  if (env.AUTOPILOT_SECRET && safeSecretEqual(provided, env.AUTOPILOT_SECRET)) return true;
  return false;
}
