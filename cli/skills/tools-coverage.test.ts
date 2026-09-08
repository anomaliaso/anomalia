import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { BRAND_ENDPOINTS, BRAND_FAMILIES, inAFamily } from '../lib/contracts/index.ts';

const CLI = fileURLToPath(new URL('../', import.meta.url));
const MCP_TOOLS = join(CLI, 'mcp', 'tools');
const REFERENCE = join(CLI, 'skills', 'anomalia', 'references', 'tools.md');

const HAND_REGISTERED_BECAUSE: Record<string, string> = {
  list_brands: 'GET /api/v1/brands non sta sotto un brand, e il registry e scoped sul brand',
  approve_post: 'risolve un prefisso di id, poi chiama la rotta del singolo post',
  approve_posts: 'approva tutta la coda pending con una chiamata dedicata',
  publish_post: 'risolve un prefisso di id, poi pubblica il singolo post',
  reject_post: 'risolve un prefisso di id, poi cancella il post',
  generate_person: 'add_person con kind ai gia impostato',
  produce_week: 'legge il piano per trovare la bozza dei seed, poi la produce'
};

// Le soglie scendono con le trentatre letture ritirate dentro `query`: restano il guardiano
// contro un estrattore che smette di estrarre, non una misura della superficie.
const MIN_REGISTRY_TOOLS = 75;
const MIN_HAND_REGISTERED = 7;
const MIN_NAMED_BY_THE_SKILL = 75;

function names(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function sourceOf(dir: string): string {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => readFileSync(join(dir, file), 'utf8'))
    .join('\n');
}

/**
 * La superficie, non la dichiarazione: un contratto puo' restare nel registro senza essere un tool
 * — perche' una famiglia lo ha assorbito, o perche' la sua rotta e' rimasta REST e basta — e un
 * estrattore che legge `tool:` dai sorgenti pretenderebbe che la skill nomini un nome che nessun
 * agente vedra' mai.
 */
function registryTools(): Set<string> {
  return new Set([
    ...BRAND_ENDPOINTS.filter((endpoint) => !inAFamily(endpoint)).map((endpoint) => endpoint.tool),
    ...BRAND_FAMILIES.map((family) => family.tool)
  ]);
}

function handRegisteredTools(): Set<string> {
  return new Set(names(/registerTool\(\s*'([a-z][a-z0-9_]*)'/g, sourceOf(MCP_TOOLS)));
}

function firstTableCell(line: string): string {
  return line.startsWith('|') ? (line.split('|')[1] ?? '') : '';
}

function toolsNamedBySkill(): Set<string> {
  const cells = readFileSync(REFERENCE, 'utf8').split('\n').map(firstTableCell).join('\n');
  return new Set(names(/`([a-z][a-z0-9_]*)`/g, cells));
}

function exposedTools(): Set<string> {
  return new Set([...registryTools(), ...Object.keys(HAND_REGISTERED_BECAUSE)]);
}

function sorted(set: Set<string>): string[] {
  return [...set].sort();
}

describe('la skill sta al passo con i tool che esistono', () => {
  test('gli estrattori trovano ancora qualcosa', () => {
    expect(registryTools().size).toBeGreaterThanOrEqual(MIN_REGISTRY_TOOLS);
    expect(handRegisteredTools().size).toBeGreaterThanOrEqual(MIN_HAND_REGISTERED);
    expect(toolsNamedBySkill().size).toBeGreaterThanOrEqual(MIN_NAMED_BY_THE_SKILL);
  });

  test('ogni tool registrato a mano porta il suo motivo', () => {
    expect(sorted(handRegisteredTools())).toEqual(Object.keys(HAND_REGISTERED_BECAUSE).sort());
  });

  test('un tool che esiste e la skill non nomina non lo trova nessuno', () => {
    const named = toolsNamedBySkill();
    expect(sorted(exposedTools()).filter((tool) => !named.has(tool))).toEqual([]);
  });

  test('un tool che la skill nomina e non esiste lo chiama qualcuno', () => {
    const exposed = exposedTools();
    expect(sorted(toolsNamedBySkill()).filter((tool) => !exposed.has(tool))).toEqual([]);
  });
});
