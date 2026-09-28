/**
 * Which Places are ticked (onboarding.plan.md §2, §6.2): saved on the Mac, in
 * `<repo>/logs/places.json`, the way the surface saves the foot switch in
 * `logs/foot-switch.json`. Any client can tick one; the file is the truth.
 *
 * **Nothing saved means a first run.** On a Mac with nothing saved the Places
 * inside `paths.sidebarRoot` are pre-ticked (the rig's seven), so the rig does
 * not change; on any other Mac nothing is, since most people's Places include
 * Desktop and Downloads. The first save, even of no ticks, ends the first run.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface TicksFile {
	version: 1;
	/** Source keys (`liveLibrary.sourceKey`) that are ticked. */
	ticked: string[];
	savedAt: string;
}

export interface Ticks {
	ticked: Set<string>;
	/** No file has ever been saved on this Mac. */
	firstRun: boolean;
	mtimeMs: number;
}

export function readTicks(file: string): Ticks {
	try {
		if (!existsSync(file)) return { ticked: new Set(), firstRun: true, mtimeMs: 0 };
		const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<TicksFile>;
		const ticked = Array.isArray(raw.ticked) ? raw.ticked.filter((k): k is string => typeof k === 'string') : [];
		return { ticked: new Set(ticked), firstRun: false, mtimeMs: statMtime(file) };
	} catch {
		// An unreadable file is not a first run: someone saved something once.
		return { ticked: new Set(), firstRun: false, mtimeMs: statMtime(file) };
	}
}

function statMtime(file: string): number {
	try {
		return statSync(file).mtimeMs;
	} catch {
		return 0;
	}
}

export function writeTicks(file: string, ticked: Iterable<string>): TicksFile {
	const data: TicksFile = { version: 1, ticked: [...new Set(ticked)].sort(), savedAt: new Date().toISOString() };
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
	renameSync(tmp, file);
	return data;
}

/** The seed for a Mac with nothing saved: every key whose path lies under `sidebarRoot`. */
export function seedTicks(keys: Array<{ key: string; path: string }>, sidebarRoot: string | undefined): Set<string> {
	if (!sidebarRoot) return new Set();
	const root = sidebarRoot.replace(/\/+$/, '');
	return new Set(keys.filter((k) => k.path.startsWith(`${root}/`)).map((k) => k.key));
}
