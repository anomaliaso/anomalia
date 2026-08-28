#!/usr/bin/env bun
/**
 * Anomalia MCP server (stdio).
 *
 * Auth is browser OAuth only — same flow as `anomalia login`, same session file.
 * No static API tokens.
 *
 * Cursor / Claude Desktop example:
 * {
 *   "mcpServers": {
 *     "anomalia": {
 *       "command": "bun",
 *       "args": ["run", "/absolute/path/to/anomalia-cli/mcp/stdio.ts"]
 *     }
 *   }
 * }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadEnv } from '../lib/config.ts';
import { createAnomaliaMcpServer } from './server.ts';

await loadEnv();

const server = createAnomaliaMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);

console.error('Anomalia MCP server running on stdio (OAuth session via login tool / anomalia login)');
