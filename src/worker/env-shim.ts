/**
 * Stand-in for `$env/dynamic/private` outside SvelteKit.
 *
 * Every one of the ~70 server modules reads its configuration through the same single import,
 * `import { env } from '$env/dynamic/private'`, and SvelteKit's version of that module is just a
 * lazily-populated view over `process.env`. So porting the whole server library to a plain Node
 * process costs exactly one build alias pointing here — not seventy edits.
 */
export const env: Record<string, string | undefined> = process.env;
