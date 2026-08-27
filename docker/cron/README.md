# Cron sidecar

Self-hosted stand-in for Vercel Cron: wakes on every minute boundary, evaluates the embedded manifest (mirrored from `vercel.json`) and GETs each due endpoint with `Authorization: Bearer $CRON_SECRET`. Vercel deployments ignore this entirely.

Env vars: `APP_URL` (required, no trailing slash), `CRON_SECRET` (required; send the bearer token the app expects), `ALLOW_INSECURE_CRON=1` to skip the secret in local experiments, and optional `CRON_MANIFEST_PATH` pointing at a JSON array of `{"path":"/api/v1/...","schedule":"*/5 * * * *"}`. Times are evaluated in container-local time (UTC on the stock image).

```yaml
services:
  cron:
    build: ./docker/cron
    restart: unless-stopped
    environment:
      APP_URL: http://app:3000
      CRON_SECRET: ${CRON_SECRET}
```
