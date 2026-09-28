/**
 * Reading Live's own `Library.cfg`: the Places in its sidebar, its User Library
 * and its packs.
 *
 * **Dependency-free on purpose** (no `$config`, no `$lib`): the Places catalog
 * diff script (`scripts/places-diff.ts`) imports it under `tsx`, where
 * SvelteKit's aliases do not resolve, beside `sampleRoots.ts` on the server.
 *
 * `Library.cfg` is Live's undocumented internal format, so everything here reads
 * it defensively: a missing attribute yields nothing rather than a throw.
 * Measured 2026-09-24 on Live 12.4.15b4 (browser-places plan, Phase 0):
 * `UserFolderInfoList` lists every Place **in exactly the sidebar's order**, the
 * ones inside the User Library included — which `browser.user_folders` omits.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

export function decodeXmlEntities(s: string): string {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&amp;/g, '&');
}

/** One Place in Live's sidebar. */
export interface LivePlace {
	/** Absolute folder. */
	path: string;
	/** The name Live shows (`DisplayName`), else the folder's own name. */
	name: string;
	/** Live's sidebar icon (`IconName`, e.g. `Sidebar/Sidebar_Drums`), or `''`. */
	icon: string;
}

function attribute(tag: string, name: string): string | null {
	const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
	return m ? decodeXmlEntities(m[1]) : null;
}

/** Every Place (`UserFolderInfo`) in a `Library.cfg`, in sidebar order. */
export function libraryPlaces(xml: string): LivePlace[] {
	const places: LivePlace[] = [];
	for (const m of xml.matchAll(/<UserFolderInfo\b[^>]*>/g)) {
		const path = attribute(m[0], 'Path');
		if (!path || !path.startsWith('/')) continue;
		const name = attribute(m[0], 'DisplayName') || posix.basename(path.replace(/\/+$/, ''));
		places.push({ path, name, icon: attribute(m[0], 'IconName') ?? '' });
	}
	return places;
}

/**
 * The folders a `Library.cfg` lists as Live's library: every Place
 * (`UserFolderInfo`), every installed pack (`LibrarySliceInfo`), the packs
 * folder, and the User Library (`ProjectPath` + `ProjectName`).
 */
export function liveLibraryRoots(xml: string): string[] {
	const roots: string[] = [];
	for (const m of xml.matchAll(/<(?:UserFolderInfo|LibrarySliceInfo)\b[^>]*?\sPath="([^"]*)"/g)) {
		roots.push(decodeXmlEntities(m[1]));
	}
	const packs = /<PreferredFactoryPacksInstallationPath\s+Value="([^"]*)"/.exec(xml);
	if (packs) roots.push(decodeXmlEntities(packs[1]));
	const project = /<LibraryProject\b[^>]*>([\s\S]*?)<\/LibraryProject>/.exec(xml);
	const dir = project && /<ProjectPath\s+Value="([^"]*)"/.exec(project[1]);
	const name = project && /<ProjectName\s+Value="([^"]*)"/.exec(project[1]);
	if (dir && name) roots.push(posix.join(decodeXmlEntities(dir[1]), decodeXmlEntities(name[1])));
	return roots.filter((r) => r.startsWith('/'));
}

/**
 * The `Library.cfg` Live wrote last, by mtime: the Live in use. Not by version
 * string — `install.sh` measured that trap (`Live 12.4b7` sorts after every
 * `Live 12.4.x`).
 */
export function newestLibraryCfg(prefsDir: string): string | null {
	let names: string[];
	try {
		names = readdirSync(prefsDir);
	} catch {
		return null;
	}
	let newest: string | null = null;
	let newestMtime = -Infinity;
	for (const name of names) {
		const file = join(prefsDir, name, 'Library.cfg');
		let mtime: number;
		try {
			mtime = statSync(file).mtimeMs;
		} catch {
			continue;
		}
		if (mtime > newestMtime) {
			newestMtime = mtime;
			newest = file;
		}
	}
	return newest;
}
