import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface VerificationResult {
  userId: string;
  email?: string;
  /** Display name from the OIDC `name` claim (falls back to preferred_username). */
  name?: string;
  orgId?: string;
  isValid: boolean;
  error?: string;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedIssuer: string | null = null;

function getKeycloakConfig() {
  const baseUrl = process.env.KEYCLOAK_URL;
  const realm = process.env.KEYCLOAK_REALM;
  if (!baseUrl || !realm) {
    throw new Error('KEYCLOAK_URL and KEYCLOAK_REALM must be set');
  }
  const issuer = `${baseUrl.replace(/\/$/, '')}/realms/${realm}`;
  return { issuer, jwksUri: `${issuer}/protocol/openid-connect/certs` };
}

function getJwks() {
  const { issuer, jwksUri } = getKeycloakConfig();
  if (!jwks || cachedIssuer !== issuer) {
    jwks = createRemoteJWKSet(new URL(jwksUri));
    cachedIssuer = issuer;
  }
  return { jwks, issuer };
}

/**
 * Verify a Keycloak-issued JWT locally against the realm's JWKS.
 * No network call to an auth provider per-request — only the (cached) JWKS fetch.
 *
 * `org_id` must come from a custom protocol mapper configured on the Keycloak
 * client/realm (there is no built-in multi-tenant org claim). Role is deliberately
 * NOT read from the token — it is looked up from the `memberships` table per request
 * (see packages/auth/src/middleware.ts), so a stale/forged claim can't grant access.
 */
export async function verifyJwt(token: string): Promise<VerificationResult> {
  try {
    const { jwks, issuer } = getJwks();
    const { payload } = await jwtVerify(token, jwks, { issuer });
    const claims = payload as JWTPayload & { email?: string; name?: string; preferred_username?: string; org_id?: string };

    if (!claims.sub) {
      throw new Error('Token missing sub claim');
    }

    return {
      userId: claims.sub,
      email: claims.email,
      name: claims.name?.trim() || claims.preferred_username?.trim() || undefined,
      orgId: claims.org_id,
      isValid: true,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Invalid token';
    console.error('JWT verification failed:', errorMsg);
    return { userId: '', isValid: false, error: errorMsg };
  }
}
