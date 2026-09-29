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
	/** A clip cell on the full session grid (session mode on): part 'body' | 'action' | 'cell'. */
	gridSlot: (track, slot, part) => ({ grid: { track, slot, part }, label: `grid ${track}/${slot} ${part}` }),
	/** Any element; `all` spans every match (a region made of parts). */
	area: (css, all = false) => ({ css, all, label: css }),
	/** A button (or switch) by its text, in the central view. */
	button: (text) => ({ css: '[data-debug="middle-panel"] button, [data-debug="middle-panel"] .clip-switch', text, label: `button ${text}` }),
	/** A slider in the central view, by its title. */
	slider: (title) => ({ css: `[data-debug="middle-panel"] .slider-container[aria-label^="${title}:"]`, label: `slider ${title}` }),
	/** A tile in the Groove view, by groove name. */
	groove: (name) => ({ css: `[data-debug="groove-view"] button.tile[data-groove="${name}"]`, label: `groove ${name}` }),
	/** An on-screen wheel: 'Pitch' | 'Mod'. */
	wheel: (name) => ({ css: `.wheel-container[aria-label="${name} wheel"]`, label: `${name} wheel` }),
	/** The same target held for `ms` instead of tapped. */
	hold: (target, ms = 700) => ({ ...target, hold: ms, label: `hold ${target.label}` })
};

/**
 * Regions of Live's window, in its points, for boxes on Live's pane
 * (measured on Live 12.4 with its browser hidden: track columns 95 pt
 * apart from x 8, clip rows 18 pt from y 78, the device chain from y 628).
 */
export const LIVE = {
	track: (i, label) => ({ x: 8 + 95 * i, y: 60, w: 94, h: 562, label }),
	clip: (i, slot, label) => ({ x: 8 + 95 * i, y: 78 + 18 * slot, w: 94, h: 20, label }),
	devices: (label) => ({ x: 8, y: 628, w: 1078, h: 196, label }),
	key: (label) => ({ x: 402, y: 25, w: 144, h: 25, label })
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

export const stopped = (t, s) => ({
	what: `track ${t} slot ${s} stopped`,
	read: (live) => slotRead(live, t, s, ['has_clip', 'is_playing']),
	test: (r) => r.has_clip && !r.is_playing
});

/**
 * The clip is on a groove made from `pattern`. The surface names a clip's
 * own pool entry "<track> <scene> · <pattern> #<hash>", and a shared one
 * by the file's name, so either way the name holds the pattern.
 */
export const grooveIs = (t, s, pattern) => ({
	what: `track ${t} slot ${s} on groove ${pattern}`,
	read: (live) => slotRead(live, t, s, ['clip.groove.name']),
	test: (r) => typeof r['clip.groove.name'] === 'string' && r['clip.groove.name'].includes(pattern)
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

	walkthrough: {
		title: 'Vamp: a walkthrough',
		blurb: 'The layout, then an empty Live set built into a groove, one touch at a time, with what each part of the interface does.',
		tempo: 96,
		// The session clip grid AND the FX grid: all four sections.
		prefs: { [PREFS.session]: '1', [PREFS.fx]: '1' },
		liveCrop: { x: 0, y: 0, w: 1090, h: 826 },
		// Live 12 puts its default "Swing 16ths 66" groove on every new MIDI
		// clip; each run starts it at Live's own settings.
		set: {
			empty: true,
			key: { root: 0, scale: 'Major' },
			groove: { name: 'Swing 16ths 66', base: 3, timing: 100, quantization: 0 }
		},
		intro: { title: 'Vamp', subtitle: 'Live looping for Ableton Live, played from an iPad.' },
		outro: {
			title: 'Vamp',
			subtitle: 'Built by a dance accompanist for playing ballet class.',
			foot: 'github.com/ben-juodvalkis/vamp'
		},
		steps: [
			{
				at: '1.3',
				chapter: 'The layout',
				caption: 'Vamp on an iPad, beside Ableton Live.',
				note: 'An empty Live set. Everything from here on is a touch on the iPad.'
			},
			{
				at: '3.1',
				box: T.area('.vendor-buttons.places-rail'),
				boxLabel: 'Browser',
				caption: "On the left, Live's browser.",
				note: "One button per Place in Live's sidebar: drums, basses, keys, synths."
			},
			{
				at: '4.3',
				box: T.area('[data-debug="devices-panel"]'),
				boxLabel: 'Effects grid',
				caption: 'Across the top, the effects grid.',
				note: "A tile per effect. Drag one to add Live's own device and set it in the same move."
			},
			{
				at: '6.1',
				box: T.area('[data-debug="middle-panel"]'),
				boxLabel: 'Central view',
				caption: 'In the middle, the view for whatever you touch.',
				note: "An instrument's controls, a clip's tools, or a step sequencer."
			},
			{
				at: '7.3',
				box: T.area('[data-debug="slots-section"]'),
				boxLabel: 'Clip slots',
				caption: "Below it, Live's session: a column of clip slots per track.",
				note: 'Record, launch and stop loops here.'
			},
			{
				at: '9.1',
				box: T.area('.track-col', true),
				boxLabel: 'Track strips',
				caption: 'Along the bottom, a strip per track.',
				note: 'A strip opens its clip, instrument or sequencer, sets its volume, and mutes.'
			},
			{
				at: '10.3',
				box: T.area('[data-debug="right-sidebar"]'),
				boxLabel: 'Loop · groove · scenes · key',
				caption: 'On the right: the loop, groove quantize, scenes and the key.',
				note: 'Scenes fire a whole row of slots at once.'
			},

			{
				at: '12.2',
				chapter: 'Load a kit',
				box: T.rail('Drum'),
				tap: T.rail('Drum'),
				caption: 'Tap Drum to browse drum kits.',
				note: 'The browser fills the screen until you pick something.'
			},
			{ at: '13.3', box: T.folder('Drum Machines'), tap: T.folder('Drum Machines'), caption: 'Folders first…' },
			{
				at: '15.1',
				box: T.preset('909 Core Kit'),
				tap: T.preset('909 Core Kit'),
				caption: '…then a kit. It loads onto a new track.',
				note: 'Vamp asks Live to load it, and Live does the rest.',
				until: hasDevice(1, 'DrumGroupDevice')
			},
			// The kit took a new track; Live's empty first track goes, so the
			// kit sits first, as it would have on a set with no tracks.
			{ at: '16.3', box: null, do: (live) => live.invoke('song', 'delete_track', [0]) },
			{
				at: '17.2',
				box: T.area('[data-debug="middle-panel"]'),
				boxLabel: 'Drum Rack view',
				caption: "The kit's controls open in the central view.",
				note: 'Sliders and XY pads shape every drum in the kit at once.',
				live: LIVE.devices('The Drum Rack in Live')
			},

			{
				at: '19.1',
				chapter: 'Record a loop',
				box: T.gridSlot(0, 0, 'cell'),
				boxLabel: 'Clip slot',
				tap: T.gridSlot(0, 0, 'body'),
				caption: "Tap an empty slot to select its track.",
				note: 'Vamp arms the selected track for you, so it is ready to record.',
				live: LIVE.track(0, 'Armed'),
				until: armed(0)
			},
			{
				at: '20.3',
				box: T.gridSlot(0, 0, 'action'),
				boxLabel: 'Record',
				tap: T.gridSlot(0, 0, 'action'),
				caption: 'Tap the dot to record.',
				note: "Recording waits for the next bar: Live's launch quantization.",
				live: LIVE.clip(0, 0, 'Recording')
			},
			{ at: '21.1', play: DRUMS, until: recording(0, 0) },
			{ at: '21.3', caption: 'Play.', note: 'From any MIDI keyboard or controller: the armed track takes what you play.' },
			{
				at: '22.3',
				box: T.gridSlot(0, 0, 'action'),
				boxLabel: 'Close the loop',
				tap: T.gridSlot(0, 0, 'action'),
				caption: 'Tap again to close the take.',
				note: 'It loops at exactly the length you played: two bars.'
			},
			{ at: '23.1', until: looping(0, 0) },
			{ at: '23.3', box: T.gridSlot(0, 0, 'cell'), boxLabel: 'Looping', caption: 'Recorded, and looping.', live: LIVE.clip(0, 0, 'The clip') },

			{
				at: '24.2',
				chapter: 'Shape the sound',
				box: T.strip(0, 'device'),
				boxLabel: 'Instrument band',
				tap: T.strip(0, 'device'),
				caption: "A strip's middle band opens its instrument's view.",
				live: null
			},
			{
				at: '25.2',
				box: T.xy('Filter'),
				boxLabel: 'Kit filter',
				caption: 'Drag an XY pad: filter across, resonance up.',
				note: 'Every drum in the kit follows the one gesture.',
				live: LIVE.devices('The kit in Live'),
				drag: { target: T.xy('Filter'), path: [[0.55, 0.5], [0.12, 0.62], [0.12, 0.62], [0.6, 0.45]], beats: 6 }
			},

			{
				at: '28.1',
				chapter: 'Groove',
				box: T.gridSlot(0, 0, 'cell'),
				boxLabel: 'Hold to focus',
				tap: T.hold(T.gridSlot(0, 0, 'body')),
				caption: 'Hold a clip to focus it.',
				note: "The central view shows that clip's tools.",
				live: null
			},
			{
				at: '29.3',
				box: T.area('.quantize-container'),
				boxLabel: 'Q',
				caption: 'Touch Q: it sets Quantize and opens the groove view.',
				note: "Quantize pulls the notes toward the groove's grid.",
				drag: { target: T.area('.quantize-container'), path: [[0.5, 0.9], [0.5, 0.6]], beats: 2 }
			},
			{
				at: '31.1',
				box: T.area('[data-debug="groove-tiles"]'),
				boxLabel: 'Grooves',
				caption: "Each tile is one of Live's grooves, drawn as its timing.",
				note: 'Choose which ones appear in Settings → Grooves.'
			},
			{
				at: '32.2',
				box: T.groove('Swing 16ths 73'),
				boxLabel: 'Swing 16ths 73',
				tap: T.groove('Swing 16ths 73'),
				caption: 'Swing 16ths 73: every other sixteenth lands late.',
				note: 'Listen to the hi-hats.',
				until: grooveIs(0, 0, 'Swing 16ths 73')
			},
			{
				at: '33.3',
				box: T.slider('Amount'),
				boxLabel: 'Amount',
				caption: 'Amount runs from straight to the full swing.',
				note: "The tile's picture follows it.",
				drag: { target: T.slider('Amount'), path: [[0.5, 0.2], [0.5, 0.95], [0.5, 0.95], [0.5, 0.25]], beats: 7 }
			},
			{
				at: '35.4',
				box: T.groove('Hip Hop Late 8ths'),
				boxLabel: 'Hip Hop Late 8ths',
				tap: T.groove('Hip Hop Late 8ths'),
				caption: 'Or another feel: Hip Hop Late 8ths.',
				note: 'The clip keeps its Quantize and Amount when it changes groove.',
				until: grooveIs(0, 0, 'Hip Hop Late 8ths')
			},
			{
				at: '37.2',
				box: T.slider('Velocity'),
				boxLabel: 'Velocity',
				caption: 'Velocity lets the groove shape the accents too.',
				drag: { target: T.slider('Velocity'), path: [[0.5, 0.85], [0.5, 0.4]], beats: 3 }
			},

			{ at: '39.1', chapter: 'Add a bass', box: T.rail('Bass'), tap: T.rail('Bass'), caption: 'Now a bass: Bass, Drift, Deep Bass.', note: 'The same three taps, and it lands on a track of its own.' },
			{ at: '39.3', box: T.folder('Drift'), tap: T.folder('Drift') },
			{ at: '40.2', box: T.preset('Deep Bass'), tap: T.preset('Deep Bass'), until: hasDevice(1, 'Drift') },
			{
				at: '41.3',
				box: T.area('[data-debug="middle-panel"]'),
				boxLabel: 'Drift view',
				caption: "Drift's view: oscillators, envelope time, filter, and wheels.",
				note: 'Each of Live’s instruments gets a view laid out for it.',
				live: LIVE.devices('Drift in Live')
			},
			{ at: '43.2', box: T.gridSlot(1, 0, 'cell'), boxLabel: 'Clip slot', tap: T.gridSlot(1, 0, 'body'), caption: 'Select the bass’s first slot…', live: LIVE.track(1, 'Armed'), until: armed(1) },
			{ at: '44.3', box: T.gridSlot(1, 0, 'action'), boxLabel: 'Record', tap: T.gridSlot(1, 0, 'action'), caption: '…and record over the drums.' },
			{ at: '45.1', play: BASS, until: recording(1, 0) },
			{ at: '45.3', caption: 'Play.' },
			{ at: '46.3', box: T.gridSlot(1, 0, 'action'), boxLabel: 'Close the loop', tap: T.gridSlot(1, 0, 'action'), caption: 'Close the loop.' },
			{ at: '47.1', until: looping(1, 0) },
			{
				at: '47.3',
				box: T.xy('Filter'),
				boxLabel: 'Filter',
				caption: 'Open up the bass’s filter.',
				live: LIVE.devices('Drift in Live'),
				drag: { target: T.xy('Filter'), path: [[0.35, 0.55], [0.7, 0.4]], beats: 4 }
			},

			{
				at: '50.1',
				chapter: 'Key Follow',
				box: T.area('.key-band'),
				boxLabel: 'Key',
				caption: (v) => `Vamp heard the loops and set Live's key: ${v.key}.`,
				note: 'Key Follow re-reads what is playing after every take.',
				live: LIVE.key("Live's key"),
				do: readKey
			},

			{ at: '52.2', chapter: 'Add keys', box: T.rail('Key'), tap: T.rail('Key'), caption: 'Keys next: Key, Electric, an electric piano.', live: null },
			{ at: '52.4', box: T.folder('Electric'), tap: T.folder('Electric') },
			{ at: '53.3', box: T.preset('E-Piano MKI Mellow'), tap: T.preset('E-Piano MKI Mellow'), until: hasDevice(2, 'LoungeLizard') },
			{
				at: '54.3',
				box: [T.xy('Hammer'), T.xy('Fork')],
				boxLabel: "Electric's controls",
				caption: 'Hammer and fork shape the tone.',
				note: 'Two XY pads: stiffness and noise, tine colour and decay.',
				live: LIVE.devices('Electric in Live')
			},
			{ at: '56.2', box: T.gridSlot(2, 0, 'cell'), boxLabel: 'Clip slot', tap: T.gridSlot(2, 0, 'body'), caption: 'Select, record…', live: null, until: armed(2) },
			{ at: '56.4', box: T.gridSlot(2, 0, 'action'), boxLabel: 'Record', tap: T.gridSlot(2, 0, 'action') },
			{ at: '57.1', play: KEYS, caption: '…play the chords…', until: recording(2, 0) },
			{ at: '58.3', box: T.gridSlot(2, 0, 'action'), boxLabel: 'Close the loop', tap: T.gridSlot(2, 0, 'action'), caption: '…and close the loop.' },
			{ at: '59.1', until: looping(2, 0) },
			{
				at: '59.3',
				box: T.wheel('Pitch'),
				boxLabel: 'Pitch wheel',
				caption: 'Bend the chords with the pitch wheel.',
				note: 'It springs back when you let go.',
				drag: { target: T.wheel('Pitch'), path: [[0.5, 0.5], [0.5, 0.82], [0.5, 0.5]], beats: 4 }
			},

			{
				at: '62.1',
				chapter: 'Transpose',
				box: T.gridSlot(2, 0, 'cell'),
				boxLabel: 'Hold to focus',
				tap: T.hold(T.gridSlot(2, 0, 'body')),
				caption: 'Focus the keys clip…'
			},
			{ at: '63.3', box: T.button('+12'), boxLabel: '+12', tap: T.button('+12'), caption: '…and +12 moves it up an octave.', note: 'The notes themselves move; the loop plays on.' },
			{ at: '65.3', box: T.button('−12'), boxLabel: '−12', tap: T.button('−12'), caption: '−12 brings it back down.' },

			{
				at: '67.1',
				chapter: 'Effects by touch',
				box: T.tile('fx12'),
				boxLabel: 'Reverb',
				caption: 'Drag a tile: Live inserts the effect, and your finger sets it.',
				note: 'Reverb: across is decay, up is how much.',
				live: LIVE.devices('Reverb, inserted in Live'),
				drag: { target: T.tile('fx12'), path: [[0.5, 0.6], [0.62, 0.22]], beats: 4 }
			},
			{
				at: '68.3',
				box: T.tile('fx11'),
				boxLabel: 'Echo',
				caption: 'Echo on the keys.',
				note: 'Across is the delay time, up is feedback.',
				drag: { target: T.tile('fx11'), path: [[0.4, 0.6], [0.52, 0.34]], beats: 3 }
			},
			{ at: '70.2', box: T.strip(1, 'device'), boxLabel: 'Bass', tap: T.strip(1, 'device'), caption: 'Select the bass…', note: "The middle band of a strip opens its instrument's view.", live: null },
			{
				at: '71.2',
				box: T.tile('fx5'),
				boxLabel: 'Pedal',
				caption: '…and drive it through Pedal.',
				live: LIVE.devices('Pedal, inserted in Live'),
				drag: { target: T.tile('fx5'), path: [[0.5, 0.65], [0.56, 0.3]], beats: 3 }
			},

			{
				at: '73.2',
				chapter: 'Permute',
				box: T.strip(1, 'permute'),
				boxLabel: 'Permute band',
				tap: T.strip(1, 'permute'),
				caption: "A strip's third band opens Permute, a step sequencer.",
				note: "It runs on every track, transposing and muting what's playing.",
				live: null
			},
			{ at: '74.3', box: T.area('.grid-pitch-steps'), boxLabel: 'Pitch steps', taps: [T.step('pitch', 3), T.step('pitch', 7)], caption: 'Pitch steps jump the bass an octave.' },
			{ at: '76.3', box: T.strip(2, 'permute'), boxLabel: 'Permute band', tap: T.strip(2, 'permute'), caption: 'On the keys…' },
			{ at: '77.2', box: T.area('.grid-mute-steps'), boxLabel: 'Mute steps', taps: [T.step('mute', 1), T.step('mute', 3), T.step('mute', 6)], caption: '…mute steps chop the chords.' },

			// The bass, not the drums: selecting a clip gives Live the clip's
			// own scale, and the drums were recorded while the set was still
			// C major, so selecting them would undo Key Follow (and switch it
			// off, as a key set by hand).
			{
				at: '80.1',
				chapter: 'Launch and stop',
				box: T.gridSlot(1, 0, 'action'),
				boxLabel: 'Stop',
				tap: T.gridSlot(1, 0, 'action'),
				caption: 'Tap a playing clip to stop it at the next bar.',
				until: stopped(1, 0)
			},
			{
				at: '82.1',
				box: T.gridSlot(1, 0, 'action'),
				boxLabel: 'Launch',
				tap: T.gridSlot(1, 0, 'action'),
				caption: 'Tap again to bring it back in.',
				until: looping(1, 0)
			},

			{
				at: '84.1',
				chapter: 'Mix',
				box: T.area('.track-col[data-track-index="2"]'),
				boxLabel: 'Keys strip',
				caption: 'Drag a strip to set its volume…',
				drag: { target: T.strip(2, 'device'), path: [[0.5, 0.3], [0.5, 0.75]], beats: 3 }
			},
			{ at: '85.3', caption: '…and back up.', drag: { target: T.strip(2, 'device'), path: [[0.5, 0.6], [0.5, 0.15]], beats: 3 } },
			{ at: '87.2', box: T.name(1), boxLabel: 'Name: mute', tap: T.name(1), caption: 'Tap a name to mute the track…', until: muted(1, true) },
			{ at: '89.1', box: T.name(1), boxLabel: 'Name: mute', tap: T.name(1), caption: '…and again to bring it back.', until: muted(1, false) },
			{ at: '90.3', box: null, caption: 'Everything you saw was played on the iPad.' }
		],
		end: '93.1',
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
