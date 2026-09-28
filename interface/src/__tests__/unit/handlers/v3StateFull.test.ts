/**
 * Tests for v3 state/full handler, v3 invalidate handler, and the v3
 * normalized store — Phase 2 PR-2a.
 *
 * Coverage:
 * - Path helpers: `splitTrackPath` / `splitParamPath` across
 *   master/tracks/returns; malformed rejects.
 * - Store primitives: `replaceTree`, `applyParamValue`,
 *   `invalidatePaths`, `resetTree`.
 * - Derived views: `paramByPath`, `deviceByPath` rebuild on mutation.
 * - `parseChecksumHex` over the ETag token the header carries.
 * - Parser: T/D/P/V/S/C happy-path tree decode; structural anomalies
 *   (orphan D/P/V/S/C, cross-parent path, unknown tag) bail.
 * - `state/full/tree`: header validation, scoped vs. whole-song apply,
 *   same-(generation, etag) dedupe.
 * - A T record whose ONLY change is `preset` (protocol 3.9.0, ADR-439),
 *   through both scalar-equality guards — the whole stated risk of that
 *   bump, since either guard missing the field drops the change silently.
 * - Invalidate: generation mirror advance, subtree drop at every
 *   level (track / device / param / slot / clip), empty path list,
 *   malformed generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

import {
	v3Store,
	replaceTree,
	mergeSubtreeAtPath,
	applyParamValue,
	invalidatePaths,
	resetTree,
	splitTrackPath,
	splitParamPath,
	_resetForTests,
	UNSET_GENERATION,
	type TrackRecord,
	type DeviceRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';
import {
	handleV3StateFullTree,
	parseV3TreeArgs,
	parseChecksumHex,
	_resetV3StateFull_forTests
} from '$lib/api/handlers/v3StateFull';
import { handleV3StateInvalidate } from '$lib/api/handlers/v3Invalidate';
import { clearHeldEtags, getHeldEtag } from '$lib/api/handlers/stateFullEtagStore';
import type { OSCArg } from '$lib/types/osc';

// ============================================
// Fixture builders
// ============================================

function mkParam(
	trackIdx: number,
	deviceIdx: number,
	paramIdx: number,
	overrides: Partial<ParamRecord> = {}
): ParamRecord {
	const paramPath = `tracks/${trackIdx}/devices/${deviceIdx}/params/${paramIdx}`;
	return {
		paramPath,
		name: `p${paramIdx}`,
		displayName: `P${paramIdx}`,
		min: 0,
		max: 1,
		value: 0,
		unit: '',
		...overrides
	};
}

function mkDevice(
	trackIdx: number,
	deviceIdx: number,
	params: ParamRecord[]
): DeviceRecord {
	const devicePath = `tracks/${trackIdx}/devices/${deviceIdx}`;
	return {
		devicePath,
		name: `d${deviceIdx}`,
		className: 'AudioEffect',
		params: new Map(params.map((p) => [p.paramPath, p])),
		properties: new Map()
	};
}

function mkTrack(trackIdx: number, devices: DeviceRecord[]): TrackRecord {
	const trackPath = `tracks/${trackIdx}`;
	return {
		trackPath,
		name: `t${trackIdx}`,
		color: 0xff0000,
		mute: false,
		solo: false,
		arm: false,
		// PR-3.5.3: default fixtures to MIDI-only. Tests that need a
		// specific I/O shape construct the TrackRecord directly.
		hasMidiInput: true,
		hasAudioInput: false,
		// PR-7c pr7c-5: default "no arrangement clips". Tests that
		// exercise arrangement-presence construct directly.
		hasArrangementClips: false,
		// ADR-410: default to a plain top-level track. Group fixtures set
		// these explicitly.
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		// Protocol 3.7.0: default to "no role recorded", which is what
		// every track made before 3.7.0 or outside this app carries.
		role: '',
		// Protocol 3.9.0 (ADR-439): no preset recorded.
		preset: '',
		devices: new Map(devices.map((d) => [d.devicePath, d])),
		slots: new Map()
	};
}

/**
 * Build a tree_args flat payload as the v3 Python emitter will produce.
 * Depth-first: T, (D (P* V*)*)*, (S C?)*.
 *
 * Track spec is object-shape so individual tests can keep call sites
 * short; defaults fill in color/mute/solo/arm, which most tests don't
 * care about.
 */
interface TreeSpec {
	tracks: TrackSpec[];
}
interface TrackSpec {
	trackPath: string;
	name?: string;
	color?: number;
	mute?: 0 | 1;
	solo?: 0 | 1;
	arm?: 0 | 1;
	// PR-3.5.3 — track-input capability flags on the T record. Default
	// MIDI-only when omitted (matches the most common fixture shape).
	hasMidiInput?: 0 | 1;
	hasAudioInput?: 0 | 1;
	// PR-7c pr7c-5 — arrangement-clip presence flag (T arity 9 offset 8).
	// Default 0; tests that care about arrangement presence set it
	// explicitly. Master / returns emit 0 structurally.
	hasArrangementClips?: 0 | 1;
	// ROW 6.5 2026-04-21 — mixer volume (T arity 10 offset 9). Default
	// 0.85 (Live's unity). Tests that care about volume round-trip set
	// it explicitly.
	volume?: number;
	// ADR-410 — Group Track structure (T arity 13 offsets 10/11/12).
	// Defaults model a plain top-level track: not a group, not folded,
	// no parent.
	isFoldable?: 0 | 1;
	foldState?: 0 | 1;
	groupTrackIndex?: number;
	role?: string;
	preset?: string;
	devices?: DeviceSpec[];
	slots?: SlotSpec[];
}
interface DeviceSpec {
	devicePath: string;
	name?: string;
	className?: string;
	params?: ParamSpec[];
}
interface ParamSpec {
	paramPath: string;
	name?: string;
	displayName?: string;
	min?: number;
	max?: number;
	value?: number;
	unit?: string;
}
interface SlotSpec {
	slotPath: string;
	state?: 0 | 1 | 2 | 3;
	clip?: ClipSpec;
}
interface ClipSpec {
	clipPath: string;
	name?: string;
	length?: number;
	color?: number;
	pitch?: number;
}

function buildTreeArgs(spec: TreeSpec): OSCArg[] {
	const out: OSCArg[] = [];
	for (const t of spec.tracks) {
		out.push(
			'T',
			t.trackPath,
			t.name ?? '',
			t.color ?? 0,
			t.mute ?? 0,
			t.solo ?? 0,
			t.arm ?? 0,
			// PR-3.5.3 (T arity 8→9): default MIDI-only since most
			// fixtures model audio-effect chains on a MIDI track. Tests
			// that care about a specific I/O shape pass these explicitly.
			t.hasMidiInput ?? 1,
			t.hasAudioInput ?? 0,
			// PR-7c pr7c-5 (T arity 9 offset 8): default "no arrangement
			// clips" since the overwhelmingly-common fixture shape is a
			// session-view-only test session.
			t.hasArrangementClips ?? 0,
			// ROW 6.5 2026-04-21 (T arity 10 offset 9): mixer volume.
			// Default 0.85 (Live's unity).
			t.volume ?? 0.85,
			// ADR-410 2026-07-27 (T arity 13 offsets 10/11/12): Group
			// Track structure. Defaults are "plain top-level track".
			t.isFoldable ?? 0,
			t.foldState ?? 0,
			t.groupTrackIndex ?? -1,
			// Protocol 3.7.0 (T arity 14 offset 13): the persisted rail.
			// Default "" — no role recorded.
			t.role ?? '',
			// Protocol 3.9.0 (T arity 15 offset 14, ADR-439): the preset the
			// last prepare load recorded. Default "" — none.
			t.preset ?? ''
		);
		for (const d of t.devices ?? []) {
			out.push(
				'D',
				d.devicePath,
				d.name ?? '',
				d.className ?? ''
				// ROW 5 (2026-04-21, protocol 3.3.0): D-record arity
				// is 3; legacyId 4th field retired.
			);
			for (const p of d.params ?? []) {
				out.push(
					'P',
					p.paramPath,
					p.name ?? '',
					p.displayName ?? '',
					p.min ?? 0,
					p.max ?? 1,
					// Force fractional encoding so the checksum path exercises
					// the float32 branch on at least one value.
					p.value ?? 0.5,
					p.unit ?? ''
				);
			}
		}
		for (const s of t.slots ?? []) {
			out.push('S', s.slotPath, s.state ?? 0);
			if (s.clip) {
				out.push(
					'C',
					s.clip.clipPath,
					s.clip.name ?? '',
					s.clip.length ?? 0,
					s.clip.color ?? 0,
					s.clip.pitch ?? 0
				);
			}
		}
	}
	return out;
}

/** A minimal but FULL-arity T record (15 fields). Hand-built fixtures
 *  that only care about what follows the track must still emit a whole
 *  T, or they bail on the arity guard and prove nothing. */
function tRecord(trackPath: string): OSCArg[] {
	return ['T', trackPath, '', 0, 0, 0, 0, 0, 0, 0, 0.85, 0, 0, -1, '', ''];
}

/**
 * End-to-end driver: one `state/full/tree` message.
 *
 * `tracks` is the flat record stream. `etag` defaults to a distinct
 * token per (generation, payload-length) pair so tests that don't care
 * about deduping don't accidentally trip it; tests that *do* care pass
 * their own and control it exactly.
 *
 * `tracksByChunk` survives as a parameter name in a few call sites'
 * fixtures — it is now just "the pieces to concatenate", with no wire
 * meaning.
 */
function deliverStateFull(options: {
	reason: 'accept' | 'structural' | 'resync';
	generation: number;
	tracksByChunk: OSCArg[][];
	etag?: string;
	scope?: string;
}): void {
	const { reason, generation, tracksByChunk, etag, scope } = options;
	const flat: OSCArg[] = [];
	for (const c of tracksByChunk) for (const a of c) flat.push(a);
	handleV3StateFullTree([
		reason,
		generation,
		etag ?? `0x${(generation * 1000 + flat.length).toString(16).padStart(8, '0')}`,
		scope ?? '',
		...flat
	]);
}

// ============================================
// beforeEach
// ============================================

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
	_resetV3StateFull_forTests();
});

// ============================================
// Path helpers
// ============================================

describe('splitTrackPath', () => {
	it('handles tracks/<N> bare', () => {
		expect(splitTrackPath('tracks/0')).toEqual({
			trackPath: 'tracks/0',
			rest: ''
		});
	});
	it('handles tracks/<N>/... suffix', () => {
		expect(splitTrackPath('tracks/3/devices/1/params/7')).toEqual({
			trackPath: 'tracks/3',
			rest: 'devices/1/params/7'
		});
	});
	it('handles master bare', () => {
		expect(splitTrackPath('master')).toEqual({
			trackPath: 'master',
			rest: ''
		});
	});
	it('handles master/... suffix', () => {
		expect(splitTrackPath('master/devices/0/params/2')).toEqual({
			trackPath: 'master',
			rest: 'devices/0/params/2'
		});
	});
	it('handles returns/<N>', () => {
		expect(splitTrackPath('returns/1/devices/0')).toEqual({
			trackPath: 'returns/1',
			rest: 'devices/0'
		});
	});
	it('rejects non-digit track index', () => {
		expect(splitTrackPath('tracks/abc').trackPath).toBeNull();
	});
	it('rejects unknown prefix', () => {
		expect(splitTrackPath('sends/0').trackPath).toBeNull();
	});
});

describe('splitParamPath', () => {
	it('splits a regular track paramPath', () => {
		expect(splitParamPath('tracks/0/devices/1/params/2')).toEqual({
			trackPath: 'tracks/0',
			devicePath: 'tracks/0/devices/1'
		});
	});
	it('splits a master paramPath', () => {
		expect(splitParamPath('master/devices/0/params/7')).toEqual({
			trackPath: 'master',
			devicePath: 'master/devices/0'
		});
	});
	it('rejects chain-suffixed paths as devicePath-unresolvable', () => {
		// Chain paths are grammar-valid but not supported in Phase 1–3;
		// they should not resolve to a devicePath under our simple walker.
		const split = splitParamPath(
			'tracks/0/devices/0/chains/1/devices/0/params/5'
		);
		expect(split.trackPath).toBe('tracks/0');
		expect(split.devicePath).toBeNull();
	});
	it('rejects malformed trackRef', () => {
		expect(splitParamPath('tracks/x/devices/0/params/0').trackPath).toBeNull();
	});
});

// ============================================
// Store primitives + derived views
// ============================================

describe('v3 normalized store', () => {
	it('starts empty with UNSET_GENERATION', () => {
		expect(v3Store.generation).toBe(UNSET_GENERATION);
		expect(v3Store.tracks.size).toBe(0);
		expect(v3Store.sessionId).toBe('');
	});

	it('replaceTree installs tracks and bumps generation', () => {
		const track = mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0)])]);
		replaceTree(5, [track]);
		expect(v3Store.generation).toBe(5);
		expect(v3Store.tracks.size).toBe(1);
		expect(v3Store.tracks.get('tracks/0')).toBe(track);
	});

	it('applyParamValue writes through on a known path', () => {
		const track = mkTrack(0, [
			mkDevice(0, 1, [mkParam(0, 1, 2, { value: 0.1 })])
		]);
		replaceTree(1, [track]);
		expect(applyParamValue('tracks/0/devices/1/params/2', 0.8)).toBe(true);
		expect(v3Store.tracks.get('tracks/0')?.devices.get('tracks/0/devices/1')
			?.params.get('tracks/0/devices/1/params/2')?.value).toBe(0.8);
	});

	it('applyParamValue drops silently on unknown path', () => {
		replaceTree(1, []);
		expect(applyParamValue('tracks/99/devices/0/params/0', 0.5)).toBe(false);
	});

	it('applyParamValue drops on malformed path', () => {
		expect(applyParamValue('gibberish', 0.5)).toBe(false);
	});

	it('resetTree clears tracks but leaves generation', () => {
		replaceTree(7, [mkTrack(0, [])]);
		resetTree();
		expect(v3Store.tracks.size).toBe(0);
		expect(v3Store.generation).toBe(7);
	});
});

describe('v3 invalidatePaths', () => {
	it('drops a whole track subtree', () => {
		const t0 = mkTrack(0, [mkDevice(0, 0, [mkParam(0, 0, 0), mkParam(0, 0, 1)])]);
		const t1 = mkTrack(1, [mkDevice(1, 0, [mkParam(1, 0, 0)])]);
		replaceTree(1, [t0, t1]);
		const removed = invalidatePaths(2, ['tracks/0']);
		// 1 track + 1 device + 2 params
		expect(removed).toBe(4);
		expect(v3Store.generation).toBe(2);
		expect(v3Store.tracks.has('tracks/0')).toBe(false);
		expect(v3Store.tracks.has('tracks/1')).toBe(true);
	});

	it('drops a whole device subtree', () => {
		const track = mkTrack(0, [
			mkDevice(0, 0, [mkParam(0, 0, 0)]),
			mkDevice(0, 1, [mkParam(0, 1, 0), mkParam(0, 1, 1)])
		]);
		replaceTree(1, [track]);
		const removed = invalidatePaths(2, ['tracks/0/devices/1']);
		// 1 device + 2 params
		expect(removed).toBe(3);
		expect(v3Store.tracks.get('tracks/0')?.devices.size).toBe(1);
	});

	it('drops a single param', () => {
		const track = mkTrack(0, [
			mkDevice(0, 0, [mkParam(0, 0, 0), mkParam(0, 0, 1)])
		]);
		replaceTree(1, [track]);
		const removed = invalidatePaths(2, ['tracks/0/devices/0/params/1']);
		expect(removed).toBe(1);
		expect(v3Store.tracks.get('tracks/0')?.devices.get('tracks/0/devices/0')
			?.params.size).toBe(1);
	});

	it('drops a clip and resets slot state to empty', () => {
		const track = mkTrack(0, []);
		track.slots.set('tracks/0/slots/0', {
			slotPath: 'tracks/0/slots/0',
			state: 'playing',
			clip: {
				clipPath: 'tracks/0/slots/0/clip',
				name: 'loop',
				length: 4,
				color: 0,
				pitch: 0,
				properties: new Map()
			}
		});
		replaceTree(1, [track]);
		const removed = invalidatePaths(2, ['tracks/0/slots/0/clip']);
		expect(removed).toBe(1);
		const slot = v3Store.tracks.get('tracks/0')?.slots.get('tracks/0/slots/0');
		expect(slot?.clip).toBeUndefined();
		expect(slot?.state).toBe('empty');
	});

	it('handles empty path list as bookkeeping-only advance', () => {
		replaceTree(1, [mkTrack(0, [])]);
		const removed = invalidatePaths(2, []);
		expect(removed).toBe(0);
		expect(v3Store.generation).toBe(2);
		expect(v3Store.tracks.size).toBe(1);
	});

	it('ignores unknown paths without changing anything', () => {
		replaceTree(1, [mkTrack(0, [])]);
		const removed = invalidatePaths(2, ['tracks/99', 'gibberish']);
		expect(removed).toBe(0);
		expect(v3Store.generation).toBe(2);
		expect(v3Store.tracks.size).toBe(1);
	});
});

// ============================================
// ETag token
// ============================================

describe('parseChecksumHex', () => {
	it('accepts 0x-prefixed hex', () => {
		expect(parseChecksumHex('0xdeadbeef')).toBe(0xdeadbeef);
	});
	it('accepts raw hex', () => {
		expect(parseChecksumHex('deadbeef')).toBe(0xdeadbeef);
	});
	it('is case-insensitive', () => {
		expect(parseChecksumHex('0xDEADBEEF')).toBe(0xdeadbeef);
	});
	it('rejects non-hex', () => {
		expect(parseChecksumHex('0xzzzz')).toBeNull();
		expect(parseChecksumHex('')).toBeNull();
		expect(parseChecksumHex('0x')).toBeNull();
	});
});

// The FNV-1a mirror these tests used to pin went away with protocol
// 3.6.0. The UI never computes an ETag now — it reads the token off
// the header, stores it, and declares it back — so there is no second
// implementation for a parity test to hold in step. What remains
// worth pinning is that a token we can't read costs the optimisation
// and nothing more; that lives in the `state/full/tree` block below.

// ============================================
// Parser
// ============================================

describe('parseV3TreeArgs', () => {
	it('parses a single-track, single-device, two-param tree', () => {
		const flat = buildTreeArgs({
			tracks: [
				{
					trackPath: 'tracks/0',
					name: 't0',
					devices: [
						{
							devicePath: 'tracks/0/devices/0',
							name: 'EQ8',
							className: 'AudioEffect',
							params: [
								{ paramPath: 'tracks/0/devices/0/params/0', name: 'Gain', value: 0.5 },
								{ paramPath: 'tracks/0/devices/0/params/1', name: 'Freq', value: 0.25 }
							]
						}
					]
				}
			]
		});
		const parsed = parseV3TreeArgs(flat, 'accept', 1);
		expect(parsed).not.toBeNull();
		expect(parsed!.tracks.length).toBe(1);
		const track = parsed!.tracks[0];
		expect(track.trackPath).toBe('tracks/0');
		expect(track.devices.size).toBe(1);
		const device = track.devices.get('tracks/0/devices/0')!;
		expect(device.params.size).toBe(2);
		expect(device.params.get('tracks/0/devices/0/params/0')!.value).toBe(0.5);
	});

	it('attaches S + C for slots/clips', () => {
		const flat = buildTreeArgs({
			tracks: [
				{
					trackPath: 'tracks/0',
					slots: [
						{
							slotPath: 'tracks/0/slots/0',
							state: 2, // playing
							clip: {
								clipPath: 'tracks/0/slots/0/clip',
								name: 'loop-a',
								length: 4.0
							}
						},
						{ slotPath: 'tracks/0/slots/1', state: 0 }
					]
				}
			]
		});
		const parsed = parseV3TreeArgs(flat, 'accept', 1);
		const track = parsed!.tracks[0];
		expect(track.slots.size).toBe(2);
		const slot0 = track.slots.get('tracks/0/slots/0')!;
		expect(slot0.state).toBe('playing');
		expect(slot0.clip?.name).toBe('loop-a');
		expect(track.slots.get('tracks/0/slots/1')!.clip).toBeUndefined();
	});

	it('parses a master track', () => {
		const flat = buildTreeArgs({
			tracks: [
				{
					trackPath: 'master',
					devices: [
						{
							devicePath: 'master/devices/0',
							params: [{ paramPath: 'master/devices/0/params/0' }]
						}
					]
				}
			]
		});
		const parsed = parseV3TreeArgs(flat, 'accept', 1);
		expect(parsed!.tracks[0].trackPath).toBe('master');
	});

	// ADR-410 — T-record arity 13 offsets 10/11/12 (isFoldable /
	// foldState / groupTrackIndex). The emit-side tests live in
	// test_v3_state_full_component.py; these pin the UI parser's read
	// of the same fields, and — critically — that the arity bump keeps
	// the walk aligned for every record that follows a T.
	it('reads the group fields off a Group Track T record', () => {
		const flat = buildTreeArgs({
			tracks: [{ trackPath: 'tracks/0', isFoldable: 1, foldState: 1 }]
		});
		const parsed = parseV3TreeArgs(flat, 'accept', 1);
		expect(parsed!.tracks[0].isFoldable).toBe(true);
		expect(parsed!.tracks[0].foldState).toBe(true);
		expect(parsed!.tracks[0].groupTrackIndex).toBe(-1);
	});

	it('defaults a plain track to (false, false, -1)', () => {
		const flat = buildTreeArgs({ tracks: [{ trackPath: 'tracks/0' }] });
		const parsed = parseV3TreeArgs(flat, 'accept', 1);
		expect(parsed!.tracks[0].isFoldable).toBe(false);
		expect(parsed!.tracks[0].foldState).toBe(false);
		expect(parsed!.tracks[0].groupTrackIndex).toBe(-1);
	});

	it('reads a child track\'s parent group index', () => {
		const flat = buildTreeArgs({
			tracks: [
				{ trackPath: 'tracks/0', isFoldable: 1 },
				{ trackPath: 'tracks/1', groupTrackIndex: 0 }
			]
		});
		const parsed = parseV3TreeArgs(flat, 'accept', 1);
		expect(parsed!.tracks[1].groupTrackIndex).toBe(0);
	});

	it('keeps the walk aligned across the arity bump (T then D/P then T)', () => {
		// The failure mode an off-by-N arity produces isn't a wrong field
		// value — it's the parser reading the NEXT record's tag as an int
		// and bailing, or silently mis-attributing devices to the wrong
		// track. Assert structure, not just scalars.
		const flat = buildTreeArgs({
			tracks: [
				{
					trackPath: 'tracks/0',
					isFoldable: 1,
					foldState: 1,
					devices: [
						{
							devicePath: 'tracks/0/devices/0',
							params: [{ paramPath: 'tracks/0/devices/0/params/0' }]
						}
					]
				},
				{ trackPath: 'tracks/1', groupTrackIndex: 0 }
			]
		});
		const parsed = parseV3TreeArgs(flat, 'accept', 1);
		expect(parsed).not.toBeNull();
		expect(parsed!.tracks).toHaveLength(2);
		expect(parsed!.tracks[0].devices.size).toBe(1);
		expect(parsed!.tracks[1].trackPath).toBe('tracks/1');
		expect(parsed!.tracks[1].devices.size).toBe(0);
	});

	// PR-7c pr7c-5 — T-record arity 9 offset 8 (hasArrangementClips).
	// The emit-side tests live in test_v3_state_full_component.py; these
	// pin the UI parser's read of the same field.
	it('reads hasArrangementClips=true from T record flag=1', () => {
		const flat = buildTreeArgs({
			tracks: [{ trackPath: 'tracks/0', hasArrangementClips: 1 }]
		});
		const parsed = parseV3TreeArgs(flat, 'accept', 1);
		expect(parsed!.tracks[0].hasArrangementClips).toBe(true);
	});

	it('reads hasArrangementClips=false from T record flag=0 (default)', () => {
		const flat = buildTreeArgs({
			tracks: [{ trackPath: 'tracks/0' }]
		});
		const parsed = parseV3TreeArgs(flat, 'accept', 1);
		expect(parsed!.tracks[0].hasArrangementClips).toBe(false);
	});

	it('reads hasArrangementClips=false on master (structural zero)', () => {
		// Master / returns emit literal 0 per pr7c-3 (uniform T arity).
		const flat = buildTreeArgs({
			tracks: [{ trackPath: 'master' }]
		});
		const parsed = parseV3TreeArgs(flat, 'accept', 1);
		expect(parsed!.tracks[0].hasArrangementClips).toBe(false);
	});

	it('bails on a short T record (only 9 fields — pre-ROW-6.5 wire)', () => {
		// Defense-in-depth: if a surface running the old 3.2.0 protocol
		// ever raced through the handshake downgrade gate and emitted a
		// pre-arity-10 T, we must bail rather than silently read whatever
		// happens to be at the next position as volume.
		const flat: OSCArg[] = [
			'T', 'tracks/0', '', 0, 0, 0, 0, 0, 0, 0
			// deliberately no 10th field (volume)
		];
		expect(parseV3TreeArgs(flat, 'accept', 1)).toBeNull();
	});

	it('bails on D without a preceding T', () => {
		const flat: OSCArg[] = ['D', 'tracks/0/devices/0', 'name', 'cls', 0];
		expect(parseV3TreeArgs(flat, 'accept', 1)).toBeNull();
	});

	it('bails on P without a preceding D', () => {
		const flat: OSCArg[] = [
			'T', 'tracks/0', '', 0, 0, 0, 0, 0, 0, 0,
			'P', 'tracks/0/devices/0/params/0', '', '', 0, 1, 0, ''
		];
		expect(parseV3TreeArgs(flat, 'accept', 1)).toBeNull();
	});

	it('bails when D devicePath is not under current track', () => {
		// Full-arity T, then a D that belongs to a different track. The
		// T must be complete or this would bail on the short-record
		// guard instead and prove nothing about the parent check.
		const flat: OSCArg[] = [
			...tRecord('tracks/0'),
			'D', 'tracks/5/devices/0', 'name', 'cls'
		];
		expect(parseV3TreeArgs(flat, 'accept', 1)).toBeNull();
	});

	it('bails on an unknown tag', () => {
		const flat: OSCArg[] = [...tRecord('tracks/0'), 'Z', 'oops'];
		expect(parseV3TreeArgs(flat, 'accept', 1)).toBeNull();
	});

	it('bails on a T record one field short of the arity', () => {
		// The arity guard itself, pinned independently — the two tests
		// above used to lean on it by accident.
		expect(parseV3TreeArgs(tRecord('tracks/0').slice(0, -1), 'accept', 1)).toBeNull();
	});

	it('bails when V refers to an unknown param', () => {
		const flat: OSCArg[] = [
			'T', 'tracks/0', '', 0, 0, 0, 0, 0, 0, 0,
			'D', 'tracks/0/devices/0', '', '', 0,
			'V', 'tracks/0/devices/0/params/99', 0
		];
		expect(parseV3TreeArgs(flat, 'accept', 1)).toBeNull();
	});
});

// ============================================
// state/full/tree
// ============================================

describe('v3 state/full/tree', () => {
	it('happy path: one message installs the tree', () => {
		const c0 = buildTreeArgs({
			tracks: [
				{
					trackPath: 'tracks/0',
					name: 't0',
					devices: [
						{
							devicePath: 'tracks/0/devices/0',
							params: [{ paramPath: 'tracks/0/devices/0/params/0', value: 0.5 }]
						}
					]
				}
			]
		});
		const c1 = buildTreeArgs({
			tracks: [{ trackPath: 'tracks/1', name: 't1' }]
		});

		deliverStateFull({ reason: 'accept', generation: 3, tracksByChunk: [c0, c1] });

		expect(v3Store.generation).toBe(3);
		expect(v3Store.tracks.size).toBe(2);
		expect([...v3Store.tracks.keys()]).toEqual(['tracks/0', 'tracks/1']);
	});

	it('reads the header positionally and parses from arg 4 on', () => {
		// The load-bearing off-by-one. A header arity of 3 or 5 would
		// hand the parser a stray header field as a record tag.
		const c = buildTreeArgs({ tracks: [{ trackPath: 'tracks/0', name: 'only' }] });
		handleV3StateFullTree(['accept', 9, '0x0000002a', '', ...c]);
		expect(v3Store.generation).toBe(9);
		expect([...v3Store.tracks.keys()]).toEqual(['tracks/0']);
		expect(v3Store.tracks.get('tracks/0')?.name).toBe('only');
	});

	it('records the header ETag verbatim for the next hello', () => {
		const c = buildTreeArgs({ tracks: [{ trackPath: 'tracks/0' }] });
		clearHeldEtags();
		handleV3StateFullTree(['accept', 4, '0x0f6edcf5', '', ...c]);
		expect(getHeldEtag(null)).toBe('0x0f6edcf5');
	});

	it('applies the tree but claims no ETag when the token is unreadable', () => {
		// The token is opaque to us, so an unreadable one is not an
		// integrity failure — it costs the next reconnect a full resend
		// and nothing else. Dropping the tree over it would be strictly
		// worse.
		const c = buildTreeArgs({ tracks: [{ trackPath: 'tracks/0' }] });
		clearHeldEtags();
		handleV3StateFullTree(['accept', 4, 'not-a-hex', '', ...c]);
		expect(v3Store.tracks.size).toBe(1);
		expect(getHeldEtag(null)).toBeNull();
	});

	it('claims no ETag when the tree failed to parse', () => {
		// Claiming one here is the failure the ETag exists to prevent:
		// the surface would answer `unchanged` and leave the UI holding
		// a tree it never applied.
		clearHeldEtags();
		handleV3StateFullTree(['accept', 4, '0x0f6edcf5', '', 'D', 'tracks/0/devices/0', 'd', 'c']);
		expect(v3Store.tracks.size).toBe(0);
		expect(getHeldEtag(null)).toBeNull();
	});

	it('rejects a short header without touching the store', () => {
		handleV3StateFullTree(['accept', 1, '0x00000001']);
		expect(v3Store.tracks.size).toBe(0);
		expect(v3Store.generation).toBe(UNSET_GENERATION);
	});

	it('rejects an unknown reason', () => {
		const c = buildTreeArgs({ tracks: [{ trackPath: 'tracks/0' }] });
		handleV3StateFullTree(['bogus', 1, '0x00000001', '', ...c]);
		expect(v3Store.tracks.size).toBe(0);
	});

	it('rejects generation 0 — the UI-side unset sentinel', () => {
		const c = buildTreeArgs({ tracks: [{ trackPath: 'tracks/0' }] });
		handleV3StateFullTree(['accept', 0, '0x00000001', '', ...c]);
		expect(v3Store.tracks.size).toBe(0);
		expect(v3Store.generation).toBe(UNSET_GENERATION);
	});

	it('accepts an empty tree as an empty tree', () => {
		const c = buildTreeArgs({ tracks: [{ trackPath: 'tracks/0' }] });
		deliverStateFull({ reason: 'accept', generation: 1, tracksByChunk: [c] });
		expect(v3Store.tracks.size).toBe(1);

		handleV3StateFullTree(['structural', 2, '0x00000009', '']);
		expect(v3Store.generation).toBe(2);
		expect(v3Store.tracks.size).toBe(0);
	});

	it('dedupes on identical (generation, etag) for structural bundles', () => {
		// `structural` is the only reason that may be deduped. `accept` and
		// `resync` both follow a tree wipe and must always re-apply — see
		// the regression tests below.
		const c = buildTreeArgs({ tracks: [{ trackPath: 'tracks/0' }] });

		deliverStateFull({
			reason: 'structural',
			generation: 5,
			etag: '0x000000aa',
			tracksByChunk: [c]
		});
		// Mutate store out-of-band to prove replaceTree did NOT re-fire.
		invalidatePaths(5, ['tracks/0']);
		expect(v3Store.tracks.size).toBe(0);

		// Same generation, same ETag. Handler should skip reinstallation.
		deliverStateFull({
			reason: 'structural',
			generation: 5,
			etag: '0x000000aa',
			tracksByChunk: [c]
		});
		expect(v3Store.tracks.size).toBe(0); // not repopulated
	});

	it('does NOT dedupe an identical accept bundle after a tree wipe', () => {
		// The surface-restart blank-UI bug. `v3SurfaceHello` calls
		// `resetForSurfaceRestart()`, which clears the v3 store but not the
		// handler's `lastApplied` dedupe key. Reloading the control surface
		// against an unchanged set then produces an identical bundle, which
		// used to be deduped into a blank UI with no path to repair.
		const c = buildTreeArgs({ tracks: [{ trackPath: 'tracks/0' }] });

		deliverStateFull({
			reason: 'accept',
			generation: 5,
			etag: '0x000000aa',
			tracksByChunk: [c]
		});
		expect(v3Store.tracks.size).toBe(1);

		// Simulate the wipe that resetForSurfaceRestart performs.
		invalidatePaths(5, ['tracks/0']);
		expect(v3Store.tracks.size).toBe(0);

		// Identical bundle again — must repopulate, not dedupe.
		deliverStateFull({
			reason: 'accept',
			generation: 5,
			etag: '0x000000aa',
			tracksByChunk: [c]
		});
		expect(v3Store.tracks.size).toBe(1);
	});

	it('does NOT dedupe an identical resync bundle after a tree wipe', () => {
		const c = buildTreeArgs({ tracks: [{ trackPath: 'tracks/0' }] });

		deliverStateFull({
			reason: 'resync',
			generation: 6,
			etag: '0x000000bb',
			tracksByChunk: [c]
		});
		expect(v3Store.tracks.size).toBe(1);

		invalidatePaths(6, ['tracks/0']);
		expect(v3Store.tracks.size).toBe(0);

		deliverStateFull({
			reason: 'resync',
			generation: 6,
			etag: '0x000000bb',
			tracksByChunk: [c]
		});
		expect(v3Store.tracks.size).toBe(1);
	});

	it('does not dedupe when generation advances', () => {
		const c = buildTreeArgs({ tracks: [{ trackPath: 'tracks/0' }] });

		deliverStateFull({
			reason: 'accept',
			generation: 1,
			etag: '0x000000cc',
			tracksByChunk: [c]
		});
		resetTree(); // clear tracks, generation stays at 1

		deliverStateFull({
			reason: 'structural',
			generation: 2,
			etag: '0x000000cc',
			tracksByChunk: [c]
		});
		expect(v3Store.generation).toBe(2);
		expect(v3Store.tracks.size).toBe(1);
	});

	it('does not dedupe when the ETag moves under the same generation', () => {
		const c = buildTreeArgs({ tracks: [{ trackPath: 'tracks/0' }] });

		deliverStateFull({
			reason: 'structural',
			generation: 7,
			etag: '0x000000dd',
			tracksByChunk: [c]
		});
		invalidatePaths(7, ['tracks/0']);
		expect(v3Store.tracks.size).toBe(0);

		deliverStateFull({
			reason: 'structural',
			generation: 7,
			etag: '0x000000de',
			tracksByChunk: [c]
		});
		expect(v3Store.tracks.size).toBe(1);
	});
});

// ============================================
// Invalidate handler
// ============================================

describe('v3 state/invalidate handler', () => {
	it('advances generation and drops listed paths', () => {
		const track = mkTrack(0, [
			mkDevice(0, 0, [mkParam(0, 0, 0), mkParam(0, 0, 1)])
		]);
		replaceTree(1, [track]);
		handleV3StateInvalidate([2, 'structural', 'tracks/0/devices/0/params/1']);
		expect(v3Store.generation).toBe(2);
		expect(v3Store.tracks.get('tracks/0')?.devices.get('tracks/0/devices/0')
			?.params.size).toBe(1);
	});

	it('handles zero-paths invalidate as generation bump', () => {
		replaceTree(1, [mkTrack(0, [])]);
		handleV3StateInvalidate([5, 'bookkeeping']);
		expect(v3Store.generation).toBe(5);
		expect(v3Store.tracks.size).toBe(1);
	});

	it('rejects short payload', () => {
		replaceTree(1, [mkTrack(0, [])]);
		handleV3StateInvalidate([]);
		handleV3StateInvalidate([3]); // missing reason
		expect(v3Store.generation).toBe(1); // unchanged
	});

	it('rejects invalid generation', () => {
		replaceTree(1, [mkTrack(0, [])]);
		handleV3StateInvalidate([0, 'bad']);
		expect(v3Store.generation).toBe(1);
	});
});

// `awaitNextStateFullEnd` and its seven tests went with the
// reassembler. The barrier was a read-after-write fence for
// `trackPreparation`'s clip-presence check against an asynchronously
// reassembled store — a race that only existed while the tree arrived
// in pieces. It had no production callers by the time 3.6.0 landed;
// only these tests exercised it.

// ============================================
// Phase 12 pr12-3 — scoped state/full (reason="selection-change")
// ============================================

/**
 * Drive a scoped `state/full/tree`. The header's 4th arg carries the
 * scope path (`tracks/<N>` or `master`), and the payload carries a
 * single track's subtree.
 */
function deliverScopedStateFull(options: {
	generation: number;
	scope: string;
	tracksByChunk: OSCArg[][];
	etag?: string;
}): void {
	const { generation, scope, tracksByChunk, etag } = options;
	const flat: OSCArg[] = [];
	for (const c of tracksByChunk) for (const a of c) flat.push(a);
	handleV3StateFullTree([
		'selection-change',
		generation,
		etag ?? `0x${(generation * 1000 + flat.length).toString(16).padStart(8, '0')}`,
		scope,
		...flat
	]);
}

describe('handleV3StateFullTree — scoped (pr12-3)', () => {
	it('applies a scoped bundle to its subtree only', () => {
		// Two tracks in store up front — scoped apply must leave tracks/0
		// alone and upsert tracks/1.
		const t0 = buildTreeArgs({ tracks: [{ trackPath: 'tracks/0', name: 'keep' }] });
		const t1 = buildTreeArgs({ tracks: [{ trackPath: 'tracks/1', name: 'old' }] });
		deliverStateFull({
			reason: 'accept',
			generation: 1,
			tracksByChunk: [t0, t1]
		});
		expect(v3Store.tracks.get('tracks/0')?.name).toBe('keep');
		expect(v3Store.tracks.get('tracks/1')?.name).toBe('old');

		const scoped = buildTreeArgs({
			tracks: [{ trackPath: 'tracks/1', name: 'new' }]
		});
		deliverScopedStateFull({
			generation: 2,
			scope: 'tracks/1',
			tracksByChunk: [scoped]
		});

		// Scoped apply advances generation, upserts the scoped track, and
		// leaves the sibling track untouched.
		expect(v3Store.generation).toBe(2);
		expect(v3Store.tracks.get('tracks/1')?.name).toBe('new');
		expect(v3Store.tracks.get('tracks/0')?.name).toBe('keep');
	});

	it('still applies an empty-scope bundle as a full-tree replace', () => {
		// Seed tracks/0, tracks/1. 4-arg begin with one-track payload
		// must (per replaceTree's reconcileTracks) delete tracks/1.
		const t0 = buildTreeArgs({ tracks: [{ trackPath: 'tracks/0' }] });
		const t1 = buildTreeArgs({ tracks: [{ trackPath: 'tracks/1' }] });
		deliverStateFull({
			reason: 'accept',
			generation: 1,
			tracksByChunk: [t0, t1]
		});
		expect(v3Store.tracks.has('tracks/1')).toBe(true);

		deliverStateFull({
			reason: 'structural',
			generation: 2,
			tracksByChunk: [t0]
		});
		expect(v3Store.tracks.has('tracks/0')).toBe(true);
		expect(v3Store.tracks.has('tracks/1')).toBe(false);
	});

	it('routes an empty-string scope to the full apply', () => {
		const t0 = buildTreeArgs({ tracks: [{ trackPath: 'tracks/0' }] });
		const t1 = buildTreeArgs({ tracks: [{ trackPath: 'tracks/1' }] });
		deliverStateFull({ reason: 'accept', generation: 1, tracksByChunk: [t0, t1] });
		// Empty scope means whole-song even under a selection-change
		// reason, so tracks/1 gets deleted — the payload has only t0.
		handleV3StateFullTree(['selection-change', 2, '0x00000002', '', ...t0]);
		expect(v3Store.tracks.has('tracks/1')).toBe(false);
	});

	it('keeps map identity stable across a scoped re-apply', () => {
		// Pre-seed a track with 2 devices so we can prove ADR-003 identity
		// survives the scoped reconcile (device map reference stable when
		// device list unchanged).
		const seed = buildTreeArgs({
			tracks: [
				{
					trackPath: 'tracks/0',
					name: 'preserve',
					devices: [
						{
							devicePath: 'tracks/0/devices/0',
							name: 'dA',
							className: 'AudioEffect',
							params: [{ paramPath: 'tracks/0/devices/0/params/0', value: 0.25 }]
						}
					]
				},
				{ trackPath: 'tracks/1' }
			]
		});
		const chunk0 = seed.slice(0, Math.floor(seed.length / 2));
		const chunk1 = seed.slice(Math.floor(seed.length / 2));
		deliverStateFull({
			reason: 'accept',
			generation: 1,
			tracksByChunk: [chunk0, chunk1]
		});
		const devicesMapBefore = v3Store.tracks.get('tracks/0')?.devices;
		expect(devicesMapBefore).toBeDefined();

		// Scoped bundle for tracks/0 carrying identical device/params but
		// new track scalar (name change) — reconcileDevices should keep
		// the same params map reference.
		const scoped = buildTreeArgs({
			tracks: [
				{
					trackPath: 'tracks/0',
					name: 'renamed',
					devices: [
						{
							devicePath: 'tracks/0/devices/0',
							name: 'dA',
							className: 'AudioEffect',
							params: [{ paramPath: 'tracks/0/devices/0/params/0', value: 0.25 }]
						}
					]
				}
			]
		});
		deliverScopedStateFull({
			generation: 2,
			scope: 'tracks/0',
			tracksByChunk: [scoped]
		});

		expect(v3Store.tracks.get('tracks/0')?.name).toBe('renamed');
		// Sibling untouched.
		expect(v3Store.tracks.has('tracks/1')).toBe(true);
		// ADR-003: devices Map identity preserved through scoped apply.
		const devicesMapAfter = v3Store.tracks.get('tracks/0')?.devices;
		expect(devicesMapAfter).toBe(devicesMapBefore);
	});
});

/*
 * Protocol 3.9.0 (ADR-439) appended `preset` to the T record, and the WHOLE
 * stated risk of that bump is the pair of scalar-equality checks the store
 * uses to decide whether a T record changed anything. Both short-circuit when
 * every compared field matches, so a field missing from either list is a field
 * whose change is silently dropped — no error, no re-emit, and the swap pill
 * keeps stepping from the preset the track used to hold.
 *
 * Both lists gained `preset`; neither was exercised. These drive a T record
 * whose ONLY difference is that field through both paths, and each asserts the
 * record object is REPLACED, not just that the value reads back — reading the
 * value alone would pass against a store that re-set the record every time and
 * so would say nothing about the guard. The no-change control beside each is
 * what gives the identity assertion its meaning.
 */
describe('T record whose only change is `preset` (protocol 3.9.0)', () => {
	const PRESET_A = '/Library/Instruments/Omni/Synth/Lead/Aurora Lead.adg';
	const PRESET_B = '/Library/Instruments/Omni/Synth/Lead/Crystal Fifths.adg';

	/** One track, everything fixed but the preset. */
	const trackWith = (preset: string) =>
		buildTreeArgs({
			tracks: [
				{
					trackPath: 'tracks/0',
					name: 'Lead',
					color: 0x886ce4,
					volume: 0.69,
					role: 'synth',
					preset,
					devices: [{ devicePath: 'tracks/0/devices/0', name: 'Operator', className: 'Operator' }]
				}
			]
		});

	it('is re-emitted through the whole-song apply (reconcileTracks)', () => {
		deliverStateFull({ reason: 'accept', generation: 1, tracksByChunk: [trackWith(PRESET_A)] });
		const before = v3Store.tracks.get('tracks/0');
		expect(before?.preset).toBe(PRESET_A);

		// Control: the SAME record again must not replace anything, or the
		// identity assertion below proves nothing about the guard.
		deliverStateFull({ reason: 'structural', generation: 2, tracksByChunk: [trackWith(PRESET_A)] });
		expect(v3Store.tracks.get('tracks/0')).toBe(before);

		deliverStateFull({ reason: 'structural', generation: 3, tracksByChunk: [trackWith(PRESET_B)] });
		const after = v3Store.tracks.get('tracks/0');
		expect(after?.preset, 'a preset-only change was dropped as "unchanged"').toBe(PRESET_B);
		expect(after).not.toBe(before);
		// Everything else rides through untouched, including ADR-003 identity.
		expect(after?.name).toBe('Lead');
		expect(after?.role).toBe('synth');
		expect(after?.devices).toBe(before?.devices);
	});

	it('is re-emitted through the scoped apply (mergeSubtreeAtPath)', () => {
		deliverStateFull({ reason: 'accept', generation: 1, tracksByChunk: [trackWith(PRESET_A)] });
		const before = v3Store.tracks.get('tracks/0');
		expect(before?.preset).toBe(PRESET_A);

		deliverScopedStateFull({ generation: 2, scope: 'tracks/0', tracksByChunk: [trackWith(PRESET_A)] });
		expect(v3Store.tracks.get('tracks/0')).toBe(before);

		deliverScopedStateFull({ generation: 3, scope: 'tracks/0', tracksByChunk: [trackWith(PRESET_B)] });
		const after = v3Store.tracks.get('tracks/0');
		expect(after?.preset, 'a preset-only change was dropped as "unchanged"').toBe(PRESET_B);
		expect(after).not.toBe(before);
		expect(after?.name).toBe('Lead');
		expect(after?.devices).toBe(before?.devices);
	});

	it('the same, straight through the store primitive', () => {
		// No parser, no header: `mergeSubtreeAtPath` itself, so a future
		// change to either can be told apart from a change to the other.
		replaceTree(1, [{ ...mkTrack(0, []), preset: PRESET_A }]);
		const before = v3Store.tracks.get('tracks/0');
		mergeSubtreeAtPath(2, 'tracks/0', { ...mkTrack(0, []), preset: PRESET_A });
		expect(v3Store.tracks.get('tracks/0')).toBe(before);
		mergeSubtreeAtPath(3, 'tracks/0', { ...mkTrack(0, []), preset: PRESET_B });
		expect(v3Store.tracks.get('tracks/0')?.preset).toBe(PRESET_B);
		expect(v3Store.tracks.get('tracks/0')).not.toBe(before);
	});
});

describe('mergeSubtreeAtPath (pr12-3 store primitive)', () => {
	it('upserts a new scoped track without touching siblings', () => {
		replaceTree(1, [
			mkTrack(0, []),
			mkTrack(1, [])
		]);
		const incoming: TrackRecord = mkTrack(1, []);
		incoming.name = 'replaced';
		mergeSubtreeAtPath(2, 'tracks/1', incoming);
		expect(v3Store.generation).toBe(2);
		expect(v3Store.tracks.get('tracks/1')?.name).toBe('replaced');
		expect(v3Store.tracks.has('tracks/0')).toBe(true);
	});

	it('inserts a scoped track that was not in the store before', () => {
		replaceTree(1, [mkTrack(0, [])]);
		mergeSubtreeAtPath(2, 'tracks/1', mkTrack(1, []));
		expect(v3Store.tracks.has('tracks/0')).toBe(true);
		expect(v3Store.tracks.has('tracks/1')).toBe(true);
	});

	it('no-op apply (null track) still advances generation', () => {
		replaceTree(1, [mkTrack(0, [])]);
		mergeSubtreeAtPath(2, 'tracks/5', null);
		expect(v3Store.generation).toBe(2);
		expect(v3Store.tracks.size).toBe(1);
	});

	it('drops apply when scope/payload mismatch', () => {
		replaceTree(1, [mkTrack(0, [])]);
		const wrongPath = mkTrack(0, []);
		wrongPath.name = 'should-not-apply';
		mergeSubtreeAtPath(2, 'tracks/1', wrongPath);
		// Generation still advances (we already took the scope fields off
		// the buffer) but the mismatched track is NOT written through.
		expect(v3Store.generation).toBe(2);
		expect(v3Store.tracks.get('tracks/0')?.name).toBe('t0');
		expect(v3Store.tracks.has('tracks/1')).toBe(false);
	});
});
