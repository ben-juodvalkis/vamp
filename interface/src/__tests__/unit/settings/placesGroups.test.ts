/**
 * Settings → Places lays out a hundred-odd folders (the rig: 21 Places, the
 * User Library) and Live's categories, every Pack as one of them, in four
 * groups, ticked first, and a folder keeps
 * the group it had when the page opened, so a tick never moves the row under
 * the finger (`placesGroups.ts`).
 */
import { describe, it, expect } from 'vitest';
import { groupPlaces, settleTicks, parentPath, matchesFilter } from '$lib/components/v6/settings/placesGroups';
import type { PlacesSource } from '$lib/services/placesLive';

const src = (kind: PlacesSource['kind'], name: string, path: string, ticked = false, present = true): PlacesSource => ({
	key: `${kind}:${path || name}`,
	kind,
	name,
	path,
	icon: '',
	present,
	ticked,
	id: name.toLowerCase(),
	totalItems: ticked ? 10 : null
});

const LIB = '/Users/me/Music/Ableton/User Library';
const sources = [
	src('place', 'Desktop', '/Users/me/Desktop'),
	src('place', 'Drum', `${LIB}/Sidebar/Drum`, true),
	src('place', 'Bass', `${LIB}/Sidebar/Bass`, true),
	src('user-library', 'User Library', LIB),
	src('category', 'Sounds', ''),
	src('category', 'Packs', '', true)
];

describe('groupPlaces', () => {
	it("puts the ticked first, then Live's categories (the Packs among them), the Places and the User Library, each in Live’s order", () => {
		const groups = groupPlaces(sources, new Map());
		expect(groups.map((g) => g.id)).toEqual(['shown', 'categories', 'places', 'user-library']);
		expect(groups[0].sources.map((s) => s.name)).toEqual(['Drum', 'Bass', 'Packs']);
		expect(groups[1].sources.map((s) => s.name)).toEqual(['Sounds']);
		expect(groups[2].sources.map((s) => s.name)).toEqual(['Desktop']);
	});

	it('leaves an empty group out', () => {
		const groups = groupPlaces(sources.filter((s) => s.kind !== 'user-library'), new Map());
		expect(groups.map((g) => g.id)).toEqual(['shown', 'categories', 'places']);
	});

	it('keeps a folder where it was settled when its tick changes', () => {
		const settled = settleTicks(new Map(), sources);
		const after = sources.map((s) => (s.name === 'Desktop' ? { ...s, ticked: true } : s.name === 'Drum' ? { ...s, ticked: false } : s));
		const groups = groupPlaces(after, settled);
		expect(groups.find((g) => g.id === 'places')!.sources.map((s) => s.name)).toEqual(['Desktop']);
		expect(groups.find((g) => g.id === 'shown')!.sources.map((s) => s.name)).toContain('Drum');
		// The counts are the ticks as they stand.
		expect(groups.find((g) => g.id === 'places')!.ticked).toBe(1);
		expect(groups.find((g) => g.id === 'shown')!.ticked).toBe(2);
	});

	it('settles a folder that appears later by its tick then, and is a no-op otherwise', () => {
		const settled = settleTicks(new Map(), sources);
		expect(settleTicks(settled, sources)).toBe(settled);
		const added = src('place', 'Downloads', '/Users/me/Downloads', true);
		const next = settleTicks(settled, [...sources, added]);
		expect(next.get(added.key)).toBe(true);
		expect(groupPlaces([...sources, added], next)[0].sources.map((s) => s.name)).toContain('Downloads');
	});

	it('filters by name or path, counting against the whole group', () => {
		const groups = groupPlaces(sources, new Map(), 'drum');
		const shown = groups.find((g) => g.id === 'shown')!;
		expect(shown.sources.map((s) => s.name)).toEqual(['Drum']);
		expect(shown.total).toBe(3);
		expect(groups.find((g) => g.id === 'categories')!.sources).toEqual([]);
		expect(groups.find((g) => g.id === 'places')!.sources).toEqual([]);
		expect(matchesFilter(sources[0], 'users/me')).toBe(true);
		expect(matchesFilter(sources[0], '  ')).toBe(true);
	});
});

describe('parentPath', () => {
	it('drops the folder’s own name, which the row already says', () => {
		expect(parentPath(sources[1])).toBe(`${LIB}/Sidebar`);
		expect(parentPath(src('place', 'Desktop', '/Users/me/Desktop/'))).toBe('/Users/me');
	});

	it('keeps the whole path when Live’s name for the Place is not the folder’s', () => {
		expect(parentPath(src('place', 'M4L', '/repo/Vamp Devices'))).toBe('/repo/Vamp Devices');
	});
});
