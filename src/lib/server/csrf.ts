// CSRF origin check, replacing kit's built-in one (disabled in svelte.config.js) so a single
// route can opt out.
//
// Kit blocks every form-encoded mutating request whose `origin` header doesn't match the request
// URL — including a *missing* origin, which is what every non-browser client sends. RFC 6749
// requires the OAuth token endpoint to accept `application/x-www-form-urlencoded`, so
// `opencode mcp auth anomalia` got a 403 there. That endpoint carries no ambient credentials
// (no cookies, no session): it needs a signed authorization code plus the matching PKCE verifier,
// which is exactly what a cross-site page cannot produce.
//
// Unlike kit's version this also runs in dev — kit skips the check entirely when DEV, which is
// why a full local run of the OAuth flow passed while production 403'd.

const EXEMPT_PATHS = new Set(['/oauth/token']);
const FORM_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];

export function isCsrfForbidden(request: Request, url: URL): boolean {
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return (
    MUTATING.includes(request.method) &&
    FORM_CONTENT_TYPES.includes(type) &&
    !EXEMPT_PATHS.has(url.pathname) &&
    request.headers.get('origin') !== url.origin
  );
}
