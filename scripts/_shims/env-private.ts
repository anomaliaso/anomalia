import { readFileSync } from 'node:fs';
try {
  for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env */ }
export const env = process.env as Record<string, string | undefined>;
