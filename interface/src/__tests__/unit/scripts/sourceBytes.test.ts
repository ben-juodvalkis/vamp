/**
 * No NUL bytes in source (2026-09-12).
 *
 * Twice in one week a NUL separator meant as the six-character escape was
 * committed as the raw byte: `RackMacrosRow.svelte` (fixed in 99ad0ba) and
 * `useDrumVm.svelte.ts`. A raw NUL makes git index the file as binary
 * (`git ls-files --eol` reports `i/-text`, so no diff can review it), makes
 * ripgrep skip the file, and renders as a space in most viewers so the code
 * reads as `join(' ')`. Git's own binary heuristic inspects only the first
 * 8000 bytes, which is how the second one got past the sweep that found the
 * first. This walks every text source under the repo and says no.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function findRepoRoot(): string {
	let dir = process.cwd();
	for (let i = 0; i < 6; i++) {
		if (existsSync(path.join(dir, 'config', 'constants.json')) && existsSync(path.join(dir, 'interface'))) return dir;
		dir = path.dirname(dir);
	}
	throw new Error(`repo root not found above ${process.cwd()}`);
}

const ROOT = findRepoRoot();

/** The trees that hold hand-written text sources. */
const TREES = ['interface/src', 'interface/bridge', 'scripts', 'surface', 'docs', 'config', 'owner'];
const SKIP_DIRS = new Set(['node_modules', '.svelte-kit', '.cache', '__pycache__', '.pytest_cache', 'golden', 'scenes']);
const TEXT = new Set(['.ts', '.js', '.mjs', '.cjs', '.svelte', '.py', '.md', '.json', '.css', '.html', '.sh', '.yml', '.yaml', '.txt']);

function* textFiles(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) yield* textFiles(full);
			continue;
		}
		if (!entry.isFile() || !TEXT.has(path.extname(entry.name))) continue;
		yield full;
	}
}

describe('source files carry no NUL byte', () => {
	it('every text source under the repo is free of 0x00', () => {
		const offenders: string[] = [];
		let scanned = 0;
		for (const tree of TREES) {
			const dir = path.join(ROOT, tree);
			if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
			for (const file of textFiles(dir)) {
				scanned += 1;
				if (readFileSync(file).includes(0)) offenders.push(path.relative(ROOT, file));
			}
		}
		expect(scanned).toBeGreaterThan(100); // the walk reached the trees it names
		expect(offenders).toEqual([]);
	});
});
