/**
 * presetPath — what a preset's file path means, read in one place.
 *
 * `folderSlug` is the catalog generator's id rule (a Place's rail id and file
 * name); the category readers are what the device band and track coloring's
 * no-Place fallback read — over a Sidebar path (`Sidebar/<Place>/…`) and a
 * path recorded before the Places (`<Vendor>/<Type>/…`) alike.
 *
 * The `categoryFromPresetPath` cases moved here from `trackColoring.test.ts`
 * with the function.
 */

import { describe, it, expect } from 'vitest';
import {
	aliasPresetPath,
	categoryFromPresetPath,
	folderSlug,
	libraryCategoryOfPreset,
	libraryRelativePath,
	presetCategory,
	pathSegments
} from '$lib/utils/presetPath';

const INSTRUMENTS = '/Lib/Instruments';

describe('folderSlug', () => {
	it('is the generator rule: lowercase, anything outside a-z0-9 becomes -, runs collapse', () => {
		expect(folderSlug('Drum')).toBe('drum');
		expect(folderSlug('FX')).toBe('fx');
		expect(folderSlug('Mini Racks')).toBe('mini-racks');
		expect(folderSlug('A Moonkits')).toBe('a-moonkits');
		expect(folderSlug('Keys & Pads')).toBe('keys-pads');
	});

	it('keeps a leading or trailing dash, as the generator always has', () => {
		// Changing this renames generated files, so it is pinned rather than tidied.
		expect(folderSlug('Keys!')).toBe('keys-');
		expect(folderSlug('(Old) Kits')).toBe('-old-kits');
	});
});

describe('pathSegments', () => {
	it('tolerates back slashes, doubled slashes and a leading or trailing slash', () => {
		expect(pathSegments('/Omni//Key\\Acoustic/')).toEqual(['Omni', 'Key', 'Acoustic']);
		expect(pathSegments('')).toEqual([]);
	});
});

describe('libraryRelativePath', () => {
	it('strips the given root, and only that root', () => {
		expect(libraryRelativePath('/Lib/Instruments/Omni/Key/A.aupreset', '/Lib/Instruments')).toBe('Omni/Key/A.aupreset');
		expect(libraryRelativePath('/Lib/Instruments/Omni/Key/A.aupreset', '/Lib/Instruments/')).toBe('Omni/Key/A.aupreset');
		expect(libraryRelativePath('/Lib/InstrumentsExtra/A.adv', '/Lib/Instruments')).toBeNull();
		expect(libraryRelativePath('', '/Lib/Instruments')).toBeNull();
		expect(libraryRelativePath('/Lib/Instruments/A.adv', '')).toBeNull();
	});
});

describe('categoryFromPresetPath', () => {
	it('extracts the category of a vendor/category/... path', () => {
		expect(categoryFromPresetPath('Omnisphere/Bass/Sub Wobble.aupreset')).toBe('bass');
		expect(categoryFromPresetPath('Ableton/Drum/Kit 7.adg')).toBe('drum');
		expect(categoryFromPresetPath('Native Instruments/Synth/Lead.aupreset')).toBe('synth');
	});

	it('resolves off-pattern and absolute paths (the Plymouth Kit case)', () => {
		// Split-catalog copy whose category folder is not segment 1.
		expect(categoryFromPresetPath('Ableton/Drumset/Acoustic/Plymouth Kit.adg')).toBe('drum');
		expect(categoryFromPresetPath('Ableton/Drums/Drumset/Acoustic/Plymouth Kit.adg')).toBe('drum');
		// Absolute library path: the scan runs deepest-first, so the
		// "Instruments" root ('inst') never shadows the real category.
		expect(
			categoryFromPresetPath(
				'/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/User Library/Looping Presets/Instruments/Ableton/Drum/Acoustic/Ableton/Plymouth Kit.adg'
			)
		).toBe('drum');
	});

	it('prefers the deepest matching folder', () => {
		expect(categoryFromPresetPath('Ableton/Drum/Percs/Shaker Kit.adg')).toBe('perc');
	});

	it('handles plural and synonym folder names', () => {
		expect(categoryFromPresetPath('Vendor/Drums/foo.adg')).toBe('drum');
		expect(categoryFromPresetPath('Vendor/Keys/foo.adg')).toBe('key');
		expect(categoryFromPresetPath('Vendor/Keyboards/foo.adg')).toBe('key');
		expect(categoryFromPresetPath('Vendor/Synths/foo.adg')).toBe('synth');
		expect(categoryFromPresetPath('Vendor/Lead/foo.adg')).toBe('synth');
		expect(categoryFromPresetPath('Vendor/Pad/foo.adg')).toBe('synth');
		expect(categoryFromPresetPath('Vendor/Effects/foo.adg')).toBe('fx');
		expect(categoryFromPresetPath('Vendor/Instruments/foo.adg')).toBe('inst');
		expect(categoryFromPresetPath('Vendor/Perc/foo.adg')).toBe('perc');
		expect(categoryFromPresetPath('Vendor/Percussion/foo.adg')).toBe('perc');
	});

	it('is case-insensitive', () => {
		expect(categoryFromPresetPath('vendor/BASS/x.adg')).toBe('bass');
		expect(categoryFromPresetPath('vendor/bass/x.adg')).toBe('bass');
		expect(categoryFromPresetPath('vendor/Bass/x.adg')).toBe('bass');
	});

	it('returns null for unknown categories', () => {
		expect(categoryFromPresetPath('Vendor/Vocal/foo.adg')).toBeNull();
		expect(categoryFromPresetPath('Vendor/Misc/foo.adg')).toBeNull();
	});

	it('returns null for paths without a second segment', () => {
		expect(categoryFromPresetPath('Bass.adg')).toBeNull();
		expect(categoryFromPresetPath('')).toBeNull();
		expect(categoryFromPresetPath('Vendor/')).toBeNull();
	});

	it('tolerates leading slashes', () => {
		expect(categoryFromPresetPath('/Vendor/Bass/x.adg')).toBe('bass');
	});
});

describe('libraryCategoryOfPreset', () => {
	it('reads the folder under the vendor, and the folders below it top down', () => {
		expect(libraryCategoryOfPreset(`${INSTRUMENTS}/Omni/Inst/Wind/Brass/Horns.aupreset`, INSTRUMENTS)).toEqual({
			category: 'inst',
			folders: ['Wind', 'Brass']
		});
	});

	it("reads a Sidebar path's Place as its category — the Places are named for them", () => {
		expect(libraryCategoryOfPreset(`${INSTRUMENTS}/Sidebar/Inst/Wind/Brass/Horns.aupreset`, INSTRUMENTS)).toEqual({
			category: 'inst',
			folders: ['Wind', 'Brass']
		});
		// A Place named for something else has no category to read.
		expect(libraryCategoryOfPreset(`${INSTRUMENTS}/Sidebar/Found Sounds/Rain.adg`, INSTRUMENTS)).toBeNull();
	});

	it('names the category folder where the deepest-folder rule names another', () => {
		const path = `${INSTRUMENTS}/Omni/Bass/Synth/808/Sub.aupreset`;
		expect(categoryFromPresetPath(path)).toBe('synth');
		expect(libraryCategoryOfPreset(path, INSTRUMENTS)?.category).toBe('bass');
	});

	it('is null outside the library, for a type folder that is not a category, and for a file at the type level', () => {
		expect(libraryCategoryOfPreset('/Elsewhere/Omni/Key/Piano.adg', INSTRUMENTS)).toBeNull();
		expect(libraryCategoryOfPreset(`${INSTRUMENTS}/xFull/Damage/Kit.adg`, INSTRUMENTS)).toBeNull();
		expect(libraryCategoryOfPreset(`${INSTRUMENTS}/Omni/Key.adg`, INSTRUMENTS)).toBeNull();
		expect(libraryCategoryOfPreset('', INSTRUMENTS)).toBeNull();
	});
});

describe('presetCategory', () => {
	it('reads the category folder of a catalog path, over any deeper folder naming another', () => {
		expect(presetCategory('Omni/Drum/Synth/Boomers/Boom.aupreset', INSTRUMENTS)).toBe('drum');
		expect(presetCategory('Omni/Bass/Synth/808/Sub.aupreset', INSTRUMENTS)).toBe('bass');
		expect(presetCategory('Ableton/Drum/Percs/Shaker Kit.adg', INSTRUMENTS)).toBe('drum');
		expect(presetCategory('Omni/Synth/BPM/Bass/Arp.aupreset', INSTRUMENTS)).toBe('synth');
	});

	it('reads an absolute library path (a Recent item) the same way', () => {
		expect(presetCategory(`${INSTRUMENTS}/Omni/Drum/Synth/Boomers/Boom.aupreset`, INSTRUMENTS)).toBe('drum');
		expect(presetCategory(`${INSTRUMENTS}/Ableton/Drum/Acoustic/Ableton/Plymouth Kit.adg`, INSTRUMENTS)).toBe(
			'drum'
		);
	});

	it('keeps the old off-pattern shapes', () => {
		expect(presetCategory('Ableton/Drumset/Acoustic/Plymouth Kit.adg', INSTRUMENTS)).toBe('drum');
		expect(presetCategory('Ableton/Drums/Drumset/Acoustic/Plymouth Kit.adg', INSTRUMENTS)).toBe('drum');
	});

	it('falls back to the deepest folder where there is no category folder', () => {
		// Off-library: no category folder to read.
		expect(presetCategory('/Elsewhere/Packs/Keys/Piano.adg', INSTRUMENTS)).toBe('key');
		// In the library, a type folder that is not a category (xFull) scans
		// the RELATIVE path, so the "Instruments" root never reads as inst.
		expect(presetCategory(`${INSTRUMENTS}/xFull/Damage/Kit.adg`, INSTRUMENTS)).toBeNull();
		expect(presetCategory('xFull/Damage/Kit.adg', INSTRUMENTS)).toBeNull();
		expect(presetCategory('xFull/Shaker/Perc/Cabasa.adg', INSTRUMENTS)).toBe('perc');
	});

	it('is null for nothing', () => {
		expect(presetCategory('', INSTRUMENTS)).toBeNull();
		expect(presetCategory('Bass.adg', INSTRUMENTS)).toBeNull();
	});
});

describe('aliasPresetPath', () => {
	const map = {
		rules: [{ from: `${INSTRUMENTS}/Omni/Drum/`, to: `${INSTRUMENTS}/Sidebar/Drum/` }],
		exceptions: { [`${INSTRUMENTS}/NI/Drum/Kit.adg`]: `${INSTRUMENTS}/Sidebar/Drum/Kit (NI).adg` }
	};

	it('maps an old path by its rule, an exception first, and anything else to itself', () => {
		expect(aliasPresetPath(map, `${INSTRUMENTS}/Omni/Drum/Synth/Boom.aupreset`)).toBe(
			`${INSTRUMENTS}/Sidebar/Drum/Synth/Boom.aupreset`
		);
		expect(aliasPresetPath(map, `${INSTRUMENTS}/NI/Drum/Kit.adg`)).toBe(`${INSTRUMENTS}/Sidebar/Drum/Kit (NI).adg`);
		expect(aliasPresetPath(map, '/Elsewhere/Kit.adg')).toBe('/Elsewhere/Kit.adg');
	});

	it('holds a folder boundary, and tolerates no map', () => {
		expect(aliasPresetPath(map, `${INSTRUMENTS}/Omni/Drumset/Kit.adg`)).toBe(`${INSTRUMENTS}/Omni/Drumset/Kit.adg`);
		expect(aliasPresetPath(null, `${INSTRUMENTS}/Omni/Drum/x.adg`)).toBe(`${INSTRUMENTS}/Omni/Drum/x.adg`);
		expect(aliasPresetPath(map, '')).toBe('');
	});
});
