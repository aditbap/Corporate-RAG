/**
 * pnpm --filter @rag/database db:new <short_name>
 * Creates the next numbered, empty migration file and registers it in the journal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const name = process.argv[2];
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error('Usage: db:new <snake_case_name>');
  process.exit(1);
}
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'migrations');
const journalPath = path.join(dir, 'meta', '_journal.json');
const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as { entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] };
const idx = Math.max(-1, ...journal.entries.map((e) => e.idx)) + 1;
const tag = `${String(idx).padStart(4, '0')}_${name}`;
fs.writeFileSync(path.join(dir, `${tag}.sql`), `-- ${tag}\n-- Hand-written SQL. Use vector(N) unquoted. Statements run in one transaction.\n`);
journal.entries.push({ idx, version: '5', when: Date.now(), tag, breakpoints: true });
fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2) + '\n');
console.log(`created src/migrations/${tag}.sql`);
