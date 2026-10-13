/**
 * Startup configuration checks for production.
 *
 * The dev defaults (minioadmin, postgres/postgres, CORS `*`, antivirus off) are convenient locally
 * and dangerous anywhere else, so in production the process refuses to start rather than run with
 * them. Outside production this is a no-op.
 */
export type ServiceRole = 'api' | 'worker';

const REQUIRED: Record<ServiceRole, string[]> = {
  api: [
    'DATABASE_URL', 'REDIS_URL', 'KEYCLOAK_URL', 'KEYCLOAK_REALM',
    'MINIO_ENDPOINT', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'MINIO_BUCKET',
    'CORS_ORIGINS', 'NVIDIA_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN',
  ],
  worker: [
    'DATABASE_URL', 'REDIS_URL',
    'MINIO_ENDPOINT', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'MINIO_BUCKET',
    'NVIDIA_API_KEY', 'OCR_SERVICE_URL',
  ],
};

const WEAK_SECRETS = new Set(['minioadmin', 'postgres', 'admin', 'password', 'changeme', 'secret', 'your-keycloak-client-secret']);
const PLACEHOLDER = /^(your-|changeme|replace-me|generate-with)/i;

export function findProductionConfigProblems(role: ServiceRole, env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];

  for (const key of REQUIRED[role]) {
    const value = env[key];
    if (!value) problems.push(`${key} is required in production`);
    else if (PLACEHOLDER.test(value)) problems.push(`${key} still holds a placeholder value`);
  }

  for (const key of ['MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY']) {
    if (env[key] && WEAK_SECRETS.has(env[key] as string)) problems.push(`${key} is a well-known default; set a unique value`);
  }

  if (env.DATABASE_URL) {
    try {
      const password = decodeURIComponent(new URL(env.DATABASE_URL).password);
      if (!password) problems.push('DATABASE_URL has no password');
      else if (WEAK_SECRETS.has(password)) problems.push('DATABASE_URL uses a well-known default password');
    } catch {
      problems.push('DATABASE_URL is not a valid URL');
    }
  }

  if (role === 'api') {
    const origins = (env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
    if (origins.includes('*')) problems.push("CORS_ORIGINS must list explicit origins, not '*'");
    if (env.KEYCLOAK_URL && !/^https:\/\//.test(env.KEYCLOAK_URL) && env.ALLOW_INSECURE_KEYCLOAK !== 'true') {
      problems.push('KEYCLOAK_URL must be https:// in production (the token issuer is the public URL)');
    }
  }

  if (env.ENABLE_VIRUS_SCAN !== 'true' && env.ALLOW_UNSCANNED_UPLOADS !== 'true') {
    problems.push('ENABLE_VIRUS_SCAN=true is required in production (set ALLOW_UNSCANNED_UPLOADS=true to accept the risk explicitly)');
  }

  return problems;
}

/** Throws one error listing every problem, so an operator can fix them in a single pass. */
export function assertProductionConfig(role: ServiceRole, env: NodeJS.ProcessEnv = process.env): void {
  const problems = findProductionConfigProblems(role, env);
  if (problems.length > 0) {
    throw new Error(`Refusing to start ${role} with unsafe production configuration:\n  - ${problems.join('\n  - ')}`);
  }
}
