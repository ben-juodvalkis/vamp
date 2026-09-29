/**
 * Demo scenarios (docs/plans/general-release/demo-recording.plan.md §2).
 *
 * A step happens AT a position in the song (`'bar.beat'`, 4/4, 1-based),
 * which is what makes every run sound the same, and may name a condition
 * on Live's own state (`until`) that must hold before the next step, which
 * is what makes a gesture that did nothing a failed take instead of a
 * published one.
 *
 * Step fields (all optional but `at`):
 *   chapter  starts a numbered chapter in the lower third
 *   caption  the subtitle from here on; a function of the take's `vars`
 *            is filled in when the take ends (see `readKey`)
 *   tap      a target (below): one finger, down and up
 *   taps     several targets, one after another
 *   drag     { target, path: [[fx, fy], …], beats }: a finger down at the
 *            path's first point and moved through the rest, in fractions
 *            of the target's box, over `beats`
 *   play     [[beat, lengthBeats, notes, velocity], …]: the performer's
 *            phrase, into the recorder's Vamp Demo MIDI port
 *   do       async (live, vars) => …: a direct LOM action or read
 *   until    a condition on Live (below)
 *
 * The interface is driven only by touch; `do` is for the runner's own
 * bookkeeping (reading the key for a caption, tidying the set).
 */

import { BASS, DRUMS, KEYS } from './phrases.mjs';

// ---- targets: where a finger lands ----------------------------------------
// Each is { css, text?, within?, index? } resolved in the page: the first
// element matching `css` (inside `within`, if given) whose trimmed text is
// `text`, if given.

export const T = {
	/** A Place in the browser's left rail. */
	rail: (name) => ({ css: '.places-rail .selection-button.category-button', text: name, label: `rail ${name}` }),
	/**
	 * A folder tile in the open browser. Pressed as a MOUSE-type pointer: a
	 * folder opens on finger-up, and the click Chromium synthesizes from a
	 * touch tap then lands on whatever preset tile appeared under the finger
	 * and loads it. A mouse click needs press and release on one element.
	 */
	folder: (name) => ({ css: 'button.card.folder-tile', text: name, textCss: '.tile-name', pointer: 'mouse', label: `folder ${name}` }),
	/** A preset tile in the open browser. */
	preset: (name) => ({ css: 'button.card.preset-tile', text: name, textCss: '.tile-name', label: `preset ${name}` }),
	/** A band of a track strip: 'clip' | 'device' | 'permute'. */
	strip: (track, section) => ({
		css: `.track-col[data-track-index="${track}"] [data-section="${section}"]`,
		label: `track ${track} ${section}`
	}),
	/** A strip's name band: a tap mutes. */
	name: (track) => ({ css: `.track-col[data-track-index="${track}"] .header-name`, label: `track ${track} name` }),
	/** The action strip of a slot in the clip view's column (the selected track's). */
	slot: (slot) => ({ css: `.mini-session .slot-cell[data-slot-index="${slot}"] .slot-action`, label: `slot ${slot}` }),
	/** A cell of the FX grid: 'fx1'…'fx12', 'squash'. */
	tile: (cell) => ({ css: `[data-debug="devices-panel"] [data-cell="${cell}"] .device-control`, label: `tile ${cell}` }),
	/** An XY pad in the central view, by its title. */
	xy: (title) => ({ css: `[data-debug="middle-panel"] .xy-container[aria-label^="${title}:"]`, label: `xy ${title}` }),
	/** A Permute step: lane 'mute' | 'pitch'. */
	step: (lane, i) => ({ css: `.grid-${lane}-steps .step-cell[data-step-index="${i}"]`, label: `${lane} step ${i}` }),
	/** A clip cell on the full session grid (session mode on). */
	gridSlot: (track, slot, part) => ({ grid: { track, slot, part }, label: `grid ${track}/${slot} ${part}` })
};

// ---- conditions on Live ----------------------------------------------------

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

export const hasDevice = (t, className) => ({
	what: `track ${t} has ${className}`,
	read: (live) => live.read('song', ['tracks.*name']).then(async (s) =>
		s['tracks.*name'].length > t ? live.read(`tracks/${t}`, ['devices.*class_name']) : { 'devices.*class_name': [] }
	),
	test: (r) => r['devices.*class_name'].includes(className)
});

export const muted = (t, on) => ({
	what: `track ${t} ${on ? 'muted' : 'unmuted'}`,
	read: (live) => live.read(`tracks/${t}`, ['mute']),
	test: (r) => r.mute === on
});

// ---- runner actions -----------------------------------------------------------

const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Live's key, into `vars.key`, e.g. "A Minor". */
export const readKey = async (live, vars) => {
	const r = await live.read('song', ['root_note', 'scale_name']);
	vars.key = `${NOTE[r.root_note] ?? '?'} ${r.scale_name}`;
};

// ---- scenarios -------------------------------------------------------------------

const PREFS = {
	session: 'uiPrefsStore.sessionMode',
	fx: 'uiPrefsStore.showFxGrid'
};

export const SCENARIOS = {
	tour: {
		title: 'Vamp: a tour',
		blurb: 'From an empty Live set to a three-part groove, every step played on the iPad.',
		tempo: 96,
		// Clip grid hidden, FX grid shown: the layout the iPad ships with.
		prefs: { [PREFS.session]: '0', [PREFS.fx]: '1' },
		// Live's window, in points: the transport bar, the track columns and
		// the device chain, without the empty session area to their right.
		liveCrop: { x: 0, y: 0, w: 1090, h: 826 },
		// Live's one bare MIDI track, the way a new set opens.
		set: { empty: true, key: { root: 0, scale: 'Major' } },
		intro: { title: 'Vamp', subtitle: 'Live looping for Ableton Live, played from an iPad.' },
		outro: {
			title: 'Vamp',
			subtitle: 'Built by a dance accompanist for playing ballet class.',
			foot: 'github.com/ben-juodvalkis/vamp'
		},
		steps: [
			{ at: '1.2', chapter: 'Start', caption: 'An empty Live set, and Vamp on the iPad.' },

			{ at: '2.1', chapter: 'Load a kit', caption: "Browse Live's library by touch.", tap: T.rail('Drum') },
			{ at: '2.3', tap: T.folder('Drum Machines') },
			{ at: '3.1', caption: 'Tap a kit. It loads on a new track.', tap: T.preset('909 Core Kit'), until: hasDevice(1, 'DrumGroupDevice') },
			// The kit took a new track; Live's empty first track goes, so the
			// kit sits first, as it would have on a set with no tracks.
			{ at: '4.4', do: (live) => live.invoke('song', 'delete_track', [0]) },

			{ at: '5.2', chapter: 'Record a loop', caption: 'Tap the clip band to arm the track, then tap record.', tap: T.strip(0, 'clip'), until: armed(0) },
			{ at: '5.4', tap: T.slot(0) },
			{ at: '6.1', caption: 'It records from the next bar. Play.', play: DRUMS, until: recording(0, 0) },
			{ at: '7.3', caption: 'Tap again, and the take loops.', tap: T.slot(0) },
			{ at: '8.1', until: looping(0, 0) },

			{ at: '8.3', chapter: 'Shape the sound', caption: 'Every instrument gets its own controls.', tap: T.strip(0, 'device') },
			{
				at: '9.2',
				caption: "Sweep the whole kit's filter.",
				drag: { target: T.xy('Filter'), path: [[0.55, 0.5], [0.12, 0.62], [0.12, 0.62], [0.6, 0.45]], beats: 6 }
			},

			{ at: '11.1', chapter: 'Add a bass', caption: 'Load a bass.', tap: T.rail('Bass') },
			{ at: '11.3', tap: T.folder('Drift') },
			{ at: '12.1', tap: T.preset('Deep Bass'), until: hasDevice(1, 'Drift') },
			{ at: '12.3', caption: 'Arm it, and record over the drums.', tap: T.strip(1, 'clip'), until: armed(1) },
			{ at: '12.4', tap: T.slot(0) },
			{ at: '13.1', play: BASS, until: recording(1, 0) },
			{ at: '13.3', caption: 'Play.' },
			{ at: '14.3', caption: 'Close the loop.', tap: T.slot(0) },
			{ at: '15.1', until: looping(1, 0) },

			// Key Follow re-reads the loops ~300 ms after a take ends; the
			// caption quotes the key Live is in by then (bottom right, too).
			{
				at: '15.3',
				chapter: 'Key Follow',
				caption: (v) => `Vamp heard the loops and set Live's key: ${v.key}.`,
				do: readKey
			},

			{ at: '17.1', chapter: 'Add keys', caption: 'Now some keys.', tap: T.rail('Key') },
			{ at: '17.3', tap: T.folder('Electric') },
			{ at: '18.1', tap: T.preset('E-Piano MKI Mellow'), until: hasDevice(2, 'LoungeLizard') },
			{ at: '18.3', caption: 'Record the chords.', tap: T.strip(2, 'clip'), until: armed(2) },
			{ at: '18.4', tap: T.slot(0) },
			{ at: '19.1', play: KEYS, until: recording(2, 0) },
			{ at: '19.3', caption: 'Play.' },
			{ at: '20.3', tap: T.slot(0) },
			{ at: '21.1', caption: 'Three loops.', until: looping(2, 0) },

			{
				at: '22.1',
				chapter: 'Effects by touch',
				caption: 'Drag a tile. Live inserts the effect, and your finger sets it.',
				drag: { target: T.tile('fx12'), path: [[0.5, 0.6], [0.62, 0.22]], beats: 4 }
			},
			{ at: '23.2', caption: 'Echo on the keys.', drag: { target: T.tile('fx11'), path: [[0.4, 0.6], [0.52, 0.34]], beats: 3 } },
			{ at: '24.2', caption: 'Pick the bass, and drive it.', tap: T.strip(1, 'device') },
			{ at: '24.4', drag: { target: T.tile('fx5'), path: [[0.5, 0.65], [0.56, 0.3]], beats: 3 } },

			{
				at: '26.1',
				chapter: 'Permute',
				caption: 'A step sequencer on every track. Octave steps on the bass…',
				tap: T.strip(1, 'permute')
			},
			{ at: '26.3', taps: [T.step('pitch', 3), T.step('pitch', 7)] },
			{ at: '27.3', caption: '…and mute steps that chop the keys.', tap: T.strip(2, 'permute') },
			{ at: '28.1', taps: [T.step('mute', 1), T.step('mute', 3), T.step('mute', 6)] },

			{ at: '29.1', chapter: 'Mix', caption: 'Tap a name to mute it…', tap: T.name(0), until: muted(0, true) },
			{ at: '30.1', caption: '…and bring it back.', tap: T.name(0), until: muted(0, false) },
			{ at: '31.1', caption: 'Everything you saw was played on the iPad.' }
		],
		end: '33.1',
		result: [looping(0, 0), looping(1, 0), looping(2, 0)]
	},

	'record-and-layer': {
		title: 'Record a loop, then layer another',
		blurb:
			'Pick a track and tap record: Vamp records on the next bar. Tap again to close the take, and it loops. Then do the same on a second track, over the first.',
		tempo: 100,
		prefs: { [PREFS.session]: '1', [PREFS.fx]: '0' },
		set: { tracks: [{ name: 'Keys', device: 'Electric' }, { name: 'Bass', device: 'Drift' }] },
		intro: { title: 'Vamp', subtitle: 'Record a loop, then layer another.' },
		outro: { title: 'Vamp', subtitle: 'Live looping for Ableton Live, played from an iPad.' },
		steps: [
			{ at: '1.2', chapter: 'Record a loop', caption: 'Pick the Keys track', tap: T.gridSlot(0, 0, 'body'), until: armed(0) },
			{ at: '1.4', caption: 'Tap record: it starts on the next bar', tap: T.gridSlot(0, 0, 'action') },
			{ at: '2.1', caption: 'Play', play: KEYS, until: recording(0, 0) },
			{ at: '3.3', caption: 'Tap again to close the loop', tap: T.gridSlot(0, 0, 'action') },
			{ at: '4.1', caption: 'It loops', until: looping(0, 0) },
			{ at: '4.2', chapter: 'Layer another', caption: 'Pick the Bass track', tap: T.gridSlot(1, 0, 'body'), until: armed(1) },
			{ at: '4.4', caption: 'Record over it', tap: T.gridSlot(1, 0, 'action') },
			{ at: '5.1', caption: 'Play', play: BASS, until: recording(1, 0) },
			{ at: '6.3', caption: 'Close the second loop', tap: T.gridSlot(1, 0, 'action') },
			{ at: '7.1', caption: 'Two loops', until: looping(1, 0) }
		],
		end: '9.1',
		result: [looping(0, 0), looping(1, 0)]
	}
};
