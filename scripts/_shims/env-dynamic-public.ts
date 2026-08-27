// Shim for $env/dynamic/public under vite-node.
export const env: Record<string, string | undefined> = process.env;
