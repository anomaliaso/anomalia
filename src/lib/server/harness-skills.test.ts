import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadHarnessSkills, parseHarnessSkillSelection, parseSkillFrontmatter } from './harness-skills';

let repoRoot: string;

beforeEach(async () => {
	repoRoot = await mkdtemp(join(tmpdir(), 'harness-skills-'));
	vi.spyOn(process, 'cwd').mockReturnValue(repoRoot);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(repoRoot, { recursive: true, force: true });
});

async function writeSkill(root: 'agents' | 'claude', name: string, entry: string, extra?: Record<string, string>) {
	const dir = root === 'agents' ? join(repoRoot, '.agents/skills', name) : join(repoRoot, '.claude/skills', name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'SKILL.md'), entry);
	for (const [path, content] of Object.entries(extra ?? {})) {
		const full = join(dir, path);
		await mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
		await writeFile(full, content);
	}
	return dir;
}

describe('parseHarnessSkillSelection', () => {
	it('empty or missing env selects nothing', () => {
		expect(parseHarnessSkillSelection(undefined)).toEqual([]);
		expect(parseHarnessSkillSelection('')).toEqual([]);
		expect(parseHarnessSkillSelection('  ')).toEqual([]);
	});

	it('splits comma-separated names and honors *', () => {
		expect(parseHarnessSkillSelection(' anomalia , composio ')).toEqual(['anomalia', 'composio']);
		expect(parseHarnessSkillSelection('*')).toEqual(['*']);
	});
});

describe('parseSkillFrontmatter', () => {
	it('reads name, folded description and body', () => {
		const text = [
			'---',
			'name: demo',
			'description: >-',
			'  First line here',
			'  second line follows.',
			'license: MIT',
			'---',
			'# Body',
			'content'
		].join('\n');
		const { attrs, body } = parseSkillFrontmatter(text);
		expect(attrs.name).toBe('demo');
		expect(attrs.description).toBe('First line here second line follows.');
		expect(attrs.license).toBe('MIT');
		expect(body).toBe('# Body\ncontent');
	});

	it('handles quoted values and text without frontmatter', () => {
		expect(parseSkillFrontmatter('---\nname: "quoted"\n---\nbody').attrs.name).toBe('quoted');
		expect(parseSkillFrontmatter('just text').body).toBe('just text');
	});
});

describe('loadHarnessSkills', () => {
	it('returns nothing when selection is empty', async () => {
		await expect(loadHarnessSkills([])).resolves.toEqual([]);
	});

	it('returns nothing when no skill folder exists', async () => {
		await expect(loadHarnessSkills(['anomalia'])).resolves.toEqual([]);
	});

	it('loads selected skill with textual files attached', async () => {
		await writeSkill(
			'agents',
			'demo',
			'---\nname: demo\ndescription: A demo skill.\n---\n# Demo\nsteps',
			{ 'references/codes.md': 'the codes' }
		);
		const skills = await loadHarnessSkills(['demo']);
		expect(skills).toHaveLength(1);
		expect(skills[0]).toMatchObject({
			name: 'demo',
			description: 'A demo skill.',
			content: '# Demo\nsteps'
		});
		expect(skills[0].files).toEqual([{ path: 'references/codes.md', content: 'the codes' }]);
	});

	it('skips binaries and oversized files', async () => {
		await writeSkill(
			'agents',
			'demo',
			'---\nname: demo\ndescription: d\n---\nbody',
			{
				'references/small.bin': 'ok\u0000null',
				'references/huge.txt': 'x'.repeat(64 * 1024 + 1)
			}
		);
		const skills = await loadHarnessSkills(['demo']);
		expect(skills[0].files ?? []).toEqual([]);
	});

	it('* loads every skill from both roots', async () => {
		await writeSkill('agents', 'alpha', '---\nname: alpha\ndescription: a\n---\nx');
		await writeSkill('claude', 'beta', '---\nname: beta\ndescription: b\n---\ny');
		const skills = await loadHarnessSkills(['*']);
		expect(skills.map((skill) => skill.name).sort()).toEqual(['alpha', 'beta']);
	});

	it('unselected skills stay out', async () => {
		await writeSkill('agents', 'alpha', '---\nname: alpha\ndescription: a\n---\nx');
		await writeSkill('agents', 'beta', '---\nname: beta\ndescription: b\n---\ny');
		const skills = await loadHarnessSkills(['beta']);
		expect(skills.map((skill) => skill.name)).toEqual(['beta']);
	});
});

async function writeExtraSkill(base: string, name: string, body: string) {
	const dir = join(base, name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: extra\n---\n${body}`);
	return base;
}

describe('HARNESS_SKILLS_EXTRA_DIRS', () => {
	let envValue: string | undefined;

	beforeEach(() => {
		envValue = process.env.HARNESS_SKILLS_EXTRA_DIRS;
	});

	afterEach(async () => {
		if (envValue === undefined) {
			delete process.env.HARNESS_SKILLS_EXTRA_DIRS;
		} else {
			process.env.HARNESS_SKILLS_EXTRA_DIRS = envValue;
		}
	});

	it('loads an extra dir and applies the same selection filter', async () => {
		const base = await mkdtemp(join(tmpdir(), 'harness-extra-'));
		await writeExtraSkill(base, 'superpowers', 'brainstorm');
		try {
			process.env.HARNESS_SKILLS_EXTRA_DIRS = base;
			await expect(loadHarnessSkills(['other'])).resolves.toEqual([]);
			const skills = await loadHarnessSkills(['superpowers']);
			expect(skills).toHaveLength(1);
			expect(skills[0]).toMatchObject({ name: 'superpowers', description: 'extra' });
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});

	it('ignores missing dirs without throwing', async () => {
		await writeSkill('agents', 'alpha', '---\nname: alpha\ndescription: a\n---\nx');
		process.env.HARNESS_SKILLS_EXTRA_DIRS = '/no/such/dir/harness';
		const skills = await loadHarnessSkills(['alpha']);
		expect(skills.map((skill) => skill.name)).toEqual(['alpha']);
	});

	it('concatenates multiple dirs split on : and ;', async () => {
		const first = await mkdtemp(join(tmpdir(), 'harness-extra-a-'));
		const second = await mkdtemp(join(tmpdir(), 'harness-extra-b-'));
		await writeExtraSkill(first, 'one', 'a');
		await writeExtraSkill(second, 'two', 'b');
		await writeSkill('agents', 'alpha', '---\nname: alpha\ndescription: a\n---\nx');
		try {
			process.env.HARNESS_SKILLS_EXTRA_DIRS = `${first};${second}`;
			const skills = await loadHarnessSkills(['*']);
			expect(skills.map((skill) => skill.name).sort()).toEqual(['alpha', 'one', 'two']);
		} finally {
			await rm(first, { recursive: true, force: true });
			await rm(second, { recursive: true, force: true });
		}
	});
});
