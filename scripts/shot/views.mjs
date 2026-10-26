/**
 * Named view recipes for the screenshot harness.
 *
 * A view is "which layout do I want to look at", expressed as the
 * localStorage prefs the UI reads at boot plus an optional list of
 * things to click once it's up. Everything here is seeded *before* the
 * first paint, so a shot never captures a layout mid-transition.
 *
 * The pref keys are `uiPrefsStore`'s (see
 * `interface/src/lib/stores/v6/uiPrefsStore.svelte.ts`). Note the
 * default-ON `showFxGrid` reads inverted: only an explicit `'0'` turns it
 * off. The central view, the flipped stack (ADR-421), the Drum Rack's pad
 * column and the strips' device band have no switch since 2026-09-26, so
 * every view captures them on.
 *
 * Add a view here rather than growing shot.mjs's flag surface — a named
 * view is something you can ask for from a phone in three words.
 */

/** iPad Pro 12.9" landscape, the machine this interface is built for. */
import { readFileSync } from 'node:fs';
import { CHAIN_DEMO_DEVICES, CHAIN_DEMO_TRACK, OMNISPHERE_STANDIN, driftParams, setTrackDevices } from './scene.mjs';

// The rig's "106 Bass 01" Analog, all 172 parameters as the running Live
// reported them (device_dump.js, 2026-10-22): [name, min, max, value].
const ANALOG_106_BASS = JSON.parse(readFileSync(new URL('./fixtures/analog-106-bass.json', import.meta.url), 'utf8'));
// A fresh Meld's 129 parameters as the running Live listed them
// (device dump, 2026-10-22), a few moved off their defaults so the shot
// shows values: [name, min, max, value].
const MELD_DEFAULT = JSON.parse(readFileSync(new URL('./fixtures/meld-default.json', import.meta.url), 'utf8'));

export const DEFAULT_VIEWPORT = { width: 1366, height: 1024 };

const P = {
	session: 'uiPrefsStore.sessionMode',
	fx: 'uiPrefsStore.showFxGrid',
	transport: 'uiPrefsStore.showTransportHeader'
};

export const VIEWS = {
	default: {
		description: 'As shipped — strips, central view, FX grid.',
		prefs: {}
	},
	session: {
		description: 'Session mode on: clip grid under the strips (ADR-415/416).',
		prefs: { [P.session]: '1' }
	},
	'session-only': {
		description: 'Strips + clip grid + central view, FX grid off.',
		prefs: { [P.session]: '1', [P.fx]: '0' }
	},
	central: {
		description: 'Strips + central view, FX grid off — the emptiest layout.',
		prefs: { [P.fx]: '0' }
	},
	full: {
		description: 'All four sections plus the transport header.',
		prefs: {
			[P.session]: '1',
			[P.fx]: '1',
			[P.transport]: '1'
		}
	},
	// The feature switches (general-release audit §7b). `features` replaces
	// the scene's bridge snapshot (`/bridge/features`) for the matching ids;
	// these three share one layout, so any two of them diff to the switch
	// alone. The status-strip mirror is not in any capture: its band is
	// `env(safe-area-inset-top)` tall, which is 0 off the iPad.
	header: {
		description: 'Transport header on — the TotalMix faders as the rig draws them.',
		prefs: { [P.transport]: '1' }
	},
	general: {
		description: 'General edition: TotalMix, the Max Utility patch and the expression pedal switched off — no faders, the header re-divides.',
		prefs: { [P.transport]: '1' },
		features: {
			totalmix: { enabled: false, available: false, reason: '' },
			maxUtilityPatch: { enabled: false, available: false, reason: '' },
			expressionPedal: { enabled: false, available: false, reason: '' }
		}
	},
	'totalmix-down': {
		description: 'TotalMix switched on but not answering — the faders greyed out, saying why.',
		prefs: { [P.transport]: '1' },
		features: { totalmix: { enabled: true, available: false, reason: 'TotalMix not answering' } }
	}
};

export function listViews() {
	return Object.entries(VIEWS).map(([name, v]) => ({ name, description: v.description }));
}

export function resolveView(name) {
	const view = VIEWS[name];
	if (!view) {
		const known = Object.keys(VIEWS).join(', ');
		throw new Error(`Unknown view "${name}". Known views: ${known}`);
	}
	return { name, path: '/', ...view };
}

// ---- tours (tour.mjs) ----------------------------------------------------

/*
 * A tour is many states captured in one boot. A state is a view (its prefs
 * and path) plus the steps that reach the screen you want — `performSteps` in
 * screenshot-page.mjs — an optional crop selector, an optional `swap` (a
 * device put in another's place before the mock starts) and an optional
 * `axHelper` (the state the bridge publishes on `/bridge/ax_helper`, which is
 * what the Drum Rack's swap pill is gated on).
 *
 * The selectors lean on the default scene's track order (scene.mjs):
 *   0 Drums   DrumCell kit            6 Lead     Wavetable + Permute
 *   1 Bass    Wavetable + Permute     7 Texture  audio, Simpler
 *   2 Keys    Drift + Permute         8 Jazz     Simpler kit (pad 38 in play)
 *   3 Guitar  audio                   9 Ethnic   nested-rack kit
 *   4 Vox     audio                  10 Autumn   Sampler kit
 *   5 Pad     Drift                  11 FM       Operator + Drum Buss
 * Reorder the scene and these indices move with it.
 */
const selectTrack = (index) => ({ click: `[data-track-index="${index}"] [data-section="clip"]` });
const openPermute = (index) => ({ click: `[data-track-index="${index}"] [data-section="permute"]` });
// The strip's device band: it selects the track AND opens that device's
// central view in one tap (`TrackStrip.selectThenDevice`), so it needs no
// `selectTrack` ahead of it. It replaced the FX grid's instrument slider
// here on 2026-09-15, when that slider left the grid with the ten-column
// cut — the band is the instrument view's door now.
const openInstrument = (index) => ({ click: `[data-track-index="${index}"] [data-section="device"]` });
// The FX section opens on the chain overview; a grid tile is behind the switch.
const SHOW_GRID = { click: '[data-fx-mode="grid"]' };
const openTile = (label) => [SHOW_GRID, { click: `.device-control:has-text("${label}")` }];

const FX_TILES = [
	['Rand Oct', 'random', 'Random view (the Rand Oct tile)'],
	['EQ', 'eq', 'EQ Eight'],
	['Filter', 'filter', 'Auto Filter'],
	['Drive', 'pedal', 'Drive tile → the Saturator view: Color · Output · Mix'],
	['Gtr', 'guitar', 'Gtr tile → the Guitar rack view: Gain, Spring/Room, Tremolo'],
	['Drum', 'drum-buss', 'Drum Buss'],
	['Glue', 'squash', 'Glue (the Squash slot): Threshold over Output'],
	['Glitch', 'glitch', 'Glitch: GlitchLoop (the GlitchLoop slot)'],
	['Stutter', 'variation', 'Variation (Beat Repeat), the Stutter tile: Interval, Grid, Length, Pitch Decay, Mode'],
	['Tremolo', 'tremolo', 'Auto Pan Legacy (the Tremolo tile)'],
	['Echo', 'echo', 'Echo'],
	['Reverb', 'reverb', 'Reverb']
];

/** Open Settings from the master strip's gear. */
const chainDemo = (scene) => setTrackDevices(scene, CHAIN_DEMO_TRACK, CHAIN_DEMO_DEVICES);
// Chains of other lengths, for the adaptive layout: the instrument, then effects.
const chainOf = (n) => (scene) =>
	setTrackDevices(scene, CHAIN_DEMO_TRACK, [CHAIN_DEMO_DEVICES[0], 'Auto Filter', 'Echo', 'Reverb', CHAIN_DEMO_DEVICES[5], 'Auto Filter', CHAIN_DEMO_DEVICES[7], CHAIN_DEMO_DEVICES[8]].slice(0, n));
const chainCell = (index) => `[data-device-path="tracks/${CHAIN_DEMO_TRACK}/devices/${index}"]`;
const SETTINGS_OPEN = [{ click: '[data-debug="master-card"]' }, { click: '[data-debug="settings-gear"]', dom: true }];

export const TOURS = {
	// The FX section's second face (the chain overview, a mock-up for Ben,
	// 2026-10-25): the Lead track carries CHAIN_DEMO_DEVICES — two Auto
	// Filters, two racks of the performer's, a plug-in.
	chain: {
		description: 'The FX grid and the chain overview behind its switch, on a track with two Auto Filters, two racks and a plug-in.',
		states: [
			{
				name: 'grid',
				description: 'Lead selected, the switch flipped to the FX grid: the Filter tile wears 1/2 (two Auto Filters on the track)',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK), SHOW_GRID]
			},
			{
				name: 'chain',
				description: 'The FX section as it opens: the chain in order, each device its tile chip',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK)]
			},
			...[2, 4, 5, 8].map((n) => ({
				name: `chain-len-${n}`,
				description: `A chain of ${n} devices: one row up to five, then two rows split evenly, the + cell always last`,
				scenePatch: chainOf(n),
				steps: [openInstrument(CHAIN_DEMO_TRACK)]
			})),
			{
				name: 'chain-wheels',
				description: 'MidiWheels ahead of the instrument: its cell carries the pitch and mod wheels',
				scenePatch: (scene) =>
					setTrackDevices(scene, CHAIN_DEMO_TRACK, [{ name: 'MidiWheels', className: 'MxDeviceMidiEffect' }, CHAIN_DEMO_DEVICES[0], 'Auto Filter', 'Echo']),
				steps: [openInstrument(CHAIN_DEMO_TRACK)]
			},
			{
				name: 'chain-wheels-two-rows',
				description: 'MidiWheels on a two-row chain: the wheels side by side in its half-height cell',
				scenePatch: (scene) =>
					setTrackDevices(scene, CHAIN_DEMO_TRACK, [{ name: 'MidiWheels', className: 'MxDeviceMidiEffect' }, ...CHAIN_DEMO_DEVICES.slice(0, 6)]),
				steps: [openInstrument(CHAIN_DEMO_TRACK)]
			},
			{
				name: 'chain-faces',
				description: 'Omnisphere with its ORB, Permute with its mute and pitch steps, then two effects',
				scenePatch: (scene) => setTrackDevices(scene, CHAIN_DEMO_TRACK, [OMNISPHERE_STANDIN, CHAIN_DEMO_DEVICES[1], 'Auto Filter', 'Echo']),
				steps: [openInstrument(CHAIN_DEMO_TRACK)]
			},
			{
				name: 'chain-drift',
				description: 'Drift with its filter XY, then Permute and an Echo',
				scenePatch: (scene) => setTrackDevices(scene, CHAIN_DEMO_TRACK, [{ name: 'Drift', params: driftParams() }, CHAIN_DEMO_DEVICES[1], 'Echo']),
				steps: [openInstrument(CHAIN_DEMO_TRACK)]
			},
			{
				name: 'chain-filter-2',
				description: 'Tapped the second Auto Filter: appointed, the Filter view on it, the Filter chip moved to it',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK), { click: chainCell(3) }]
			},
			{
				name: 'grid-after-pick',
				description: 'Back to the grid after that pick: the Filter tile wears 2/2',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK), { click: chainCell(3) }, { click: '[data-fx-mode="grid"]' }]
			},
			{
				name: 'chain-rack',
				description: 'Tapped the Dub Space rack: its macros in the central view',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK), { click: chainCell(5) }]
			},
			{
				name: 'chain-power',
				description: 'Tapped the Echo cell\'s power button: Echo off (dimmed, the button unlit); Grit was off already',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK), { click: `${chainCell(4)} .power` }]
			},
			{
				name: 'chain-dragging',
				description: 'Reverb mid-drag, still held: it rides the finger, Echo has slid right, the dashed gap is where it lands',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK), { drag: `${chainCell(6)} .cell-head .name`, by: [-190, 20], keep: true }]
			},
			{
				name: 'chain-xy',
				description: 'Dragged the Wobble cell\'s Filter XY down and a whole cell left: its curve and dot move, the other Auto Filter stays, the chain keeps its order and the hand moves to Wobble',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK), { drag: `${chainCell(2)} .cell-control`, by: [-170, 80] }]
			},
			{
				name: 'chain-steps-drag',
				description: 'Dragged across Permute\'s steps in its cell: the Permute view opens, as a tap on the cell opens it',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK), { drag: `${chainCell(1)} .cell-control`, by: [60, 0] }]
			},
			{
				name: 'chain-moved',
				description: 'Dragged Reverb two cells left: it now sits ahead of Echo',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK), { drag: `${chainCell(6)} .cell-head .name`, by: [-190, 0] }]
			},
			{
				name: 'chain-drum',
				description: 'Jazz, no pad scoped: the Drum Rack cell carries the kit\'s Trnsp',
				steps: [openInstrument(8), { click: '[data-fx-mode="chain"]' }]
			},
			{
				name: 'chain-pad',
				description: 'Jazz, pad 38 latched in the Drum Rack view: the chain is that pad\'s (its Simpler, Reverb, Permute; the blue hand on the Simpler), in the pad\'s frame and chip',
				steps: [openInstrument(8), { click: '.pad-tile[data-note="38"]' }]
			},
			{
				name: 'chain-pedal-gate',
				description: 'A Pedal and a Gate on the chain: no grid tile, so the Pedal cell is the face its browser tiles draw (Drive at 0.6) and the Gate cell the Glue view\'s Gate XY',
				scenePatch: (scene) =>
					setTrackDevices(scene, CHAIN_DEMO_TRACK, [
						CHAIN_DEMO_DEVICES[0],
						{ name: 'Pedal', className: 'Pedal', params: [['Device On', 'Device On', 0, 1, 1, ''], ['Type', 'Type', 0, 2, 0, ''], ['Drive', 'Drive', 0, 1, 0.6, ''], ['Output', 'Output', -20, 20, 0, ''], ['Bass', 'Bass', -1, 1, 0, ''], ['Mid', 'Mid', -1, 1, 0, ''], ['Treble', 'Treble', -1, 1, 0, ''], ['Mid Freq', 'Mid Freq', 0, 2, 1, ''], ['Sub', 'Sub', 0, 1, 0, ''], ['Dry/Wet', 'Dry/Wet', 0, 1, 1, '']] },
						{ name: 'Gate', className: 'Gate', params: [['Device On', 'Device On', 0, 1, 1, ''], ['Threshold', 'Threshold', 0, 1, 0.55, ''], ['Attack', 'Attack', 0.02, 150, 3.5, ''], ['Hold', 'Hold', 0, 1, 0.31, ''], ['Release', 'Release', 0, 1, 0.35, '']] },
						'Echo'
					]),
				steps: [openInstrument(CHAIN_DEMO_TRACK)]
			},
			// A device with no grid tile opens its own view from its chain cell,
			// drawing its `deviceControls` entry (ADR-479).
			...[
				['shifter', { name: 'Shifter', className: 'Shifter', params: [['Device On', 'Device On', 0, 1, 1, ''], ...Array.from({ length: 17 }, (_, i) => [`P${i + 1}`, `P${i + 1}`, 0, 1, 0, '']), ['RM Coarse', 'RM Coarse', 0, 1, 0.5, '100 Hz']] }],
				['chance', { name: 'Note Chance', className: 'MxDeviceMidiEffect', params: [['Device On', 'Device On', 0, 1, 1, ''], ['Chance', 'Chance', 0, 100, 60, '60 %']] }],
				['redux', { name: 'Redux', className: 'Redux2', params: [['Device On', 'Device On', 0, 1, 1, ''], ['Sample Rate', 'Sample Rate', 0, 1, 0.62, '9.08 kHz'], ['Jitter', 'Jitter', 0, 1, 0.2, '4.0 %'], ['Bit Depth', 'Bit Depth', 1, 16, 8, '8'], ['Quantizer Shape', 'Quantizer Shape', 0, 1, 0.35, '35 %'], ['DC Shift', 'DC Shift', 0, 1, 0, 'Off'], ['Pre-Filter On', 'Pre-Filter On', 0, 1, 1, 'On'], ['Post-Filter On', 'Post-Filter On', 0, 1, 1, 'On'], ['Post-Filter', 'Post-Filter', 0, 1, 0.5, '0.00'], ['Dry/Wet', 'Dry/Wet', 0, 1, 0.8, '80 %']] }],
				['multiband', { name: 'Multiband Dynamics', className: 'MultibandDynamics', params: Array.from({ length: 28 }, (_, i) => i === 0 ? ['Device On', 'Device On', 0, 1, 1, ''] : i === 5 ? ['Output', 'Output', -24, 24, 0, '0.00 dB'] : i === 21 ? ['Below Threshold (Mid)', 'Below Threshold (Mid)', -80, 0, -27.125, '-27.1 dB'] : i === 27 ? ['Below Ratio (Mid)', 'Below Ratio (Mid)', -3, 1, 0.4, '1 : 1.67'] : [`P${i}`, `P${i}`, 0, 1, 0, '']) }]
			].map(([key, device]) => ({
				name: `chain-view-${key}`,
				description: `Tapped the ${device.name} cell: its own view, the control its browser tiles and chain cell draw`,
				scenePatch: (scene) => setTrackDevices(scene, CHAIN_DEMO_TRACK, [CHAIN_DEMO_DEVICES[0], device]),
				steps: [openInstrument(CHAIN_DEMO_TRACK), { click: `${chainCell(1)} .cell-head .name` }, { wait: 500 }]
			})),
			{
				name: 'chain-add',
				description: 'Tapped the + cell at the end of the chain: the browser opens on its Effect segment, on a Place that has effect presets',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK), { click: '[data-debug="chain-add"]' }, { wait: 800 }]
			},
			// The effects Place as it is on disk (needs --real-data), from a MIDI
			// track and from an audio track, where its MIDI effects are greyed.
			...[
				['browser-effects', 'a MIDI track: every effect live, MIDI effects included', openInstrument(CHAIN_DEMO_TRACK)],
				['browser-effects-on-audio', 'an audio track (Guitar): the MIDI effects greyed, "MIDI tracks only"', selectTrack(3)]
			].map(([name, from, select]) => ({
				name,
				description: `The + Effect browser from ${from}; each tile its device's control at its saved values`,
				scenePatch: chainDemo,
				steps: [select, { click: '[data-debug="chain-add"]' }, { wait: 2500 }]
			})),
			{
				name: 'chain-plugin',
				description: 'Tapped the plug-in: the generic view, one slider per parameter',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK), { click: chainCell(8) }]
			}
		]
	},

	central: {
		description: 'Every central view the default scene reaches, cropped to the central section.',
		crop: '.central-frame',
		states: [
			{ name: 'clip-midi', description: 'Clip view, MIDI track, mini session up' },
			{ name: 'clip-audio', description: 'Clip view, audio track (Guitar)', steps: [selectTrack(3)] },
			{
				name: 'clip-audio-general',
				description: 'Clip view, audio track, AX helper switched off — no Rev and no Group; to Simpler and Dup Trk take their columns',
				features: { axHelper: { enabled: false, available: false, reason: '' } },
				steps: [selectTrack(3)]
			},
			{
				name: 'clip-audio-no-recorder',
				description: 'Clip view, audio track, no recorder device on Return A — REC greyed out, saying why',
				features: { captureRecorder: { enabled: true, available: false, reason: 'No recorder on Return A' } },
				steps: [selectTrack(3)]
			},
			{ name: 'clip-session', view: 'session', description: 'Clip view with CLIPS on — no mini column' },
			// The pencil's note editor: Fold on (its default) and off. With the
			// clip grid off it keeps the mini session column on its left.
			{ name: 'clip-notes', description: 'Note editor (the pencil), Fold on, the mini session column beside it', steps: [{ click: '.editor-toggle' }] },
			{
				name: 'clip-notes-session',
				view: 'session',
				description: 'Note editor with CLIPS on — no mini column, the editor full width',
				steps: [{ click: '.editor-toggle' }]
			},
			// The mini session sits in the right sidebar (ADR-469), where a tap
			// launches; a hold past 500 ms focuses the clip and opens the Clip
			// view. The second slot is a stopped clip in the default scene.
			{
				name: 'clip-mini-hold',
				description: 'A hold on a mini slot holding a clip opens the Clip view on it',
				steps: [{ hold: '[data-debug="mini-session"] [data-slot-index="1"]', ms: 700 }]
			},
			// On the Drums track the rows are the kit's pads: each name, note
			// and velocity bar wears its pad's chain colour.
			{
				name: 'clip-notes-drums',
				description: 'Note editor on the Drums track: pad names, the rows in their chain colours',
				session: { '/looping/v3/clip/focused': ['tracks/0/slots/0/clip'] },
				// Drums is the selected track, so a Clip tap on its strip is
				// the editor's toggle (TrackStrip `clipViewUp`).
				steps: [selectTrack(0)]
			},
			{
				name: 'clip-notes-drums-solo',
				description: 'The same, the Ride row soloed by a tap on its name: lit in its own colour',
				session: { '/looping/v3/clip/focused': ['tracks/0/slots/0/clip'] },
				steps: [selectTrack(0), { click: '.pitch-gutter .key:has-text("Ride")' }]
			},
			{
				name: 'clip-notes-unfolded',
				description: 'Note editor, Fold off',
				steps: [{ click: '.editor-toggle' }, { click: '.edit-chip:has-text("Fold")' }]
			},
			{ name: 'permute', description: 'Permute (Bass)', steps: [openPermute(1)] },
			// Touching Q opens it; the tiles are the Mac's own ticks
			// (`logs/grooves.json`, else the twelve defaults) from Live's Core
			// Library — on a Mac without Live there are none to draw.
			{ name: 'groove', description: 'Groove view (touch Q): the ticked grooves, Random · Velocity · Amount', steps: [{ click: '[aria-label="Quantization amount"]' }] },
			{ name: 'system', description: 'Master track — the System view: Transport, Follow Key, Sections', steps: [{ click: '[data-debug="master-card"]' }] },
			{
				name: 'fx-pedal-general',
				description: 'Guitar rack view, expression pedal switched off (no Wah in it either way since 2026-10-26)',
				features: { expressionPedal: { enabled: false, available: false, reason: '' } },
				steps: [...openTile('Gtr')]
			},
			// The Gtr tile opens the Guitar rack's view (one device per view
			// since 2026-10-26). On the Guitar track (an audio track) the rack
			// is loaded.
			{
				name: 'fx-guitar-loaded',
				description: 'Guitar view on the Guitar track: the Guitar rack live — Spring, Tremolo pad, Room',
				steps: [selectTrack(3), ...openTile('Gtr')]
			},
			...FX_TILES.map(([label, name, description]) => ({
				name: `fx-${name}`,
				description,
				steps: [...openTile(label)]
			})),
			// The Hybrid Reverb on Pad (track 5): the rig's full parameter vector
			// (a Quartz), one state per algorithm the picker's tap leaves it on,
			// each with the drag that shows what that algorithm is about. A box
			// drag is relative: -dy of 240 px sweeps it bottom to top (ADR-477).
			...[
				['Hall', 'Bass Mult raised: the lows below Bass X ring longer', [{ drag: '[aria-label^="Bass Mult"]', by: [0, -44] }]],
				['Quartz', 'Diffusion down: the tail breaks into its echoes', [{ drag: '[aria-label^="Diffusion"]', by: [0, 208] }]],
				['Shimmer', 'Pitch +12: the energy climbs an octave a pass', []],
				['Tides', 'Rate 1/4: the bands ripple out of step', [{ drag: '[aria-label^="Rate"]', by: [0, 49] }]],
				['Prism', 'Low Mult up, High Mult down: the lows outlast the highs', [
					{ drag: '[aria-label^="Low Mult"]', by: [0, -73] },
					{ drag: '[aria-label^="High Mult"]', by: [0, 61] }
				]]
			].map(([algo, what, drags]) => ({
				name: `fx-reverb-${algo.toLowerCase()}`,
				description: `Reverb, ${algo}. ${what}`,
				steps: [selectTrack(5), ...openTile('Reverb'), { click: `[data-reverb-type="${algo}"]` }, ...drags]
			})),
			// The EQ tab (2026-10-02): the rig's own EQ — Lo Cut at 121 Hz, 18 dB,
			// Hi Shelf at 5 kHz — then shaped by dragging the handles, as a finger
			// would, and the Hi end switched to a cut.
			{
				name: 'fx-reverb-eq',
				description: 'Reverb, EQ tab: the rig’s EQ — Lo Cut 121 Hz 18 dB, the peaks flat, Hi Shelf 5 kHz',
				steps: [selectTrack(5), ...openTile('Reverb'), { click: '[data-reverb-type="Hall"]' }, { click: '[data-reverb-tab="eq"]' }]
			},
			{
				name: 'fx-reverb-eq-shaped',
				description: 'Reverb, EQ tab: Peak 1 dragged up, Peak 2 down and higher, the Hi end switched to Cut',
				steps: [
					selectTrack(5),
					...openTile('Reverb'),
					{ click: '[data-reverb-type="Hall"]' },
					{ click: '[data-reverb-tab="eq"]' },
					{ drag: '[data-eq-band="peak1"]', by: [-20, -45] },
					{ drag: '[data-eq-band="peak2"]', by: [40, 35] },
					{ click: '[data-reverb-own] [data-reverb-switch="43"]' }
				]
			},
			// Convolution: the IR the button loads, then shaped by its Attack and
			// Decay boxes. Its waveform (from Live's own file, `/api/reverb-ir`)
			// is drawn on the Reverb tile since ADR-477, not in this view.
			{
				name: 'fx-reverb-ir-spring',
				description: 'Reverb, Spring: Live’s “Awesome Stereo Spring” IR, unshaped',
				steps: [selectTrack(5), ...openTile('Reverb'), { click: '[data-reverb-type="Spring"]' }]
			},
			{
				name: 'fx-reverb-ir-plate',
				description: 'Reverb, Plate: Live’s “Classic Plate 1” IR',
				steps: [selectTrack(5), ...openTile('Reverb'), { click: '[data-reverb-type="Plate"]' }]
			},
			{
				name: 'fx-reverb-ir-shaped',
				description: 'Reverb, Spring, Attack up and Decay down: Attack fades it in, Decay cuts the tail',
				steps: [
					selectTrack(5),
					...openTile('Reverb'),
					{ click: '[data-reverb-type="Spring"]' },
					{ drag: '[data-reverb-own] [role="slider"][aria-label^="Attack"]', by: [0, -40] },
					{ drag: '[data-reverb-own] [role="slider"][aria-label^="Decay"]', by: [0, 160] }
				]
			},
			{
				name: 'fx-reverb-ir-short',
				description: 'Reverb, Short (an early-reflections IR) shaped: its boxes fitted to a short IR',
				steps: [
					selectTrack(5),
					...openTile('Reverb'),
					{ click: '[data-reverb-type="Short"]' },
					{ drag: '[data-reverb-own] [role="slider"][aria-label^="Attack"]', by: [0, -53] },
					{ drag: '[data-reverb-own] [role="slider"][aria-label^="Decay"]', by: [0, 100] }
				]
			},
			{
				name: 'fx-reverb-ir-size',
				description: 'Reverb, Spring with Size dragged up: the IR stretched over a longer axis',
				steps: [
					selectTrack(5),
					...openTile('Reverb'),
					{ click: '[data-reverb-type="Spring"]' },
					{ drag: '[data-reverb-own] [role="slider"][aria-label^="Size"]', by: [0, -73] }
				]
			},
			{
				name: 'fx-reverb-ir-eq',
				description: 'Reverb, Spring on its EQ tab: the same editor and EQ rows as an algorithm’s',
				steps: [selectTrack(5), ...openTile('Reverb'), { click: '[data-reverb-type="Spring"]' }, { click: '[data-reverb-tab="eq"]' }]
			},
			{
				name: 'fx-reverb-frozen',
				description: 'Reverb, Hall with Freeze on: every band holds to the edge',
				steps: [selectTrack(5), ...openTile('Reverb'), { click: '[data-reverb-type="Hall"]' }, { click: '[data-reverb-switch="8"]' }]
			},
			{ name: 'drumrack-drumcell', description: 'Drum Rack, DrumCell kit (Drums)', steps: [openInstrument(0)] },
			// A tap latches a pad: the controls are its, and under them the
			// strip of its notes in the playing clip, each step as tall as its
			// velocity.
			// The same on a 2-bar loop: the strip shows one bar, and the bar
			// button left of it slides between the two.
			{
				name: 'drumrack-pad-notes-2bars',
				description: 'Drum Rack, the Ride pad latched, the Drums clip a 2-bar loop: one bar on the strip, the bar button beside it',
				scenePatch: (scene) => {
					scene.clipLengths['tracks/0/slots/0/clip'] = 8;
					for (const p of scene.playing) if (p.trackPath === 'tracks/0') p.lengthBeats = 8;
				},
				steps: [openInstrument(0), { click: '.pad-tile:has-text("Ride")' }]
			},
			{
				name: 'drumrack-pad-notes',
				description: 'Drum Rack, DrumCell kit, the Ride pad latched: its notes strip under the controls',
				steps: [openInstrument(0), { click: '.pad-tile:has-text("Ride")' }]
			},
			// The held pads' mixer strip (2026-09-29): Kick latched, its chain
			// mute and volume in a thin column right of the pads.
			{
				name: 'drumrack-pad-mixer',
				description: 'Drum Rack, Kick latched — the pad’s chain mute and volume beside the pads',
				steps: [openInstrument(0), { click: '.pad-tile[data-note="36"]' }]
			},
			// The swap pill's OTHER branch (ADR-439). On a held Drum Sampler pad
			// the pill is gated on the bridge's `/bridge/ax_helper`, and the mock
			// hardcoded `ready`, so the state a rig without `npm run
			// install-ax-helper` is actually in — the pill disabled, the helper's
			// code in place of the pad's name — could not be photographed at all.
			// The tap latches Kick (a DrumCell pad): since 2026-09-27 a kit with
			// nothing scoped steps its preset folder and never asks the helper.
			{
				name: 'drumrack-helper-down',
				description: 'Drum Rack, Kick latched, AX helper down — the pad’s swap pill disabled, naming why',
				steps: [openInstrument(0), { click: '.pad-tile[data-note="36"]' }],
				axHelper: {
					state: 'ax-helper-down',
					detail: 'helper not running (no socket; npm run install-ax-helper)'
				}
			},
			// The one step in this repo that PRESSES the swap pill, and it is a
			// CSS gate rather than a picture. `SwapControl`'s `.swap-name` is
			// `grid-column: 1 / -1`, so it covers the whole pill including both
			// arrows, and only `pointer-events: none` on it lets a press reach
			// the half below. Nothing covered that: the component's own tests
			// press with the keyboard, `check:touch` does not reach `central/`,
			// and `multitouch.mjs` has no swap scenario — delete that one
			// declaration and every assertion still passed, while on the iPad
			// the whole control went dead but for two ~12 px strips.
			// `screenshot-page.mjs`'s `page.click()` does Playwright's real
			// hit-target check, so an intercepted press fails the run rather
			// than quietly photographing an unpressed pill. Kick is latched first
			// because the Drums track records no preset, so its KIT pill is
			// disabled; a latched Drum Sampler pad's pill is live.
			{
				name: 'drumrack-swap-pressed',
				description: 'The swap pill pressed — the hit test SwapControl’s pointer-events split depends on',
				steps: [openInstrument(0), { click: '.pad-tile[data-note="36"]' }, { click: '[data-swap="next"]' }]
			},
			{ name: 'drumrack-simpler-kit', description: 'Drum Rack, Simpler kit (Jazz)', steps: [openInstrument(8)] },
			{
				name: 'drumrack-pad-held',
				description: 'Jazz kit with pad 38 held — the controls take the pad',
				steps: [openInstrument(8), { hold: '.pad-tile[data-note="38"]' }]
			},
			{ name: 'drumrack-rack-macros', description: 'Drum Rack, nested-rack kit (Ethnic)', steps: [openInstrument(9)] },
			{ name: 'drumrack-sampler-kit', description: 'Drum Rack, Sampler kit (Autumn)', steps: [openInstrument(10)] },
			{ name: 'inst-wavetable', description: 'Wavetable (Bass)', steps: [openInstrument(1)] },
			// Osc 2 up (off in this patch, so ghosted); both envelopes are always in view (ADR-477).
			{
				name: 'inst-wavetable-osc2',
				description: 'Wavetable (Bass), Osc 2',
				steps: [openInstrument(1), { click: '.osc-badge' }]
			},
			// Filter 2 up.
			{
				name: 'inst-wavetable-flt2',
				description: 'Wavetable (Bass), Filter 2',
				steps: [openInstrument(1), { click: '.filter-col .osc-badge' }]
			},
			{ name: 'inst-drift', description: 'Drift (Keys)', steps: [openInstrument(2)] },
			// No single-Simpler state: the scene's only Simpler is on Texture, an
			// AUDIO track, and audio tracks draw no instrument tile to open it from.
			{ name: 'inst-operator', description: 'Operator (FM)', steps: [openInstrument(11)] },
			...instrumentSwapStates()
		]
	},
	// The full-page Settings (plan.md §11): the setup that left the System
	// view on 2026-09-26, behind the gear in Transport's corner — General,
	// Places and Connection down a sidebar (tabs under 760px). Cropped to the
	// page itself, which covers the app; the layout check still measures the
	// System view underneath, which is what the gear left. The gear is clicked
	// through the DOM, because at phone width the app's layout draws it off
	// screen. A state's `firstRun: true` has the fixture listing say the Mac
	// has saved nothing, which opens Settings by itself as the checklist. The
	// listing is the rig's own (fixtures/places-list.json): 21 Places, 7
	// ticked, the User Library and 81 Packs.
	settings: {
		description: 'The full-page Settings, opened from the gear in the System view.',
		crop: '[data-debug="settings-page"]',
		states: [
			{
				name: 'settings',
				description: 'Settings → General — Behavior, Appearance, Foot Switch',
				steps: SETTINGS_OPEN
			},
			{
				name: 'settings-general',
				description: 'Settings → General, Max Utility patch switched off — no Move Knob switch',
				features: { maxUtilityPatch: { enabled: false, available: false, reason: '' } },
				steps: SETTINGS_OPEN
			},
			{
				name: 'settings-places',
				description: 'Settings → Places — the ticked ones first, the Packs folded',
				steps: [...SETTINGS_OPEN, { click: '[data-tab="places"]' }]
			},
			{
				name: 'settings-places-packs',
				description: 'Settings → Places, the Packs unfolded and scrolled to',
				steps: [...SETTINGS_OPEN, { click: '[data-tab="places"]' }, { click: '[data-group="packs"] .set-group-toggle' }, { wait: 700 }]
			},
			{
				name: 'settings-places-filter',
				description: 'Settings → Places, filtered to "drum"',
				steps: [...SETTINGS_OPEN, { click: '[data-tab="places"]' }, { fill: '.set-filter input', text: 'drum' }]
			},
			{
				name: 'settings-grooves',
				description: 'Settings → Grooves — Live’s groove files, the Groove view’s first',
				steps: [...SETTINGS_OPEN, { click: '[data-tab="grooves"]' }]
			},
			{
				name: 'settings-connection',
				description: 'Settings → Connection — Live, the iPad address, the features (TotalMix unavailable)',
				features: { totalmix: { enabled: true, available: false, reason: 'TotalMix has not answered on port 7001' } },
				steps: [...SETTINGS_OPEN, { click: '[data-tab="connection"]' }]
			},
			{
				// A first run: the Mac has saved nothing, so Settings opens by itself
				// as the checklist (onboarding.plan.md §7). No steps: the page is
				// already up, over the master strip.
				name: 'settings-first-run',
				description: 'Settings on a first run — the Setup checklist, nothing ticked yet',
				firstRun: true
			},
			{
				name: 'settings-foot-learn',
				description: 'Settings → General, the foot switch learning — "Press your pedal…"',
				steps: [...SETTINGS_OPEN, { click: '[data-debug="foot-switch-learn"]' }]
			}
		]
	}
};

/*
 * Instruments the default scene has no track for, each swapped onto the FM
 * track in Operator's place (`swap`, applied by scene.mjs's `swapDevice`)
 * so the tour reaches — and the layout check measures — every instrument
 * view. A swap without `params` keeps Operator's, so a view that binds by
 * name draws ghosted: those states are for layout, not values. The racks
 * get macro names, because their layout is built from them; the pattern
 * rack needs "Pattern N" as its first macro to be one.
 */
function instrumentSwapStates() {
	const macros = (names) => [
		['Device On', 'Device On', 0, 1, 1, ''],
		...names.map((n, i) => [n, n, 0, 127, 20 + i * 12, ''])
	];
	const analog = ANALOG_106_BASS.map(([n, min, max, v]) => [n, n, min, max, v, '']);
	const meld = MELD_DEFAULT.map(([n, min, max, v]) => [n, n, min, max, v, '']);
	const swaps = [
		// Live, not ghosted: the measured patch, so the shot shows its values.
		['analog', 'Analog', 'UltraAnalog', analog],
		// Voice 2 up: the other half, in blue (both its envelopes in view, ADR-477).
		['analog-voice2', 'Analog', 'UltraAnalog', analog, [{ click: '.osc-badge' }]],
		['collision', 'Collision', 'Collision'],
		['electric', 'Electric', 'LoungeLizard'],
		['meld', 'Meld', 'InstrumentMeld', meld],
		// Engine B up: the other half, in blue (both its envelopes in view, ADR-477).
		['meld-engine-b', 'Meld', 'InstrumentMeld', meld, [{ click: '.osc-badge' }]],
		// The oscillator type grid open over the Osc pad.
		['meld-osc-types', 'Meld', 'InstrumentMeld', meld, [{ click: '.engine-head .chooser-name' }]],
		// Plate picked from the filter grid: the second macro reads Ratio.
		['meld-filter-plate', 'Meld', 'InstrumentMeld', meld,
			[{ click: '.filter-col .chooser-name' }, { click: '.filter-types .type-option:nth-child(16)' }]],
		// Amp and Filter envelopes both in view (ADR-477): the Filter row takes
		// the track's ink, not Amp's orange. (An omnisphere-filter state flipped
		// the switch that showed one or the other until then.)
		['omnisphere', 'Omnisphere', 'AuPluginDevice'],
		// A plug-in named Komplete Kontrol: eight parameter boxes, two rows (ADR-477).
		['komplete-kontrol', 'Komplete Kontrol', 'AuPluginDevice'],
		// The Sampler as the rig lists it (read off a running Sampler,
		// 2026-09-27): what the view binds by name, at the ranges and values
		// Live reported — Osc and the pitch envelope off, so only their
		// switches are listed. Live, not ghosted, so its shot shows values.
		['sampler', 'Sampler', 'MultiSampler', [
			['Device On', 0, 1, 1], ['Osc On', 0, 1, 0], ['Spread', 0, 100, 0], ['Transpose', -48, 48, 0],
			['Pe On', 0, 1, 0], ['Volume', -36, 36, -12], ['Ve Attack', 0, 1, 0], ['Ve Decay', 0, 1, 0.581],
			['Ve Sustain', 0, 1, 1], ['Ve Release', 0, 1, 0.356], ['F On', 0, 1, 1], ['Filter Freq', 0, 1, 1],
			['Filter Res', 0, 1.25, 0.091]
		].map(([n, min, max, v]) => [n, n, min, max, v, ''])],
		['simpler', 'Simpler', 'OriginalSimpler'],
		['instrument-rack', 'Instrument Rack', 'InstrumentGroupDevice',
			macros(['Cutoff', 'Resonance', 'Attack', 'Release', 'Drive', 'Space', 'Macro 7', 'Macro 8'])],
		// Two macros whose first word is XY play as one pad, placed where
		// the first was — Attack between them stays a slider after it.
		['instrument-rack-xy', 'Instrument Rack', 'InstrumentGroupDevice',
			macros(['XY Cutoff', 'Attack', 'XY Res', 'Release', 'Drive', 'Space', 'Macro 7', 'Macro 8'])],
		// The picker is a fixed 2 x 3 whatever the rack names, so these two
		// differ only in what the sliders beside it do. Both say "Pattern 4":
		// the real rack (Skaka Metronome Rack) has four patterns, and the
		// picker's tab has five states counting auto.
		['pattern-rack', 'Pattern Rack', 'InstrumentGroupDevice',
			macros(['Pattern 4', 'Offset', 'Cutoff', 'Resonance', 'Attack', 'Release', 'Drive', 'Space'])],
		// The real rack's shape: macros 3-16 unnamed, so no sliders and the
		// picker takes the whole view. Offbeat is tapped on so the tour
		// shows it lit.
		['pattern-rack-only', 'Pattern Rack', 'InstrumentGroupDevice',
			macros(['Pattern 4', 'Offset', 'Macro 3', 'Macro 4', 'Macro 5', 'Macro 6', 'Macro 7', 'Macro 8']),
			[{ click: '.offbeat-button' }]]
	];
	return swaps.map(([key, name, className, params, extraSteps = []]) => ({
		name: `inst-${key}`,
		description: `${name}, swapped onto the FM track`,
		swap: { path: 'tracks/11/devices/0', name, className, params },
		steps: [openInstrument(11), ...extraSteps]
	}));
}

export function listTours() {
	return Object.keys(TOURS).map((name) => resolveTour(name));
}

export function resolveTour(name) {
	const tour = TOURS[name];
	if (!tour) {
		const known = Object.keys(TOURS).join(', ');
		throw new Error(`Unknown tour "${name}". Known tours: ${known}`);
	}
	const seen = new Set();
	const states = tour.states.map((state) => {
		if (seen.has(state.name)) throw new Error(`Tour "${name}" names state "${state.name}" twice`);
		seen.add(state.name);
		const view = resolveView(state.view ?? 'default');
		return {
			...state,
			path: view.path,
			prefs: { ...view.prefs, ...(state.prefs ?? {}) },
			...(view.features || state.features
				? { features: { ...(view.features ?? {}), ...(state.features ?? {}) } }
				: {}),
			steps: state.steps ?? [],
			crop: state.crop ?? tour.crop ?? null
		};
	});
	return { name, description: tour.description, states };
}
