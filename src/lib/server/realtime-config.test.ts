import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const KONG_CONFIG = fileURLToPath(
  new URL('../../../infra/compose/volumes/api/kong.yml', import.meta.url)
);

describe('local Realtime routing', () => {
  it('uses the compose Realtime service for HTTP and WebSocket traffic', () => {
    const config = readFileSync(KONG_CONFIG, 'utf8');

    expect(config).toContain('url: http://realtime-dev:4000/socket');
    expect(config).toContain('url: http://realtime-dev:4000/api');
    expect(config).not.toContain('host_header:');
    expect(config.match(/"Host: realtime-dev"/g)).toHaveLength(2);
    expect(config).not.toContain('realtime-dev.supabase-realtime');
    // Il tenant arriva dall'header `Host` qui sopra, non dal nome del container: così il compose
    // non battezza i suoi servizi e due stack possono girare affiancati sulla stessa macchina.
    expect(config).not.toContain('realtime-dev.anomalia-realtime');
  });
});
