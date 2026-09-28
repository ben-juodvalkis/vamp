/**
 * `install.sh` — which Live, and which User Library.
 *
 * The Remote Script is installed by symlinking into Live's User Library, so
 * getting either answer wrong installs it where Live will never look — and
 * both of the script's old answers were wrong in ways that still produce a
 * path that EXISTS, so its `-d` guard passed and it printed success.
 *
 * 1. "Newest Live" was the last iteration of a shell glob, with a comment
 *    claiming lexicographic order works because "Live 12.3.6" > "Live 12.3.5".
 *    It does not: `Live 12.9` sorts after `Live 12.10`, and `'b' > '.'` so
 *    `Live 12.4b7` sorts after every `Live 12.4.x`. Measured on the author's
 *    Mac with 100 prefs directories present, the glob picked `Live 12.4b7`
 *    (last written in February) over `Live 12.4.15b2` (written that morning).
 *
 * 2. The path was cut with a greedy sed capture ending in "/User Library",
 *    which keeps the LAST such segment in the string rather than the first.
 *    (Written out rather than quoted: the regex contains the two characters
 *    that close a block comment, which is its own small trap.)
 *
 * These drive the real script through its `--print-user-library` seam against
 * a synthetic $HOME. Every case here fails against the pre-fix script.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, existsSync, symlinkSync, readlinkSync, lstatSync } from 'node:fs';
import path, { join } from 'node:path';
import { tmpdir } from 'node:os';

// Same walk `cleanupScoping.test.ts` uses: `import.meta.url` is not a file:
// URL under vite, so it cannot locate a sibling script.
function findRepoRoot(): string {
	let dir = process.cwd();
	for (let i = 0; i < 6; i++) {
		if (existsSync(path.join(dir, 'surface', 'install.sh'))) return dir;
		dir = path.dirname(dir);
	}
	throw new Error(`surface/install.sh not found above ${process.cwd()}`);
}

const INSTALL_SH = path.join(findRepoRoot(), 'surface', 'install.sh');

let home: string;

/** Create a Live prefs dir with a Library.cfg pointing at `libraryPath`. */
function prefs(version: string, libraryPath: string, ageSeconds: number) {
	const dir = join(home, 'Library', 'Preferences', 'Ableton', version);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'Library.cfg'),
		`<?xml version="1.0"?>\n<Library>\n  <Entry Path="${libraryPath}" />\n</Library>\n`
	);
	const when = new Date(Date.now() - ageSeconds * 1000);
	utimesSync(dir, when, when);
	return dir;
}

/** A prefs dir Live made but never wrote a Library.cfg into. */
function emptyPrefs(version: string, ageSeconds: number) {
	const dir = join(home, 'Library', 'Preferences', 'Ableton', version);
	mkdirSync(dir, { recursive: true });
	const when = new Date(Date.now() - ageSeconds * 1000);
	utimesSync(dir, when, when);
}

function resolveUserLibrary(): string {
	return execFileSync('/bin/sh', [INSTALL_SH, '--print-user-library'], {
		env: { ...process.env, HOME: home, LOOPING_USER_LIBRARY: '' },
		encoding: 'utf8'
	}).trim();
}

describe('install.sh — User Library detection', () => {
	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), 'looping-home-'));
	});

	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
	});

	it('prefers the prefs directory Live wrote most recently, not the last one the glob yields', () => {
		// `Live 12.4b7` is what a lexicographic glob ends on, because 'b' > '.'.
		prefs('Live 12.4b7', '/Volumes/Old/User Library/Samples', 60 * 60 * 24 * 200);
		prefs('Live 12.4.5b11', '/Volumes/Older/User Library/Samples', 60 * 60 * 24 * 9);
		prefs('Live 12.4.15b2', '/Volumes/Current/User Library/Samples', 60);

		expect(resolveUserLibrary()).toBe('/Volumes/Current/User Library');
	});

	it('does not read 12.9 as newer than 12.10', () => {
		prefs('Live 12.10', '/Volumes/Ten/User Library/Samples', 60);
		prefs('Live 12.9', '/Volumes/Nine/User Library/Samples', 60 * 60 * 24);

		expect(resolveUserLibrary()).toBe('/Volumes/Ten/User Library');
	});

	it('cuts at the FIRST /User Library, not the last', () => {
		// A real shape: the library root holds a folder that repeats the name.
		prefs(
			'Live 12.4.15b2',
			'/Volumes/Audio/User Library/Backups/User Library/Samples',
			60
		);

		expect(resolveUserLibrary()).toBe('/Volumes/Audio/User Library');
	});

	it('skips a prefs directory that has no Library.cfg, however recent', () => {
		emptyPrefs('Live 12.5b1', 1);
		prefs('Live 12.4.15b2', '/Volumes/Current/User Library/Samples', 60 * 60);

		expect(resolveUserLibrary()).toBe('/Volumes/Current/User Library');
	});

	it('falls back to the macOS default when no Library.cfg exists at all', () => {
		expect(resolveUserLibrary()).toBe(join(home, 'Music/Ableton/User Library'));
	});

	it('honours the LOOPING_USER_LIBRARY override', () => {
		prefs('Live 12.4.15b2', '/Volumes/Current/User Library/Samples', 60);
		const out = execFileSync('/bin/sh', [INSTALL_SH, '--print-user-library'], {
			env: { ...process.env, HOME: home, LOOPING_USER_LIBRARY: '/tmp/Explicit/User Library' },
			encoding: 'utf8'
		});
		// The path alone: the setup check reads this output as the path.
		expect(out.trim()).toBe('/tmp/Explicit/User Library');
	});
});

/**
 * Live lists a Remote Script by the link's name, so the link is the public
 * name, Vamp (naming.md §4). A rig installed before the rename has a
 * `Looping` link as well; two links to one surface would list it twice.
 */
describe('install.sh — the Vamp link', () => {
	let library: string;
	const scripts = () => join(library, 'Remote Scripts');
	const surface = path.dirname(INSTALL_SH);

	function install(): string {
		return execFileSync('/bin/sh', [INSTALL_SH], {
			env: { ...process.env, LOOPING_USER_LIBRARY: library },
			encoding: 'utf8'
		});
	}

	beforeEach(() => {
		library = mkdtempSync(join(tmpdir(), 'looping-library-'));
		mkdirSync(join(library, 'Presets'));
	});

	afterEach(() => {
		rmSync(library, { recursive: true, force: true });
	});

	it('links Remote Scripts/Vamp to this checkout', () => {
		install();
		expect(readlinkSync(join(scripts(), 'Vamp'))).toBe(surface);
		expect(existsSync(join(scripts(), 'Looping'))).toBe(false);
	});

	it('removes an old Looping link into a looping-surface folder', () => {
		mkdirSync(scripts());
		symlinkSync('/Users/someone/Looping/ableton/looping-surface', join(scripts(), 'Looping'));

		expect(install()).toContain("pick 'Vamp' in place of 'Looping'");
		expect(() => lstatSync(join(scripts(), 'Looping'))).toThrow();
		expect(readlinkSync(join(scripts(), 'Vamp'))).toBe(surface);
	});

	it('leaves anything else called Looping alone', () => {
		mkdirSync(join(scripts(), 'Looping'), { recursive: true });
		install();
		expect(lstatSync(join(scripts(), 'Looping')).isDirectory()).toBe(true);
	});
});
