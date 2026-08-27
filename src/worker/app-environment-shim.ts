/**
 * Stand-in for `$app/environment` outside SvelteKit.
 *
 * Only `dev` is imported by the server library (`chat/queue.ts`, to arm a setInterval fallback for
 * the cron that does not exist under `npm run dev`). The worker has its own loop instead of a
 * cron, so that fallback would be redundant here even if it could run — always false, never dev.
 */
export const dev = false;
export const browser = false;
export const building = false;
export const version = 'worker';
