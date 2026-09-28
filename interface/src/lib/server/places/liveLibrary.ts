/**
 * Live's own record of its library (onboarding.plan.md §4): the Places in its
 * sidebar, its User Library and its installed Packs, read from the newest
 * `Library.cfg` (`../libraryCfg.ts` parses it). Every one is a candidate for a
 * tick in Settings; a ticked one is cataloged and becomes a rail button.
 *
 * Measured on this Mac on 2026-09-26 (Live 12.4.15b1, Live running): adding a
 * Place in Live's browser rewrote `Library.cfg` at once (09:49, Live still
 * running), and the index's `places` table listed the new Places, with their
 * files, within the minute. So the list can follow Live live, without a quit.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { decodeXmlEntities, libraryPlaces, newestLibraryCfg, type LivePlace } from '../libraryCfg';

export type SourceKind = 'place' | 'user-library' | 'pack';

/** One folder the browser can catalog: a sidebar Place, the User Library, or a Pack. */
export interface LibrarySource {
	/** Stable key: the kind and the absolute folder. Ticks are saved against it. */
	key: string;
	kind: SourceKind;
	/** The name Live shows. */
	name: string;
	/** Absolute folder. */
	path: string;
	/** Live's sidebar icon name, or ''. */
	icon: string;
	/** Whether the folder exists on this Mac right now (a Pack on an unmounted drive does not). */
	present: boolean;
}

export interface LiveLibrary {
	/** The `Library.cfg` read, or null when none was found. */
	cfgFile: string | null;
	/** Its mtime, for change detection. */
	cfgMtimeMs: number;
	/** The sidebar Places, in the sidebar's order. */
	places: LivePlace[];
	/** The User Library folder, or null. */
	userLibrary: string | null;
	/** The Packs folder, or null. */
	packsFolder: string | null;
	/** Installed Packs (`LibrarySliceInfo`), by name. */
	packs: Array<{ name: string; path: string }>;
}

export const DEFAULT_PREFS_DIR = join(process.env.HOME ?? '', 'Library/Preferences/Ableton');

export function sourceKey(kind: SourceKind, path: string): string {
	return `${kind}:${path.replace(/\/+$/, '')}`;
}

/** The User Library folder a `Library.cfg` names (`ProjectPath` + `ProjectName`). */
export function userLibraryOf(xml: string): string | null {
	const project = /<LibraryProject\b[^>]*>([\s\S]*?)<\/LibraryProject>/.exec(xml);
	const dir = project && /<ProjectPath\s+Value="([^"]*)"/.exec(project[1]);
	const name = project && /<ProjectName\s+Value="([^"]*)"/.exec(project[1]);
	if (!dir || !name) return null;
	const p = posix.join(decodeXmlEntities(dir[1]), decodeXmlEntities(name[1]));
	return p.startsWith('/') ? p : null;
}

/** The installed Packs a `Library.cfg` lists (`LibrarySliceInfo`), in file order. */
export function packsOf(xml: string): Array<{ name: string; path: string }> {
	const packs: Array<{ name: string; path: string }> = [];
	for (const m of xml.matchAll(/<LibrarySliceInfo\b[^>]*>/g)) {
		const path = /\sPath="([^"]*)"/.exec(m[0]);
		if (!path) continue;
		const p = decodeXmlEntities(path[1]);
		if (!p.startsWith('/')) continue;
		const name = /\sDisplayName="([^"]*)"/.exec(m[0]);
		packs.push({ name: name ? decodeXmlEntities(name[1]) : posix.basename(p), path: p });
	}
	return packs;
}

export function packsFolderOf(xml: string): string | null {
	const m = /<PreferredFactoryPacksInstallationPath\s+Value="([^"]*)"/.exec(xml);
	const p = m ? decodeXmlEntities(m[1]) : '';
	return p.startsWith('/') ? p : null;
}

/** Parse one `Library.cfg`'s text. */
export function parseLiveLibrary(xml: string, cfgFile: string | null = null, cfgMtimeMs = 0): LiveLibrary {
	return {
		cfgFile,
		cfgMtimeMs,
		places: libraryPlaces(xml),
		userLibrary: userLibraryOf(xml),
		packsFolder: packsFolderOf(xml),
		packs: packsOf(xml)
	};
}

/** Read the newest `Library.cfg` under `prefsDir`; an empty library when there is none. */
export function readLiveLibrary(prefsDir = DEFAULT_PREFS_DIR): LiveLibrary {
	const cfgFile = newestLibraryCfg(prefsDir);
	if (!cfgFile) return { cfgFile: null, cfgMtimeMs: 0, places: [], userLibrary: null, packsFolder: null, packs: [] };
	try {
		const xml = readFileSync(cfgFile, 'utf8');
		return parseLiveLibrary(xml, cfgFile, statSync(cfgFile).mtimeMs);
	} catch {
		return { cfgFile, cfgMtimeMs: 0, places: [], userLibrary: null, packsFolder: null, packs: [] };
	}
}

/**
 * Every folder a user can tick, in the order Settings lists them: the sidebar
 * Places in Live's order, then the User Library, then the Packs A→Z.
 */
export function librarySources(lib: LiveLibrary, exists: (p: string) => boolean = existsSync): LibrarySource[] {
	const out: LibrarySource[] = [];
	const seen = new Set<string>();
	const add = (kind: SourceKind, name: string, path: string, icon = '') => {
		const clean = path.replace(/\/+$/, '');
		const key = sourceKey(kind, clean);
		if (seen.has(key)) return;
		seen.add(key);
		out.push({ key, kind, name, path: clean, icon, present: exists(clean) });
	};
	for (const p of lib.places) add('place', p.name, p.path, p.icon);
	if (lib.userLibrary) add('user-library', 'User Library', lib.userLibrary);
	for (const p of [...lib.packs].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))) {
		add('pack', p.name, p.path);
	}
	return out;
}
