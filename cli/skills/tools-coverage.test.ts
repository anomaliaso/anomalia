import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const CLI = fileURLToPath(new URL('../', import.meta.url));
const REPO = join(CLI, '..');
const CONTRACTS = join(REPO, 'packages', 'api-contracts', 'src');
const MCP_TOOLS = join(CLI, 'mcp', 'tools');
const REFERENCE = join(CLI, 'skills', 'anomalia', 'references', 'tools.md');

const HAND_REGISTERED_BECAUSE: Record<string, string> = {
  login: 'la sessione OAuth vive nel client, non dietro una rotta di brand',
  logout: 'cancella il file di sessione locale, nessuna chiamata HTTP',
  whoami: 'legge la sessione locale o il Bearer della richiesta',
  list_brands: 'GET /api/v1/brands non sta sotto un brand, e il registry e scoped sul brand',
  get_status: 'compone due letture dell API in una risposta sola',
  approve_post: 'risolve un prefisso di id, poi chiama la rotta del singolo post',
  approve_posts: 'approva tutta la coda pending con una chiamata dedicata',
  publish_post: 'risolve un prefisso di id, poi pubblica il singolo post',
  reject_post: 'risolve un prefisso di id, poi cancella il post',
  generate_person: 'add_person con kind ai gia impostato',
  produce_week: 'legge il piano per trovare la bozza dei seed, poi la produce'
};

const MIN_REGISTRY_TOOLS = 100;
const MIN_HAND_REGISTERED = 8;
const MIN_NAMED_BY_THE_SKILL = 100;

function names(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function sourceOf(dir: string): string {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => readFileSync(join(dir, file), 'utf8'))
    .join('\n');
}

function registryTools(): Set<string> {
  return new Set(names(/tool:\s*'([a-z][a-z0-9_]*)'/g, sourceOf(CONTRACTS)));
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
