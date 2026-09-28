/**
 * What a preset's file path means — the one place that reads it.
 *
 * The browser's library is the Places (browser-places plan): one folder per
 * rail button under `<instrumentsBase>/Sidebar/<Place>/…`, each Place named
 * for the role it holds (`Drum`, `Key`, …). Before the cutover (2026-09-24) it
 * was `<instrumentsBase>/<Vendor>/<Type>/…`, and paths in that shape outlive
 * it in saved Sets (`looping.preset`) and in Recent — the Places index's alias
 * map (`aliasPresetPath`, below) turns them into their copies.
 *
 * Both shapes read the same way here: the folder under the library's first
 * level is the category (`Omni/Drum/…`, `Sidebar/Drum/…`), which is what the
 * device band and track coloring's no-Place fallback read.
 *
 * **Dependency-free on purpose.** The Places catalog generator
 * (`scripts/places-diff.ts`, through `$lib/server/places/diskScan.ts`) imports this under `tsx`, where
 * SvelteKit's `$config` and `$lib` aliases do not resolve — so nothing here
 * reads `constants.json`; the caller passes the roots in.
 */

/** A path's segments, tolerating back slashes and doubled or trailing slashes. */
export function pathSegments(path: string): string[] {
	return path.replace(/\\/g, '/').split('/').filter(Boolean);
}

/**
 * The catalog generator's rule for turning a folder name into an id and a file
 * name: lowercase, every character outside `a-z0-9` becomes `-`, and runs of
 * `-` collapse. A Place's id — its rail id `place:<id>` and its `<id>.json` —
 * is this of its name.
 *
 * It keeps a leading or trailing `-`: changing it changes every generated file
 * name, and every rail id the browser remembers a path under.
 */
export function folderSlug(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
}

/** `fullPath` relative to `base`, or null when it lies outside it. */
export function libraryRelativePath(fullPath: string, base: string): string | null {
	if (!fullPath || !base) return null;
	const root = `${base.replace(/\/+$/, '')}/`;
	return fullPath.startsWith(root) ? fullPath.slice(root.length) : null;
}

/** Folder name → performance role (ADR-399). The primary role-resolution table. */
const CATEGORY_SYNONYMS: Record<string, string> = {
	drum: 'drum',
	drums: 'drum',
	drumset: 'drum',
	drumsets: 'drum',
	bass: 'bass',
	fx: 'fx',
	effects: 'fx',
	inst: 'inst',
	instrument: 'inst',
	instruments: 'inst',
	key: 'key',
	keys: 'key',
	keyboard: 'key',
	keyboards: 'key',
	perc: 'perc',
	percs: 'perc',
	percussion: 'perc',
	synth: 'synth',
	synths: 'synth',
	lead: 'synth',
	leads: 'synth',
	pad: 'synth',
	pads: 'synth'
};

/**
 * The role one folder's own name gives (`Drum` → `drum`, `Keys` → `key`), or
 * null. A browser Place's role is this of its name (browser-places plan §2),
 * the same table a preset's category folder is read through.
 */
export function categoryForFolderName(name: string): string | null {
	return CATEGORY_SYNONYMS[name.trim().toLowerCase()] ?? null;
}

/**
 * The performance role (drum / bass / fx / inst / key / perc / synth) the
 * deepest folder of a path names, or null when none does.
 *
 * Only for a path from OUTSIDE the library, where there is no category folder
 * to read — {@link presetCategory} is the reading for everything else, and
 * falls back to this. Over the library itself this answers wrong for 13,504
 * of 44,577 preset files (measured 2026-09-18), because a category folder
 * holds subfolders that are also category names: all 3,208 Omnisphere Drum
 * presets sit under `Omni/Drum/Synth/…` and read as synth, fx or perc.
 *
 * It was the whole rule from 2026-08-28 to 2026-09-18. A kit loaded from
 * Recent (the Plymouth Kit) handed the recorder its ABSOLUTE path, whose
 * segment 1 is `Shared`, so no category was read and no color written;
 * scanning deepest-first fixed that one load and moved every catalog load
 * off the folder ADR-399 colors by. Filenames can't false-match — their
 * extensions keep them out of the synonym table.
 */
export function categoryFromPresetPath(presetPath: string): string | null {
	if (!presetPath) return null;
	const parts = pathSegments(presetPath);
	for (let i = parts.length - 1; i >= 0; i--) {
		const hit = CATEGORY_SYNONYMS[parts[i].toLowerCase()];
		if (hit) return hit;
	}
	return null;
}

/**
 * A library-relative path's category folder — segment 1, under the vendor
 * (`Omni/Drum/…`) or the Sidebar (`Sidebar/Drum/…`) — and the folders between
 * it and the file, top down. Null when segment 1 is not a category, or is the
 * file itself.
 */
function categoryFolderOf(relative: string): { category: string; folders: string[] } | null {
	const [, type, ...rest] = pathSegments(relative);
	if (!type || rest.length === 0) return null;
	const category = CATEGORY_SYNONYMS[type.toLowerCase()];
	return category ? { category, folders: rest.slice(0, -1) } : null;
}

/**
 * The category a preset is filed under in the instrument library — its Place,
 * `<instrumentsBase>/Sidebar/<Place>/…`, or before the cutover the folder
 * right under its vendor, `<instrumentsBase>/<Vendor>/<Category>/…` — with the
 * folders between it and the file, top down. Null when the path is outside
 * the library, or that folder is not a category (a Place named for something
 * else; the xFull kits, which file under their own names, `xFull/Damage/…`).
 *
 * The strip's device band reads this rather than {@link presetCategory}
 * because it needs the folders too: Inst is read one folder down.
 */
export function libraryCategoryOfPreset(
	fullPath: string,
	instrumentsBase: string
): { category: string; folders: string[] } | null {
	const relative = libraryRelativePath(fullPath, instrumentsBase);
	return relative === null ? null : categoryFolderOf(relative);
}

/**
 * The category a preset path names, for a load with no Place behind it — a
 * Recent entry outside every Place (track coloring, ADR-399 / ADR-425; a load
 * from a Place carries its Place's role instead).
 *
 * 1. **The category folder**, when the path has the library's shape: relative
 *    (`<Vendor>/<Category>/…`), or absolute under `instrumentsBase` (a Recent
 *    item carries its absolute path).
 * 2. **The deepest folder that names one** (`categoryFromPresetPath`)
 *    otherwise — an off-library path, or a library path whose type folder is
 *    not a category (xFull). For a library path the scan runs on the RELATIVE
 *    path, so the library root "Instruments" can never read as `inst`.
 */
export function presetCategory(presetPath: string, instrumentsBase: string): string | null {
	if (!presetPath) return null;
	const relative = presetPath.startsWith('/')
		? libraryRelativePath(presetPath, instrumentsBase)
		: presetPath;
	if (relative === null) return categoryFromPresetPath(presetPath);
	return categoryFolderOf(relative)?.category ?? categoryFromPresetPath(relative);
}

/**
 * Old path → new path for the library the browser-places copy made (the
 * one-time copy of 2026-09-24): one prefix rule per copied source folder
 * (`<instrumentsBase>/Omni/Drum/` → `<sidebarRoot>/Drum/`), plus the exact
 * entries a rule would get wrong (a collision rename). Built from the copy's
 * manifest (`scripts/placesManifest.ts`) into `places/index.json`, and read by
 * Recent and the swap pill so a path recorded before the Places finds its
 * copy.
 */
export interface PlaceAliasMap {
	rules: Array<{ from: string; to: string }>;
	exceptions: Record<string, string>;
}

/** The new path for `oldPath`, or `oldPath` itself when no rule covers it. Rules end in `/`, so a folder boundary holds. */
export function aliasPresetPath(map: PlaceAliasMap | null | undefined, oldPath: string): string {
	if (!map || !oldPath) return oldPath;
	const exact = map.exceptions?.[oldPath];
	if (exact) return exact;
	for (const r of map.rules ?? []) if (oldPath.startsWith(r.from)) return r.to + oldPath.slice(r.from.length);
	return oldPath;
}
