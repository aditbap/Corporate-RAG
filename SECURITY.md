# Security Policy

## Reporting a vulnerability

Please do not open a public issue. Report privately through GitHub's
**Security → Report a vulnerability** form on this repository, with steps to reproduce and the
affected component. We aim to acknowledge reports within 3 working days.

## Scope and built-in safeguards

- In production (`NODE_ENV=production`) the API and worker refuse to start with default or placeholder
  secrets, wildcard CORS, a non-HTTPS Keycloak URL, or virus scanning disabled
  (`packages/core/src/config.ts`).
- Uploads are scanned by ClamAV; access is enforced per library through role-based checks (`packages/auth`).
- Authentication is delegated to Keycloak (OIDC); the API verifies tokens against the realm's JWKS.
- Never commit `.env` files. Rotate any credential that has appeared in git history.
