/**
 * Forward-only SQL migration runner.
 *
 *   node dist/migrate.js                       apply every pending migration
 *   node dist/migrate.js --baseline=<tag>      record migrations up to <tag> as already applied
 *                                              (for a database created before this runner existed)
 *
 * Migrations are the numbered .sql files listed in migrations/meta/_journal.json. Each one runs in its
 * own transaction and is recorded in `schema_migrations`; an advisory lock serialises concurrent
 * runners (e.g. several containers starting together). Hand-written SQL is expected: drizzle-kit's
 * generator cannot emit our pgvector column types correctly, so it is not part of the workflow.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

interface JournalEntry { idx: number; tag: string }

const MIGRATION_LOCK_ID = 727_274; // arbitrary, stable across processes

export function resolveMigrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/migrations (copied at build) in production images; src/migrations when run from source.
  for (const candidate of [path.join(here, 'migrations'), path.join(here, '..', 'src', 'migrations')]) {
    if (fs.existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
  }
  throw new Error('Could not locate the migrations directory (set MIGRATIONS_DIR)');
}

export function readJournal(dir: string): JournalEntry[] {
  const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta', '_journal.json'), 'utf-8')) as { entries: JournalEntry[] };
  return [...journal.entries].sort((a, b) => a.idx - b.idx);
}

export async function runMigrations(databaseUrl: string, opts: { baseline?: string; dir?: string; log?: (m: string) => void } = {}) {
  const log = opts.log ?? ((m: string) => console.log(m));
  const dir = opts.dir ?? resolveMigrationsDir();
  const entries = readJournal(dir);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

  try {
    await sql`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    await sql.unsafe('CREATE EXTENSION IF NOT EXISTS vector');
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS schema_migrations (
      tag text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    const applied = new Set((await sql<{ tag: string }[]>`select tag from schema_migrations`).map((r) => r.tag));

    if (opts.baseline) {
      const upTo = entries.findIndex((e) => e.tag === opts.baseline);
      if (upTo < 0) throw new Error(`Unknown baseline migration "${opts.baseline}"`);
      for (const e of entries.slice(0, upTo + 1)) {
        if (!applied.has(e.tag)) {
          await sql`insert into schema_migrations (tag) values (${e.tag})`;
          applied.add(e.tag);
          log(`baseline: marked ${e.tag} as applied`);
        }
      }
    } else if (applied.size === 0) {
      // A populated database with no migration history was built by hand/older tooling; replaying
      // 0000 over it would fail or, worse, half-apply. Make the operator say what state it is in.
      const rows = await sql<{ exists: boolean }[]>`select to_regclass('public.organizations') is not null as exists`;
      if (rows[0]?.exists) {
        throw new Error('Database already has tables but no migration history. Re-run with --baseline=<last migration already applied> (see docs/DEPLOYMENT.md).');
      }
    }

    let count = 0;
    for (const entry of entries) {
      if (applied.has(entry.tag)) continue;
      const file = path.join(dir, `${entry.tag}.sql`);
      const text = fs.readFileSync(file, 'utf-8');
      log(`applying ${entry.tag} ...`);
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into schema_migrations (tag) values (${entry.tag})`;
      });
      count++;
    }
    log(count === 0 ? 'database is up to date' : `applied ${count} migration(s)`);
    return count;
  } finally {
    await sql`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`.catch(() => undefined);
    await sql.end({ timeout: 5 });
  }
}

// CLI entrypoint (not when imported by tests).
// realpath on both sides: in the pnpm-deployed image argv[1] is a symlink into node_modules/.pnpm.
if (process.argv[1] && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1]))) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const baseline = process.argv.find((a) => a.startsWith('--baseline='))?.split('=')[1];
  runMigrations(databaseUrl, { baseline }).then(
    () => process.exit(0),
    (err) => {
      console.error('Migration failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
