#!/usr/bin/env bash
# Idempotently configures the local Keycloak for the RAG platform:
#   realm  -> client "rag-web" (confidential, auth-code flow) -> web env vars
#
# Run after `docker compose up -d keycloak`. Safe to re-run: existing realm/client are kept,
# the client secret in the env file is reused (generated only if missing), and the client's
# redirect URIs are re-applied.
#
#   infra/keycloak/setup-realm.sh              # realm + client + env vars
#   infra/keycloak/setup-realm.sh --dev-user   # also create dev user admin / admin123 (LOCAL ONLY)
#
# Overridable env: KEYCLOAK_CONTAINER, KEYCLOAK_REALM, AUTH_KEYCLOAK_ID, WEB_URL,
#   KEYCLOAK_PUBLIC_URL, KEYCLOAK_ADMIN_USER, KEYCLOAK_ADMIN_PASSWORD, ENV_FILE,
#   KEYCLOAK_ALLOW_REGISTRATION (default true: visitors can self-register)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER="${KEYCLOAK_CONTAINER:-rag-keycloak}"
REALM="${KEYCLOAK_REALM:-rag-platform}"
CLIENT_ID="${AUTH_KEYCLOAK_ID:-rag-web}"
WEB_URL="${WEB_URL:-http://localhost:3000}"
PUBLIC_URL="${KEYCLOAK_PUBLIC_URL:-http://localhost:8180}"
ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
ENV_FILE="${ENV_FILE:-$ROOT/apps/web/.env.local}"
DEV_USER=0
[[ "${1:-}" == "--dev-user" ]] && DEV_USER=1

kc() { docker exec "$CONTAINER" /opt/keycloak/bin/kcadm.sh "$@"; }

# Set KEY=VALUE in the env file (replace if present, append otherwise).
set_env() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp="$(mktemp)"
  grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}
# Read KEY from the env file (empty if missing).
get_env() { grep "^${1}=" "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- || true; }

echo "Waiting for Keycloak ($CONTAINER)..."
for i in $(seq 1 60); do
  if kc config credentials --server http://localhost:8080 --realm master --user "$ADMIN_USER" --password "$ADMIN_PASSWORD" >/dev/null 2>&1; then break; fi
  [[ $i -eq 60 ]] && { echo "Keycloak did not become ready (check admin credentials / container name)" >&2; exit 1; }
  sleep 2
done

if kc get "realms/$REALM" >/dev/null 2>&1; then
  echo "Realm '$REALM' exists"
else
  kc create realms -s "realm=$REALM" -s enabled=true -s registrationAllowed=true >/dev/null
  echo "Created realm '$REALM'"
fi

# Custom login theme (infra/keycloak/themes/rag). Harmless if the image lacks it: Keycloak falls back to its default.
kc update "realms/$REALM" -s loginTheme=rag >/dev/null && echo "Login theme set to 'rag'" || echo "Could not set login theme (skipped)"

# Self-service sign-up: visitors can create their own account (no email verification: no SMTP is configured).
# Set KEYCLOAK_ALLOW_REGISTRATION=false to turn it off.
kc update "realms/$REALM" -s "registrationAllowed=${KEYCLOAK_ALLOW_REGISTRATION:-true}" >/dev/null && echo "Self-registration: ${KEYCLOAK_ALLOW_REGISTRATION:-true}"

SECRET="$(get_env AUTH_KEYCLOAK_SECRET)"
[[ -z "$SECRET" ]] && SECRET="$(openssl rand -hex 24)"

REDIRECTS="[\"$WEB_URL/*\",\"${WEB_URL/localhost/127.0.0.1}/*\"]"
ORIGINS="[\"$WEB_URL\",\"${WEB_URL/localhost/127.0.0.1}\"]"
UUID="$(kc get clients -r "$REALM" -q "clientId=$CLIENT_ID" --fields id --format csv --noquotes | head -n1 | tr -d '\r')"
if [[ -z "$UUID" ]]; then
  kc create clients -r "$REALM" -s "clientId=$CLIENT_ID" -s enabled=true -s publicClient=false \
    -s standardFlowEnabled=true -s "secret=$SECRET" -s "redirectUris=$REDIRECTS" -s "webOrigins=$ORIGINS" >/dev/null
  echo "Created client '$CLIENT_ID'"
else
  kc update "clients/$UUID" -r "$REALM" -s "secret=$SECRET" -s "redirectUris=$REDIRECTS" -s "webOrigins=$ORIGINS" >/dev/null
  echo "Client '$CLIENT_ID' exists (secret and redirect URIs re-applied)"
fi

set_env AUTH_KEYCLOAK_ID "$CLIENT_ID"
set_env AUTH_KEYCLOAK_SECRET "$SECRET"
set_env AUTH_KEYCLOAK_ISSUER "$PUBLIC_URL/realms/$REALM"
[[ -z "$(get_env AUTH_SECRET)" ]] && set_env AUTH_SECRET "$(openssl rand -base64 32)"
echo "Wrote AUTH_* variables to $ENV_FILE"

if [[ $DEV_USER -eq 1 ]]; then
  if [[ -z "$(kc get users -r "$REALM" -q username=admin --fields id --format csv --noquotes | tr -d '\r')" ]]; then
    kc create users -r "$REALM" -s username=admin -s email=admin@example.com -s firstName=Admin -s lastName=User \
      -s enabled=true -s emailVerified=true >/dev/null
    kc set-password -r "$REALM" --username admin --new-password admin123
    echo "Created dev user admin / admin123 — LOCAL USE ONLY"
  else
    echo "Dev user 'admin' exists"
  fi
fi

echo "Done. Restart the web app if it was running."
