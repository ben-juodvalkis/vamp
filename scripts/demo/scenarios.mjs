/**
 * Demo scenarios (docs/plans/general-release/demo-recording.plan.md §2).
 *
 * A step happens AT a position in the song (`'bar.beat'`, 4/4, 1-based),
 * which is what makes every run sound the same, and may name a condition
 * on Live's own state (`until`) that must hold before the next step, which
 * is what makes a gesture that did nothing a failed take instead of a
 * published one.
 *
 * Kinds of step:
 *   tap:  { track, slot, part: 'body' | 'action' }  a finger on a clip cell.
 *         The body selects (and, with Auto-Arm, arms); the action strip on
 *         the cell's leading edge records, closes a take, launches or stops.
 *   play: [[beat, lengthBeats, notes, velocity], …]  the performer's phrase,
 *         into the recorder's Vamp Demo MIDI port, beats from `at`.
 */

// ---- conditions on Live ------------------------------------------------

/** A clip slot's attributes, read through its track (the probe path has no slot level). */
const slotRead = (live, t, s, attrs) =>
	live
		.read(`tracks/${t}`, attrs.map((a) => `clip_slots[${s}].${a}`))
		.then((r) => Object.fromEntries(attrs.map((a) => [a, r[`clip_slots[${s}].${a}`]])));

export const armed = (t) => ({
	what: `track ${t} armed`,
	read: (live) => live.read(`tracks/${t}`, ['arm']),
	test: (r) => r.arm === true
});

export const recording = (t, s) => ({
	what: `track ${t} slot ${s} recording`,
	read: (live) => slotRead(live, t, s, ['is_recording']),
	test: (r) => r.is_recording === true
});

export const looping = (t, s) => ({
	what: `track ${t} slot ${s} looping`,
	read: (live) => slotRead(live, t, s, ['has_clip', 'is_playing', 'is_recording']),
	test: (r) => r.has_clip && r.is_playing && !r.is_recording
});

// ---- phrases -----------------------------------------------------------

const Am7 = [57, 60, 64, 67];
const Fmaj7 = [53, 57, 60, 64];
const G6 = [55, 59, 62, 64];

const KEYS = [
	[0, 1.5, Am7, 92],
	[1.5, 0.5, Am7, 70],
	[2.5, 1.25, Am7, 84],
	[4, 1.5, Fmaj7, 92],
	[5.5, 0.5, Fmaj7, 70],
	[6.5, 1.25, G6, 84]
];

const BASS = [
	[0, 1.5, [33], 100],
	[1.5, 0.5, [33], 80],
	[2.5, 0.5, [40], 90],
	[3, 0.75, [43], 90],
	[4, 1.5, [29], 100],
	[5.5, 0.5, [29], 80],
	[6.5, 0.5, [36], 90],
	[7, 0.75, [31], 90]
];

// ---- scenarios ---------------------------------------------------------

export const SCENARIOS = {
	'record-and-layer': {
		title: 'Record a loop, then layer another',
		blurb:
			'Pick a track and tap record: Vamp records on the next bar. Tap again to close the take, and it loops. Then do the same on a second track, over the first.',
		features: [],
		tempo: 100,
		tracks: [
			{ name: 'Keys', device: 'Electric' },
			{ name: 'Bass', device: 'Drift' }
		],
		// Live's pane: its whole window for now (the camera is Phase 1).
		steps: [
			{ at: '1.2', caption: 'Pick the Keys track', tap: { track: 0, slot: 0, part: 'body' }, until: armed(0) },
			{ at: '1.4', caption: 'Tap record: it starts on the next bar', tap: { track: 0, slot: 0, part: 'action' } },
			{ at: '2.1', caption: 'Play', play: KEYS, until: recording(0, 0) },
			{ at: '3.3', caption: 'Tap again to close the loop', tap: { track: 0, slot: 0, part: 'action' } },
			{ at: '4.1', caption: 'It loops', until: looping(0, 0) },
			{ at: '4.2', caption: 'Pick the Bass track', tap: { track: 1, slot: 0, part: 'body' }, until: armed(1) },
			{ at: '4.4', caption: 'Record over it', tap: { track: 1, slot: 0, part: 'action' } },
			{ at: '5.1', caption: 'Play', play: BASS, until: recording(1, 0) },
			{ at: '6.3', caption: 'Close the second loop', tap: { track: 1, slot: 0, part: 'action' } },
			{ at: '7.1', caption: 'Two loops', until: looping(1, 0) }
		],
		end: '9.1',
		result: [looping(0, 0), looping(1, 0)]
	}
};
