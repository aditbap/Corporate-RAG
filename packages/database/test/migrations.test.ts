import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJournal } from '../src/migrate.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'migrations');
const entries = readJournal(dir);
const sqlFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

describe('migration files', () => {
  it('journal indexes are consecutive from 0 and tags carry the matching number', () => {
    entries.forEach((e, i) => {
      assert.equal(e.idx, i, `entry ${i} has idx ${e.idx}`);
      assert.ok(e.tag.startsWith(String(i).padStart(4, '0') + '_'), `${e.tag} should start with ${String(i).padStart(4, '0')}_`);
    });
  });

  it('every journal entry has a file and every file is in the journal', () => {
    assert.deepEqual(sqlFiles, entries.map((e) => `${e.tag}.sql`));
  });

  it('never quotes a vector type (drizzle-kit emits "vector(N)", which Postgres rejects on a fresh database)', () => {
    for (const f of sqlFiles) {
      assert.ok(!/"vector\(\d+\)"/.test(fs.readFileSync(path.join(dir, f), 'utf-8')), `${f} contains a quoted vector type`);
    }
  });

  it('later migrations are re-runnable: indexes use IF NOT EXISTS', () => {
    for (const f of sqlFiles.slice(5)) {
      const text = fs.readFileSync(path.join(dir, f), 'utf-8');
      for (const m of text.matchAll(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF NOT EXISTS)/gi)) {
        assert.fail(`${f}: CREATE INDEX without IF NOT EXISTS near "${text.slice(m.index, (m.index ?? 0) + 60)}"`);
      }
    }
  });
});
