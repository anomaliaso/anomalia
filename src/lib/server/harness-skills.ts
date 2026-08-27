/**
 * LE SKILL DEL REPO NELL'AGENTE CHAT — lette da `.agents`/`.claude` sotto `skills/<nome>/SKILL.md`,
 * trasformate nel contratto `HarnessV1Skill` di `@ai-sdk/harness`.
 *
 * DEFAULT OFF: le skill del repo sono scritte per gli agenti di codice, non per il brand. Un
 * turno di chat non ne vede nessuna a meno che `HARNESS_SKILLS` non lo chieda — una lista di nomi
 * separati da virgola, o `*` per tutte. La selezione vuota è il caso normale, non un errore.
 *
 * Il frontmatter è YAML ma qui basta il minimo: chiavi top-level `key: value`, blocchi piegati
 * (`>-`, `|-`) e righe continue indentate. Ciò che serve è solo name e description; il corpo
 * dopo il secondo `---` passa intatto come content.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

export type HarnessRepoSkill = {
	name: string;
	description: string;
	content: string;
	files?: { path: string; content: string }[];
};

const SKILL_ROOTS = ['.agents/skills', '.claude/skills'];
const EXTRA_ROOTS_ENV = 'HARNESS_SKILLS_EXTRA_DIRS';
const SKILL_ENTRY = 'SKILL.md';
const MAX_TEXT_BYTES = 64 * 1024;
const ALL = '*';

const cache = new Map<string, { mtimeMs: number; size: number; text: string }>();

async function readCached(path: string): Promise<string | null> {
	try {
		const info = await stat(path);
		const hit = cache.get(path);
		if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) {
			return hit.text;
		}
		const text = await readFile(path, 'utf8');
		cache.set(path, { mtimeMs: info.mtimeMs, size: info.size, text });
		return text;
	} catch {
		return null;
	}
}

export function parseHarnessSkillSelection(raw: string | undefined | null): string[] {
	const trimmed = raw?.trim();
	if (!trimmed) {
		return [];
	}
	if (trimmed === ALL) {
		return [ALL];
	}
	return trimmed.split(',').map((name) => name.trim()).filter(Boolean);
}

function unquote(value: string): string {
	const pair = value.length >= 2 ? value[0] + value[value.length - 1] : '';
	if (pair === '""' || pair === "''") {
		return value.slice(1, -1);
	}
	return value;
}

export function parseSkillFrontmatter(text: string): { attrs: Record<string, string>; body: string } {
	const normalized = text.replace(/\r\n/g, '\n');
	if (!normalized.startsWith('---')) {
		return { attrs: {}, body: normalized.trim() };
	}
	const closing = normalized.indexOf('\n---', 3);
	if (closing < 0) {
		return { attrs: {}, body: normalized.trim() };
	}
	const header = normalized.slice(3, closing);
	const body = normalized.slice(closing + 4).replace(/^\n/, '');

	const attrs: Record<string, string> = {};
	let current: string | null = null;
	for (const line of header.split('\n')) {
		const top = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
		if (top) {
			current = top[1];
			let value = unquote(top[2].trim());
			if (/^[>|][+-]?$/.test(value)) {
				value = '';
			}
			attrs[current] = value;
			continue;
		}
		if (current && /^\s+\S/.test(line)) {
			attrs[current] = `${attrs[current]} ${line.trim()}`.trim();
		}
	}
	return { attrs, body };
}

function isTextual(buffer: Buffer): boolean {
	const sample = buffer.subarray(0, 8192);
	return !sample.includes(0);
}

async function collectFiles(dir: string, root: string): Promise<{ path: string; content: string }[]> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const files: { path: string; content: string }[] = [];
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectFiles(full, root)));
			continue;
		}
		if (!entry.isFile() || entry.name === SKILL_ENTRY || entry.name.startsWith('.')) {
			continue;
		}
		const info = await stat(full).catch(() => null);
		if (!info || info.size > MAX_TEXT_BYTES) {
			continue;
		}
		const buffer = await readFile(full).catch(() => null);
		if (!buffer || !isTextual(buffer)) {
			continue;
		}
		files.push({ path: relative(root, full).split('\\').join('/'), content: buffer.toString('utf8') });
	}
	return files;
}

async function loadSkillDir(root: string, dirName: string): Promise<HarnessRepoSkill | null> {
	const entryPath = join(root, dirName, SKILL_ENTRY);
	const text = await readCached(entryPath);
	if (text === null) {
		return null;
	}
	const { attrs, body } = parseSkillFrontmatter(text);
	const files = await collectFiles(join(root, dirName), join(root, dirName));
	const skill: HarnessRepoSkill = {
		name: attrs.name?.trim() || dirName,
		description: attrs.description?.trim() || '',
		content: body.trim()
	};
	if (files.length > 0) {
		skill.files = files;
	}
	return skill;
}

export async function loadHarnessSkills(selection: readonly string[]): Promise<HarnessRepoSkill[]> {
	if (selection.length === 0) {
		return [];
	}
	const wantAll = selection.includes(ALL);
	const wanted = new Set(selection.filter((name) => name !== ALL));
	const skills: HarnessRepoSkill[] = [];
	const extra = (process.env[EXTRA_ROOTS_ENV] ?? '').split(/[;:]/).map((dir) => dir.trim()).filter(Boolean);
	for (const root of [...SKILL_ROOTS.map((dir) => join(process.cwd(), dir)), ...extra]) {
		let dirs: string[];
		try {
			dirs = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
		} catch {
			continue;
		}
		for (const dirName of dirs) {
			const skill = await loadSkillDir(root, dirName);
			if (!skill) {
				continue;
			}
			if (!wantAll && !wanted.has(skill.name) && !wanted.has(dirName)) {
				continue;
			}
			wanted.delete(skill.name);
			wanted.delete(dirName);
			skills.push(skill);
		}
	}
	return skills;
}
