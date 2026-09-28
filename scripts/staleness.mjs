#!/usr/bin/env node
/**
 * Fingerprint-based staleness gates for the `npm run ipad` startup path.
 *
 * Two of the four serial steps in a cold start are pure functions of files on
 * disk — the preset-catalog scan and the Vite build — yet both re-ran
 * unconditionally on every launch. This module gives each one a stamp: hash the
 * inputs, compare against `scripts/.cache/<name>-stamp.json`, and skip the work
 * when the digest matches and the declared outputs still exist.
 *
 * Used two ways:
 *   - as a CLI, `node scripts/staleness.mjs build`, which gates the Vite build
 *     (wired to `npm run build:ipad`)
 *   - as a module, by the old `generate-places-catalog.ts`, which gated the Places catalog (until 2026-09-26; the server builds it now)
 *     (the type-catalog builder it first gated was retired at the browser-places
 *     cutover, 2026-09-24)
 *
 * The fingerprint is `(relative path, size, mtimeMs)` over every declared input
 * — a stat walk, never a read — so it stays cheap even across a preset library
 * of tens of thousands of files. It is deliberately NOT a content hash: an
 * mtime-only touch invalidates, which costs a rebuild but never serves stale
 * output. Digests are versioned by `STAMP_VERSION` so changing the walk itself
 * invalidates every stamp.
 *
 * Set `FORCE=1` (or pass `--force`) to bypass a gate.
 *
 * NOTE: this is why `scripts/cleanup.sh` no longer deletes `interface/.svelte-kit`
 * by default. Nuking the build output on every launch made the build gate
 * structurally impossible — the outputs were always missing, so it was always a
 * miss. Staleness is now decided by the inputs, not by deleting the evidence.
 * `npm run cleanup:caches` still nukes everything by hand when needed.
 */

import { spawn } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPO_ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(__dirname, '.cache');

/** Bump to invalidate every stamp (e.g. when the walk below changes shape). */
const STAMP_VERSION = 2;

/** Never descend into these — they're either huge or not build inputs. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.svelte-kit', '.cache', '.DS_Store']);

/**
 * Hash one file's identity into `hash`. Size + mtime, never contents: a preset
 * library is tens of thousands of files and reading them all would cost more
 * than the work we're trying to skip.
 */
function hashFile(hash, absPath, relPath) {
	const st = fs.statSync(absPath, { throwIfNoEntry: false });
	if (!st) return;
	hash.update(`${relPath}\0${st.size}\0${st.mtimeMs}\n`);
}

/**
 * Hash one symlink's identity into `hash` — the link, never its target.
 *
 * The old audio library was a symlink farm (53,907 links against 3,922 real
 * files), and its catalog fed that tree straight to `fingerprint()`. A `Dirent`
 * for a symlink returns **false from both** `isFile()` and `isDirectory()`, so
 * before this existed every symlinked sample contributed nothing at all: adding
 * two of them left the digest byte-identical and `npm run dev` printed "inputs
 * unchanged" while shipping the old catalog. The Places are clones now, all but
 * 190 clip links, and a link still counts.
 *
 * `lstat` never follows, so a broken link costs nothing and there is no cycle
 * risk. Reading the target rather than stat-ing it is also the right
 * granularity: the catalog records names and paths, not audio, so a sample
 * edited in place is not a catalog input — but a *retargeted* link is, and
 * `readlink` catches that where an mtime alone would not.
 */
function hashSymlink(hash, absPath, relPath) {
	const st = fs.lstatSync(absPath, { throwIfNoEntry: false });
	if (!st) return;
	let target = '';
	try {
		target = fs.readlinkSync(absPath);
	} catch {
		// Raced away between readdir and here; the empty target still records
		// that *something* was linked at this path.
	}
	// The `->` marker keeps a symlink from colliding with a real file of the
	// same name whose size happens to equal the target's length.
	hash.update(`${relPath}\0->${target}\0${st.mtimeMs}\n`);
}

/**
 * Hash a directory tree. Entries are sorted so the digest is stable across
 * filesystems that hand back readdir in arbitrary order.
 */
function hashTree(hash, absPath, relPath) {
	let entries;
	try {
		entries = fs.readdirSync(absPath, { withFileTypes: true });
	} catch {
		return; // unreadable or gone — absence is itself part of the digest
	}
	entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

	for (const entry of entries) {
		if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
		const childAbs = path.join(absPath, entry.name);
		const childRel = `${relPath}/${entry.name}`;
		if (entry.isDirectory()) {
			hashTree(hash, childAbs, childRel);
		} else if (entry.isFile()) {
			hashFile(hash, childAbs, childRel);
		} else if (entry.isSymbolicLink()) {
			hashSymlink(hash, childAbs, childRel);
		}
	}
}

/**
 * Digest a set of inputs.
 *
 * @param {Array<{path: string, tree?: boolean}>} inputs — absolute paths.
 *   `tree: true` walks a directory; otherwise the path is treated as one file.
 * @returns {{digest: string, ms: number}}
 */
export function fingerprint(inputs) {
	const started = Date.now();
	const hash = createHash('sha1');
	hash.update(`v${STAMP_VERSION}\n`);

	for (const input of inputs) {
		// Relative-to-repo keys keep the digest stable if the checkout moves.
		const key = path.relative(REPO_ROOT, input.path) || path.basename(input.path);
		hash.update(`::${key}\n`);
		if (input.tree) {
			hashTree(hash, input.path, key);
		} else {
			hashFile(hash, input.path, key);
		}
	}

	return { digest: hash.digest('hex'), ms: Date.now() - started };
}

function stampPath(name) {
	return path.join(CACHE_DIR, `${name}-stamp.json`);
}

/** True when `--force` / `FORCE=1` asked us to ignore the stamp. */
export function forced(argv = process.argv.slice(2)) {
	return argv.includes('--force') || process.env.FORCE === '1';
}

/**
 * Decide whether the gated work can be skipped.
 *
 * Freshness needs BOTH halves: the inputs must be unchanged AND every file the
 * work is supposed to have produced must still be there. The second half is
 * what catches a hand-deleted artifact, where no input moved and the digest
 * still matches perfectly.
 *
 * The required set is the caller's `outputs` (what must exist even on a first
 * run) UNION whatever the last successful run recorded producing. Reading it
 * back from the stamp rather than re-deriving it is deliberate: a caller can't
 * always predict its own output set — the catalog's audio splits only exist
 * when a sample library is configured — and anything derived by probing the
 * filesystem goes blind exactly when a file is missing, which is the case this
 * is meant to catch.
 *
 * @param {object} opts
 * @param {string} opts.name — stamp identity, e.g. 'build'
 * @param {Array<{path: string, tree?: boolean}>} opts.inputs
 * @param {string[]} opts.outputs — absolute paths required even with no stamp
 * @returns {{fresh: boolean, digest: string, ms: number, reason: string}}
 */
export function check({ name, inputs, outputs = [] }) {
	const { digest, ms } = fingerprint(inputs);

	if (forced()) return { fresh: false, digest, ms, reason: 'forced' };

	let previous = null;
	try {
		previous = JSON.parse(fs.readFileSync(stampPath(name), 'utf8'));
	} catch {
		previous = null;
	}

	const recorded = (previous?.outputs ?? []).map((rel) => path.join(REPO_ROOT, rel));
	const missing = [...outputs, ...recorded].find((p) => !fs.existsSync(p));
	if (missing) {
		return { fresh: false, digest, ms, reason: `missing output ${path.relative(REPO_ROOT, missing)}` };
	}

	if (!previous) return { fresh: false, digest, ms, reason: 'no stamp' };
	if (previous.digest !== digest) return { fresh: false, digest, ms, reason: 'inputs changed' };

	return { fresh: true, digest, ms, reason: 'inputs unchanged' };
}

/**
 * Record a digest and the artifacts the run produced. Call only after the gated
 * work actually succeeded. Paths are stored repo-relative so a moved checkout
 * fails closed (missing → rebuild) rather than matching stale absolute paths.
 *
 * @param {string} name
 * @param {string} digest
 * @param {string[]} outputs — absolute paths this run wrote
 */
export function stamp(name, digest, outputs = []) {
	fs.mkdirSync(CACHE_DIR, { recursive: true });
	fs.writeFileSync(
		stampPath(name),
		JSON.stringify(
			{
				digest,
				outputs: outputs.map((p) => path.relative(REPO_ROOT, p)),
				at: new Date().toISOString()
			},
			null,
			2
		)
	);
}

// ---------------------------------------------------------------------------
// CLI: `node scripts/staleness.mjs build [--force]`
// ---------------------------------------------------------------------------

/**
 * Everything the Vite build reads. `interface/node_modules` is deliberately NOT
 * walked — it's far too large to stat every run — so `package-lock.json` stands
 * in for it. A change that alters the installed tree without touching the
 * lockfile (`npm link`, a hand-edit under node_modules) will not invalidate.
 */
function buildInputs() {
	const i = (...p) => path.join(REPO_ROOT, ...p);
	return [
		{ path: i('interface', 'src'), tree: true },
		{ path: i('interface', 'static'), tree: true },
		{ path: i('config'), tree: true },
		{ path: i('interface', 'vite.config.ts') },
		{ path: i('interface', 'svelte.config.js') },
		{ path: i('interface', 'tsconfig.json') },
		{ path: i('interface', 'package.json') },
		{ path: i('package-lock.json') }
	];
}

async function runBuild() {
	const outDir = path.join(REPO_ROOT, 'interface', '.svelte-kit', 'output');
	const verdict = check({ name: 'build', inputs: buildInputs(), outputs: [outDir] });

	if (verdict.fresh) {
		console.log(`⚡ Vite build skipped — ${verdict.reason} (fingerprint ${verdict.ms}ms)`);
		return 0;
	}

	console.log(`🔨 Building the iPad app — about 40 s, and only when the code has changed (${verdict.reason})`);

	// Errors only: a first build used to print ~480 lines of a11y and
	// chunking warnings, which read as failure to anyone starting the app.
	// svelte-check and the gate's own build still report them.
	const started = Date.now();
	const code = await new Promise((resolve) => {
		const child = spawn('npm', ['run', 'build', '--silent', '--', '--logLevel', 'error'], {
			cwd: path.join(REPO_ROOT, 'interface'),
			stdio: 'inherit',
			shell: false,
			env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --disable-warning=ExperimentalWarning`.trim() }
		});
		child.on('close', resolve);
		child.on('error', () => resolve(1));
	});

	if (code !== 0) {
		console.error(`❌ Vite build failed (exit ${code}) — stamp not written`);
		return code ?? 1;
	}

	// Stamp the digest taken BEFORE the build, not after. If a source file is
	// edited while the build is running, the pre-build digest no longer matches
	// the tree and the next run rebuilds — the safe direction. Stamping the
	// post-build state would instead record the edit as already built.
	stamp('build', verdict.digest, [outDir]);
	console.log(`✅ Vite build complete in ${((Date.now() - started) / 1000).toFixed(1)}s`);
	return 0;
}

const invokedDirectly =
	!!process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

// No top-level await here on purpose: scripts import this
// module under tsx, which transpiles it to CJS — and top-level await is not
// representable in CJS output.
if (invokedDirectly) {
	const command = process.argv[2];
	if (command === 'build') {
		runBuild().then(
			(code) => process.exit(code),
			(error) => {
				console.error('❌ Build gate failed:', error);
				process.exit(1);
			}
		);
	} else {
		console.error('Usage: node scripts/staleness.mjs build [--force]');
		process.exit(1);
	}
}
