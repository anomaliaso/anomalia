# OAuth code-exchange error recovery

What happened: `/auth/callback` redirected a failed Supabase code exchange to bare `/login`,
losing the error marker used by the other authentication-link failure path.

What changes: a failed exchange now redirects to `/login?error=link`, matching `/auth/confirm`.
Callbacks without a code still redirect to `/login`.

Decision: reuse the existing generic `link` flag so OAuth failures do not expose provider error
details and both callback paths keep the same recovery contract.
