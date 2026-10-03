#!/usr/bin/env node
/**
 * Guard the write boundary (issue #7): no component imports the OSC client.
 *
 * A component that wants Live to change calls a named command in
 * `interface/src/lib/services/` (`trackCommands`, `clipCommands`,
 * `sessionCommands`, `deviceParams` …). It never calls `send` itself.
 *
 * Why it matters: a write named in `services/` is one the mock surface in
 * `scripts/shot/` can answer and a test can assert on, by name. A raw
 * `send('/looping/v3/…')` inside a view is invisible to both until it
 * misbehaves on the rig, and it puts a second copy of an address where
 * the wire contract (`docs/reference/wire-protocol.md`) cannot see it.
 * Before this gate, 22 files under `components/` imported the client,
 * and two of them carried their own `sendParam`.
 *
 * ## Scope
 *
 * Everything under `interface/src/lib/components/`, `.svelte`, `.ts` and
 * `.js` alike: a composable beside a view is still the view's code.
 * Services, stores and `api/` itself may import the client.
 *
 * ## How it reads a file
 *
 * With `check-touch-dialects.mjs`'s lexer (`maskSource`), so an import
 * named in a comment ("this used to import api/simpleClient") is prose,
 * not a violation. The lexer blanks string contents too, so the matcher
 * finds an import's keyword in the masked text and reads its specifier
 * from the same offsets in the original: masking preserves length.
 *
 * Usage:
 *   node scripts/check-write-boundary.mjs           human report, exit 1 on a hit
 *   node scripts/check-write-boundary.mjs --json    machine-readable
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskSource } from './check-touch-dialects.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const COMPONENTS_ROOT = join(REPO_ROOT, 'interface', 'src', 'lib', 'components');

/** A specifier that names the OSC client, by alias or relative path. */
export const CLIENT_SPECIFIER = /(?:^|\/)api\/simpleClient(?:\.[jt]s)?$/;

/**
 * Where a module specifier's opening quote sits, found in MASKED text:
 * `from '…'`, `import '…'` (side-effect) and `import('…')` (dynamic).
 */
const IMPORT_KEYWORD = /\b(?:from|import)\s*\(?\s*(['"`])/g;

const MESSAGE =
	'imports the OSC client. Write through a named command in\n' +
	'      interface/src/lib/services/ (trackCommands, clipCommands, sessionCommands,\n' +
	'      deviceParams …), adding one there if none fits.';

function lineOf(source, index) {
	let line = 1;
	for (let i = 0; i < index; i++) if (source[i] === '\n') line += 1;
	return line;
}

/**
 * Every client import in one file. `source` is the original text; `ext`
 * picks the lexer. Exported for the test.
 */
export function violationsIn(source, ext, relPath) {
	const masked = maskSource(source, ext);
	const hits = [];
	IMPORT_KEYWORD.lastIndex = 0;
	let m;
	while ((m = IMPORT_KEYWORD.exec(masked)) !== null) {
		const quote = m[1];
		const open = m.index + m[0].length - 1;
		const close = source.indexOf(quote, open + 1);
		if (close === -1) continue;
		const specifier = source.slice(open + 1, close);
		if (!CLIENT_SPECIFIER.test(specifier)) continue;
		hits.push({
			file: relPath.split(sep).join('/'),
			line: lineOf(source, m.index),
			text: specifier
		});
	}
	return hits;
}

async function* walk(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walk(full);
		} else if (/\.(svelte|ts|js)$/.test(entry.name)) {
			yield full;
		}
	}
}

export async function scan(root = COMPONENTS_ROOT) {
	const found = [];
	for await (const file of walk(root)) {
		const source = await readFile(file, 'utf8');
		const ext = file.slice(file.lastIndexOf('.'));
		found.push(...violationsIn(source, ext, relative(root, file)));
	}
	return found;
}

// ---- CLI ---------------------------------------------------------------

const invokedDirectly =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
	const hits = await scan();
	if (process.argv.includes('--json')) {
		console.log(JSON.stringify(hits, null, 2));
		process.exit(hits.length ? 1 : 0);
	}
	if (!hits.length) {
		console.log('[write-boundary] clean — every component writes through services/');
		process.exit(0);
	}
	console.error(`[write-boundary] ${hits.length} violation(s):\n`);
	for (const hit of hits) {
		console.error(`  interface/src/lib/components/${hit.file}:${hit.line}  ${hit.text}`);
		console.error(`      ${MESSAGE}\n`);
	}
	process.exit(1);
}
