import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listMigrationFiles, MIGRATIONS_DIR } from '../../../scripts/db-migrate.mjs';

const REPLAY = fileURLToPath(
  new URL('../../../supabase/migrations/0226_realtime_brand_channel_policies.sql', import.meta.url)
);
const COMPOSE = fileURLToPath(
  new URL('../../../infra/compose/docker-compose.yml', import.meta.url)
);
const INIT = fileURLToPath(
  new URL('../../../infra/compose/volumes/db/realtime-policies.sh', import.meta.url)
);

describe('Realtime policy replay', () => {
  it('replays safely before Realtime and installs policies after its healthcheck', () => {
    const files = listMigrationFiles(MIGRATIONS_DIR);
    const original = files.indexOf('0137_realtime_brand_channel.sql');
    const replay = files.indexOf('0226_realtime_brand_channel_policies.sql');
    const sql = readFileSync(REPLAY, 'utf8');
    const compose = readFileSync(COMPOSE, 'utf8');
    const init = readFileSync(INIT, 'utf8');

    expect(original).toBeGreaterThanOrEqual(0);
    expect(replay).toBeGreaterThan(original);
    expect(sql).not.toMatch(/to_regclass\s*\(\s*'realtime\.messages'\s*\)/i);
    expect(sql).not.toMatch(/do\s*\$\$/i);
    expect(sql).toContain('public.auth_brand_ids()');
    expect(compose).toMatch(
      /realtime-policies:[\s\S]*?profiles: \['init'\][\s\S]*?condition: service_healthy[\s\S]*?realtime-policies\.sh[\s\S]*?entrypoint/i
    );
    expect(compose).not.toMatch(/app:[\s\S]*?realtime-policies:/i);
    expect(init).toMatch(/to_regclass\('realtime\.messages'\)/i);
    expect(init).toMatch(/0226_realtime_brand_channel_policies\.sql/);
    expect(init).toMatch(/insert into app_schema_migrations[\s\S]*?on conflict/i);

    for (const name of [
      'brand members receive brand channel',
      'brand members publish presence on brand channel'
    ]) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(sql).toMatch(
        new RegExp(
          `drop policy if exists "${escaped}" on realtime\\.messages[\\s\\S]*create policy "${escaped}"`,
          'i'
        )
      );
    }
  });
});
