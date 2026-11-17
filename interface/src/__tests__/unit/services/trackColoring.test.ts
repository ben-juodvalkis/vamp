/**
 * trackColoring.test.ts — auto-color + auto-role rules and their applies.
 *
 * Three halves, since protocol 3.7.0:
 *   - Pure colour resolution: an instrument type's colour (ADR-545), or
 *     the audio colour for a sample loaded as audio.
 *   - Pure role resolution (`resolveAutoRole`) — a Place's role outright,
 *     else the path's category folder. The Place half is also pinned in
 *     `services/placesBrowser.test.ts`.
 *   - The two applies — the override-safety gate, the optimistic store
 *     write, and the clip-color iteration.
 *
 * The `roleFromTrackColor` block that used to sit between them retired
 * with the colour tier of the Drum Buss gate; the measurements it pinned
 * (Live quantizes LOM colour writes) live on in `trackColoring.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SvelteMap } from 'svelte/reactivity';

vi.mock('$lib/api/simpleClient', () => ({
	send: vi.fn()
}));

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

import { send } from '$lib/api/simpleClient';
import { machineStore } from '$lib/stores/machineStore.svelte';
// A Mac's library folder, as /bridge/machine hands it over; a fixture one.
const LIBRARY = '/Volumes/Audio/User Library/Looping Presets/Instruments';
machineStore.update(JSON.stringify({ paths: { instrumentsBase: LIBRARY, m4lDevicesRoot: '' }, totalmix: null }));
import {
	applyAutoColorOnPrepareAck,
	colorForAudio,
	colorForInstrument,
	applyInstrumentColor,
	takePendingInstrumentColor,
	applyAutoRoleOnPrepareAck,
	resolveAutoRole
} from '$lib/services/trackColoring';
import {
	replaceTree,
	v3Store,
	type ClipRecord,
	type SlotRecord,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';

const sendMock = send as unknown as ReturnType<typeof vi.fn>;

// Constants we expect from constants.json:vendors (the ADR-399 role
// palette for audio, `vendors.devices` / `vendors.brands` for instruments,
// ADR-545). Keeping them inline makes test failures self-explanatory
// if the palette changes.
const COLOR_DRUM_RACK = 0xf97096;
const COLOR_DRIFT = 0x3be59d;
const COLOR_COLLISION = 0x06bfa0;
const COLOR_MELD = 0xad8dfd;
const COLOR_OMNI = 0xdd3cdd;
const COLOR_AUDIO = 0x89ce5f;

// --- fixture helpers ------------------------------------------------------

function mkClip(
	trackIdx: number,
	slotIdx: number,
	overrides: Partial<ClipRecord> = {}
): ClipRecord {
	return {
		clipPath: `tracks/${trackIdx}/slots/${slotIdx}/clip`,
		name: 'clip',
		length: 4,
		color: 0x000000,
		pitch: 0,
		properties: new SvelteMap(),
		...overrides
	};
}

function mkSlot(
	trackIdx: number,
	slotIdx: number,
	clip?: ClipRecord
): SlotRecord {
	return {
		slotPath: `tracks/${trackIdx}/slots/${slotIdx}`,
		state: clip ? 'has_clip' : 'empty',
		clip
	};
}

function mkTrack(
	trackIdx: number,
	overrides: { color?: number; slots?: SlotRecord[] } = {}
): TrackRecord {
	const slots = overrides.slots ?? [];
	return {
		trackPath: `tracks/${trackIdx}`,
		name: `T${trackIdx}`,
		color: overrides.color ?? 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		// ADR-410: plain top-level track (not a group, not folded, no parent).
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		// Protocol 3.7.0: no role recorded, the pre-3.7.0 shape.
		role: '',
		volume: 0.5,
		devices: new Map(),
		slots: new SvelteMap(slots.map((s) => [s.slotPath, s]))
	};
}

function seed(tracks: TrackRecord[]): void {
	replaceTree(1, tracks);
}

// --- colorForInstrument / colorForAudio ---------------------------------

describe('colorForInstrument (ADR-545)', () => {
	it("is each instrument type's own colour", () => {
		expect(colorForInstrument('drumrack')).toBe(COLOR_DRUM_RACK);
		expect(colorForInstrument('drift')).toBe(COLOR_DRIFT);
		expect(colorForInstrument('collision')).toBe(COLOR_COLLISION);
		expect(colorForInstrument('meld')).toBe(COLOR_MELD);
	});

	it("is a plug-in's brand colour where the rig knows the plug-in", () => {
		expect(colorForInstrument('omnisphere')).toBe(COLOR_OMNI);
	});

	it('is null for an instrument with no colour of its own: the colour is left alone', () => {
		expect(colorForInstrument('plugin')).toBeNull();
		expect(colorForInstrument('unknown')).toBeNull();
		expect(colorForInstrument(null)).toBeNull();
	});
});

describe('colorForAudio', () => {
	it('returns the audio button color from vendors.special', () => {
		expect(colorForAudio()).toBe(COLOR_AUDIO);
	});
});

// --- applyAutoColorOnPrepareAck / applyInstrumentColor ------------------

describe('applyAutoColorOnPrepareAck', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		takePendingInstrumentColor('tracks/0');
	});

	it('colours an audio load at once', () => {
		seed([mkTrack(0, { color: 0 })]);
		applyAutoColorOnPrepareAck({ trackPath: 'tracks/0', presetPath: 'Drum/Samples/Kick.wav', audio: true });
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/track/color', ['tracks/0', COLOR_AUDIO]);
	});

	it('marks an instrument load pending and writes nothing: the device has not landed', () => {
		seed([mkTrack(0, { color: 0x123456 })]);
		applyAutoColorOnPrepareAck({ trackPath: 'tracks/0', presetPath: 'Bass/Synth/x.aupreset', placeRole: 'bass' });
		expect(sendMock).not.toHaveBeenCalled();
		expect(takePendingInstrumentColor('tracks/0')).toBe(true);
		expect(takePendingInstrumentColor('tracks/0')).toBe(false);
	});

	it('skips master and returns paths', () => {
		applyAutoColorOnPrepareAck({ trackPath: 'master', presetPath: 'x.wav', audio: true });
		applyAutoColorOnPrepareAck({ trackPath: 'returns/0', presetPath: 'x/Bass/y.adg' });
		expect(sendMock).not.toHaveBeenCalled();
		expect(takePendingInstrumentColor('returns/0')).toBe(false);
	});
});

describe('applyInstrumentColor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('writes the track and every clip it holds', () => {
		const clip0 = mkClip(0, 0);
		const clip2 = mkClip(0, 2);
		seed([mkTrack(0, { color: 0, slots: [mkSlot(0, 0, clip0), mkSlot(0, 1), mkSlot(0, 2, clip2)] })]);

		expect(applyInstrumentColor('tracks/0', 'drift')).toBe(true);

		expect(v3Store.tracks.get('tracks/0')?.color).toBe(COLOR_DRIFT);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/track/color', ['tracks/0', COLOR_DRIFT]);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/clip/set/color', ['tracks/0/slots/0/clip', COLOR_DRIFT]);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/clip/set/color', ['tracks/0/slots/2/clip', COLOR_DRIFT]);
		expect(sendMock).toHaveBeenCalledTimes(3);
	});

	it('leaves the track alone for an instrument with no colour', () => {
		seed([mkTrack(0, { color: 0xabcdef })]);
		expect(applyInstrumentColor('tracks/0', 'plugin')).toBe(false);
		expect(sendMock).not.toHaveBeenCalled();
		expect(v3Store.tracks.get('tracks/0')?.color).toBe(0xabcdef);
	});

	it('touches no other track', () => {
		seed([mkTrack(0, { color: 0 }), mkTrack(1, { color: 0xabcdef })]);
		applyInstrumentColor('tracks/0', 'drumrack');
		expect(v3Store.tracks.get('tracks/0')?.color).toBe(COLOR_DRUM_RACK);
		expect(v3Store.tracks.get('tracks/1')?.color).toBe(0xabcdef);
	});
});


// --- protocol 3.7.0: role resolution + persist ----------------------------
//
// `resolveAutoRole` was computed for the colour and thrown away. Recovering it downstream is what
// the Drum Buss rail's gate needed a 2.46 MB catalog fetch to do.

describe('resolveAutoRole', () => {
	it("is a Place's role outright, over what the path's shape would say", () => {
		// `Drum/Synth/…` read by shape is the Synth folder — the 2026-09-18 mistake.
		expect(resolveAutoRole('Drum/Synth/Boomers/Boom.aupreset', { placeRole: 'drum' })).toBe('drum');
		expect(resolveAutoRole('Found/Thing.adg', { placeRole: null })).toBeNull();
		// Only the seven rail roles count.
		expect(resolveAutoRole('Found/Thing.adg', { placeRole: 'vocal' })).toBeNull();
	});

	it('reads the category out of the preset path when no Place is behind the load', () => {
		expect(resolveAutoRole('Ableton/Drum/Acoustic/Plymouth Kit')).toBe('drum');
		expect(resolveAutoRole('Omni/Bass/Acoustic/Upright')).toBe('bass');
	});

	it('reads the category FOLDER, not the deepest folder naming one (2026-09-18)', () => {
		// Every Omnisphere Drum preset sits under a Synth, FX or Percussion
		// subfolder; the deepest-folder read recorded and colored all 3,208
		// of them as not-drum, and 2,146 of 2,470 Omni Bass presets as synth.
		expect(resolveAutoRole('Omni/Drum/Synth/Boomers/Boom.aupreset')).toBe('drum');
		expect(resolveAutoRole('Omni/Drum/Synth/Percussion/Clave.aupreset')).toBe('drum');
		expect(resolveAutoRole('Omni/Bass/Synth/808/Sub.aupreset')).toBe('bass');
		expect(resolveAutoRole('Omni/Drum/Synth/FX/Riser.aupreset')).toBe('drum');
	});

	it("reads a Recent load's ABSOLUTE path by its category folder too", () => {
		// A Recent entry outside every Place hands the recorder its `fullPath` —
		// the Plymouth Kit case. A Sidebar path reads its Place the same way.
		const base = LIBRARY;
		expect(resolveAutoRole(`${base}/Ableton/Drum/Acoustic/Ableton/Plymouth Kit.adg`)).toBe('drum');
		expect(resolveAutoRole(`${base}/Omni/Bass/Synth/808/Sub.aupreset`)).toBe('bass');
		expect(resolveAutoRole(`${base}/Sidebar/Key/Grand/Ballad.aupreset`)).toBe('key');
	});

	it('returns null for audio loads — a sample has no rail', () => {
		expect(resolveAutoRole('Drum/Samples/Kick.wav', { audio: true })).toBeNull();
		expect(resolveAutoRole('Drum/Samples/Kick.wav', { audio: true, placeRole: 'drum' })).toBeNull();
	});

	it('returns null when the path names no category', () => {
		// A null role leaves any existing role alone (applyAutoRoleOnPrepareAck).
		expect(resolveAutoRole('Ableton/Nonsense/Thing')).toBeNull();
		expect(resolveAutoRole('')).toBeNull();
	});
});

describe('applyAutoRoleOnPrepareAck', () => {
	beforeEach(() => {
		sendMock.mockClear();
		seed([mkTrack(0)]);
	});

	it('sends set_role and applies it optimistically', () => {
		applyAutoRoleOnPrepareAck({
			trackPath: 'tracks/0',
			presetPath: 'Ableton/Drum/Acoustic/Plymouth Kit'
		});
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/track/set_role', [
			'tracks/0',
			'drum'
		]);
		expect(v3Store.tracks.get('tracks/0')?.role).toBe('drum');
	});

	it('leaves an existing role alone when the load says nothing', () => {
		// Overwriting a known-good role with a guess is worse than
		// leaving a stale one — the stale one came from a real load.
		applyAutoRoleOnPrepareAck({
			trackPath: 'tracks/0',
			presetPath: 'Ableton/Drum/Kit'
		});
		sendMock.mockClear();
		applyAutoRoleOnPrepareAck({
			trackPath: 'tracks/0',
			presetPath: 'Ableton/Nonsense/Thing'
		});
		expect(sendMock).not.toHaveBeenCalled();
		expect(v3Store.tracks.get('tracks/0')?.role).toBe('drum');
	});

	it('skips master and returns', () => {
		applyAutoRoleOnPrepareAck({
			trackPath: 'master',
			presetPath: 'Ableton/Drum/Kit'
		});
		expect(sendMock).not.toHaveBeenCalled();
	});
});
