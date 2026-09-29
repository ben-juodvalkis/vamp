/**
 * How Settings → Grooves lays out Live's groove files (219 on the home Mac):
 *
 *   In the Groove view   the ticked ones, in tick order — the tiles' order
 *   Swing · Basic … Utility   every file, grouped as Live's library groups them
 *
 * Every file stays in its library group, ticked or not, so the groups read as
 * the library does. The top group is SETTLED like the Places' groups: a groove
 * unticked while the page is open keeps its row, unticked, and the next visit
 * drops it — a tick never pulls the row out from under the finger. A newly
 * ticked one joins the end, where its tile lands.
 *
 * The filter matches a groove's name, and while it has text every group shows
 * its matches, folded or not.
 */
import { GROOVE_GROUPS, type GrooveFile } from '$lib/types/grooves';

export const SHOWN_GROUP = 'shown';
export const SHOWN_TITLE = 'In the Groove view';

export interface GrooveGroup {
	id: string;
	title: string;
	/** The group's files that pass the filter. */
	files: GrooveFile[];
	/** Every file in the group, filter or not. */
	total: number;
	/** How many of the group's files are ticked now. */
	ticked: number;
}

/** The top group's names: what was there, plus anything ticked since, at the end. */
export function settleShown(shown: readonly string[], ticked: readonly string[]): string[] {
	const fresh = ticked.filter((n) => !shown.includes(n));
	return fresh.length ? [...shown, ...fresh] : (shown as string[]);
}

export function matchesGrooveFilter(f: GrooveFile, filter: string): boolean {
	const q = filter.trim().toLowerCase();
	return !q || f.name.toLowerCase().includes(q);
}

/** The top group, then the library's groups in Live's order; empty ones left out. */
export function groupGrooves(
	files: readonly GrooveFile[],
	shown: readonly string[],
	ticked: ReadonlySet<string>,
	filter = ''
): GrooveGroup[] {
	const byName = new Map(files.map((f) => [f.name, f]));
	const top = shown.map((n) => byName.get(n)).filter((f): f is GrooveFile => !!f);
	const groups: GrooveGroup[] = [
		{
			id: SHOWN_GROUP,
			title: SHOWN_TITLE,
			files: top.filter((f) => matchesGrooveFilter(f, filter)),
			total: top.length,
			ticked: top.filter((f) => ticked.has(f.name)).length
		}
	];
	const known = new Set(GROOVE_GROUPS.map((g) => g.id));
	const library = [...GROOVE_GROUPS, ...[...new Set(files.map((f) => f.group))].filter((g) => !known.has(g)).map((id) => ({ id, title: id }))];
	for (const g of library) {
		const all = files.filter((f) => f.group === g.id);
		groups.push({
			id: g.id,
			title: g.title,
			files: all.filter((f) => matchesGrooveFilter(f, filter)),
			total: all.length,
			ticked: all.filter((f) => ticked.has(f.name)).length
		});
	}
	return groups.filter((g) => g.total > 0);
}
