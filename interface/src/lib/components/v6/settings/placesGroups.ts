/**
 * How Settings → Places lays out the folders Live lists (a hundred and more on
 * the rig: 21 Places, the User Library, 81 Packs), in four groups:
 *
 *   In the browser   the ticked ones, whatever their kind
 *   Places in Live   the sidebar Places not ticked
 *   User Library     Live's User Library, when not ticked
 *   Packs            the installed Packs not ticked (collapsed until opened)
 *
 * A folder's group is SETTLED the first time the page sees it and does not
 * move while the page is open: a tick lands where the finger is, rather than
 * the row jumping to the top under it. The next visit sorts it. A folder
 * that first appears later (a Place added in Live meanwhile) is settled by
 * its tick at that moment.
 *
 * The filter matches a folder's name or its path, and while it has text every
 * group shows its matches, collapsed or not.
 */
import type { PlacesSource } from '$lib/services/placesLive';

export type PlacesGroupId = 'shown' | 'places' | 'user-library' | 'packs';

export interface PlacesGroup {
	id: PlacesGroupId;
	title: string;
	/** The group's folders that pass the filter, in Live's order. */
	sources: PlacesSource[];
	/** Every folder in the group, filter or not. */
	total: number;
	/** How many of the group's folders are ticked now. */
	ticked: number;
}

export const GROUP_TITLES: Record<PlacesGroupId, string> = {
	shown: 'In the browser',
	places: 'Places in Live',
	'user-library': 'User Library',
	packs: 'Packs'
};

const ORDER: PlacesGroupId[] = ['shown', 'places', 'user-library', 'packs'];

/** Settle every folder not seen before by its tick now. Returns the same map when nothing is new. */
export function settleTicks(settled: ReadonlyMap<string, boolean>, sources: PlacesSource[]): ReadonlyMap<string, boolean> {
	const fresh = sources.filter((s) => !settled.has(s.key));
	if (!fresh.length) return settled;
	const next = new Map(settled);
	for (const s of fresh) next.set(s.key, s.ticked);
	return next;
}

function groupOf(s: PlacesSource, settled: ReadonlyMap<string, boolean>): PlacesGroupId {
	if (settled.get(s.key) ?? s.ticked) return 'shown';
	return s.kind === 'pack' ? 'packs' : s.kind === 'user-library' ? 'user-library' : 'places';
}

export function matchesFilter(s: PlacesSource, filter: string): boolean {
	const q = filter.trim().toLowerCase();
	if (!q) return true;
	return s.name.toLowerCase().includes(q) || s.path.toLowerCase().includes(q);
}

/** The four groups, empty ones left out. */
export function groupPlaces(sources: PlacesSource[], settled: ReadonlyMap<string, boolean>, filter = ''): PlacesGroup[] {
	const groups = new Map<PlacesGroupId, PlacesGroup>(
		ORDER.map((id) => [id, { id, title: GROUP_TITLES[id], sources: [], total: 0, ticked: 0 }])
	);
	for (const s of sources) {
		const g = groups.get(groupOf(s, settled))!;
		g.total++;
		if (s.ticked) g.ticked++;
		if (matchesFilter(s, filter)) g.sources.push(s);
	}
	return ORDER.map((id) => groups.get(id)!).filter((g) => g.total > 0);
}

/**
 * The folder a source sits in, for the row's second line: its path less its
 * own name, which the first line already says. A Place Live renamed keeps
 * its whole path, since the name no longer says where it is.
 */
export function parentPath(s: PlacesSource): string {
	const path = s.path.replace(/\/+$/, '');
	const cut = path.lastIndexOf('/');
	if (cut <= 0 || path.slice(cut + 1) !== s.name) return path;
	return path.slice(0, cut);
}
