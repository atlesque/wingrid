import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

// Exercise the Worker's actual SQL against SQLite with D1's batch rollback semantics.
export function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../../migrations/', import.meta.url)).sort()) {
    sqlite.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
  }
  const db = {
    sqlite,
    prepare(sql) {
      let args = [];
      return { sql, get args() { return args; }, bind(...values) { args = values; return this; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() { return { meta: sqlite.prepare(sql).run(...args) }; } };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(s => ({ meta: sqlite.prepare(s.sql).run(...s.args) }));
        sqlite.exec('COMMIT'); return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return db;
}
