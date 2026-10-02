/**
 * Live's groove files, for Settings → Grooves and the Groove view (the groove
 * chooser, 2026-09-29).
 *
 * **Where they are.** `<Live app>/Contents/App-Resources/Core Library/Grooves/`,
 * in four folders — `Swing` (with `Basic`, `Logic`, `MPC`, `Notator`,
 * `SP 1200` under it), `Style`, `Percussion`, `Utility` — 219 files on the
 * home Mac. The app is the one `scripts/open-live.js` opens: `paths.abletonApp`,
 * else the Live whose version names the preferences folder written last, else
 * the newest installed. The surface loads a groove by its name through Live's
 * own browser, so only the names have to agree, and the 219 are unique by name.
 *
 * **What a card shows.** A `.agr` is a small MIDI clip plus the groove's
 * settings, gzipped or plain XML: `<Grid Value=…>` (1 = 1/8, 3 = 1/16, 5 = 1/32)
 * and `<MidiNoteEvent Time=… Velocity=…>`. The picture is its first 8 note
 * events, x = time / span and height = velocity / 127, where span is one step
 * per event of the step the notes themselves keep (their mean gap rounded to a
 * power of two of a beat: `Hip Hop Late 8ths` is gridded 1/16 but plays 8ths),
 * so a groove of fewer notes still spans the picture (four quarters land on
 * every other line, not in the first half). 103 of
 * the 219 are in Ableton's binary format (all of Logic and Notator, 9 MPC, 10
 * Percussion, 9 Style, 1 Utility, measured 2026-09-29): those carry no grid
 * and no picture rather than a guessed one.
 *
 * **Your own grooves** are the `.agr` files in the User Library's `Grooves`
 * folder (Live's `Library.cfg` says where the User Library is), in any
 * subfolder, listed first as "Your grooves" and named `User: <file>` so each
 * can be ticked beside a Core Library groove of the same name. That folder is
 * re-read on every listing, so a groove saved from Live shows up on the next
 * visit. A name holding `·`, `#` or `/` cannot be carried by the pool's naming
 * and is listed but cannot be ticked.
 *
 * **Which are ticked** is saved on the Mac in `logs/grooves.json`, IN TICK
 * ORDER — the order is the Groove view's tile order — the way the Places'
 * ticks are saved in `logs/places.json`. Nothing saved is a first run, which
 * starts from `DEFAULT_TICKS`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { logger } from '$lib/utils/logger';
import { GROOVE_GROUPS, USER_GROOVE_PREFIX, type GrooveEvent, type GrooveFile, type GroovesListing } from '$lib/types/grooves';
import { readLiveLibrary } from './places/liveLibrary';
import { configPath, repoRoot } from './runtimeConfig';

export { GROOVE_GROUPS, type GrooveEvent, type GrooveFile, type GroovesListing };

/** A first run's tiles: the approved design's twelve, all readable. */
export const DEFAULT_TICKS: readonly string[] = [
	'Swing 16ths 57',
	'Swing 16ths 64',
	'Swing 16ths 73',
	'Swing 8ths 73',
	'Swing 32nds 73',
	'Swing MPC 3000 16ths 74',
	'Swing MPC 3000 8ths 74',
	'Swing SP 1200 8ths 71',
	'Swing SP 1200 16ths 71',
	'Disco Live Feel 16ths',
	'Funk Late On The One 16ths',
	'Hip Hop Late 8ths'
];

// Live's Grid values. 1, 3 and 5 are the design's; the others follow the
// same order and were read off Quantize 4 / 8T / 16T (see the tests).
const GRID_LABELS: Record<number, string> = { 0: '1/4', 1: '1/8', 2: '1/8T', 3: '1/16', 4: '1/16T', 5: '1/32' };

const PICTURE_EVENTS = 8;

function attr(tag: string, name: string): string | null {
	const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
	return m ? m[1] : null;
}

/** A `.agr`'s grid and picture, or null for a file in Ableton's binary format. */
export function parseAgr(bytes: Buffer): { grid: string | null; events: GrooveEvent[] } | null {
	let buf = bytes;
	if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
		try {
			buf = gunzipSync(buf);
		} catch {
			return null;
		}
	}
	const xml = buf.toString('utf8');
	if (!xml.startsWith('<?xml')) return null;

	// The groove's own `<Grid Value=…/>` follows the clip; the clip's editor
	// grids are `<Grid>` elements with children and no Value.
	let grid: string | null = null;
	for (const m of xml.matchAll(/<Grid Value="(\d+)"/g)) grid = GRID_LABELS[Number(m[1])] ?? null;

	const notes: Array<{ t: number; vel: number }> = [];
	for (const m of xml.matchAll(/<MidiNoteEvent\b[^>]*>/g)) {
		const t = Number(attr(m[0], 'Time'));
		const vel = Number(attr(m[0], 'Velocity'));
		if (attr(m[0], 'IsEnabled') === 'false' || !Number.isFinite(t) || !Number.isFinite(vel)) continue;
		notes.push({ t, vel });
	}
	notes.sort((a, b) => a.t - b.t);
	const first = notes.slice(0, PICTURE_EVENTS);
	if (first.length < 2) return { grid, events: [] };

	const gap = (first[first.length - 1].t - first[0].t) / (first.length - 1);
	const step = gap > 0 ? 2 ** Math.round(Math.log2(gap)) : 0.25;
	const span = first.length * step;
	const events = first.map((n) => ({
		x: Math.min(1, Math.max(0, n.t / span)),
		v: Math.min(1, Math.max(0, n.vel / 127))
	}));
	return { grid, events };
}

/** Every `.agr` under `root`, grouped by the folder it sits in, in Settings' order —
 *  or, with `user`, all in one "User" group and named `User: <file>`. */
export function readGrooveLibrary(root: string, { user = false }: { user?: boolean } = {}): GrooveFile[] {
	const files: GrooveFile[] = [];
	const walk = (dir: string, group: string) => {
		let names: string[];
		try {
			names = readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
		} catch {
			return;
		}
		for (const n of names) {
			const p = join(dir, n);
			let isDir = false;
			try {
				isDir = statSync(p).isDirectory();
			} catch {
				continue;
			}
			if (isDir) walk(p, group ? `${group}/${n}` : n);
			else if (n.toLowerCase().endsWith('.agr')) {
				let parsed: ReturnType<typeof parseAgr> = null;
				try {
					parsed = parseAgr(readFileSync(p));
				} catch {
					parsed = null;
				}
				const stem = n.slice(0, -4);
				const file: GrooveFile = {
					name: user ? USER_GROOVE_PREFIX + stem : stem,
					group: user ? 'User' : group,
					grid: parsed?.grid ?? null,
					events: parsed ? parsed.events : null
				};
				if (/[·#/]/.test(stem)) file.blocked = 'Rename it without “·” or “#” to use it';
				files.push(file);
			}
		}
	};
	walk(root, '');
	if (user) {
		// One file per name: the first found, as the surface's lookup finds it.
		const seen = new Set<string>();
		return files.filter((f) => !seen.has(f.name) && !!seen.add(f.name));
	}
	const rank = (g: string) => {
		const i = GROOVE_GROUPS.findIndex((x) => x.id === g);
		return i < 0 ? GROOVE_GROUPS.length : i;
	};
	return files.sort((a, b) => rank(a.group) - rank(b.group));
}

interface LiveApp {
	app: string;
}

/** The `Grooves` folder of the Live `scripts/open-live.js` would open, or null. */
export function grooveRoot(): string | null {
	let found: LiveApp | null = null;
	try {
		const require = createRequire(import.meta.url);
		const { findLiveApp } = require(join(repoRoot(), 'scripts', 'open-live.js')) as {
			findLiveApp: (o: { configured?: string }) => LiveApp | null;
		};
		found = findLiveApp({ configured: configPath('abletonApp') });
	} catch (err) {
		logger.warn('Grooves: could not find the Live app', { component: 'grooves', err: String(err) });
	}
	if (!found) return null;
	const root = join(found.app, 'Contents', 'App-Resources', 'Core Library', 'Grooves');
	return existsSync(root) ? root : null;
}

/** The User Library's `Grooves` folder, or null. */
export function userGrooveRoot(): string | null {
	const lib = readLiveLibrary();
	return lib.userLibrary ? join(lib.userLibrary, 'Grooves') : null;
}

export function readGrooveTicks(file: string): { ticked: string[]; firstRun: boolean } {
	try {
		if (!existsSync(file)) return { ticked: [...DEFAULT_TICKS], firstRun: true };
		const raw = JSON.parse(readFileSync(file, 'utf8')) as { ticked?: unknown };
		const ticked = Array.isArray(raw.ticked) ? raw.ticked.filter((k): k is string => typeof k === 'string') : [];
		return { ticked: [...new Set(ticked)], firstRun: false };
	} catch {
		return { ticked: [], firstRun: false };
	}
}

/** Save `ticked` as given: its order is the Groove view's. */
export function writeGrooveTicks(file: string, ticked: string[]): void {
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	writeFileSync(tmp, JSON.stringify({ version: 1, ticked: [...new Set(ticked)], savedAt: new Date().toISOString() }, null, 2) + '\n');
	renameSync(tmp, file);
}

let library: { root: string; files: GrooveFile[] } | null = null;

/** The listing, the library read once per `Grooves` folder. */
export function groovesListing(
	root: string | null = grooveRoot(),
	ticksFile: string = join(repoRoot(), 'logs', 'grooves.json'),
	userRoot: string | null = userGrooveRoot()
): GroovesListing {
	if (root && library?.root !== root) library = { root, files: readGrooveLibrary(root) };
	const mine = userRoot && existsSync(userRoot) ? readGrooveLibrary(userRoot, { user: true }) : [];
	const files = [...mine, ...(root && library ? library.files : [])];
	const names = new Set(files.filter((f) => !f.blocked).map((f) => f.name));
	const { ticked, firstRun } = readGrooveTicks(ticksFile);
	return { root, userRoot, files, ticked: ticked.filter((n) => names.has(n)), firstRun };
}
