// IndexNow verification matcher: a plain hex key file at the site root, e.g. /a1b2c3… .txt.
// SvelteKit strips the route's literal suffix before matching, so the param arrives as pure hex.
export function match(value: string): boolean {
  return /^[0-9a-f]{16,64}$/.test(value);
}
