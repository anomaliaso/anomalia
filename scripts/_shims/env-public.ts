import './env-private';
export const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => k.startsWith('PUBLIC_'))
) as Record<string, string | undefined>;
