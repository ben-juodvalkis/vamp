/**
 * Resolving the IR a Hybrid Reverb has loaded to its file, by the names
 * Live gives it (measured on the rig, 2026-10-02).
 */
import { describe, it, expect } from 'vitest';
import { resolveIr } from '$lib/server/reverbIr';
import { hybridIrFolder, isAllowedSamplePath, coreLibraryRoots } from '$lib/server/sampleRoots';

const BETA = '/Applications/Ableton Live 12 Beta.app';
const FOLDER = hybridIrFolder(BETA);
// A slice of the Beta's folder, as it lists.
const ENTRIES = [
	'Hybrid_Early_Reflections_Ableton Studio Backwards L.aif',
	'Hybrid_Early_Reflections_Ableton Studio Backwards L.aif.asd',
	'Hybrid_Early_Reflections_Ableton Studio Backwards R.aif',
	'Hybrid_Early_Reflections_Ableton Studio Mid.aif',
	'Hybrid_Chambers_and_Large_Rooms_Large Wood Room.aif',
	'Hybrid_Real_Places_Igny Church.wav'
];
const list = (folder: string) => {
	if (folder !== FOLDER) throw new Error('ENOENT');
	return ENTRIES;
};

describe('resolveIr', () => {
	it('finds a stereo IR’s pair from its "LR" name', () => {
		expect(resolveIr('Early_Reflections', 'Ableton Studio Backwards LR', [FOLDER], list)).toEqual([
			{ channel: 'L', path: `${FOLDER}/Hybrid_Early_Reflections_Ableton Studio Backwards L.aif` },
			{ channel: 'R', path: `${FOLDER}/Hybrid_Early_Reflections_Ableton Studio Backwards R.aif` }
		]);
	});

	it('finds a mono IR, whatever its extension', () => {
		expect(resolveIr('Real_Places', 'Igny Church', [FOLDER], list)).toEqual([
			{ channel: 'mono', path: `${FOLDER}/Hybrid_Real_Places_Igny Church.wav` }
		]);
		expect(resolveIr('Chambers_and_Large_Rooms', 'Large Wood Room', [FOLDER], list)).toHaveLength(1);
	});

	it('looks past a folder that is missing to the next app’s', () => {
		expect(resolveIr('Early_Reflections', 'Ableton Studio Mid', ['/nowhere', FOLDER], list)).toHaveLength(1);
	});

	it('finds nothing for a User IR, the empty list, or half a pair', () => {
		expect(resolveIr('User', 'My Room', [FOLDER], list)).toEqual([]);
		expect(resolveIr('User', '<empty>', [FOLDER], list)).toEqual([]);
		expect(resolveIr('Real_Places', 'Igny Church LR', [FOLDER], list)).toEqual([]);
		expect(resolveIr('', 'Igny Church', [FOLDER], list)).toEqual([]);
	});
});

describe('the sample roots admit Live’s IR folder', () => {
	it('so /api/sample-peaks can draw an IR', () => {
		const roots = [...coreLibraryRoots('/nowhere', [BETA]), FOLDER];
		expect(isAllowedSamplePath(`${FOLDER}/Hybrid_Real_Places_Igny Church.wav`, roots, () => false)).toBe(true);
		expect(isAllowedSamplePath(`${BETA}/Contents/App-Resources/Builtin/Devices/x.wav`, roots, () => false)).toBe(false);
	});
});
