#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
: "${TASK85_LLM_API_KEY:?set TASK85_LLM_API_KEY explicitly; this harness never reads .env}"
: "${TASK85_VERCEL_TOKEN:?set TASK85_VERCEL_TOKEN explicitly — without it openBrandSandbox has no credentials and the shell tool never runs}"
: "${TASK85_VERCEL_TEAM_ID:?set TASK85_VERCEL_TEAM_ID explicitly}"
: "${TASK85_VERCEL_PROJECT_ID:?set TASK85_VERCEL_PROJECT_ID explicitly}"
ENV_DIR=$(mktemp -d /tmp/task85-env.XXXXXX)
ENV_FILE="$ENV_DIR/.env"
COMPOSE_FILE="$ROOT_DIR/infra/compose/docker-compose.yml"
OVERRIDE_FILE="$ROOT_DIR/infra/compose/docker-compose.task85.yml"
PROJECT=anomalia-task85
APP_URL=http://localhost:5177
APP_PID=
WORKER_PID=

compose() {
	env -i PATH="$PATH" \
		LLM_API_KEY="$TASK85_LLM_API_KEY" \
		LLM_BASE_URL="${TASK85_LLM_BASE_URL:-https://openrouter.ai/api/v1}" \
		LLM_DEFAULT_MODEL="${TASK85_LLM_DEFAULT_MODEL:-z-ai/glm-5.3-flash}" \
		LLM_MODELS="${TASK85_LLM_MODELS:-z-ai/glm-5.3-flash}" \
		docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$OVERRIDE_FILE" "$@"
}

cleanup() {
	if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
		kill "$APP_PID" 2>/dev/null || true
		wait "$APP_PID" 2>/dev/null || true
	fi
	if [ -n "$WORKER_PID" ] && kill -0 "$WORKER_PID" 2>/dev/null; then
		kill "$WORKER_PID" 2>/dev/null || true
		wait "$WORKER_PID" 2>/dev/null || true
	fi
	compose down --volumes --remove-orphans >/dev/null 2>&1 || true
	rm -rf "$ENV_DIR"
}

trap cleanup EXIT INT TERM

WORKER_LOG=$(mktemp /tmp/task85-worker.XXXXXX)
APP_LOG=$(mktemp /tmp/task85-app.XXXXXX)

base64url() {
	base64 | tr '+/' '-_' | tr -d '=\n'
}

sign_jwt() {
	local role=$1
	local header=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | base64url)
	local payload=$(printf '{"role":"%s","iss":"supabase-task85","iat":%s,"exp":%s}' "$role" "$JWT_ISSUED_AT" "$JWT_EXPIRES_AT" | base64url)
	local signing_input="$header.$payload"
	local signature=$(printf '%s' "$signing_input" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | base64url)
	printf '%s.%s' "$signing_input" "$signature"
}

POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
JWT_ISSUED_AT=$(date +%s)
JWT_EXPIRES_AT=$((JWT_ISSUED_AT + 3600))
APP_SECRET=$(openssl rand -hex 32)
SECRET_KEY_BASE=$(openssl rand -hex 48)

ANON_KEY=$(sign_jwt anon)
SERVICE_ROLE_KEY=$(sign_jwt service_role)

cat >"$ENV_FILE" <<EOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=postgres
POSTGRES_PORT=5432
JWT_SECRET=$JWT_SECRET
JWT_EXPIRY=3600
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
DASHBOARD_PASSWORD=$(openssl rand -hex 24)
SUPABASE_PUBLIC_URL=http://localhost:58085
API_EXTERNAL_URL=http://localhost:58085/auth/v1
KONG_HTTP_PORT=58085
PUBLIC_APP_URL=$APP_URL
DATABASE_URL=postgres://supabase_admin:$POSTGRES_PASSWORD@localhost:55432/postgres
SITE_URL=$APP_URL
ADDITIONAL_REDIRECT_URLS=
DISABLE_SIGNUP=false
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=true
ENABLE_ANONYMOUS_USERS=false
PGRST_DB_SCHEMAS=public
PGRST_DB_MAX_ROWS=1000
PGRST_DB_EXTRA_SEARCH_PATH=public
STORAGE_TENANT_ID=stub
SECRET_KEY_BASE=$SECRET_KEY_BASE
REALTIME_DB_ENC_KEY=supabaserealtime
APP_SECRET=$APP_SECRET
EOF

DB_URL="postgres://supabase_admin:$POSTGRES_PASSWORD@localhost:55432/postgres"
SUPABASE_URL=http://localhost:58085

runtime_env() {
	env -i PATH="$PATH" NODE_ENV=production TASK85_DISPOSABLE=1 \
		PUBLIC_APP_URL="$APP_URL" ORIGIN="$APP_URL" \
		PUBLIC_SUPABASE_URL="$SUPABASE_URL" PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
		SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" APP_SECRET="$APP_SECRET" AGENT_KIT=on \
		LLM_BASE_URL="${TASK85_LLM_BASE_URL:-https://openrouter.ai/api/v1}" \
		LLM_API_KEY="$TASK85_LLM_API_KEY" \
		LLM_DEFAULT_MODEL="${TASK85_LLM_DEFAULT_MODEL:-z-ai/glm-5.3-flash}" \
		LLM_MODELS="${TASK85_LLM_MODELS:-z-ai/glm-5.3-flash}" \
		VERCEL_TOKEN="$TASK85_VERCEL_TOKEN" \
		VERCEL_TEAM_ID="$TASK85_VERCEL_TEAM_ID" \
		VERCEL_PROJECT_ID="$TASK85_VERCEL_PROJECT_ID" \
		"$@"
}

compose down --volumes --remove-orphans >/dev/null 2>&1 || true
compose up -d --wait db realtime auth rest storage
runtime_env DATABASE_URL="$DB_URL" node "$ROOT_DIR/scripts/db-migrate.mjs"
compose up -d --wait kong
runtime_env DATABASE_URL="$DB_URL" node "$ROOT_DIR/scripts/db-seed.mjs"
runtime_env npm run build:node
runtime_env PORT=5177 node "$ROOT_DIR/build" >"$APP_LOG" 2>&1 &
APP_PID=$!
for _ in $(seq 1 60); do
	if curl -fsS "$APP_URL/robots.txt" >/dev/null 2>&1; then break; fi
	if ! kill -0 "$APP_PID" 2>/dev/null; then
		cat "$APP_LOG"
		exit 1
	fi
	sleep 1
done
curl -fsS "$APP_URL/robots.txt" >/dev/null
runtime_env SANDBOX_TEST_SUPABASE_URL="$SUPABASE_URL" \
	SANDBOX_TEST_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
	SANDBOX_HOLDER_INTEGRATION=1 \
	npx --no-install vitest run "$ROOT_DIR/src/lib/server/sandbox-leases.integration.test.ts" --reporter=verbose
runtime_env node "$ROOT_DIR/scripts/build-worker.mjs"
runtime_env WORKER_IDLE_POLL_MS=500 WORKER_REAP_EVERY_MS=5_000 node "$ROOT_DIR/build-worker/index.js" >"$WORKER_LOG" 2>&1 &
WORKER_PID=$!
runtime_env TASK85_APP_URL="$APP_URL" \
	TASK85_SUPABASE_URL="$SUPABASE_URL" \
	TASK85_SUPABASE_ANON_KEY="$ANON_KEY" \
	TASK85_SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
	vite-node --config "$ROOT_DIR/scripts/vite-node.config.ts" "$ROOT_DIR/scripts/task85-browser.ts"
printf '%s\n' "worker log: $WORKER_LOG"
