# Local Keycloak setup

Keycloak's realm lives in the `keycloak_data` Docker volume, so a fresh machine (or a wiped
volume) starts with no `rag-platform` realm and SSO fails with `ClientFetchError` /
`unauthorized_client`. `setup-realm.sh` recreates the configuration:

```bash
docker compose -f infra/docker/docker-compose.yml up -d keycloak
infra/keycloak/setup-realm.sh              # realm + client "rag-web" + AUTH_* in apps/web/.env.local
infra/keycloak/setup-realm.sh --dev-user   # additionally creates dev user admin / admin123
```

It is idempotent: re-running keeps the realm and reuses the client secret already in
`apps/web/.env.local` (a new one is generated only when missing). Variables it manages:
`AUTH_SECRET`, `AUTH_KEYCLOAK_ID`, `AUTH_KEYCLOAK_SECRET`, `AUTH_KEYCLOAK_ISSUER`.

The API needs `KEYCLOAK_URL` and `KEYCLOAK_REALM` in the root `.env` to verify tokens.

Do not use `--dev-user` or the default `admin/admin` bootstrap credentials outside local development.

## Tests

`pnpm --filter @rag/api test:integration` creates throw-away Keycloak users/client through the admin
API and removes them (and their DB rows) afterwards. It refuses to run against a non-local Keycloak/API.

## Login theme

`themes/rag` restyles the Keycloak login page to match the web app (neutral palette, Inter, card layout). It extends the
stock `keycloak.v2` theme with one CSS file, so there are no template overrides to maintain. The Keycloak image is built
from `infra/keycloak/Dockerfile` (stock image + the theme). `setup-realm.sh` selects it (`loginTheme=rag`); for an existing
realm you can also set it in the admin console: Realm settings -> Themes -> Login theme = `rag`.
