// No Postgres available in this environment (docker not installed) — this covers ordering,
// pending-file filtering, error-line computation, and the transaction shape (begin/query/commit
// vs begin/query/rollback) against a fake client. See scripts/db-migrate.mjs header.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listMigrationFiles,
  pendingMigrations,
  lineForPosition,
  runsInTransaction,
  statementChunks,
  applyOne
} from './db-migrate.mjs';

function makeMigrationsDir(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'db-migrate-test-'));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

class FakeClient {
  calls: string[] = [];
  params: unknown[][] = [];
  failOn: string | null;
  constructor(failOn: string | null = null) {
    this.failOn = failOn;
  }
  async query(sql: string, params: unknown[] = []) {
    this.calls.push(sql);
    this.params.push(params);
    if (this.failOn && sql.includes(this.failOn)) {
      const err: any = new Error('syntax error at or near "BOOM"');
      // 1-indexed offset into `sql` pointing at BOOM
      err.position = sql.indexOf('BOOM') + 1;
      throw err;
    }
    return { rows: [] };
  }
}

describe('listMigrationFiles', () => {
  it('lists .sql files in lexicographic (= numeric, zero-padded) order', () => {
    const dir = makeMigrationsDir({
      '0002_b.sql': 'select 1;',
      '0001_a.sql': 'select 1;',
      '0010_c.sql': 'select 1;',
      'README.md': 'not a migration'
    });
    try {
      expect(listMigrationFiles(dir)).toEqual(['0001_a.sql', '0002_b.sql', '0010_c.sql']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('pendingMigrations', () => {
  it('filters out already-applied files, keeps order', () => {
    const all = ['0001_a.sql', '0002_b.sql', '0003_c.sql'];
    expect(pendingMigrations(all, ['0001_a.sql'])).toEqual(['0002_b.sql', '0003_c.sql']);
  });

  it('is a no-op when nothing is applied yet', () => {
    const all = ['0001_a.sql'];
    expect(pendingMigrations(all, [])).toEqual(['0001_a.sql']);
  });

  it('returns empty when everything is already applied', () => {
    const all = ['0001_a.sql'];
    expect(pendingMigrations(all, ['0001_a.sql'])).toEqual([]);
  });
});

describe('lineForPosition', () => {
  it('converts a pg error character position to a 1-indexed line number', () => {
    const sql = 'select 1;\nselect 2;\nBOOM;';
    const position = sql.indexOf('BOOM') + 1; // pg positions are 1-indexed
    expect(lineForPosition(sql, position)).toBe(3);
  });

  it('returns null when there is no position', () => {
    expect(lineForPosition('select 1;', undefined)).toBeNull();
  });
});

describe('runsInTransaction', () => {
  it('is false for statements Postgres forbids inside a transaction block', () => {
    expect(runsInTransaction('vacuum (analyze) public.posts;')).toBe(false);
    expect(runsInTransaction('create index concurrently i on t (a);')).toBe(false);
  });

  it('is true for an ordinary migration, and for the words inside a comment', () => {
    expect(runsInTransaction('create table t (id int);')).toBe(true);
    expect(runsInTransaction('-- vacuum keeps the map fresh\ncreate index i on t (a);')).toBe(true);
  });
});

describe('statementChunks', () => {
  it('sends each vacuum alone — a multi-statement query is a transaction block', () => {
    const sql = 'create index i on t (a);\nvacuum (analyze) t;\nvacuum (analyze) u;';
    expect(statementChunks(sql)).toEqual([
      'create index i on t (a);',
      'vacuum (analyze) t;',
      'vacuum (analyze) u;'
    ]);
  });

  it('keeps a multi-line solo statement whole', () => {
    const sql = 'create index concurrently i\n  on t (a);\nselect 1;';
    expect(statementChunks(sql)).toEqual(['create index concurrently i\n  on t (a);', 'select 1;']);
  });
});

describe('applyOne', () => {
  it('runs a vacuum migration outside a transaction, one statement per query', async () => {
    const dir = makeMigrationsDir({
      '0003_vac.sql': 'create index i on t (a);\nvacuum (analyze) public.posts;'
    });
    const client = new FakeClient();
    try {
      await applyOne(client, '0003_vac.sql', dir);
      expect(client.calls).not.toContain('begin');
      expect(client.calls[0]).toBe('create index i on t (a);');
      expect(client.calls[1]).toBe('vacuum (analyze) public.posts;');
      expect(client.calls[2]).toContain('insert into app_schema_migrations');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('wraps a migration in begin/query/insert/commit', async () => {
    const dir = makeMigrationsDir({ '0001_a.sql': 'create table t (id int);' });
    const client = new FakeClient();
    try {
      await applyOne(client, '0001_a.sql', dir);
      expect(client.calls[0]).toBe('begin');
      expect(client.calls[1]).toContain('create table t');
      expect(client.calls[2]).toContain('insert into app_schema_migrations');
      expect(client.params[2]).toEqual(['0001_a.sql']);
      expect(client.calls[3]).toBe('commit');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rolls back and names the file:line on failure, never marks it applied', async () => {
    const dir = makeMigrationsDir({ '0002_bad.sql': 'select 1;\nBOOM;' });
    const client = new FakeClient('BOOM');
    try {
      await expect(applyOne(client, '0002_bad.sql', dir)).rejects.toThrow('0002_bad.sql:2');
      expect(client.calls).toContain('rollback');
      expect(client.calls.some((c) => c.includes('insert into app_schema_migrations'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
