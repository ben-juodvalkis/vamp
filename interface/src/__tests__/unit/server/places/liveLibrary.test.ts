/**
 * Live's library as the Places service reads it (onboarding.plan.md §4): the
 * sidebar Places in order, the User Library and the Packs from one
 * `Library.cfg`, and the tickable list built from them.
 */
import { describe, expect, it } from 'vitest';
import { librarySources, packsOf, parseLiveLibrary, sourceKey, userLibraryOf } from '$lib/server/places/liveLibrary';

const XML = `<Ableton><ContentLibrary>
	<LibraryProject><ProjectPath Value="/Users/me/Music/Ableton" /><ProjectName Value="User Library" /></LibraryProject>
	<SliceInfoList>
		<LibrarySliceInfo Id="1" Path="/Packs/Session Drums Club" DisplayName="Session Drums Club" UniqueId="www.ableton.com/95" />
		<LibrarySliceInfo Id="2" Path="/Packs/Beat Tools" DisplayName="Beat Tools" UniqueId="www.ableton.com/237" />
	</SliceInfoList>
	<UserFolderInfoList>
		<UserFolderInfo Id="424" Path="/Users/me/Sidebar/Bass" DisplayName="Bass" IconName="" />
		<UserFolderInfo Id="425" Path="/Users/me/Sidebar/Drum" DisplayName="Drum" IconName="Sidebar/Sidebar_Drums" />
	</UserFolderInfoList>
	<PreferredFactoryPacksInstallationPath Value="/Packs" />
</ContentLibrary></Ableton>`;

describe('parseLiveLibrary', () => {
	it('reads the Places in order, the User Library, the Packs folder and the Packs', () => {
		const lib = parseLiveLibrary(XML, '/prefs/Library.cfg', 5);
		expect(lib.places.map((p) => p.name)).toEqual(['Bass', 'Drum']);
		expect(lib.userLibrary).toBe('/Users/me/Music/Ableton/User Library');
		expect(lib.packsFolder).toBe('/Packs');
		expect(lib.packs.map((p) => p.name)).toEqual(['Session Drums Club', 'Beat Tools']);
		expect(lib.cfgMtimeMs).toBe(5);
	});

	it('answers nothing for a file with no project or packs', () => {
		expect(userLibraryOf('<Ableton />')).toBeNull();
		expect(packsOf('<Ableton />')).toEqual([]);
	});
});

describe('librarySources', () => {
	it('lists Places first in sidebar order, then the User Library, then the Packs A→Z, each keyed by kind and path', () => {
		const lib = parseLiveLibrary(XML);
		const present = new Set(['/Users/me/Sidebar/Bass', '/Users/me/Music/Ableton/User Library', '/Packs/Beat Tools']);
		const sources = librarySources(lib, (p) => present.has(p));
		expect(sources.map((s) => `${s.kind}:${s.name}`)).toEqual([
			'place:Bass',
			'place:Drum',
			'user-library:User Library',
			'pack:Beat Tools',
			'pack:Session Drums Club'
		]);
		expect(sources[0].key).toBe(sourceKey('place', '/Users/me/Sidebar/Bass'));
		expect(sources.map((s) => s.present)).toEqual([true, false, true, true, false]);
		expect(sources[1].icon).toBe('Sidebar/Sidebar_Drums');
	});
});
