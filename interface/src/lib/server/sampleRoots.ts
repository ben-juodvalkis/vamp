/**
 * The folders `/api/sample-peaks` and `/api/similar-samples` answer for
 * (general-release audit §5.3, 2026-09-23).
 *
 * Both routes live on the interface server, which listens on 0.0.0.0 so the
 * iPad can reach it, and neither sits behind the WebSocket's HMAC gate. Before
 * this, `sample-peaks` opened any absolute path a LAN host named — `/etc`,
 * `~/.ssh` — and answered 404 / 415 / 413 by what was there: an existence and
 * size oracle over the whole disk, and a decode of any large file on the event
 * loop that serves every waveform.
 *
 * A path is allowed when it names a sample file (audio, or a Live clip — see
 * `SAMPLE_EXTENSIONS`) and, **as written**, lies under one of:
 *
 * - **the configured library** — `paths.userLibraryBase` (which holds the
 *   browser's Places), `abletonPacksBase` and every `placesRoots` value;
 * - **Live's own library, read from Live** — the Places, the User Library and
 *   the installed packs in the newest `Library.cfg`, and the Core Library of
 *   every Live app in `/Applications`;
 * - **a Live project** — any folder holding `Ableton Project Info`, which is how
 *   Live marks one: a saved set's folder, where its recordings and the
 *   recorder's captures land, and the temp project an unsaved set records
 *   into — the recorder's included, since 2026-09-27.
 *
 * The list is what the rig was measured to need, 2026-09-23, not a guess. Every
 * audio-clip and Simpler sample the 258 sets saved in the prior 120 days refer
 * to (31,405 references), all 76 recorder captures, all 75,884 catalog paths
 * and all 455,904 files Live's index can rank pass, run through this module.
 * The configured library alone admitted 13,576 of those references and 126,742
 * of the rankable files. The rest: Live's Places (Native Instruments
 * Expansions and Ben Multisamples are Places but not `placesRoots`, and hold
 * 322,603 rankable files and 176 clip references between them); projects under
 * `Raw Class Sessions`, which is no Place at all (14,833 references); the
 * owner's old unsaved-set capture folder (72 of the 76 captures; no root since
 * 2026-09-27, when the recorder moved to Live's temp projects — adding it as a
 * Place in Live makes it readable again); and the **Suite** app's Core Library,
 * 3,563 files the shared index ranks while the rig runs the Beta. Live's Places
 * on this Mac include Desktop and Downloads, so audio there is readable through
 * these routes too; removing a Place from Live's browser removes it here
 * within a minute.
 *
 * **As written, not resolved.** A library can reach files under no root
 * through its own symlinks — the old `Audio Samples` folder was 53,907 of them,
 * 10,076 into `Soundbanks/8dio/Voices Normalized` (the Places copy cloned
 * those, 2026-09-24) — so the check runs on the lexical path and the user's
 * own symlinks are followed after it. That makes the normalized path the only one a route may open:
 * `<root>/link/../x.wav` is `<root>/x.wav` lexically but `<link target>/../x.wav`
 * physically, so resolving the raw string would walk out of the root.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix } from 'node:path';
import { runtimeConstants } from './runtimeConfig';
import { liveLibraryRoots, newestLibraryCfg } from './libraryCfg';

// The Library.cfg readers moved to `libraryCfg.ts` (2026-09-24) so the Places
// catalog builder can share them under tsx; re-exported for this module's callers.
export { liveLibraryRoots, newestLibraryCfg };

/** The folder Live creates in every project folder, and so what makes one. */
export const LIVE_PROJECT_MARKER = 'Ableton Project Info';

/**
 * What these routes are ever asked about: audio, the video containers Live
 * takes audio from, REX loops and Live clips. Measured 2026-09-23, every path
 * the rig asked for — clip, Simpler, capture, catalog — was .aif .aiff .wav
 * .mp3 .m4a .mov .caf or .alc, in either case. It is what keeps the project
 * rule to recordings: this repo's own root holds a stray, empty
 * `Ableton Project Info` (a set was once saved there), which made every file
 * in the checkout, `config/.ws-secret` included, "inside a Live project".
 */
const SAMPLE_EXTENSIONS = new Set([
	'.wav', '.wave', '.aif', '.aiff', '.aifc', '.flac', '.ogg', '.oga', '.opus', '.mp3',
	'.m4a', '.mp4', '.aac', '.caf', '.mov', '.rx2', '.rex', '.rcy', '.alc'
]);

/** Live writes `Library.cfg` when a Place changes; a minute bounds how stale this can be. */
const ROOTS_TTL_MS = 60_000;

const APPLICATIONS_DIR = '/Applications';

interface ConfiguredPaths {
	userLibraryBase?: string;
	abletonPacksBase?: string;
	placesRoots?: Record<string, string>;
	abletonApp?: string;
}

/**
 * `raw` as the one absolute, lexically normalized path a route may touch, or
 * null. `.` and `..` collapse here, before any filesystem call, so the string
 * checked and the string opened are the same.
 */
export function normalizeSamplePath(raw: string | null | undefined): string | null {
	if (typeof raw !== 'string' || !raw.startsWith('/') || raw.includes('\0')) return null;
	return posix.normalize(raw);
}

/** The form paths are compared in: NFC, because macOS hands out either form, and no trailing slash. */
function comparable(p: string): string {
	const n = posix.normalize(p).normalize('NFC');
	return n.length > 1 && n.endsWith('/') ? n.slice(0, -1) : n;
}

/** Whether `path` is `root` or lies beneath it, at a segment boundary: `/a/bc` is not under `/a/b`. */
export function isUnderRoot(path: string, root: string): boolean {
	const p = comparable(path);
	const r = comparable(root);
	return p === r || p.startsWith(`${r}/`);
}

function directoryExists(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

/** Whether a folder above `path` holds `Ableton Project Info`, i.e. `path` is inside a Live project. */
export function isInsideLiveProject(
	path: string,
	isDirectory: (p: string) => boolean = directoryExists
): boolean {
	for (let dir = posix.dirname(path); dir !== '/' && dir !== '.'; dir = posix.dirname(dir)) {
		if (isDirectory(posix.join(dir, LIVE_PROJECT_MARKER))) return true;
	}
	return false;
}

/** The Core Library inside every Live app in `appsDir`, plus `extraApps`. */
export function coreLibraryRoots(appsDir: string, extraApps: readonly string[] = []): string[] {
	let names: string[] = [];
	try {
		names = readdirSync(appsDir);
	} catch {
		// No apps folder: only the configured app counts.
	}
	const apps = [
		...names.filter((n) => /^Ableton Live\b.*\.app$/.test(n)).map((n) => join(appsDir, n)),
		...extraApps
	];
	return apps.map((app) => join(app, 'Contents', 'App-Resources', 'Core Library'));
}

function expandHome(p: string): string {
	return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}

function configuredRoots(paths: ConfiguredPaths | undefined): string[] {
	if (!paths) return [];
	const places = Object.entries(paths.placesRoots ?? {})
		.filter(([name]) => !name.startsWith('_'))
		.map(([, root]) => root);
	return [
		paths.userLibraryBase,
		paths.abletonPacksBase,
		...places
	].filter((p): p is string => typeof p === 'string' && p.length > 0);
}

function readRoots(): string[] {
	const paths = (runtimeConstants() as { paths?: ConfiguredPaths }).paths;
	let fromLive: string[] = [];
	const cfg = newestLibraryCfg(join(homedir(), 'Library', 'Preferences', 'Ableton'));
	if (cfg) {
		try {
			fromLive = liveLibraryRoots(readFileSync(cfg, 'utf8'));
		} catch {
			// Unreadable: the configured roots and projects still apply.
		}
	}
	const apps = paths?.abletonApp ? [paths.abletonApp] : [];
	const roots = [...configuredRoots(paths), ...fromLive, ...coreLibraryRoots(APPLICATIONS_DIR, apps)]
		.map(expandHome)
		.filter((r) => r.startsWith('/') && comparable(r) !== '/');
	return [...new Set(roots)];
}

let cached: { at: number; roots: string[] } | null = null;
let pinned: string[] | null = null;

/** Every root a sample path may lie under, re-read at most once a minute. */
export function sampleRoots(now: number = Date.now()): string[] {
	if (pinned) return pinned;
	if (!cached || now - cached.at >= ROOTS_TTL_MS) cached = { at: now, roots: readRoots() };
	return cached.roots;
}

/** Tests only: pin the roots; `null` goes back to reading them. */
export function _pinSampleRootsForTests(roots: string[] | null): void {
	pinned = roots;
	cached = null;
}

/** Whether `path` names a file the sample routes deal in, by extension, in either case. */
export function hasSampleExtension(path: string): boolean {
	return SAMPLE_EXTENSIONS.has(posix.extname(path).toLowerCase());
}

/**
 * Whether a normalized path (see `normalizeSamplePath`) is one the sample
 * routes may open: a sample file under a root or inside a Live project.
 */
export function isAllowedSamplePath(
	path: string,
	roots: readonly string[] = sampleRoots(),
	isDirectory: (p: string) => boolean = directoryExists
): boolean {
	if (!hasSampleExtension(path)) return false;
	return roots.some((root) => isUnderRoot(path, root)) || isInsideLiveProject(path, isDirectory);
}
