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
	<LabelInfos>
		<LabelInfo Id="2" Uri="color:colors=2" DisplayName="Plug &amp; Play" IsEnabled="false" />
		<LabelInfo Id="1" Uri="color:colors=1" DisplayName="Favorites" IsEnabled="true" />
		<LabelInfo Id="3" Uri="query:Everything" DisplayName="" IsEnabled="true" />
	</LabelInfos>
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

	it("reads Live's Collections by number, hidden in Live's sidebar or not", () => {
		expect(parseLiveLibrary(XML).collections).toEqual([
			{ n: 1, name: 'Favorites' },
			{ n: 2, name: 'Plug & Play' }
		]);
	});

	it('answers nothing for a file with no project or packs', () => {
		expect(userLibraryOf('<Ableton />')).toBeNull();
		expect(packsOf('<Ableton />')).toEqual([]);
	});
});

describe('librarySources', () => {
	it("lists Live's categories and every Pack as one source, then the Places in sidebar order, then the User Library, each keyed by kind", () => {
		const lib = parseLiveLibrary(XML);
		const present = new Set(['/Users/me/Sidebar/Bass', '/Users/me/Music/Ableton/User Library']);
		const sources = librarySources(lib, (p) => present.has(p));
		expect(sources.map((s) => `${s.kind}:${s.name}`)).toEqual([
			'category:Sounds',
			'category:Drums',
			'category:Instruments',
			'category:Audio Effects',
			'category:MIDI Effects',
			'category:Max for Live',
			'category:Clips',
			'category:Packs',
			'collection:Favorites',
			'collection:Plug & Play',
			'place:Bass',
			'place:Drum',
			'user-library:User Library'
		]);
		// A category has no folder: it is read from Live's index alone. No Pack is a source of its own.
		expect(sources[0]).toMatchObject({ key: 'category:Sounds', path: '', present: true });
		// A Collection is keyed by its number, so a rename in Live keeps its tick.
		expect(sources[8]).toMatchObject({ key: 'collection:1', path: '', present: true });
		expect(sources[10].key).toBe(sourceKey('place', '/Users/me/Sidebar/Bass'));
		expect(sources.slice(10).map((s) => s.present)).toEqual([true, false, true]);
		expect(sources[11].icon).toBe('Sidebar/Sidebar_Drums');
	});
});
