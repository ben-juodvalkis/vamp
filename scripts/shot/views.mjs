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
import { DUMPED_DEVICES } from './dumpedDevices.mjs';
import { readFileSync } from 'node:fs';
import { CHAIN_DEMO_DEVICES, CHAIN_DEMO_TRACK, OMNISPHERE_STANDIN, PERMUTE_16_DEVICE, driftParams, permuteParams, setTrackDevices } from './scene.mjs';

// The rig's "106 Bass 01" Analog, all 172 parameters as the running Live
// reported them (device_dump.js, 2026-10-22): [name, min, max, value].
const ANALOG_106_BASS = JSON.parse(readFileSync(new URL('./fixtures/analog-106-bass.json', import.meta.url), 'utf8'));
// A fresh Meld's 129 parameters as the running Live listed them
// (device dump, 2026-10-22), a few moved off their defaults so the shot
// shows values: [name, min, max, value].
const MELD_DEFAULT = JSON.parse(readFileSync(new URL('./fixtures/meld-default.json', import.meta.url), 'utf8'));
// An instrument's parameters as the rig's Live listed them, at Live's
// defaults (docs/reference/instruments/dumps, measured 2026-10-27): what a
// swapped-in view binds by name, so its shot draws values, not ghosts.
const referenceParams = (instrument) =>
	JSON.parse(readFileSync(new URL(`../../docs/reference/instruments/dumps/${instrument}.json`, import.meta.url), 'utf8'))
		.parameters.map((p) => [p.name, p.original_name ?? p.name, p.min, p.max, p.value, '']);

export const DEFAULT_VIEWPORT = { width: 1366, height: 1024 };

/** iPhone 16 Pro portrait, in points: the phone layout's design size (ADR-503). */
const PHONE_VIEWPORT = { width: 393, height: 852 };
/** A tap on one of the phone layout's tabs. */
const phoneTab = (tab) => ({ click: `[data-phone-tab="${tab}"]` });

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
	// alone. The status-strip mirror is in no capture but `pad-app`'s: its
	// band is `env(safe-area-inset-top)` tall, which is 0 off the iPad.
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
	// The page as Vamp for iPad shows it: the app marks it `data-shell="pad"`
	// before its first paint (VampPadApp.swift), which gives it 16px top and
	// bottom margins (app.css `--edge-top` / `--edge-bottom`). `corners` draws
	// the screen's rounded corners over the capture (the iPad Pro 12.9"'s,
	// 18pt), so a shot shows what the glass cuts off.
	'pad-app': {
		description: 'Inside Vamp for iPad: full screen, 16px margins all round, the TotalMix mirror in the top one, the screen corners drawn.',
		prefs: {},
		shell: 'pad',
		corners: 18
	},
	'pad-app-general': {
		description: 'Vamp for iPad in the general edition: no TotalMix, so the top margin is empty.',
		prefs: {},
		shell: 'pad',
		corners: 18,
		features: { totalmix: { enabled: false, available: false, reason: '' } }
	},
	'totalmix-down': {
		description: 'TotalMix switched on but not answering — the faders greyed out, saying why.',
		prefs: { [P.transport]: '1' },
		features: { totalmix: { enabled: true, available: false, reason: 'TotalMix not answering' } }
	},
	// The phone layout (ADR-503), at an iPhone 16 Pro's 393 x 852 points. A
	// view's `viewport` is its size unless --viewport names another; its
	// `steps` run before the flags' clicks.
	phone: {
		description: 'The phone layout on an iPhone (393x852): the Mix tab, every strip full height.',
		prefs: {},
		viewport: PHONE_VIEWPORT,
		steps: [phoneTab('mix')]
	},
	'phone-clips': {
		description: 'The phone layout, Clips tab: the session grid at full height, scenes pinned right.',
		prefs: {},
		viewport: PHONE_VIEWPORT,
		steps: [phoneTab('clips')]
	},
	'phone-track': {
		description: 'The phone layout, Track tab: the selected track\'s chain, the whole tab.',
		prefs: {},
		viewport: PHONE_VIEWPORT,
		steps: [phoneTab('track')]
	},
	'phone-browse': {
		description: 'The phone layout, Browse tab: the browser\'s rail, a tap from opening full screen.',
		prefs: {},
		viewport: PHONE_VIEWPORT,
		steps: [phoneTab('browse')]
	},
	'phone-landscape': {
		description: 'The phone layout turned sideways (852x393): the Mix tab, short strips.',
		prefs: {},
		viewport: { width: 852, height: 393 },
		steps: [phoneTab('mix')]
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
// A device's view opens from its cell in the FX chain (the FX grid went with
// ADR-485): the cell whose head names the device.
const openCell = (name) => ({ click: `.chain-cell:has(.cell-head .name:text-is("${name}"))` });

// Each device view, from its chain cell: the device on the Lead track's chain
// (after its instrument), then its cell tapped. [device, state, description]
const FX_VIEWS = [
	['Random', 'random', 'Random view'],
	['Channel EQ', 'eq', 'Channel EQ'],
	['Auto Filter', 'filter', 'Auto Filter'],
	['Saturator', 'pedal', 'The Saturator view: Color · Output · Mix'],
	['Guitar', 'guitar', 'The Guitar rack view: Gain, Spring/Room, Tremolo'],
	['Drum Buss', 'drum-buss', 'Drum Buss: the Drum XY, then its controls'],
	['Glue Compressor', 'squash', 'Glue: Threshold over Output'],
	['GlitchLoop', 'glitch', 'Glitch: GlitchLoop'],
	['Pitch Hack', 'reverse', 'Pitch Hack (Reverse): Rate tabs, then a value box per parameter'],
	['Octave', 'pitch', 'The Octave (Pitch Shift) view: Pitch, Response and Quality tabs, Tone'],
	['Variation', 'variation', 'Variation (Beat Repeat): Stutter, Interval, Grid, Length, Mode'],
	['Auto Pan Legacy', 'tremolo', 'Auto Pan Legacy (Tremolo)'],
	['Echo', 'echo', 'Echo'],
	['Reverb', 'reverb', 'Reverb']
];

/** Open Settings from the master strip's gear. */
const chainDemo = (scene) => setTrackDevices(scene, CHAIN_DEMO_TRACK, CHAIN_DEMO_DEVICES);
// Chains of other lengths, for the adaptive layout: the instrument, then effects.
/** Live's Shifter as the rig dumped it (2026-10-26), in Ring with a drive and a slow LFO. */
const SHIFTER_PARAMS = [
	['Device On', 0, 1, 1, 'On'], ['LFO Amt Hz', 0, 1, 0.3, '58.1 Hz'], ['LFO Amt St', 0, 1, 0, '0.00 st'], ['LFO Wave', 0, 9, 1, 'Triangle'],
	['LFO Sync', 0, 1, 0, 'Off'], ['LFO Freq', 0, 1, 0.46, '0.50 Hz'], ['LFO Synced', 0, 21, 12, '1/4'], ['LFO Stereo Mode', 0, 1, 1, 'Spin'],
	['LFO Phase', 0, 1, 0.5, '180°'], ['LFO Spin', 0, 1, 0, '0.0 %'], ['LFO Offset', 0, 1, 0, '0.0°'], ['LFO Width', 0, 1, 0, '0.0 %'],
	['LFO Morph', 0, 1, 0.5, '0.0 %'], ['Pitch Coarse', -24, 24, 7, '7 st'], ['Pitch Fine', 0, 1, 0.5, '0 ct'], ['Pitch Window', 0, 1, 0.59, '80.0 ms'],
	['Mod Fine', 0, 1, 0.5, '0.00 Hz'], ['FShift Coarse', 0, 1, 0.62, '1.20 kHz'], ['RM Coarse', 0, 1, 0.5, '100 Hz'], ['RM Drive', 0, 1, 1, 'On'],
	['RM Drive Gain', 0, 1, 0.4, '9.6 dB'], ['MidiPitch Glide', 0, 1, 0, '0.00 ms'], ['Env On', 0, 1, 0, 'Off'], ['Env Attack', 0, 1, 0.2, '6.00 ms'],
	['Env Release', 0, 1, 0.5, '200 ms'], ['Env Amount Hz', 0, 1, 0.5, '0.00 Hz'], ['Env Amount St', 0, 1, 0.5, '0.00 st'], ['Delay On', 0, 1, 0, 'Off'],
	['Delay Sync', 0, 1, 1, 'On'], ['Delay Time', 0, 1, 0.35, '250 ms'], ['Delay Synced', 0, 17, 9, '1/4'], ['Delay Feedback', 0, 1, 0, '0.0 %'],
	['Mode', 0, 2, 2, 'Ring'], ['Tone', 0, 1, 0.75, '9.45 kHz'], ['Wide', 0, 1, 0, 'Off'], ['Dry/Wet', 0, 1, 0.8, '80 %']
].map(([name, ...rest]) => [name, name, ...rest]);
const chainOf = (n) => (scene) =>
	setTrackDevices(scene, CHAIN_DEMO_TRACK, [CHAIN_DEMO_DEVICES[0], 'Auto Filter', 'Echo', 'Reverb', CHAIN_DEMO_DEVICES[5], 'Auto Filter', CHAIN_DEMO_DEVICES[7], CHAIN_DEMO_DEVICES[8]].slice(0, n));
const chainCell = (index) => `[data-device-path="tracks/${CHAIN_DEMO_TRACK}/devices/${index}"]`;
const SETTINGS_OPEN = [{ click: '[data-debug="master-card"]' }, { click: '[data-debug="settings-gear"]', dom: true }];

// Devices with no grid tile, each opening its own view from its chain cell.
const CHAIN_VIEW_DEVICES = [
		['shifter', { name: 'Shifter', className: 'Shifter', params: SHIFTER_PARAMS }],
		['comb', { name: 'Comb', className: 'MxDeviceAudioEffect', params: [['Device On', 0, 1, 1, ''], ['Tune', -24, 24, 0, '0 st'], ['Mix', 0, 100, 17.58, '17.6 %'], ['Feedback', -100, 100, 17.58, '17.6 %'], ['Amount', 0, 24, 7, '+7 st'], ['Rate', 0.01, 2, 1.587, '1.00 Hz'], ['Sync Rate', 0, 15, 7, '1/4'], ['Shape', 0, 6, 1, 'Triangle'], ['Sync', 0, 1, 0, 'val1']].map(([name, ...rest]) => [name, name, ...rest]) }],
		// Chord's 29 parameters as device_dump read them (2026-10-27): two notes added, a strum.
		['chord', { name: 'Chord', className: 'MidiChord', params: [['Device On', 0, 1, 1, ''], ...[[12, 0.8, 1], [7, 1.2, 0.5], [0, 1, 1], [0, 1, 1], [0, 1, 1], [0, 1, 1]].flatMap(([st, vel, ch], i) => [[`Shift${i + 1}`, -36, 36, st, `${st > 0 ? '+' : ''}${st} st`], [`Shift${i + 1} Scale Degrees`, -36, 36, 0, '0 sd'], [`Velocity${i + 1}`, 0.01, 2, vel, `${Math.round(vel * 100)} %`], [`Chance${i + 1}`, 0, 1, ch, `${Math.round(ch * 100)} %`]]), ['Strum', -20, 20, 6, '36.0 ms'], ['Strum Tension', -100, 100, 0, '0 %'], ['Strum Crescendo', -100, 100, 0, '0 %'], ['Use Current Scale', 0, 1, 0, 'Off']].map(([name, ...rest]) => [name, name, ...rest]) }],
		['chance', { name: 'Note Chance', className: 'MxDeviceMidiEffect', params: [['Device On', 'Device On', 0, 1, 1, ''], ['Chance', 'Chance', 0, 100, 60, '60 %']] }],
		['chorus', { name: 'Chorus-Ensemble', className: 'Chorus2', params: [['Device On', 'Device On', 0, 1, 1, ''], ['Mode', 'Mode', 0, 2, 0, 'Chorus'], ['Shape', 'Shape', 0, 1, 0, ''], ['Rate', 'Rate', 0, 1, 0.42, '1.20 Hz'], ['Amount', 'Amount', 0, 1, 0.6, '60 %'], ['Feedback', 'Feedback', 0, 1, 0.25, '25 %'], ['FB Invert', 'FB Invert', 0, 1, 0, ''], ['Offset', 'Offset', 0, 1, 0, ''], ['Delay Time', 'Delay Time', 0, 5, 2, ''], ['Delay Taps', 'Delay Taps', 0, 1, 1, ''], ['HP On', 'HP On', 0, 1, 0, ''], ['HP Freq', 'HP Freq', 0, 1, 0.28, ''], ['Width', 'Width', 0, 1, 0.7, '140 %'], ['Warmth', 'Warmth', 0, 1, 0.3, '9.0 %'], ['Output', 'Output', 0, 1, 0.71, ''], ['Dry/Wet', 'Dry/Wet', 0, 1, 0.5, '50 %']] }],
		['redux', { name: 'Redux', className: 'Redux2', params: [['Device On', 'Device On', 0, 1, 1, ''], ['Sample Rate', 'Sample Rate', 0, 1, 0.62, '9.08 kHz'], ['Jitter', 'Jitter', 0, 1, 0.2, '4.0 %'], ['Bit Depth', 'Bit Depth', 1, 16, 8, '8'], ['Quantizer Shape', 'Quantizer Shape', 0, 1, 0.35, '35 %'], ['DC Shift', 'DC Shift', 0, 1, 0, 'Off'], ['Pre-Filter On', 'Pre-Filter On', 0, 1, 1, 'On'], ['Post-Filter On', 'Post-Filter On', 0, 1, 1, 'On'], ['Post-Filter', 'Post-Filter', 0, 1, 0.5, '0.00'], ['Dry/Wet', 'Dry/Wet', 0, 1, 0.8, '80 %']] }],
		...['autoPanTremolo', 'eq8', 'delay', 'limiter'].map((key) => [key, DUMPED_DEVICES[key]]),
		['multiband', DUMPED_DEVICES.multiband],
		// Roar in Serial: two stages run, the third ghosts (ADR-515).
		['roar', { ...DUMPED_DEVICES.roar, properties: { routing_mode_index: 1 } }]
];

// The views no other state reaches (layout audit, 2026-10-27), opened from
// their chain cell like `chain-view-*`. Only the parameters a view needs to
// draw, often just Device On: these states are for layout, not values.
const VIEW_ONLY_DEVICES = [
	['compressor', { name: 'Compressor', className: 'Compressor2', params: [['Device On', 'Device On', 0, 1, 1, '']] }],
	['gate', { name: 'Gate', className: 'Gate', params: [['Device On', 'Device On', 0, 1, 1, ''], ['Threshold', 'Threshold', 0, 1, 0.55, ''], ['Attack', 'Attack', 0.02, 150, 3.5, ''], ['Hold', 'Hold', 0, 1, 0.31, ''], ['Release', 'Release', 0, 1, 0.35, '']] }],
	['phaser', DUMPED_DEVICES.phaser],
	['utility', { name: 'Utility', className: 'StereoGain', params: [['Device On', 'Device On', 0, 1, 1, ''], ['Left Inv', 'Left Inv', 0, 1, 0, 'Off'], ['Right Inv', 'Right Inv', 0, 1, 0, 'Off'], ['Channel Mode', 'Channel Mode', 0, 3, 1, 'Stereo'], ['Stereo Width', 'Stereo Width', 0, 2, 1.25, '130 %'], ['Mono', 'Mono', 0, 1, 0, 'Off'], ['Bass Mono', 'Bass Mono', 0, 1, 1, 'On'], ['Bass Freq', 'Bass Freq', 0, 1, 0.38, '120 Hz'], ['Balance', 'Balance', -1, 1, -0.2, '10L'], ['Output', 'Output', -1, 1, -0.07, '-2.42 dB'], ['Mute', 'Mute', 0, 1, 0, 'Off'], ['DC Filter', 'DC Filter', 0, 1, 0, 'Off']] }],
	['arpeggiator', { name: 'Arpeggiator', className: 'MidiArpeggiator', params: [['Device On', 'Device On', 0, 1, 1, ''], ['Style', 'Style', 0, 17, 0, 'Up'], ['Offset', 'Offset', -8, 8, 0, '0'], ['Repeats', 'Repeats', 0, 16, 0, ''], ['Sync On', 'Sync On', 0, 1, 1, 'On'], ['Synced Rate', 'Synced Rate', 0, 13, 8, '1/8'], ['Groove', 'Groove', 0, 3, 0, ''], ['Free Rate', 'Free Rate', 0, 1, 0.15, ''], ['Gate', 'Gate', 1, 200, 120, '120 %']] }],
	['velocity', { name: 'Velocity', className: 'MidiVelocity', params: [['Device On', 'Device On', 0, 1, 1, ''], ['Drive', 'Drive', -1, 1, 0, ''], ['Compand', 'Compand', -1, 1, 0, ''], ['Random', 'Random', 0, 64, 40, '40'], ['Mode', 'Mode', 0, 2, 0, ''], ['Operation', 'Operation', 0, 2, 2, ''], ['Out Hi', 'Out Hi', 0, 127, 110, ''], ['Out Low', 'Out Low', 0, 127, 30, '']] }],
	['tone-shaper', { name: "Ben's Adaptive Tone Shaper", className: 'MxDeviceAudioEffect', params: [['Device On', 'Device On', 0, 1, 1, '']] }],
	['blur', { name: 'Blur', className: 'MxDeviceAudioEffect', params: [['Device On', 'Device On', 0, 1, 1, '']] }],
	['wah', { name: 'Wah', className: 'AudioEffectGroupDevice', params: [['Device On', 'Device On', 0, 1, 1, '']] }],
	['bass', { name: 'Bass Amp', className: 'AudioEffectGroupDevice', params: [['Device On', 'Device On', 0, 1, 1, '']] }],
	['pedal', { name: 'Pedal', className: 'Pedal', params: [['Device On', 'Device On', 0, 1, 1, ''], ['Type', 'Type', 0, 2, 0, ''], ['Drive', 'Drive', 0, 1, 0.6, ''], ['Output', 'Output', -20, 20, 0, ''], ['Bass', 'Bass', -1, 1, 0, ''], ['Mid', 'Mid', -1, 1, 0, ''], ['Treble', 'Treble', -1, 1, 0, ''], ['Mid Freq', 'Mid Freq', 0, 2, 1, ''], ['Sub', 'Sub', 0, 1, 0, ''], ['Dry/Wet', 'Dry/Wet', 0, 1, 1, '']] }]
];

const chunk = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const faceName = (d) => (typeof d === 'string' ? d : d.name);
const viewOnly = (key) => VIEW_ONLY_DEVICES.find(([k]) => k === key)[1];
const chainView = (key) => CHAIN_VIEW_DEVICES.find(([k]) => k === key)[1];
const MIDI_WHEELS_DEVICE = { name: 'MidiWheels', className: 'MxDeviceMidiEffect' };
/** The `faces` tour's chains: [group, track, devices], an instrument first where the faces need one. */
const FACE_GROUPS = [
	// The grid's tiles (ChainOverview's TILE_COMPONENTS).
	['tiles', CHAIN_DEMO_TRACK, [
		'Random', 'Channel EQ', 'Auto Filter', 'Saturator', 'Drum Buss', viewOnly('utility'), 'Variation', chainView('chorus'),
		'Auto Pan Legacy', 'Echo', 'Reverb', 'Guitar', viewOnly('bass'), 'Octave', 'GlitchLoop', 'Glue Compressor'
	]],
	// deviceControls entries with no grid tile (ControlTile).
	['controls', CHAIN_DEMO_TRACK, [
		viewOnly('pedal'), viewOnly('gate'), viewOnly('compressor'), chainView('multiband'), viewOnly('velocity'), viewOnly('arpeggiator'), chainView('chord'), chainView('redux'),
		viewOnly('phaser'), chainView('shifter'), chainView('comb'), chainView('chance'), viewOnly('wah'), 'Pitch Hack', viewOnly('tone-shaper'), viewOnly('blur')
	]],
	// The instruments' faces, Permute, the wheels, a rack's macros, the marks.
	['omni', CHAIN_DEMO_TRACK, [MIDI_WHEELS_DEVICE, OMNISPHERE_STANDIN, CHAIN_DEMO_DEVICES[1], CHAIN_DEMO_DEVICES[5], CHAIN_DEMO_DEVICES[8], CHAIN_DEMO_DEVICES[7], { name: 'Mystery', className: 'MxDeviceAudioEffect' }, 'Echo']],
	['drift', CHAIN_DEMO_TRACK, [{ name: 'Drift', params: driftParams() }, CHAIN_DEMO_DEVICES[1], MIDI_WHEELS_DEVICE, 'Echo', 'Reverb', 'Auto Filter', CHAIN_DEMO_DEVICES[5], 'Saturator']],
	['wavetable', CHAIN_DEMO_TRACK, [CHAIN_DEMO_DEVICES[0], CHAIN_DEMO_DEVICES[1], 'Echo', 'Reverb', 'Auto Filter', CHAIN_DEMO_DEVICES[5], 'Saturator', 'Drum Buss']],
	['meld', CHAIN_DEMO_TRACK, [{ name: 'Meld', className: 'InstrumentMeld', params: referenceParams('Meld') }, 'Echo', 'Reverb', 'Auto Filter', CHAIN_DEMO_DEVICES[5], 'Saturator', 'Drum Buss', 'Channel EQ']],
	// Analog: its pad draws Filter 1's response curve (2026-11-07).
	['analog', CHAIN_DEMO_TRACK, [{ name: 'Analog', className: 'UltraAnalog', params: referenceParams('Analog') }, 'Echo', 'Reverb', 'Auto Filter', CHAIN_DEMO_DEVICES[5], 'Saturator', 'Drum Buss', 'Channel EQ']],
	['simpler', CHAIN_DEMO_TRACK, ['Simpler', 'Echo', 'Reverb', 'Auto Filter', CHAIN_DEMO_DEVICES[5], 'Saturator', 'Drum Buss', 'Channel EQ']],
	['kit', 0, [{ name: 'Drum-Rack', padChains: { 50: ['Echo'] } }, 'Compressor', 'Auto Pan Legacy', 'Echo', 'Reverb', 'Auto Filter', 'Saturator', 'Drum Buss']]
];

export const TOURS = {
	// The FX section's second face (the chain overview, a mock-up for Ben,
	// 2026-10-25): the Lead track carries CHAIN_DEMO_DEVICES — two Auto
	// Filters, two racks of the performer's, a plug-in.
	chain: {
		description: 'The FX chain overview, on a track with two Auto Filters, two racks and a plug-in.',
		states: [
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
				description: 'MidiWheels ahead of the instrument: its cell carries the pitch and mod wheels, side by side',
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
				name: 'chain-permute-16-two-rows',
				description: 'A 16-step Permute on a two-row chain: four lines of four, the squarest the cell allows, still live for a swipe',
				scenePatch: (scene) =>
					setTrackDevices(scene, CHAIN_DEMO_TRACK, [CHAIN_DEMO_DEVICES[0], PERMUTE_16_DEVICE, ...CHAIN_DEMO_DEVICES.slice(2, 7)]),
				steps: [openInstrument(CHAIN_DEMO_TRACK)]
			},
			{
				name: 'chain-permute-8-two-rows',
				description: 'An 8-step Permute on the same two-row chain: two lines of four',
				scenePatch: (scene) =>
					setTrackDevices(scene, CHAIN_DEMO_TRACK, [CHAIN_DEMO_DEVICES[0], CHAIN_DEMO_DEVICES[1], ...CHAIN_DEMO_DEVICES.slice(2, 7)]),
				steps: [openInstrument(CHAIN_DEMO_TRACK)]
			},
			{
				name: 'chain-permute-16-one-row',
				description: 'A 16-step Permute in a one-row chain\'s medium cell: four lines of four',
				scenePatch: (scene) => setTrackDevices(scene, CHAIN_DEMO_TRACK, [CHAIN_DEMO_DEVICES[0], PERMUTE_16_DEVICE, 'Echo']),
				steps: [openInstrument(CHAIN_DEMO_TRACK)]
			},
			{
				name: 'chain-permute-16-crowded',
				description: 'A 16-step Permute in a crowded two-row chain\'s small, narrow cell: the mute lane alone, four lines of four, the squarest the cell allows',
				scenePatch: (scene) =>
					setTrackDevices(scene, CHAIN_DEMO_TRACK, [
						CHAIN_DEMO_DEVICES[0],
						PERMUTE_16_DEVICE,
						...CHAIN_DEMO_DEVICES.slice(2, 7),
						'Reverb', 'Saturator', 'Redux', 'Chorus', 'Gate', 'Compressor', 'Phaser', 'Shifter', 'Utility'
					]),
				steps: [openInstrument(CHAIN_DEMO_TRACK)]
			},
			{
				name: 'chain-permute-13-crowded',
				description: 'A 13-step Permute in the crowded chain\'s narrow cell: four lines of four, the last holding one step and three empty slots',
				scenePatch: (scene) =>
					setTrackDevices(scene, CHAIN_DEMO_TRACK, [
						CHAIN_DEMO_DEVICES[0],
						{ name: 'Permute', params: permuteParams({ mute: [1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1], pitch: [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0], muteLength: 13, pitchLength: 13 }) },
						...CHAIN_DEMO_DEVICES.slice(2, 7),
						'Reverb', 'Saturator', 'Redux', 'Chorus', 'Gate', 'Compressor', 'Phaser', 'Shifter', 'Utility'
					]),
				steps: [openInstrument(CHAIN_DEMO_TRACK)]
			},
			{
				name: 'chain-permute-7-two-rows',
				description: 'A 7-step Permute on a two-row chain: two lines, four over three and an empty slot',
				scenePatch: (scene) =>
					setTrackDevices(scene, CHAIN_DEMO_TRACK, [CHAIN_DEMO_DEVICES[0], { name: 'Permute', params: permuteParams({ mute: [1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1], pitch: [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0], muteLength: 7, pitchLength: 7 }) }, ...CHAIN_DEMO_DEVICES.slice(2, 7)]),
				steps: [openInstrument(CHAIN_DEMO_TRACK)]
			},
			{
				name: 'chain-permute-8-one-row',
				description: 'An 8-step Permute in a one-row chain\'s medium cell: both lanes fit at 44px, two lines of four each, mute over pitch',
				scenePatch: (scene) => setTrackDevices(scene, CHAIN_DEMO_TRACK, [CHAIN_DEMO_DEVICES[0], CHAIN_DEMO_DEVICES[1], 'Echo']),
				steps: [openInstrument(CHAIN_DEMO_TRACK)]
			},
			{
				name: 'chain-permute-16-wide',
				description: 'The same Permute in a wide, tall cell: sixteen steps a lane do not fit twice at 44px, so the mute lane takes the cell',
				scenePatch: (scene) => setTrackDevices(scene, CHAIN_DEMO_TRACK, [PERMUTE_16_DEVICE, 'Echo']),
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
				name: 'chain-rack',
				description: 'Tapped the Dub Space rack: its macros in the central view',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK), { click: chainCell(5) }]
			},
			{
				name: 'chain-power',
				description: 'Tapped the Echo cell\'s header: Echo off (dimmed, its bar bare); Grit was off already',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK), { click: `${chainCell(4)} .cell-head .name` }]
			},
			{
				name: 'chain-dragging',
				description: 'Reverb mid-drag up to third place, still held: the cell itself rides the finger and the cells after it have slid along, out of its way',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK), { drag: `${chainCell(6)} .cell-head .name`, by: [200, -240], keep: true }]
			},
			{
				name: 'chain-xy-tap',
				description: 'A finger-slow tap (350 ms) on an Auto Filter cell\'s XY: its view opens and the hand moves to it',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK), { press: `${chainCell(3)} .cell-control`, ms: 350 }]
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
				steps: [openInstrument(8)]
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
			...CHAIN_VIEW_DEVICES.map(([key, device]) => ({
				name: `chain-view-${key}`,
				description: `Tapped the ${device.name} cell: its own view, the control its browser tiles and chain cell draw`,
				scenePatch: (scene) => setTrackDevices(scene, CHAIN_DEMO_TRACK, [CHAIN_DEMO_DEVICES[0], device]),
				steps: [openInstrument(CHAIN_DEMO_TRACK), { click: `${chainCell(1)}` }, { wait: 500 }]
			})),
			// Full screen (ADR-511, ADR-515): an effect's board, every section at once.
			...[
				['roar', { ...DUMPED_DEVICES.roar, properties: { routing_mode_index: 1 } }],
				['roar-multiband', { ...DUMPED_DEVICES.roar, properties: { routing_mode_index: 3 } }],
				['multiband', DUMPED_DEVICES.multiband]
			].map(([key, device]) => ({
				name: `chain-board-${key}`,
				description: `The ${device.name} view at full screen: its board`,
				scenePatch: (scene) => setTrackDevices(scene, CHAIN_DEMO_TRACK, [CHAIN_DEMO_DEVICES[0], device]),
				steps: [openInstrument(CHAIN_DEMO_TRACK), { click: `${chainCell(1)}` }, { wait: 500 }, { click: '[data-central-expand]' }, { wait: 400 }]
			})),
			// An instrument's cell carries its view's signature control (INSTRUMENT_CONTROLS).
			...[
				['wavetable', CHAIN_DEMO_TRACK, null],
				// The scene's Simpler sits on an audio track, which claims no instrument: put one on the MIDI demo track.
				['simpler', CHAIN_DEMO_TRACK, ['Simpler', 'Echo']],
				['operator', 11, null]
			].map(([key, track, devices]) => ({
				name: `chain-instrument-${key}`,
				description: `The ${key} track's chain: its instrument cell draws its view's signature control`,
				...(devices ? { scenePatch: (scene) => setTrackDevices(scene, track, devices) } : {}),
				steps: [openInstrument(track)]
			})),
			// Grain Delay's XY on its cell: Pitch across (+7 st), Feedback up.
			{
				name: 'chain-grain-delay',
				description: 'A Grain Delay on the chain, its view open: Pitch across (+7 st), Feedback up (47 %); the view Grain, Delay and Mix',
				scenePatch: (scene) =>
					setTrackDevices(scene, CHAIN_DEMO_TRACK, [
						CHAIN_DEMO_DEVICES[0],
						{ name: 'Grain Delay', className: 'GrainDelay', params: [['Device On', 'Device On', 0, 1, 1, ''], ['Spray', 'Spray', 0, 1, 0, '0.00 ms'], ['Frequency', 'Frequency', 0, 1, 0.817, '60.0 Hz'], ['Pitch', 'Pitch', -36, 12, 7, '7.00'], ['Random', 'Random', 0, 1, 0, '0.00'], ['Feedback', 'Feedback', 0, 0.95, 0.475, '47 %'], ['DryWet', 'DryWet', 0, 1, 1, '100 %']] },
						'Echo'
					]),
				steps: [openInstrument(CHAIN_DEMO_TRACK), { wait: 500 }, { click: chainCell(1) }, { wait: 800 }]
			},
			// The MIDI effects' controls on their chain cells (deviceControls).
			{
				name: 'chain-midi-effects',
				description: 'An Arpeggiator (Rate across, Gate up), a Chord (its first shift) and a Velocity (Rand Vel) on the chain',
				scenePatch: (scene) =>
					setTrackDevices(scene, CHAIN_DEMO_TRACK, [
						{ name: 'Arpeggiator', className: 'MidiArpeggiator', params: [['Device On', 'Device On', 0, 1, 1, ''], ['Style', 'Style', 0, 17, 0, 'Up'], ['Offset', 'Offset', -8, 8, 0, '0'], ['Repeats', 'Repeats', 0, 16, 0, ''], ['Sync On', 'Sync On', 0, 1, 1, 'On'], ['Synced Rate', 'Synced Rate', 0, 13, 8, '1/8'], ['Groove', 'Groove', 0, 3, 0, ''], ['Free Rate', 'Free Rate', 0, 1, 0.15, ''], ['Gate', 'Gate', 1, 200, 120, '120 %']] },
						{ name: 'Chord', className: 'MidiChord', params: [['Device On', 'Device On', 0, 1, 1, ''], ['Shift1', 'Shift1', -36, 36, 7, '+7 st']] },
						{ name: 'Velocity', className: 'MidiVelocity', params: [['Device On', 'Device On', 0, 1, 1, ''], ['Drive', 'Drive', -1, 1, 0, ''], ['Compand', 'Compand', -1, 1, 0, ''], ['Random', 'Random', 0, 64, 40, '40'], ['Mode', 'Mode', 0, 2, 0, ''], ['Operation', 'Operation', 0, 2, 2, ''], ['Out Hi', 'Out Hi', 0, 127, 110, ''], ['Out Low', 'Out Low', 0, 127, 30, '']] },
						CHAIN_DEMO_DEVICES[0]
					]),
				steps: [openInstrument(CHAIN_DEMO_TRACK), { click: `${chainCell(2)}` }, { wait: 500 }]
			},
			{
				name: 'chain-pad-add',
				description: 'Jazz, pad 38 latched: + Effect, then Gate picked in the browser lands in the pad\'s chain (needs --real-data for the effects Place)',
				steps: [
					openInstrument(8),
					{ click: '.pad-tile[data-note="38"]' },
					{ click: '[data-debug="chain-add"]' },
					{ wait: 2500 },
					{ click: '.preset-tile:has-text("Gate")' },
					{ wait: 2500 }
				]
			},
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
			// The palette under the chain: fixed ghost effects for each kind of
			// track, MIDI on the left, audio on the right, then +.
			...[
				['chain-palette-kit', 'a Drum Rack track: Arpeggiator, Note Chance and Velocity; Drum Buss after the shared ten', openInstrument(0)],
				['chain-palette-instrument', 'an instrument track: Chord and Random join the MIDI effects; Pedal and Roar after the shared ten', openInstrument(CHAIN_DEMO_TRACK)],
				['chain-palette-audio', 'an audio track: the MIDI slots empty; the amps after the shared ten', selectTrack(3)]
			].map(([name, what, select]) => ({
				name,
				description: `The chain's palette: ${what}`,
				steps: [select, { wait: 500 }]
			})),
			{
				name: 'chain-palette-long',
				description: "The chain's palette over a chain on two rows: one row of chips, the kind's extras gone",
				scenePatch: chainOf(8),
				steps: [openInstrument(CHAIN_DEMO_TRACK), { wait: 500 }]
			},
			{
				name: 'chain-plugin',
				description: 'Tapped the plug-in: the generic view, one slider per parameter',
				scenePatch: chainDemo,
				steps: [openInstrument(CHAIN_DEMO_TRACK), { click: chainCell(8) }]
			}
		]
	},

	// Every chain face at the sizes a chain gives it (ADR-492): four devices
	// are one row of tall cells, eight two rows of short ones. The width
	// follows the viewport: the iPad's 1366 gives medium cells, 2200 wide,
	// 900 narrow.
	faces: {
		description: 'Every face the chain draws, in one-row (tall) and two-row (short) chains, cropped to the chain.',
		states: FACE_GROUPS.flatMap(([group, track, devices]) => [
			...chunk(devices, 4).map((four, i) => ({
				name: `faces-${group}-tall-${i + 1}`,
				description: `${group}, one row: ${four.map(faceName).join(', ')}`,
				crop: '.chain-wrap',
				scenePatch: (scene) => setTrackDevices(scene, track, four),
				steps: [openInstrument(track)]
			})),
			...chunk(devices, 8).map((eight, i) => ({
				name: `faces-${group}-short-${i + 1}`,
				description: `${group}, two rows: ${eight.map(faceName).join(', ')}`,
				crop: '.chain-wrap',
				scenePatch: (scene) => setTrackDevices(scene, track, eight),
				steps: [openInstrument(track)]
			}))
		])
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
				description: 'Clip view, audio track, the bridge not ready to record — REC greyed out, saying why',
				features: { captureRecorder: { enabled: true, available: false, reason: 'Waiting for the bridge' } },
				steps: [selectTrack(3)]
			},
			{ name: 'clip-session', view: 'session', description: 'Clip view with CLIPS on — no mini column' },
			// The note editor is the full screen's (ADR-528): the controls in
			// one strip over it, the right sidebar beside it (ADR-527). Fold on
			// (its default) and off.
			{ name: 'clip-notes', description: 'Clip view at full screen: controls over the note editor, Fold on (ADR-526..528)', steps: [{ click: '[data-central-expand]' }, { wait: 400 }] },
			{ name: 'clip-audio-full', description: 'Audio clip at full screen: controls over the waveform (ADR-526)', steps: [selectTrack(3), { click: '[data-central-expand]' }, { wait: 400 }] },
			{
				name: 'clip-notes-session',
				view: 'session',
				description: 'Note editor at full screen with CLIPS on',
				steps: [{ click: '[data-central-expand]' }, { wait: 400 }]
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
				// Drums is the selected track, so a Clip tap on its strip takes
				// the Clip view to full screen (TrackStrip `clipViewUp`).
				steps: [selectTrack(0)]
			},
			{
				name: 'clip-notes-drums-solo',
				description: 'The same, the Ride row soloed by a tap on its name: lit in its own colour',
				session: { '/looping/v3/clip/focused': ['tracks/0/slots/0/clip'] },
				steps: [selectTrack(0), { wait: 400 }, { click: '.pitch-gutter .key:has-text("Ride")' }]
			},
			{
				name: 'clip-notes-unfolded',
				description: 'Note editor, Fold off',
				steps: [{ click: '[data-central-expand]' }, { wait: 400 }, { click: '.edit-chip:has-text("Fold")' }]
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
				scenePatch: (scene) => setTrackDevices(scene, CHAIN_DEMO_TRACK, [CHAIN_DEMO_DEVICES[0], 'Guitar']),
				steps: [openInstrument(CHAIN_DEMO_TRACK), openCell('Guitar')]
			},
			// The Gtr tile opens the Guitar rack's view (one device per view
			// since 2026-10-26). On the Guitar track (an audio track) the rack
			// is loaded.
			{
				name: 'fx-guitar-loaded',
				description: 'Guitar view on the Guitar track: the Guitar rack live — Spring, Tremolo pad, Room',
				steps: [selectTrack(3), openCell('Guitar')]
			},
			...FX_VIEWS.map(([device, name, description]) => ({
				name: `fx-${name}`,
				description,
				scenePatch: (scene) => setTrackDevices(scene, CHAIN_DEMO_TRACK, [CHAIN_DEMO_DEVICES[0], device]),
				steps: [openInstrument(CHAIN_DEMO_TRACK), openCell(device)]
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
				steps: [selectTrack(5), openCell('Reverb'), { click: `[data-reverb-type="${algo}"]` }, ...drags]
			})),
			// The EQ tab (2026-10-02): the rig's own EQ — Lo Cut at 121 Hz, 18 dB,
			// Hi Shelf at 5 kHz — then shaped by dragging the handles, as a finger
			// would, and the Hi end switched to a cut.
			{
				name: 'fx-reverb-eq',
				description: 'Reverb, EQ tab: the rig’s EQ — Lo Cut 121 Hz 18 dB, the peaks flat, Hi Shelf 5 kHz',
				steps: [selectTrack(5), openCell('Reverb'), { click: '[data-reverb-type="Hall"]' }, { click: '[data-reverb-tab="eq"]' }]
			},
			{
				name: 'fx-reverb-eq-shaped',
				description: 'Reverb, EQ tab: Peak 1 dragged up, Peak 2 down and higher, the Hi end switched to Cut',
				steps: [
					selectTrack(5),
					openCell('Reverb'),
					{ click: '[data-reverb-type="Hall"]' },
					{ click: '[data-reverb-tab="eq"]' },
					{ drag: '[data-eq-band="peak1"]', by: [-20, -45] },
					{ drag: '[data-eq-band="peak2"]', by: [40, 35] },
					{ click: '[data-reverb-eq-types] [data-reverb-switch="43"]' }
				]
			},
			// Convolution: the IR the button loads, then shaped by its Attack and
			// Decay boxes. Its waveform (from Live's own file, `/api/reverb-ir`)
			// is drawn on the Reverb tile since ADR-477, not in this view.
			{
				name: 'fx-reverb-ir-spring',
				description: 'Reverb, Spring: Live’s “Awesome Stereo Spring” IR, unshaped',
				steps: [selectTrack(5), openCell('Reverb'), { click: '[data-reverb-type="Spring"]' }]
			},
			{
				name: 'fx-reverb-ir-plate',
				description: 'Reverb, Plate: Live’s “Classic Plate 1” IR',
				steps: [selectTrack(5), openCell('Reverb'), { click: '[data-reverb-type="Plate"]' }]
			},
			{
				name: 'fx-reverb-ir-shaped',
				description: 'Reverb, Spring, Attack up and Decay down: Attack fades it in, Decay cuts the tail',
				steps: [
					selectTrack(5),
					openCell('Reverb'),
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
					openCell('Reverb'),
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
					openCell('Reverb'),
					{ click: '[data-reverb-type="Spring"]' },
					{ drag: '[data-reverb-own] [role="slider"][aria-label^="Size"]', by: [0, -73] }
				]
			},
			{
				name: 'fx-reverb-ir-eq',
				description: 'Reverb, Spring on its EQ tab: the same editor and EQ rows as an algorithm’s',
				steps: [selectTrack(5), openCell('Reverb'), { click: '[data-reverb-type="Spring"]' }, { click: '[data-reverb-tab="eq"]' }]
			},
			{
				name: 'fx-reverb-frozen',
				description: 'Reverb, Hall with Freeze on: every band holds to the edge',
				steps: [selectTrack(5), openCell('Reverb'), { click: '[data-reverb-type="Hall"]' }, { click: '[data-reverb-switch="8"]' }]
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
			// Osc 2 up by touching its level box (off in this patch, so ghosted);
			// both envelopes are always in view (ADR-477).
			{
				name: 'inst-wavetable-osc2',
				description: 'Wavetable (Bass), Osc 2',
				steps: [openInstrument(1), { click: '[role="slider"][aria-label^="Osc 2:"]' }]
			},
			// Filter 2 up: a press on its dot, which also switches it on (ADR-507).
			// `force`: the dot takes no pointer, so the press lands on the pad there.
			{
				name: 'inst-wavetable-flt2',
				description: 'Wavetable (Bass), Filter 2',
				steps: [openInstrument(1), { click: '.graph-dot[data-dot="2"]', force: true }]
			},
			{ name: 'inst-drift', description: 'Drift (Keys)', steps: [openInstrument(2)] },
			// No single-Simpler state: the scene's only Simpler is on Texture, an
			// AUDIO track, and audio tracks draw no instrument tile to open it from.
			{ name: 'inst-operator', description: 'Operator (FM)', steps: [openInstrument(11)] },
			...instrumentSwapStates(),
			...[...CHAIN_VIEW_DEVICES, ...VIEW_ONLY_DEVICES].map(([key, device]) => ({
				name: `view-${key}`,
				description: `${device.name}, opened from its chain cell`,
				scenePatch: (scene) => setTrackDevices(scene, CHAIN_DEMO_TRACK, [CHAIN_DEMO_DEVICES[0], device]),
				steps: [openInstrument(CHAIN_DEMO_TRACK), { click: `${chainCell(1)}` }, { wait: 500 }]
			}))
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
	// listing is the rig's own (fixtures/places-list.json): Live's categories
	// and Packs as one source (ADR-493), 21 Places, 7 ticked, and the User
	// Library.
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
				description: 'Settings → Places — the ticked ones first, then Live’s categories',
				steps: [...SETTINGS_OPEN, { click: '[data-tab="places"]' }]
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
		// Operator in Live's arrangement (ADR-487), at Live's defaults: the
		// oscillator its chain cell touched last (A until one is, ADR-513);
		// every page is a tile of board-operator.
		['operator-face', 'Operator', 'Operator', referenceParams('Operator')],
		['collision', 'Collision', 'Collision', referenceParams('Collision')],
		// Live's tabs over the middle (ADR-487); its pages are board-collision's tiles.
		['collision-lfo', 'Collision', 'Collision', referenceParams('Collision'), [{ click: '[data-tab="LFO"]' }]],
		['collision-midi', 'Collision', 'Collision', referenceParams('Collision'), [{ click: '[data-tab="MIDI"]' }]],
		['electric', 'Electric', 'LoungeLizard', referenceParams('Electric')],
		// Drift's face, its own (ADR-487), on Live's measured list; its pages
		// are the full-screen board's tiles (board-drift).
		['drift-face', 'Drift', 'Drift', referenceParams('Drift')],
		// Analog's face on Live's measured list (ADR-487); its pages are the
		// full-screen board's tiles (board-analog).
		['analog-reference', 'Analog', 'UltraAnalog', referenceParams('Analog')],
		// Wavetable's face on Live's measured list (ADR-487); its pages are the
		// full-screen board's tiles (board-wavetable).
		['wavetable-reference', 'Wavetable', 'InstrumentVector', referenceParams('Wavetable')],
		['meld', 'Meld', 'InstrumentMeld', meld],
		// Engine B up: the other half, in amber (both its envelopes in view, ADR-477).
		['meld-engine-b', 'Meld', 'InstrumentMeld', meld, [{ click: '[data-engine-level="B"] [role="slider"]' }]],
		// The effect chain's Meld cell with Engine B shown in the view: its
		// pad is Osc B, B's Shape and Tone (meldEngineStore), cropped to the chain.
		['meld-chain-b', 'Meld', 'InstrumentMeld', meld, [{ click: '[data-engine-level="B"] [role="slider"]' }], '.chain-wrap'],
		// The oscillator type grid open over the face.
		['meld-osc-types', 'Meld', 'InstrumentMeld', meld, [{ click: '.osc-tile' }]],
		// Plate picked from the filter grid: the second macro reads Ratio.
		// The filters a biquad has no shape for, each drawn as a best guess
		// (utils/esotericFilterCurves.ts): Phaser 11, Vowel 13, Comb + 14, Plate 16.
		...[['phaser', 11], ['vowel', 13], ['comb', 14], ['plate', 16]].map(([state, nth]) => [`meld-filter-${state}`, 'Meld', 'InstrumentMeld', meld,
			[{ click: '.filter-type .chooser-name' }, { click: `[data-tab="meld-filter-types"] .scrub-option:nth-child(${nth})`, force: true }]]),
		// Full screen (ADR-511/512): the corner icon, and every page on one
		// board, both halves side by side.
		...[
			['board-wavetable', 'Wavetable', 'InstrumentVector', referenceParams('Wavetable')],
			['board-drift', 'Drift', 'Drift', referenceParams('Drift')],
			['board-meld', 'Meld', 'InstrumentMeld', referenceParams('Meld')],
			['board-analog', 'Analog', 'UltraAnalog', referenceParams('Analog')],
			['board-operator', 'Operator', 'Operator', referenceParams('Operator')],
			['board-electric', 'Electric', 'LoungeLizard', referenceParams('Electric')],
			['board-collision', 'Collision', 'Collision', referenceParams('Collision')],
			['board-simpler', 'Simpler', 'OriginalSimpler', referenceParams('Simpler')],
			['board-sampler', 'Sampler', 'MultiSampler', referenceParams('Sampler_all_sections')]
		].map(([state, name, cls, params]) => [state, name, cls, params, [{ click: '[data-central-expand]' }]]),
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
	return swaps.map(([key, name, className, params, extraSteps = [], crop]) => ({
		name: `inst-${key}`,
		description: `${name}, swapped onto the FM track`,
		swap: { path: 'tracks/11/devices/0', name, className, params },
		steps: [openInstrument(11), ...extraSteps],
		...(crop ? { crop } : {})
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
