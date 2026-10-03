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
 *            of the target's box, over `beats`; with `px: true` the path
 *            is CSS pixels from the box's centre, starting at [0, 0]
 *   play     [[beat, lengthBeats, notes, velocity], …]: the performer's
 *            phrase, into the recorder's Vamp Demo MIDI port
 *   do       async (live, vars) => …: a direct LOM action or read
 *   until    a condition on Live (below)
 *
 * A scenario's `setup` steps run first, the same way, off camera: the
 * clip starts at its first `steps` entry.
 *
 * The interface is driven only by touch; `do` is for the runner's own
 * bookkeeping (reading the key for a caption, tidying the set).
 */

import { BASS, DRUMS, KEYS, KEYS_UP, LEAD } from './phrases.mjs';

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
	/** The main track's strip: its meter, and its fader. */
	master: { css: '[data-debug="master-card"]', label: 'main track' },
	/** A switch in the main track's view, by its name: 'Click', 'Follow Key', 'Header', 'FX', 'Clips'. */
	sysSwitch: (name) => ({ css: '[data-debug="middle-panel"] button.sys-switch', text: name, textCss: '.sys-switch-label', label: `switch ${name}` }),
	/** The main track's tempo digits. */
	tempo: { css: '[data-debug="middle-panel"] .sys-drag-digit', label: 'tempo' },
	/** The main track's Launch Q value, and a choice in its picker. */
	launchQ: { css: '[data-debug="middle-panel"] .sys-value-digit', label: 'Launch Q' },
	quantChip: (text) => ({ css: '.quant-chip', text, label: `Launch Q ${text}` }),
	/** The browser's mode switch: 'Instrument' | 'Simpler' | 'Clip'. */
	seg: (name) => ({ css: '.seg-switch[aria-label="Browse mode"] button.seg', text: name, label: `mode ${name}` }),
	/** The same target held for `ms` instead of tapped. */
	hold: (target, ms = 700) => ({ ...target, hold: ms, label: `hold ${target.label}` })
};

/**
 * Regions of Live's window, in its points, for boxes on Live's pane
 * (measured on Live 12.4 at 1090 x 856, its browser hidden and the clip view
 * stacked over the device chain: track columns 95 pt apart from x 8, clip
 * rows 18 pt from y 78, the clip view from y 345, the devices from y 628).
 */
export const LIVE = {
	track: (i, label) => ({ x: 8 + 95 * i, y: 60, w: 94, h: 280, label }),
	clip: (i, slot, label) => ({ x: 8 + 95 * i, y: 78 + 18 * slot, w: 94, h: 20, label }),
	devices: (label) => ({ x: 8, y: 628, w: 1072, h: 194, label }),
	/** Live's clip view: the clip's properties and its notes. */
	detail: (label) => ({ x: 8, y: 345, w: 1072, h: 280, label }),
	key: (label) => ({ x: 392, y: 26, w: 144, h: 24, label }),
	/** Several tracks' columns at once. */
	tracks: (n, label) => ({ x: 8, y: 60, w: 95 * n - 1, h: 280, label }),
	/** The control bar: tempo, metronome, launch quantization. */
	tempo: (label) => ({ x: 136, y: 27, w: 48, h: 20, label }),
	metronome: (label) => ({ x: 300, y: 27, w: 38, h: 20, label }),
	quant: (label) => ({ x: 339, y: 27, w: 52, h: 20, label }),
	/** The Main track, at the right of the session. */
	main: (label) => ({ x: 976, y: 60, w: 104, h: 280, label })
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

export const slotHasClip = (t, s) => ({
	what: `track ${t} slot ${s} has a clip`,
	read: (live) => slotRead(live, t, s, ['has_clip']),
	test: (r) => r.has_clip === true
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

/** The clip's groove Amount (timing_amount, 0..100) is at least `min`. */
export const grooveAmountAtLeast = (t, s, min) => ({
	what: `track ${t} slot ${s} groove Amount >= ${min}`,
	read: (live) => slotRead(live, t, s, ['clip.groove.timing_amount']),
	test: (r) => r['clip.groove.timing_amount'] >= min
});

export const hasDevice = (t, className) => ({
	what: `track ${t} has ${className}`,
	read: (live) => live.read('song', ['tracks.*name']).then(async (s) =>
		s['tracks.*name'].length > t ? live.read(`tracks/${t}`, ['devices.*class_name']) : { 'devices.*class_name': [] }
	),
	test: (r) => r['devices.*class_name'].includes(className)
});

export const keyIs = (root, scale) => ({
	what: `Live's key is ${root}/${scale}`,
	read: (live) => live.read('song', ['root_note', 'scale_name']),
	test: (r) => r.root_note === root && r.scale_name === scale
});

/** A song attribute (`tempo`, `metronome`, `clip_trigger_quantization`) passes `test`. */
export const song = (attr, test, what) => ({
	what: `song ${attr} ${what}`,
	read: (live) => live.read('song', [attr]),
	test: (r) => test(r[attr])
});

/** Live's launch quantization: its enum's index, or its name as the probe prints it (`Song.Quantization.q_bar`). */
export const launchQIs = (index, name) =>
	song('clip_trigger_quantization', (v) => v === index || String(v).endsWith(`.${name}`), `= ${name}`);

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
	fx: 'uiPrefsStore.showFxGrid',
	header: 'uiPrefsStore.showTransportHeader'
};

/**
 * Off camera: an empty set built into three loops (a 909 kit, a Drift bass,
 * an electric piano) the way the walkthrough builds it, so a site clip
 * opens on a band already playing. Ends looping at 17.1.
 */
const BAND = [
	{ at: '1.2', tap: T.rail('Drum') },
	{ at: '1.4', tap: T.folder('Drum Machines') },
	{ at: '2.2', tap: T.preset('909 Core Kit'), until: hasDevice(1, 'DrumGroupDevice') },
	{ at: '3.3', do: (live) => live.invoke('song', 'delete_track', [0]) },
	{ at: '4.1', tap: T.gridSlot(0, 0, 'body'), until: armed(0) },
	{ at: '4.3', tap: T.gridSlot(0, 0, 'action') },
	{ at: '5.1', play: DRUMS, until: recording(0, 0) },
	{ at: '6.3', tap: T.gridSlot(0, 0, 'action') },
	{ at: '7.1', until: looping(0, 0) },
	{ at: '7.2', tap: T.rail('Bass') },
	{ at: '7.4', tap: T.folder('Drift') },
	{ at: '8.2', tap: T.preset('Deep Bass'), until: hasDevice(1, 'Drift') },
	{ at: '9.2', tap: T.gridSlot(1, 0, 'body'), until: armed(1) },
	{ at: '9.4', tap: T.gridSlot(1, 0, 'action') },
	{ at: '10.1', play: BASS, until: recording(1, 0) },
	{ at: '11.3', tap: T.gridSlot(1, 0, 'action') },
	{ at: '12.1', until: looping(1, 0) },
	{ at: '12.2', tap: T.rail('Key') },
	{ at: '12.4', tap: T.folder('Electric') },
	{ at: '13.2', tap: T.preset('E-Piano MKI Mellow'), until: hasDevice(2, 'LoungeLizard') },
	{ at: '14.2', tap: T.gridSlot(2, 0, 'body'), until: armed(2) },
	{ at: '14.4', tap: T.gridSlot(2, 0, 'action') },
	{ at: '15.1', play: KEYS, until: recording(2, 0) },
	{ at: '16.3', tap: T.gridSlot(2, 0, 'action') },
	{ at: '17.1', until: looping(2, 0) }
];

/**
 * One piece of a cut-up take (a gallery clip): off camera, `open` shows
 * what the piece is about; the piece starts two beats later and runs a
 * bar per move and one more, the phrase playing through it while `moves`
 * (drags or taps, one a bar) work the view. `bar` is where it starts;
 * the next piece starts at `bar + moves.length + 1`.
 */
const piece = (bar, name, { open, phrase, moves }) => {
	const at = (b, beat) => `${bar + b}.${beat}`;
	const steps = [{ at: at(0, 1), cut: true, box: null, ...open }, { at: at(0, 3), chapter: name }];
	moves.forEach((m, k) => steps.push({ at: at(k + 1, 1), ...(k % 2 === 0 && phrase ? { play: phrase } : {}), ...m }));
	return steps;
};
const up = (target, beats = 3) => ({ drag: { target, path: [[0.5, 0.75], [0.5, 0.25]], beats } });
const down = (target, beats = 3) => ({ drag: { target, path: [[0.5, 0.3], [0.5, 0.8]], beats } });
const sweep = (target, from, to, beats = 3) => ({ drag: { target, path: [from, to], beats } });
const tapOn = (target) => ({ tap: target });
/** A control in the central view by position, for views whose labels depend on what is loaded. */
const nthIn = (css, nth) => ({ css: `[data-debug="middle-panel"] ${css}`, nth, label: `${css} #${nth}` });

/** A button in the note editor's toolbar, by its text. */
const EDITCHIP = (text) => ({ css: '.edit-toolbar button.edit-chip', text, label: `editor ${text}` });
/** The nth note drawn in the note editor. */
const NOTEAT = (nth) => ({ css: '[aria-label="MIDI note"]', nth, label: `note #${nth}` });

/** Give a track an empty clip, so Vamp's next load goes to a new track instead of replacing this one's instrument. */
const usedTrack = (t) => (live) => live.invoke(`tracks/${t}`, 'clip_slots[0].create_clip', [4]);

/** Drop every device on a track after its first (the effects a gallery piece added). */
const clearEffects = (t) => async (live) => {
	const d = (await live.read(`tracks/${t}`, ['devices.*class_name']))['devices.*class_name'];
	for (let k = d.length - 1; k >= 1; k--) await live.invoke(`tracks/${t}`, 'delete_device', [k]);
};

/** What every site clip shares: the full layout, a band set up off camera, no title cards. */
const SITE = {
	tempo: 96,
	prefs: { [PREFS.session]: '1', [PREFS.fx]: '1', [PREFS.header]: '0' },
	liveWindow: { w: 1090, h: 856 },
	set: { empty: true, key: { root: 0, scale: 'Major' } },
	setup: BAND
};

export const SCENARIOS = {
	tour: {
		title: 'Vamp: a tour',
		blurb: 'From an empty Live set to a three-part groove, every step played on the iPad.',
		tempo: 96,
		// Clip grid hidden, FX grid shown: the layout the iPad ships with.
		prefs: { [PREFS.session]: '0', [PREFS.fx]: '1' },
		// Live's window sized to the frame's pane (about 1.3 : 1 without its
		// status bar), so all of it shows: no crop but the status bar.
		liveWindow: { w: 1090, h: 856 },
		// Live's one bare MIDI track, the way a new set opens.
		set: { empty: true, key: { root: 0, scale: 'Major' } },
		intro: { title: 'Vamp', subtitle: 'An iPad controller for Ableton Live.' },
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
				caption: 'Drive the whole kit with one of its macros.',
				drag: { target: T.slider('Drive Amount'), path: [[0.5, 0.85], [0.5, 0.2], [0.5, 0.2], [0.5, 0.8]], beats: 6 }
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
		liveWindow: { w: 1090, h: 856 },
		// Live 12 auto-loads the set's groove ("Swing 16ths 66") onto every
		// new MIDI clip (the Groove Pool's Auto Load Groove), and this set's
		// Global Groove Amount is 100 %, so at Live's Timing of 100 every loop
		// would swing fully the moment it is recorded. Each run starts that
		// groove straight (Timing 0); the Groove chapter adds the swing.
		set: {
			empty: true,
			key: { root: 0, scale: 'Major' },
			groove: { name: 'Swing 16ths 66', base: 3, timing: 0, quantization: 0 }
		},
		intro: { title: 'Vamp', subtitle: 'An iPad controller for Ableton Live.' },
		outro: {
			title: 'Vamp',
			subtitle: 'Built by a dance accompanist for playing ballet class.',
			foot: 'github.com/ben-juodvalkis/vamp'
		},
		steps: [
			{
				at: '1.3',
				chapter: 'The layout',
				caption: "Vamp on an iPad, and Ableton Live.",
				note: "An empty Live set. Every change is made on the iPad."
			},
			{
				at: '3.1',
				box: T.area('.vendor-buttons.places-rail'),
				boxLabel: "Browser",
				caption: "Left: the browser.",
				note: "One button for each Place in Live's browser sidebar."
			},
			{
				at: '4.3',
				box: T.area('[data-debug="devices-panel"]'),
				boxLabel: "Effects",
				caption: "Top: effects.",
				note: "One tile per effect. Drag a tile to add the effect and set it."
			},
			{
				at: '6.1',
				box: T.area('[data-debug="middle-panel"]'),
				boxLabel: "Central view",
				caption: "Middle: the central view.",
				note: "Controls for the selected instrument, clip or effect."
			},
			{
				at: '7.3',
				box: T.area('[data-debug="slots-section"]'),
				boxLabel: "Clip slots",
				caption: "Below it: clip slots.",
				note: "One column per track. Record, launch and stop clips here."
			},
			{
				at: '9.1',
				box: T.area('.track-col', true),
				boxLabel: "Tracks",
				caption: "Bottom: tracks.",
				note: "Open a track's clip, instrument or Permute, set its volume, and mute it."
			},
			{
				at: '10.3',
				box: T.area('[data-debug="right-sidebar"]'),
				boxLabel: "Loop, groove, scenes, key",
				caption: "Right: loop, groove quantize, scenes and key.",
				note: "A scene launches a row of clips."
			},

			{
				at: '12.2',
				chapter: 'Load a kit',
				box: T.rail('Drum'),
				tap: T.rail('Drum'),
				caption: "Tap Drum to browse drum kits.",
				note: "The browser covers the screen until you pick something."
			},
			{ at: '13.3', box: T.folder('Drum Machines'), tap: T.folder('Drum Machines'), caption: "Tap a folder." },
			{
				at: '15.1',
				box: T.preset('909 Core Kit'),
				tap: T.preset('909 Core Kit'),
				caption: "Tap a kit. It loads on a new track.",
				note: null,
				until: hasDevice(1, 'DrumGroupDevice')
			},
			// The kit took a new track; Live's empty first track goes, so the
			// kit sits first, as it would have on a set with no tracks.
			{ at: '16.3', box: null, do: (live) => live.invoke('song', 'delete_track', [0]) },
			{
				at: '17.1',
				box: T.strip(0, 'device'),
				boxLabel: "Instrument",
				tap: T.strip(0, 'device'),
				caption: "Tap the drum icon on the track.",
				note: "This opens the instrument's controls.",
				liveView: 'devices',
				live: LIVE.devices('The Drum Rack in Live')
			},
			{
				at: '18.1',
				box: T.area('[data-debug="middle-panel"]'),
				boxLabel: "Drum Rack",
				caption: "The kit's controls are in the central view."
			},

			{
				at: '19.1',
				chapter: 'Record a loop',
				box: T.gridSlot(0, 0, 'cell'),
				boxLabel: "Clip slot",
				tap: T.gridSlot(0, 0, 'body'),
				caption: "Tap an empty slot to select its track.",
				note: "Selecting a track arms it for recording.",
				live: LIVE.track(0, 'Armed'),
				until: armed(0)
			},
			{
				at: '20.3',
				box: T.gridSlot(0, 0, 'action'),
				boxLabel: "Record",
				tap: T.gridSlot(0, 0, 'action'),
				caption: "Tap the dot to record.",
				note: "Recording starts at the next bar.",
				liveView: 'clip',
				live: LIVE.detail('The notes, as Live records them')
			},
			{ at: '21.1', play: DRUMS, until: recording(0, 0) },
			{ at: '21.3', caption: "Play.", note: "Play any MIDI keyboard or controller." },
			{
				at: '22.3',
				box: T.gridSlot(0, 0, 'action'),
				boxLabel: "Stop recording",
				tap: T.gridSlot(0, 0, 'action'),
				caption: "Tap again to stop recording.",
				note: "The clip loops at the length you played: two bars."
			},
			{ at: '23.1', until: looping(0, 0) },
			{ at: '23.3', box: T.gridSlot(0, 0, 'cell'), boxLabel: "Looping", caption: "The clip is looping.", live: LIVE.detail("The loop, in Live's clip view") },

			{
				at: '24.2',
				chapter: 'Shape the sound',
				box: T.strip(0, 'device'),
				boxLabel: "Instrument",
				tap: T.strip(0, 'device'),
				caption: "Tap the drum icon to show the kit's controls again.",
				liveView: 'devices',
				live: null
			},
			// Live's Core kits map eight rack macros, and a kit with mapped macros
			// shows one slider per macro (ADR-454).
			{
				at: '25.2',
				box: T.slider('Drive Amount'),
				boxLabel: "Drive Amount",
				caption: "This kit has macros, so Vamp shows a slider for each.",
				note: "Drive Amount adds distortion to the whole kit.",
				live: LIVE.devices("The kit's macros in Live"),
				drag: { target: T.slider('Drive Amount'), path: [[0.5, 0.85], [0.5, 0.2], [0.5, 0.2], [0.5, 0.8]], beats: 6 }
			},

			{
				at: '28.1',
				chapter: 'Groove',
				box: T.gridSlot(0, 0, 'cell'),
				boxLabel: "Hold",
				tap: T.hold(T.gridSlot(0, 0, 'body')),
				caption: "Hold a clip to show its tools.",
				note: null,
				liveView: 'clip',
				live: LIVE.detail('The clip in Live, groove and all')
			},
			{
				at: '29.3',
				box: T.area('.quantize-container'),
				boxLabel: "Q",
				caption: "Touch Q to set Quantize and open the groove view.",
				note: "Quantize moves notes toward the groove's timing.",
				drag: { target: T.area('.quantize-container'), path: [[0.5, 0.9], [0.5, 0.6]], beats: 2 }
			},
			{
				at: '31.1',
				box: T.area('[data-debug="groove-tiles"]'),
				boxLabel: "Grooves",
				caption: "Each tile shows a groove's timing.",
				note: "Choose which grooves appear in Settings → Grooves."
			},
			{
				at: '32.2',
				box: T.groove('User: Swing 16ths'),
				boxLabel: "Swing 16ths",
				tap: T.groove('User: Swing 16ths'),
				caption: "Tap Swing 16ths.",
				note: "Amount sets how much of the groove is applied.",
				until: grooveIs(0, 0, 'User: Swing 16ths')
			},
			// Two drags: the slider moves by the whole gesture from its start,
			// so one drag down-then-up nets out; two land the same way whatever
			// Amount the groove started at.
			{
				at: '33.2',
				box: T.slider('Amount'),
				boxLabel: "Amount",
				caption: "Amount at 0: no swing.",
				drag: { target: T.slider('Amount'), path: [[0.5, 0.1], [0.5, 1.0]], beats: 2 }
			},
			{
				at: '34.2',
				box: T.slider('Amount'),
				boxLabel: "Amount",
				caption: "Raise Amount to add swing.",
				note: "The tile shows the result.",
				drag: { target: T.slider('Amount'), path: [[0.5, 0.9], [0.5, 0.2]], beats: 3 },
				until: grooveAmountAtLeast(0, 0, 50)
			},
			{
				at: '35.4',
				box: T.groove('User: Swing 8ths'),
				boxLabel: "Swing 8ths",
				tap: T.groove('User: Swing 8ths'),
				caption: "Tap Swing 8ths to change the groove.",
				note: "The clip keeps its Quantize and Amount.",
				until: grooveIs(0, 0, 'User: Swing 8ths')
			},
			{
				at: '37.2',
				box: T.groove('User: Swing 16ths'),
				boxLabel: "Swing 16ths",
				tap: T.groove('User: Swing 16ths'),
				caption: "Tap Swing 16ths again.",
				until: grooveIs(0, 0, 'User: Swing 16ths')
			},
			// Choosing a groove file loads it through Live's browser, which Live
			// then shows; put Live's window back to tracks and devices.
			{ at: '38.3', do: (live) => live.invoke('app', 'view.hide_view', ['Browser']) },

			{ at: '39.1', chapter: 'Add a bass', box: T.rail('Bass'), tap: T.rail('Bass'), caption: "Load a bass: Bass, Drift, Deep Bass.", note: "It loads on a new track." },
			{ at: '39.3', box: T.folder('Drift'), tap: T.folder('Drift') },
			{ at: '40.2', box: T.preset('Deep Bass'), tap: T.preset('Deep Bass'), until: hasDevice(1, 'Drift') },
			{
				at: '41.3',
				box: T.area('[data-debug="middle-panel"]'),
				boxLabel: "Drift",
				caption: "Drift's controls: oscillators, envelope, filter and wheels.",
				note: "Each Live instrument has its own view.",
				liveView: 'devices',
				live: LIVE.devices('Drift in Live')
			},
			{ at: '43.2', box: T.gridSlot(1, 0, 'cell'), boxLabel: "Clip slot", tap: T.gridSlot(1, 0, 'body'), caption: "Tap the bass track's first slot.", live: LIVE.track(1, 'Armed'), until: armed(1) },
			{ at: '44.3', box: T.gridSlot(1, 0, 'action'), boxLabel: "Record", tap: T.gridSlot(1, 0, 'action'), caption: "Tap the dot to record.", liveView: 'clip', live: LIVE.detail('The bass notes, as Live records them') },
			{ at: '45.1', play: BASS, until: recording(1, 0) },
			{ at: '45.3', caption: "Play." },
			{ at: '46.3', box: T.gridSlot(1, 0, 'action'), boxLabel: "Stop recording", tap: T.gridSlot(1, 0, 'action'), caption: "Tap again to stop recording." },
			{ at: '47.1', until: looping(1, 0) },
			{
				at: '47.3',
				box: T.xy('Filter'),
				boxLabel: "Filter",
				caption: "Drag the filter pad to open the filter.",
				liveView: 'devices',
				live: LIVE.devices('Drift in Live'),
				drag: { target: T.xy('Filter'), path: [[0.35, 0.55], [0.7, 0.4]], beats: 4 }
			},

			{
				at: '50.1',
				chapter: 'Key Follow',
				box: T.area('.key-band'),
				boxLabel: 'Key',
				caption: (v) => `Vamp heard the loops and set Live's key: ${v.key}.`,
				note: "It detects the key after each recording.",
				live: LIVE.key("Live's key"),
				do: readKey
			},

			{ at: '52.2', chapter: 'Add keys', box: T.rail('Key'), tap: T.rail('Key'), caption: "Load keys: Key, Electric, E-Piano MKI Mellow.", live: null },
			{ at: '52.4', box: T.folder('Electric'), tap: T.folder('Electric') },
			{ at: '53.3', box: T.preset('E-Piano MKI Mellow'), tap: T.preset('E-Piano MKI Mellow'), until: hasDevice(2, 'LoungeLizard') },
			{
				at: '54.3',
				box: [T.xy('Hammer'), T.xy('Fork')],
				boxLabel: "Electric",
				caption: "Electric's controls: two XY pads, Hammer and Fork.",
				note: "Hammer: stiffness and noise. Fork: tine tone and decay.",
				liveView: 'devices',
				live: LIVE.devices('Electric in Live')
			},
			{ at: '56.2', box: T.gridSlot(2, 0, 'cell'), boxLabel: "Clip slot", tap: T.gridSlot(2, 0, 'body'), caption: "Select a slot and record.", live: null, until: armed(2) },
			{ at: '56.4', box: T.gridSlot(2, 0, 'action'), boxLabel: 'Record', tap: T.gridSlot(2, 0, 'action'), liveView: 'clip', live: LIVE.detail('The chords, as Live records them') },
			{ at: '57.1', play: KEYS, caption: "Play.", until: recording(2, 0) },
			{ at: '58.3', box: T.gridSlot(2, 0, 'action'), boxLabel: "Stop recording", tap: T.gridSlot(2, 0, 'action'), caption: "Tap again to stop recording." },
			{ at: '59.1', until: looping(2, 0) },
			{
				at: '59.3',
				box: T.wheel('Pitch'),
				boxLabel: "Pitch wheel",
				caption: "Drag the pitch wheel to bend the notes.",
				note: "It returns to the centre when released.",
				liveView: 'devices',
				live: LIVE.devices('The wheels device, added on first touch'),
				drag: { target: T.wheel('Pitch'), path: [[0.5, 0.5], [0.5, 0.82], [0.5, 0.5]], beats: 4 }
			},

			{
				at: '62.1',
				chapter: 'Clip tools',
				box: T.gridSlot(2, 0, 'cell'),
				boxLabel: "Hold",
				tap: T.hold(T.gridSlot(2, 0, 'body')),
				caption: "Hold the keys clip to show its tools.",
				liveView: 'clip',
				live: LIVE.detail('The keys clip in Live')
			},
			{
				at: '63.3',
				box: T.area('[data-debug="middle-panel"] button[aria-label="Duplicate clip to the next slot"]'),
				boxLabel: 'Dup Clip',
				tap: T.area('[data-debug="middle-panel"] button[aria-label="Duplicate clip to the next slot"]'),
				caption: "Dup Clip copies the clip into the next slot.", note: "The copy is selected.",
				live: LIVE.clip(2, 1, 'The copy'),
				until: slotHasClip(2, 1)
			},
			{
				at: '65.1',
				box: T.button('+12'),
				boxLabel: '+12',
				tap: T.button('+12'),
				caption: "+12 transposes the copy up an octave.",
				note: "Live's clip view shows the notes move.",
				live: LIVE.detail("The copy's notes, an octave up")
			},
			{
				at: '66.3',
				box: T.gridSlot(2, 1, 'action'),
				boxLabel: 'Launch',
				tap: T.gridSlot(2, 1, 'action'),
				caption: "Launch the copy. It starts at the next bar.",
				live: null,
				until: looping(2, 1)
			},
			{
				at: '68.1',
				box: T.area('.editor-toggle'),
				boxLabel: 'Notes',
				tap: T.area('.editor-toggle'),
				caption: "The pencil opens the note editor.",
				note: "Tap to add a note. Tap a note to delete it.",
				live: LIVE.detail('The same clip, in Live')
			},
			{
				at: '69.2',
				box: T.area('[aria-label="Clip editor"]'),
				boxLabel: 'Note editor',
				tap: { ...T.area('[aria-label="Draw note"]'), at: [0.86, 0.35] },
				caption: "Add a note."
			},
			{
				at: '70.2',
				tap: T.area('[aria-label="MIDI note"]'),
				caption: "Delete a note."
			},
			{ at: '71.1', box: T.area('.editor-toggle'), boxLabel: 'Notes', tap: T.area('.editor-toggle'), caption: 'Tap the pencil again to close the editor.', note: null },
			{
				at: '72.1',
				box: T.gridSlot(2, 0, 'action'),
				boxLabel: 'Launch',
				tap: T.gridSlot(2, 0, 'action'),
				caption: "Launch the first clip again.",
				live: null,
				until: looping(2, 0)
			},
			// Chance and Temp on the drums, where they are easiest to hear: Temp
			// moves hits onto other pads.
			{
				at: '73.2',
				box: T.gridSlot(0, 0, 'cell'),
				boxLabel: 'Hold',
				tap: T.hold(T.gridSlot(0, 0, 'body')),
				caption: 'Hold the drum clip to show its tools.',
				liveView: 'clip',
				live: LIVE.detail('The drum clip in Live')
			},
			{
				at: '74.2',
				box: T.slider('Chance'),
				boxLabel: 'Chance',
				caption: "Chance: the probability that each note plays.",
				note: "Lower values drop more notes.",
				drag: { target: T.slider('Chance'), path: [[0.5, 0.1], [0.5, 0.6], [0.5, 0.6], [0.5, 0.1]], beats: 6 }
			},
			{
				at: '76.1',
				box: T.area('.loop-container'),
				boxLabel: 'Loop',
				caption: 'Drag the loop down to two beats.',
				note: 'The loop brace sets which part of the clip plays.',
				drag: { target: T.area('.loop-container'), path: [[0.5, 0.03], [0.5, 0.75]], beats: 2 }
			},
			{
				at: '77.1',
				box: T.slider('Temp'),
				boxLabel: 'Temp',
				caption: "Temp: random pitch variation.",
				note: "On drums, notes move to other pads. Chance and Temp are part of the track's Permute.",
				drag: { target: T.slider('Temp'), path: [[0.5, 0.9], [0.5, 0.4], [0.5, 0.4], [0.5, 0.4], [0.5, 0.9]], beats: 8 }
			},
			{
				at: '79.3',
				box: T.area('.loop-container'),
				boxLabel: 'Loop',
				caption: 'Drag the loop back to two bars.',
				note: null,
				drag: { target: T.area('.loop-container'), path: [[0.5, 0.75], [0.5, 0.02]], beats: 2 }
			},

			{
				at: '82.1',
				chapter: "Effects",
				liveView: 'devices',
				box: T.tile('fx12'),
				boxLabel: 'Reverb',
				caption: "Drag a tile to add the effect and set it.",
				note: "Reverb: left-right sets decay, up-down sets the amount.",
				live: LIVE.devices('Reverb, inserted in Live'),
				drag: { target: T.tile('fx12'), path: [[0.5, 0.6], [0.62, 0.22]], beats: 4 }
			},
			{
				at: '83.3',
				box: T.area('[data-debug="middle-panel"]'),
				boxLabel: "Reverb",
				tap: T.tile('fx12'),
				caption: "Tap the tile to open all of its controls.",
				note: null
			},
			{
				at: '85.1',
				box: T.button('Shimmer'),
				boxLabel: 'Shimmer',
				tap: T.button('Shimmer'),
				caption: "Tap Shimmer.",
				note: "Shimmer shifts the reverb tail up in pitch."
			},
			{
				at: '86.3',
				box: T.tile('fx11'),
				boxLabel: 'Echo',
				caption: "Drag Echo.",
				note: "Left-right sets the delay time, up-down sets feedback.",
				live: LIVE.devices('Echo, inserted in Live'),
				drag: { target: T.tile('fx11'), path: [[0.4, 0.6], [0.52, 0.34]], beats: 3 }
			},
			{
				at: '87.4',
				box: T.area('[data-debug="middle-panel"]'),
				boxLabel: "Echo",
				tap: T.tile('fx11'),
				caption: "Echo's controls: time, filter, modulation and levels."
			},
			{
				at: '89.1',
				box: T.slider('Feedback'),
				boxLabel: 'Feedback',
				caption: "Raise Feedback.",
				drag: { target: T.slider('Feedback'), path: [[0.5, 0.7], [0.5, 0.35]], beats: 3 }
			},
			{
				at: '90.3',
				box: T.strip(1, 'device'),
				boxLabel: "Bass",
				tap: T.strip(1, 'device'),
				caption: "Select the bass track.",
				note: null,
				live: null
			},
			{
				at: '91.3',
				box: T.tile('fx5'),
				boxLabel: 'Pedal',
				caption: "Drag Pedal.",
				live: LIVE.devices('Pedal, inserted in Live'),
				drag: { target: T.tile('fx5'), path: [[0.5, 0.65], [0.56, 0.3]], beats: 3 }
			},
			{
				at: '92.4',
				box: T.area('[data-debug="middle-panel"]'),
				boxLabel: "Pedal",
				tap: T.tile('fx5'),
				caption: "Tap Pedal to open its controls."
			},
			{
				at: '93.3',
				box: T.button('Fuzz'),
				boxLabel: 'Fuzz',
				tap: T.button('Fuzz'),
				caption: "Tap Fuzz.",
				note: "Pedal has three types: overdrive, distortion and fuzz."
			},

			{
				at: '95.2',
				chapter: 'Permute',
				box: T.strip(1, 'permute'),
				boxLabel: "Permute",
				tap: T.strip(1, 'permute'),
				caption: "Tap the bottom of a track to open Permute.",
				note: "Permute is a step sequencer. It transposes and mutes the playing clip.",
				live: null
			},
			{ at: '96.3', box: T.area('.grid-pitch-steps'), boxLabel: 'Pitch steps', taps: [T.step('pitch', 3), T.step('pitch', 7)], caption: "Pitch steps transpose the bass by an octave." },
			{
				at: '98.2',
				box: T.area('[title^="Pitch length"]'),
				boxLabel: 'Length',
				caption: "Length: the number of steps before the lane repeats.",
				note: "If it is shorter than the clip, the pattern shifts each time the clip loops.",
				drag: { target: T.area('[title^="Pitch length"]'), path: [[0.5, 0.4], [0.5, 0.74]], beats: 2 }
			},
			{
				at: '99.4',
				box: T.area('[title^="Pitch rate"]'),
				boxLabel: 'Rate',
				caption: "Rate: the step speed.",
				drag: { target: T.area('[title^="Pitch rate"]'), path: [[0.5, 0.7], [0.5, 0.3]], beats: 2 }
			},
			{ at: '101.2', box: T.strip(2, 'permute'), boxLabel: "Permute", tap: T.strip(2, 'permute'), caption: "Open Permute on the keys." },
			{ at: '102.1', box: T.area('.grid-mute-steps'), boxLabel: 'Mute steps', taps: [T.step('mute', 1), T.step('mute', 3), T.step('mute', 6)], caption: "Mute steps silence the chords on those steps." },
			{
				at: '103.4',
				box: T.area('[title^="Mute rate"]'),
				boxLabel: 'Rate',
				caption: "Each lane has its own length and rate.",
				note: "Here the mute lane is faster than the pitch lane.",
				drag: { target: T.area('[title^="Mute rate"]'), path: [[0.5, 0.65], [0.5, 0.45]], beats: 2 }
			},

			// The drums were recorded while the set was still C major, and
			// selecting a clip gives Live that clip's scale; since 077b86f Key
			// Follow keeps its key (and stays on) through that, which this
			// chapter exercises.
			{
				at: '105.1',
				chapter: 'Launch and stop',
				box: T.gridSlot(0, 0, 'action'),
				boxLabel: 'Stop',
				tap: T.gridSlot(0, 0, 'action'),
				caption: "Tap a playing clip to stop it.", note: "It stops at the next bar.",
				until: stopped(0, 0)
			},
			{
				at: '107.1',
				box: T.gridSlot(0, 0, 'action'),
				boxLabel: 'Launch',
				tap: T.gridSlot(0, 0, 'action'),
				caption: "Tap again to launch it.",
				until: looping(0, 0)
			},

			{
				at: '109.1',
				chapter: 'Mix',
				box: T.area('.track-col[data-track-index="2"]'),
				boxLabel: "Keys track",
				caption: "Drag a track down to lower its volume.",
				drag: { target: T.strip(2, 'device'), path: [[0.5, 0.3], [0.5, 0.75]], beats: 3 }
			},
			{ at: '110.3', caption: "Drag up to raise it.", drag: { target: T.strip(2, 'device'), path: [[0.5, 0.6], [0.5, 0.15]], beats: 3 } },
			{ at: '112.2', box: T.name(1), boxLabel: "Mute", tap: T.name(1), caption: "Tap a track name to mute it.", until: muted(1, true) },
			{ at: '114.1', box: T.name(1), boxLabel: "Mute", tap: T.name(1), caption: "Tap again to unmute.", until: muted(1, false) },
			{ at: '115.3', box: null, caption: "All of this was done on the iPad." }
		],
		end: '118.1',
		// D minor still: selecting the drum clip (recorded in C major) did not undo Key Follow.
		result: [looping(0, 0), looping(1, 0), looping(2, 0), keyIs(2, 'Minor'), grooveAmountAtLeast(0, 0, 50)]
	},

	// ---- clips for the site: one part of the screen each ----------------

	layout: {
		...SITE,
		// The interface alone: nothing here changes Live.
		frame: 'ipad',
		title: 'Layout',
		blurb: "The six areas of Vamp's screen.",
		steps: [
			{ at: '18.1', chapter: 'Layout', box: null, caption: "Vamp's screen has six areas." },
			{
				at: '19.2',
				box: T.area('.vendor-buttons.places-rail'),
				boxLabel: 'Browser',
				caption: 'Left: the browser.',
				note: "One button for each Place in Live's browser sidebar."
			},
			{
				at: '20.4',
				box: T.area('[data-debug="devices-panel"]'),
				boxLabel: 'Effects',
				caption: 'Top: effects.',
				note: 'One tile per effect.'
			},
			{
				at: '22.2',
				box: T.area('[data-debug="middle-panel"]'),
				boxLabel: 'Central view',
				caption: 'Middle: the central view.',
				note: 'Controls for the selected instrument, clip or effect.'
			},
			{
				at: '23.4',
				box: T.area('[data-debug="slots-section"]'),
				boxLabel: 'Clip slots',
				caption: 'Below it: clip slots.',
				note: 'One column per track.'
			},
			{
				at: '25.2',
				box: T.area('.track-col', true),
				boxLabel: 'Tracks',
				caption: 'Bottom: tracks.',
				note: 'Volume, mute, and buttons for the clip, instrument and Permute.'
			},
			{
				at: '26.4',
				box: T.area('[data-debug="right-sidebar"]'),
				boxLabel: 'Loop, groove, scenes, key',
				caption: 'Right: loop, groove quantize, scenes and key.',
				note: 'A scene launches a row of clips.'
			},
			{ at: '28.2', box: null, caption: "Vamp's screen has six areas.", note: null }
		],
		end: '29.2',
		result: [looping(0, 0), looping(1, 0), looping(2, 0)]
	},

	browser: {
		...SITE,
		tempo: 120,
		title: 'Browser',
		blurb: 'Loading a kit, an audio loop and a sample from the browser.',
		prefs: { ...SITE.prefs, 'browserModeStore.sourceMode': 'instruments' },
		setup: undefined,
		steps: [
			{
				at: '2.1',
				chapter: 'Browser',
				box: T.area('.vendor-buttons.places-rail'),
				boxLabel: 'Places',
				caption: 'The browser has a button for each Place.',
				note: "Places are the folders in Live's browser sidebar."
			},
			{ at: '3.2', box: T.rail('Drum'), boxLabel: 'Drum', tap: T.rail('Drum'), caption: 'Tap a Place to open it.', note: null },
			{
				at: '4.2',
				box: T.area('.seg-switch[aria-label="Browse mode"]'),
				boxLabel: 'Mode',
				caption: 'Choose what to load: Instrument, Simpler or Clip.'
			},
			{ at: '5.3', box: T.folder('Drum Machines'), boxLabel: 'Folder', tap: T.folder('Drum Machines'), caption: 'Instrument: presets, such as drum kits.' },
			{
				at: '6.3',
				box: T.preset('909 Core Kit'),
				boxLabel: 'Preset',
				tap: T.preset('909 Core Kit'),
				caption: 'Tap a preset. It loads on a new track.',
				live: LIVE.tracks(2, 'The new track in Live'),
				until: hasDevice(1, 'DrumGroupDevice')
			},
			{ at: '8.1', box: null, live: null, do: (live) => live.invoke('song', 'delete_track', [0]) },
			{ at: '8.3', box: T.rail('Perc'), boxLabel: 'Perc', tap: T.rail('Perc'), caption: 'Clip: audio loops and samples.' },
			{ at: '9.3', box: T.seg('Clip'), boxLabel: 'Clip', tap: T.seg('Clip') },
			{
				at: '10.3',
				box: T.preset('Akeem Groove 120 bpm'),
				boxLabel: 'Loop',
				tap: T.preset('Akeem Groove 120 bpm'),
				caption: 'Tap a loop. It loads as a clip on a new audio track.',
				live: LIVE.tracks(2, 'The new audio track in Live'),
				until: slotHasClip(1, 0)
			},
			{
				at: '12.2',
				box: T.gridSlot(1, 0, 'action'),
				boxLabel: 'Launch',
				tap: T.gridSlot(1, 0, 'action'),
				caption: 'Tap it to launch it.',
				note: 'Live warps the loop to the song tempo.',
				live: LIVE.clip(1, 0, 'The loop in Live'),
				until: looping(1, 0)
			},
			{ at: '14.2', box: T.rail('Synth'), boxLabel: 'Synth', tap: T.rail('Synth'), caption: 'Simpler: a sample goes into Simpler on a new MIDI track.', note: null, live: null },
			{ at: '15.2', box: T.seg('Simpler'), boxLabel: 'Simpler', tap: T.seg('Simpler') },
			{
				at: '16.2',
				box: T.preset('Synth Swell F'),
				boxLabel: 'Sample',
				tap: T.preset('Synth Swell F'),
				live: LIVE.devices('Simpler, with the sample, in Live'),
				liveView: 'devices',
				until: hasDevice(2, 'OriginalSimpler')
			},
			{ at: '18.1', box: T.area('[data-debug="middle-panel"]'), boxLabel: 'Simpler', caption: 'Play it.', play: LEAD },
			{ at: '20.1', box: null, caption: 'Play it.' }
		],
		end: '20.3',
		result: [looping(1, 0), hasDevice(0, 'DrumGroupDevice'), hasDevice(2, 'OriginalSimpler')]
	},

	'main-track': {
		...SITE,
		title: 'The main track',
		blurb: "The main track and its view: tempo, launch quantization, metronome, key, and which sections are on screen.",
		steps: [
			{
				at: '18.1',
				chapter: 'Main track',
				box: T.master,
				boxLabel: "Main track",
				caption: "The main track.",
				note: "It shows the master meter.",
				liveView: 'devices',
				live: LIVE.main('Main, in Live')
			},
			{
				at: '19.3',
				box: T.area('[data-debug="middle-panel"]'),
				boxLabel: 'Main track view',
				tap: T.master,
				caption: "Tap it to open the main track's view.",
				note: 'Song settings on the left, screen sections on the right.',
				live: null
			},
			{
				at: '21.2',
				box: T.tempo,
				boxLabel: 'Tempo',
				caption: 'Drag BPM up to raise the tempo.',
				note: 'Drag Time the same way to change the time signature.',
				live: LIVE.tempo("Live's tempo"),
				drag: { target: T.tempo, px: true, path: [[0, 0], [0, -100]], beats: 3 },
				until: song('tempo', (v) => v >= 104, '>= 104')
			},
			{
				at: '23.2',
				box: T.tempo,
				boxLabel: 'Tempo',
				caption: 'Drag down to lower it.',
				drag: { target: T.tempo, px: true, path: [[0, 0], [0, 100]], beats: 3 },
				until: song('tempo', (v) => Math.round(v) === 96, '= 96')
			},
			{
				at: '25.2',
				box: T.launchQ,
				boxLabel: 'Launch Q',
				tap: T.launchQ,
				caption: 'Tap Launch Q to change launch quantization.',
				note: 'Clips launch and record on this grid.',
				live: LIVE.quant("Live's launch quantization")
			},
			{
				at: '26.2',
				box: T.area('.quant-modal'),
				boxLabel: 'Launch Q',
				tap: T.quantChip('2 Bar'),
				caption: 'Choose 2 Bar: clips launch every two bars.',
				until: launchQIs(3, 'q_2_bars')
			},
			{ at: '27.4', box: T.launchQ, boxLabel: 'Launch Q', tap: T.launchQ, caption: 'Set it back to 1 Bar.' },
			{ at: '28.2', box: T.area('.quant-modal'), tap: T.quantChip('1 Bar'), until: launchQIs(4, 'q_bar') },
			{
				at: '29.3',
				box: T.sysSwitch('Click'),
				boxLabel: 'Click',
				tap: T.sysSwitch('Click'),
				caption: "Click turns Live's metronome on and off.",
				live: LIVE.metronome("Live's metronome"),
				until: song('metronome', (v) => v === true, 'on')
			},
			{ at: '31.3', box: T.sysSwitch('Click'), boxLabel: 'Click', tap: T.sysSwitch('Click'), caption: "Click turns Live's metronome on and off.", until: song('metronome', (v) => v === false, 'off') },
			{
				at: '33.1',
				box: T.area('.sys-sections'),
				boxLabel: 'Sections',
				caption: 'Sections shows or hides parts of the screen.',
				note: null,
				live: null
			},
			{
				at: '34.2',
				box: T.sysSwitch('Clips'),
				boxLabel: 'Clips',
				tap: T.sysSwitch('Clips'),
				caption: 'Clips off hides the clip slots.',
				note: "The selected track's slots stay visible next to its clip."
			},
			{ at: '36.2', box: T.sysSwitch('FX'), boxLabel: 'FX', tap: T.sysSwitch('FX'), caption: 'FX off hides the effects.', note: null },
			{
				at: '38.2',
				box: T.sysSwitch('Header'),
				boxLabel: 'Header',
				tap: T.sysSwitch('Header'),
				caption: 'Header on shows the transport bar.',
				note: 'Tempo, play, metronome and stop all.'
			},
			{
				at: '40.2',
				box: T.area('.sys-sections'),
				boxLabel: 'Sections',
				taps: [T.sysSwitch('Header'), T.sysSwitch('FX'), T.sysSwitch('Clips')],
				caption: 'Turn them back.',
				note: null
			},
			{
				at: '42.2',
				box: T.master,
				boxLabel: "Master volume",
				caption: "Drag the main track to set the master volume.",
				note: null,
				live: LIVE.main("Main's volume in Live"),
				drag: { target: T.master, path: [[0.5, 0.3], [0.5, 0.55]], beats: 3 }
			},
			{ at: '43.4', box: T.master, boxLabel: "Master volume", caption: "Drag the main track to set the master volume.", drag: { target: T.master, path: [[0.5, 0.55], [0.5, 0.3]], beats: 3 } },
			{
				at: '45.2',
				box: T.sysSwitch('Follow Key'),
				boxLabel: 'Follow Key',
				caption: "Follow Key sets Live's key from the playing clips.",
				note: 'It runs after each recording.',
				live: LIVE.key("Live's key")
			},
			{ at: '47.2', box: T.area('.sys-gear'), boxLabel: 'Settings', caption: 'The gear opens Settings.', note: null, live: null }
		],
		end: '48.4',
		result: [
			looping(0, 0),
			looping(1, 0),
			looping(2, 0),
			song('tempo', (v) => Math.round(v) === 96, '= 96'),
			song('metronome', (v) => v === false, 'off'),
			launchQIs(4, 'q_bar')
		]
	},

	tracks: {
		...SITE,
		title: 'Tracks',
		blurb: "The tracks: opening a track's clip, instrument and Permute, volume, mute, launching and recording clips.",
		steps: [
			{
				at: '18.1',
				chapter: "Tracks",
				box: T.area('.track-col', true),
				boxLabel: "Tracks",
				caption: "The tracks.",
				note: "Each track has clip slots above it.",
				liveView: 'devices',
				live: LIVE.tracks(3, 'The same tracks in Live')
			},
			{
				at: '20.1',
				box: T.strip(1, 'clip'),
				boxLabel: "Clip",
				tap: T.strip(1, 'clip'),
				caption: "Tap the top of a track to open its clip.",
				note: "The clip's tools appear in the central view.",
				liveView: 'clip',
				live: LIVE.detail('The bass clip in Live')
			},
			{
				at: '22.1',
				box: T.strip(1, 'device'),
				boxLabel: "Instrument",
				tap: T.strip(1, 'device'),
				caption: "Tap the middle to open its instrument.",
				note: null,
				liveView: 'devices',
				live: LIVE.devices('Drift in Live')
			},
			{
				at: '24.1',
				box: T.strip(1, 'permute'),
				boxLabel: "Permute",
				tap: T.strip(1, 'permute'),
				caption: "Tap the bottom to open Permute.",
				note: null,
				live: null
			},
			{
				at: '26.1',
				box: T.area('.track-col[data-track-index="2"]'),
				boxLabel: "Keys track",
				caption: "Drag a track up or down to set its volume.",
				note: null,
				live: LIVE.track(2, 'Its volume in Live'),
				drag: { target: T.strip(2, 'device'), path: [[0.5, 0.3], [0.5, 0.75]], beats: 3 }
			},
			{ at: '27.3', caption: 'Drag a track up or down to set its volume.', note: null, drag: { target: T.strip(2, 'device'), path: [[0.5, 0.6], [0.5, 0.15]], beats: 3 } },
			{
				at: '29.2',
				box: T.name(0),
				boxLabel: "Mute",
				tap: T.name(0),
				caption: "Tap a track name to mute it.",
				live: LIVE.track(0, 'Muted in Live'),
				until: muted(0, true)
			},
			{ at: '31.1', box: T.name(0), boxLabel: "Mute", tap: T.name(0), caption: 'Tap again to unmute.', until: muted(0, false) },
			{
				at: '32.2',
				box: T.gridSlot(1, 0, 'action'),
				boxLabel: 'Stop',
				tap: T.gridSlot(1, 0, 'action'),
				caption: "Tap a playing clip's button to stop it.",
				note: 'It stops at the next bar.',
				live: LIVE.clip(1, 0, 'The clip in Live'),
				until: stopped(1, 0)
			},
			{ at: '34.2', box: T.gridSlot(1, 0, 'action'), boxLabel: 'Launch', tap: T.gridSlot(1, 0, 'action'), caption: 'Tap again to launch it.', note: null, until: looping(1, 0) },
			{
				at: '36.2',
				box: T.gridSlot(2, 1, 'cell'),
				boxLabel: 'Empty slot',
				tap: T.gridSlot(2, 1, 'body'),
				caption: 'Tap an empty slot to select and arm its track.',
				note: null,
				live: LIVE.track(2, 'Armed in Live'),
				until: armed(2)
			},
			{
				at: '37.3',
				box: T.gridSlot(2, 1, 'action'),
				boxLabel: 'Record',
				tap: T.gridSlot(2, 1, 'action'),
				caption: 'Tap the dot to record.',
				note: 'Recording starts at the next bar.',
				liveView: 'clip',
				live: LIVE.detail('The new take, as Live records it')
			},
			{ at: '38.1', play: KEYS_UP, caption: 'Play.', until: recording(2, 1) },
			{
				at: '39.3',
				box: T.gridSlot(2, 1, 'action'),
				boxLabel: 'Stop recording',
				tap: T.gridSlot(2, 1, 'action'),
				caption: 'Tap again to stop recording. The new clip loops.',
				note: 'Only one clip plays per track.'
			},
			{ at: '40.1', until: looping(2, 1) },
			{
				at: '41.2',
				box: T.gridSlot(2, 0, 'action'),
				boxLabel: 'Launch',
				tap: T.gridSlot(2, 0, 'action'),
				caption: 'Tap the first clip to launch it again.',
				note: null,
				live: LIVE.clip(2, 0, 'Back to the first clip'),
				until: looping(2, 0)
			}
		],
		end: '43.3',
		result: [looping(0, 0), looping(1, 0), looping(2, 0), slotHasClip(2, 1), muted(0, false)]
	},

	recorder: {
		...SITE,
		title: 'Record to Simpler',
		blurb: "Recording a track's sound through the Vamp Recorder on Return A into Simpler.",
		steps: [
			{
				at: '18.1',
				chapter: 'Record to Simpler',
				box: T.strip(2, 'clip'),
				boxLabel: 'Keys',
				tap: T.strip(2, 'clip'),
				caption: 'Select the track to record.',
				note: 'Its clip view opens in the middle.'
			},
			{
				at: '19.3',
				box: { css: '[data-debug="middle-panel"] button.record-button', label: 'REC' },
				boxLabel: 'REC',
				tap: { css: '[data-debug="middle-panel"] button.record-button', label: 'REC' },
				caption: "Tap REC to record the track's sound.",
				note: 'The Vamp Recorder on Return A records it.'
			},
			{ at: '20.3', caption: 'Recording.', note: null },
			{
				at: '22.1',
				box: { css: '[data-debug="middle-panel"] button.record-button', label: 'REC' },
				boxLabel: 'REC',
				tap: { css: '[data-debug="middle-panel"] button.record-button', label: 'REC' },
				caption: 'Tap REC again to stop.',
				note: 'The recording goes into Simpler on a new MIDI track.',
				until: hasDevice(3, 'OriginalSimpler')
			},
			{
				at: '24.1',
				box: T.area('[data-debug="middle-panel"]'),
				boxLabel: 'Simpler',
				tap: T.strip(3, 'device'),
				caption: 'Simpler holds the recording.',
				note: null,
				liveView: 'devices',
				live: LIVE.devices('Simpler, with the recording, in Live')
			},
			{ at: '25.1', caption: 'Play it from a keyboard.', play: LEAD },
			{ at: '27.1', box: null }
		],
		end: '28.1',
		result: [hasDevice(3, 'OriginalSimpler'), looping(2, 0)]
	},

	notes: {
		...SITE,
		title: 'Note editor',
		blurb: "The clip's notes in the central view: move, lengthen, select, duplicate, quantize and set velocity.",
		// Off camera, the clip and FX grids go, so the central view (and the
		// editor in it) takes half the screen.
		setup: [
			...BAND,
			{ at: '17.2', tap: T.master },
			{ at: '17.3', tap: T.sysSwitch('Clips') },
			{ at: '17.4', tap: T.sysSwitch('FX') }
		],
		steps: [
			{
				at: '18.2',
				chapter: 'Note editor',
				box: T.strip(2, 'clip'),
				boxLabel: 'Clip',
				tap: T.strip(2, 'clip'),
				caption: "Open a track's clip.",
				liveView: 'clip',
				live: LIVE.detail('The keys clip in Live')
			},
			{
				at: '19.3',
				box: T.area('.editor-toggle'),
				boxLabel: 'Notes',
				tap: T.area('.editor-toggle'),
				caption: "The pencil opens the clip's notes.",
				note: "The same notes as Live's clip view."
			},
			{ at: '21.2', box: EDITCHIP('Fold'), boxLabel: 'Fold', tap: EDITCHIP('Fold'), caption: 'Fold shows only the pitches the clip plays.', note: null },
			{
				at: '22.3',
				box: NOTEAT(0),
				boxLabel: 'Note',
				caption: 'Drag a note to move it in time or pitch.',
				drag: { target: NOTEAT(0), path: [[0.3, 0.5], [0.3, -1.6], [1.3, -1.6]], beats: 3 }
			},
			{
				at: '24.2',
				box: NOTEAT(2),
				boxLabel: 'Note end',
				caption: 'Drag its end to change its length.',
				drag: { target: NOTEAT(2), path: [[0.96, 0.5], [1.5, 0.5]], beats: 2 }
			},
			{ at: '25.3', box: EDITCHIP('Select'), boxLabel: 'Select', tap: EDITCHIP('Select'), caption: 'Select mode: drag a box around notes.' },
			{
				at: '26.2',
				box: T.area('[aria-label="Clip editor"]'),
				boxLabel: 'Select',
				drag: { target: T.area('[aria-label="Select notes"]'), path: [[0.02, 0.05], [0.3, 0.95]], beats: 2 }
			},
			{ at: '27.3', box: EDITCHIP('Duplicate'), boxLabel: 'Duplicate', tap: EDITCHIP('Duplicate'), caption: 'Duplicate copies the selected notes.' },
			{ at: '29.1', box: EDITCHIP('Quantize'), boxLabel: 'Quantize', tap: EDITCHIP('Quantize'), caption: 'Quantize snaps them to the grid.', note: 'Tap the grid button to change its size.' },
			{
				at: '30.2',
				box: T.area('[aria-label="Note velocity"]'),
				boxLabel: 'Velocity',
				caption: 'Drag in the velocity lane to change how hard a note plays.',
				note: null,
				drag: { target: T.area('[aria-label="Note velocity"]'), path: [[0.5, 0.5], [0.5, 1.4]], beats: 2 }
			},
			{ at: '31.3', box: T.area('.editor-toggle'), boxLabel: 'Notes', tap: T.area('.editor-toggle'), caption: 'Tap the pencil again to go back to the clip tools.', note: null },
			{ at: '33.1', box: null }
		],
		end: '33.3',
		result: [looping(2, 0)]
	},

	'instrument-views': {
		title: 'Instrument views',
		blurb: "Each instrument's central view, played and adjusted: one short clip each.",
		tempo: 96,
		prefs: { [PREFS.session]: '0', [PREFS.fx]: '0', [PREFS.header]: '0' },
		liveWindow: { w: 1090, h: 856 },
		set: { empty: true, key: { root: 2, scale: 'Minor' } },
		crop: T.area('[data-debug="middle-panel"]'),
		// Presets come through the browser (a sample for Simpler and Sampler,
		// three kinds of kit), each on the track
		// after the last; Live's other instruments are inserted bare.
		setup: [
			{ at: '1.2', tap: T.rail('Key') },
			{ at: '1.4', tap: T.folder('Simpler') },
			{ at: '2.2', tap: T.preset('Grand Piano Single Sample'), until: hasDevice(1, 'OriginalSimpler') },
			{ at: '3.2', do: async (live) => (await live.invoke('song', 'delete_track', [0]), usedTrack(0)(live)) },
			...[
				['Drum', 'Drum Machines', '909 Core Kit', 'DrumGroupDevice'],
				['Drum', 'Drum Machines', '606 + 808', 'DrumGroupDevice'],
				['Drum', 'Sampled', 'Aquarium Groove', 'DrumGroupDevice'],
				['Bass', 'Sampler', 'Analogue Bass', 'MultiSampler']
			].flatMap(([place, folder, preset, className], k) => {
				const bar = 4 + 4 * k;
				return [
					{ at: `${bar + 1}.1`, tap: T.rail(place) },
					// The browser reopens where it was in this Place; the root crumb goes back to its top level.
					{ at: `${bar + 1}.3`, tap: { css: '.crumbs button.crumb.root', pointer: 'mouse', label: 'crumb root' } },
					{ at: `${bar + 2}.1`, tap: T.folder(folder) },
					{ at: `${bar + 2}.3`, tap: T.preset(preset), until: hasDevice(1 + k, className) },
					{ at: `${bar + 3}.2`, do: usedTrack(1 + k) }
				];
			}),
			{
				at: '24.3',
				do: async (live) => {
					for (const d of ['Drift', 'Electric', 'Operator', 'Wavetable', 'Meld', 'Collision']) {
						await live.invoke('song', 'create_midi_track', [-1]);
						const n = (await live.read('song', ['tracks.*name']))['tracks.*name'].length;
						await live.invoke(`tracks/${n - 1}`, 'insert_device', [d]);
						await live.set(`tracks/${n - 1}`, [['name', d]]);
					}
				},
				until: hasDevice(10, 'Collision')
			},
			// Open every view once, off camera, so none is still loading when its piece starts.
			{ at: '26.3', taps: Array.from({ length: 11 }, (_, t) => T.strip(t, 'device')) }
		],
		steps: [
			...piece(31, 'Simpler', { open: { tap: T.strip(0, 'device') }, phrase: KEYS, moves: [sweep(nthIn('.xy-container', 0), [0.3, 0.7], [0.7, 0.3]), up(nthIn('.slider-container', 0)), down(nthIn('.slider-container', 1))] }),
			...piece(35, 'Drum Rack: macros', { open: { tap: T.strip(1, 'device') }, phrase: DRUMS, moves: [up(T.slider('Drive Amount')), down(nthIn('.slider-container', 1)), up(nthIn('.slider-container', 2))] }),
			...piece(39, 'Drum Rack: Drum Sampler', { open: { tap: T.strip(2, 'device') }, phrase: DRUMS, moves: [down(T.slider('Gain')), sweep(T.xy('Filter'), [0.3, 0.7], [0.7, 0.3]), sweep(T.xy('Time'), [0.3, 0.3], [0.7, 0.7])] }),
			...piece(43, 'Drum Rack: Sampler', { open: { tap: T.strip(3, 'device') }, phrase: DRUMS, moves: [up(nthIn('.slider-container', 0)), down(nthIn('.slider-container', 1)), up(nthIn('.slider-container', 2))] }),
			...piece(47, 'Sampler', { open: { tap: T.strip(4, 'device') }, phrase: BASS, moves: [sweep(T.xy('Filter'), [0.3, 0.7], [0.7, 0.3]), sweep(T.xy('Osc'), [0.3, 0.3], [0.7, 0.6]), up(T.slider('Gain'))] }),
			...piece(51, 'Drift', { open: { tap: T.strip(5, 'device') }, phrase: BASS, moves: [sweep(T.xy('Filter'), [0.25, 0.7], [0.8, 0.35]), up(T.slider('Shape')), sweep(T.xy('Time'), [0.3, 0.6], [0.7, 0.3])] }),
			...piece(55, 'Electric', { open: { tap: T.strip(6, 'device') }, phrase: KEYS, moves: [sweep(T.xy('Hammer'), [0.3, 0.7], [0.7, 0.3]), sweep(T.xy('Fork'), [0.7, 0.6], [0.3, 0.3]), { drag: { target: T.wheel('Pitch'), path: [[0.5, 0.5], [0.5, 0.82], [0.5, 0.5]], beats: 3 } }] }),
			...piece(59, 'Operator', { open: { tap: T.strip(7, 'device') }, phrase: LEAD, moves: [up(T.slider('Feedback')), down(T.slider('Tone')), up(T.slider('Time'))] }),
			...piece(63, 'Wavetable', { open: { tap: T.strip(8, 'device') }, phrase: KEYS, moves: [sweep(T.xy('OSC 1'), [0.2, 0.6], [0.8, 0.4]), sweep(T.xy('OSC 2'), [0.7, 0.7], [0.3, 0.3]), down(T.slider('A'))] }),
			...piece(67, 'Meld', { open: { tap: T.strip(9, 'device') }, phrase: KEYS, moves: [sweep(T.xy('Macro'), [0.3, 0.7], [0.7, 0.3]), sweep(T.xy('Filter'), [0.2, 0.5], [0.8, 0.3]), sweep(T.xy('Time'), [0.3, 0.3], [0.7, 0.7])] }),
			...piece(71, 'Collision', { open: { tap: T.strip(10, 'device') }, phrase: LEAD, moves: [sweep(T.xy('Res 1'), [0.2, 0.6], [0.8, 0.3]), sweep(T.xy('Res 1'), [0.8, 0.3], [0.4, 0.7]), { drag: { target: T.wheel('Mod'), path: [[0.5, 0.9], [0.5, 0.3]], beats: 3 } }] }),
			{ at: '75.1', cut: true }
		],
		end: '75.3',
		result: []
	},

	'effect-views': {
		title: 'Effect views',
		blurb: 'Each effect tile dragged onto a drum loop, then its central view: one short clip each.',
		tempo: 96,
		prefs: { [PREFS.session]: '0', [PREFS.fx]: '1', [PREFS.header]: '0' },
		liveWindow: { w: 1090, h: 856 },
		set: { empty: true, key: { root: 2, scale: 'Minor' } },
		crop: T.area('[data-debug="devices-panel"], [data-debug="middle-panel"]', true),
		// The drum loop, recorded into the clip view's own slots (no clip grid in this layout).
		setup: [
			...BAND.slice(0, 4),
			{ at: '4.1', tap: T.strip(0, 'clip'), until: armed(0) },
			{ at: '4.3', tap: T.slot(0) },
			{ at: '5.1', play: DRUMS, until: recording(0, 0) },
			{ at: '6.3', tap: T.slot(0) },
			{ at: '7.1', until: looping(0, 0) }
		],
		steps: [
			...[
				['Reverb', 'fx12', [tapOn(T.button('Hall')), tapOn(T.button('Shimmer'))]],
				['Echo', 'fx11', [up(T.slider('Feedback')), down(T.slider('Mix'))]],
				['Auto Filter', 'fx4', [tapOn(T.button('HP')), sweep(T.xy('LFO'), [0.3, 0.6], [0.7, 0.3])]],
				['Pedal', 'fx5', [tapOn(T.button('Fuzz')), up(T.slider('Drive'))]],
				['Drum Buss', 'fx6', [sweep(T.xy('Boom'), [0.3, 0.7], [0.7, 0.3]), up(T.slider('Crunch'))]],
				['Chorus', 'fx9', [up(T.slider('Blur')), sweep(T.xy('Phaser'), [0.3, 0.3], [0.7, 0.7])]],
				['Beat Repeat', 'fx8', [tapOn(T.button('1/8')), up(nthIn('.slider-container', 0))]],
				['Glue Compressor', 'squash', [down(T.slider('Threshold')), up(T.slider('Output'))]]
			].flatMap(([name, cell, moves], k) =>
				piece(8 + 5 * k, name, {
					open: { do: clearEffects(0) },
					moves: [
						{ drag: { target: T.tile(cell), path: [[0.5, 0.65], [0.6, 0.3]], beats: 3 } },
						tapOn(T.tile(cell)),
						...moves
					]
				})
			),
			{ at: '48.1', cut: true, do: clearEffects(0) }
		],
		end: '48.3',
		result: [looping(0, 0)]
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
