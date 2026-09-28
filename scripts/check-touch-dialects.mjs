#!/usr/bin/env node
/**
 * Guard the pointer invariant (ADR-427).
 *
 * The interface used to speak four input dialects. Two of them cannot
 * carry two fingers:
 *
 *   `touches[0]` / `changedTouches[0]`
 *       *the first finger currently on the glass*, not the finger that
 *       started this gesture. A control reading it does not ignore the
 *       second hand — it follows it, and writes the wrong value to Live.
 *
 *   `onclick` on the performance surface
 *       iOS synthesizes at most one click per gesture, so two controls
 *       pressed together produce one action. `click` also disappears
 *       entirely when the browser claims the gesture, which on a
 *       `touch-action: auto` node inside a scrolling panel it is free to
 *       do — the trap that broke mute.
 *
 * Both were removed in full. This is what keeps them removed: a codebase
 * with 106 `onclick`s grows a 107th, and the two failures above are
 * invisible on a desktop browser and on this repo's own screenshot
 * harness. They are only felt with two hands on an iPad, which is to say
 * mid-performance.
 *
 * The replacement is `use:press` / `use:drag` (`$lib/actions/`), which
 * bind the handler and the node's `touch-action` in one place so they
 * cannot drift apart.
 *
 * ## Scope
 *
 * `touches[0]` is banned across all of `interface/src/lib` — there is no
 * correct use of it left anywhere.
 *
 * `onclick` is banned only under the five performance-surface
 * directories, the ones a performer touches with two hands mid-set:
 *
 *     components/v6/tracks   layout   session   clips   controls
 *
 * Deliberately NOT banned in `central/views/**` and the rest: those are
 * one-at-a-time device editing panels where a click is honest, and a
 * gate that fails on 81 sites nobody has a reason to change is a gate
 * everybody passes with `--no-verify`. See ADR-427's tier 4.
 *
 * ## Why a hand-written lexer
 *
 * A `touches[0]` inside a comment is prose — several of the components
 * this program touched now carry a comment saying exactly what they used
 * to read and why it was wrong, which a `grep` counts as a violation.
 * Same for `onclick` in the notes explaining why it went. So this masks
 * comments (and, in script, string literals) before matching.
 *
 * A `.svelte` file is lexed in three parts, because it is three
 * languages: `<script>` gets the JS lexer, `<style>` gets block comments
 * only, and the markup gets `<!-- -->` only. Running one JS lexer over
 * the whole file would take an apostrophe in a text node as the start of
 * a string literal and mask the rest of the file.
 *
 * Usage:
 *   node scripts/check-touch-dialects.mjs           human report, exit 1 on a hit
 *   node scripts/check-touch-dialects.mjs --json    machine-readable
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB_ROOT = join(REPO_ROOT, 'interface', 'src', 'lib');

/** Directories a performer touches with two hands mid-set. */
export const PERFORMANCE_SURFACE = [
	'components/v6/tracks',
	'components/v6/layout',
	'components/v6/session',
	'components/v6/clips',
	'components/v6/controls'
];

/**
 * Mask every character of the ranges a matcher must not see, preserving
 * length and newlines so offsets still map to line numbers.
 */
function blank(source, from, to) {
	let out = '';
	for (let i = from; i < to; i++) out += source[i] === '\n' ? '\n' : ' ';
	return out;
}

/**
 * Mask JS comments and string literals. Handles `//`, block comments, the
 * three quote styles, and escapes.
 *
 * Template literals are masked whole, `${}` included. Nothing this gate
 * looks for can legitimately live in one, and tracking interpolation
 * depth would buy nothing.
 */
export function maskScript(source) {
	let out = '';
	let i = 0;
	while (i < source.length) {
		const c = source[i];
		const next = source[i + 1];

		if (c === '/' && next === '/') {
			const end = source.indexOf('\n', i);
			const stop = end === -1 ? source.length : end;
			out += blank(source, i, stop);
			i = stop;
			continue;
		}
		if (c === '/' && next === '*') {
			const end = source.indexOf('*/', i + 2);
			const stop = end === -1 ? source.length : end + 2;
			out += blank(source, i, stop);
			i = stop;
			continue;
		}
		if (c === '"' || c === "'" || c === '`') {
			let j = i + 1;
			while (j < source.length) {
				if (source[j] === '\\') {
					j += 2;
					continue;
				}
				if (source[j] === c) {
					j += 1;
					break;
				}
				j += 1;
			}
			// Keep the quotes themselves: only the contents are masked, so
			// a report's column still lands on something recognisable.
			out += c + blank(source, i + 1, Math.max(i + 1, j - 1)) + (j - 1 > i ? source[j - 1] : '');
			i = j;
			continue;
		}
		out += c;
		i += 1;
	}
	return out;
}

/** Mask `<!-- -->` comments only. For Svelte markup. */
export function maskMarkup(source) {
	let out = '';
	let i = 0;
	while (i < source.length) {
		if (source.startsWith('<!--', i)) {
			const end = source.indexOf('-->', i + 4);
			const stop = end === -1 ? source.length : end + 3;
			out += blank(source, i, stop);
			i = stop;
			continue;
		}
		out += source[i];
		i += 1;
	}
	return out;
}

/** Mask CSS block comments. For `<style>`. */
export function maskStyle(source) {
	let out = '';
	let i = 0;
	while (i < source.length) {
		if (source.startsWith('/*', i)) {
			const end = source.indexOf('*/', i + 2);
			const stop = end === -1 ? source.length : end + 2;
			out += blank(source, i, stop);
			i = stop;
			continue;
		}
		out += source[i];
		i += 1;
	}
	return out;
}

/**
 * Mask a whole source file, choosing the lexer per region.
 *
 * A `.svelte` file is three languages in one, and the choice matters:
 * one JS lexer over the whole thing reads the apostrophe in a markup
 * text node as an unterminated string and masks everything after it.
 */
export function maskSource(source, ext) {
	if (ext !== '.svelte') return maskScript(source);

	let out = '';
	let i = 0;
	const open = /<(script|style)\b[^>]*>/gi;
	let m;
	while ((m = open.exec(source)) !== null) {
		if (m.index < i) continue;
		const tag = m[1].toLowerCase();
		const bodyStart = m.index + m[0].length;
		const closeIdx = source.toLowerCase().indexOf(`</${tag}>`, bodyStart);
		const bodyEnd = closeIdx === -1 ? source.length : closeIdx;

		out += maskMarkup(source.slice(i, bodyStart));
		const body = source.slice(bodyStart, bodyEnd);
		out += tag === 'script' ? maskScript(body) : maskStyle(body);
		i = bodyEnd;
		open.lastIndex = bodyEnd;
	}
	out += maskMarkup(source.slice(i));
	return out;
}

/** The banned patterns, and what to say when one is found. */
export const RULES = [
	{
		id: 'touches-index',
		pattern: /\b(?:changedTouches|touches)\s*\[\s*0\s*\]/g,
		scope: 'all',
		message:
			'reads the first finger on the glass, not the finger that owns this gesture.\n' +
			'      Use `use:drag` / `use:press` from $lib/actions (ADR-427).'
	},
	{
		id: 'onclick-performance-surface',
		// `onclick={...}` (Svelte 5) and `on:click` (legacy) alike.
		pattern: /\bon:?click\b/g,
		scope: 'performance-surface',
		message:
			'click is not an input primitive on the performance surface —\n' +
			'      iOS synthesizes at most one per gesture, and a browser that claims\n' +
			'      the gesture suppresses it entirely. Use `use:press` (ADR-427).'
	}
];

function inPerformanceSurface(relPath) {
	const posix = relPath.split(sep).join('/');
	return PERFORMANCE_SURFACE.some((dir) => posix.startsWith(`${dir}/`));
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

function lineOf(source, index) {
	let line = 1;
	for (let i = 0; i < index; i++) if (source[i] === '\n') line += 1;
	return line;
}

/** Scan one file's already-masked text. Exported for the test. */
export function violationsIn(masked, relPath) {
	const hits = [];
	for (const rule of RULES) {
		if (rule.scope === 'performance-surface' && !inPerformanceSurface(relPath)) continue;
		rule.pattern.lastIndex = 0;
		let m;
		while ((m = rule.pattern.exec(masked)) !== null) {
			hits.push({
				rule: rule.id,
				file: relPath.split(sep).join('/'),
				line: lineOf(masked, m.index),
				text: m[0],
				message: rule.message
			});
		}
	}
	return hits;
}

export async function scan(root = LIB_ROOT) {
	const found = [];
	for await (const file of walk(root)) {
		const source = await readFile(file, 'utf8');
		const ext = file.slice(file.lastIndexOf('.'));
		const masked = maskSource(source, ext);
		found.push(...violationsIn(masked, relative(root, file)));
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
		console.log('[touch-dialects] clean — every interaction is owned by one pointerId');
		process.exit(0);
	}
	console.error(`[touch-dialects] ${hits.length} violation(s):\n`);
	for (const hit of hits) {
		console.error(`  interface/src/lib/${hit.file}:${hit.line}  ${hit.text}`);
		console.error(`      ${hit.message}\n`);
	}
	process.exit(1);
}
