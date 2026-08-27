// Shim for $env/dynamic/private under vite-node — reads process.env at runtime.
export const env: Record<string, string | undefined> = process.env;
