/**
 * Scene fixtures for the headless screenshot harness.
 *
 * A *scene* is a frozen snapshot of everything the UI needs to paint a
 * populated performance surface with no bridge, no Python surface and
 * no Ableton Live running:
 *
 *   {
 *     name:      string,
 *     version:   "3.4.0",          // negotiated protocol version
 *     generation: int,
 *     session:   { "<osc address>": [args...] },   // init-emit scalars
 *     treeArgs:  [ ...state/full tree args ],      // §3 record stream
 *     padRacks:  { "<rackPath>": { pads, chains } } // drum pads' chains (issue #491)
 *   }
 *
 * Two producers, one format:
 *
 * - `buildDefaultScene()` here synthesises a plausible nine-track
 *   looping set. Zero setup, works on any machine, but the values are
 *   invented.
 * - `scripts/shot/capture.mjs` records a *real* set off a running
 *   bridge into the same shape. Higher fidelity, needs a Mac + Live.
 *
 * `mock-surface.mjs` replays either one identically.
 *
 * Record layout is docs/reference/wire-protocol.md §3 — T/D/P/S/C tags
 * with fixed arity, depth-first. Keep this in lockstep with
 * `UI_SUPPORTED_VERSIONS` in `interface/src/lib/api/handlers/v3Handshake.ts`;
 * a T-record arity change breaks replay exactly like it breaks the
 * real surface.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROTOCOL_VERSION = '3.12.0';

/**
 * The feature switches a scene's bridge publishes when it names none
 * (`/bridge/features [json]`, general-release audit §7b): the rig's, every
 * switch on and answering, so a scene captured before the switches existed
 * draws what it always drew. The `general` and `totalmix-down` views
 * (views.mjs) override it.
 */
export const DEFAULT_FEATURES = Object.freeze({
	totalmix: Object.freeze({ enabled: true, available: true, reason: '' }),
	maxUtilityPatch: Object.freeze({ enabled: true, available: true, reason: '' }),
	expressionPedal: Object.freeze({ enabled: true, available: true, reason: '' }),
	menubar: Object.freeze({ enabled: true, available: true, reason: '' }),
	axHelper: Object.freeze({ enabled: true, available: true, reason: '' }),
	// Not a switch: every edition has the recorder; available once it says hello.
	captureRecorder: Object.freeze({ enabled: true, available: true, reason: '' })
});

/*
 * The library roots, from the fixture catalog the harness serves. They are
 * not decoration: the swap pill finds the recorded preset through that
 * index's alias rules, which are absolute paths under the instruments folder,
 * so a root that disagreed with them would put the scene's preset outside
 * every rule and the pill would draw "Not in the catalog". The config's
 * `paths.sidebarRoot` is a Mac's own now (constants.local.json), absent on a
 * clone; the fixture is tracked and holds its own.
 */
const FIXTURE_INDEX = JSON.parse(
	readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/data/places/index.json'), 'utf8')
);
const SIDEBAR_ROOT = FIXTURE_INDEX.metadata.sidebarRoot.replace(/\/+$/, '');
const INSTRUMENTS_BASE = dirname(SIDEBAR_ROOT);

/**
 * The preset the FM track's last load recorded — protocol 3.9.0's `preset`
 * field, which the instrument views' swap pill steps from.
 *
 * A path from before the Places (`<Vendor>/<Type>/…`), as a saved Set still
 * holds, so every capture of the pill also proves the alias map: it must reach
 * a Place the harness serves through `fixtures/data/places/index.json`'s alias
 * rules, or the pill draws "Not in the catalog". `fixtures/data/places/
 * synth.json` holds the leaf it lands in, and `shotFixtures.test.ts` holds the
 * two together. Before 2026-09-16 **no** scene
 * track set `preset` at all, so every one of the eleven states that draw this
 * pill photographed it reading "No preset recorded", disabled — the harness
 * could only ever show the control broken.
 *
 * On the FM track because the central tour swaps eight more instruments onto
 * that track in Operator's place (`instrumentSwapStates`), so one recorded
 * preset lights the pill in nine states. The Bass and Keys tracks deliberately
 * record none, which keeps the disabled branch photographed too.
 */
export const SCENE_PRESET = `${INSTRUMENTS_BASE}/Omni/Synth/Lead/Bright/Aurora Lead.adg`;

/**
 * The file behind the Guitar track's clips. `clip/sample` answered an empty
 * path until 2026-09-16, and an empty path is what `SlotCell` treats as
 * provisional and `useClipSwap` bails on — so the clip view's swap pill could
 * not mount at all, let alone reach a ranked list.
 */
export const SCENE_CLIP_FILE = `${SIDEBAR_ROOT}/Inst/Samples/Vocal/Takes/Slow Chime Bed.wav`;

/** Live's track colours, as the RGB ints that ride the T record. */
/* Live's own track-colour swatches (the picker's second row + greys), so a
   shot shows the colours a real set carries. The interface normalises them
   per skin exactly as it would Live's. */
const COLOR = {
	red: 0xff3636,
	orange: 0xf66c03,
	yellow: 0xfff034,
	green: 0x3dc300,
	cyan: 0x19e9ff,
	blue: 0x10a4ee,
	purple: 0x886ce4,
	pink: 0xff39d4,
	teal: 0x00bfaf,
	grey: 0xa9a9a9
};

/** Slot states per §3: 0 empty, 1 has clip, 2 playing, 3 recording. */
const SLOT = { empty: 0, hasClip: 1, playing: 2, recording: 3 };

/**
 * Device shorthand → param records. Deliberately small: the FX grid
 * paints names + normalised positions, so a handful of representative
 * params per device is enough to exercise layout without pretending to
 * mirror a real plugin's full surface.
 */
/**
 * Build Permute's 38-param vector (Device On first) from two patterns of up
 * to 16 steps, in the device's order: steps 9–16 of each lane come after
 * Temperature (ADR-443). A pattern shorter than 16 is filled with the
 * device defaults — mute steps on, pitch steps off.
 */
/**
 * Echo's parameter vector out to Dry Wet at 52. Names and LOM rails of the
 * indices the Echo tile and view read are the running device's (measured
 * 2026-09-14: all 0..1 but L 16th, 1..16); the rest are fillers that keep
 * those indices where the real device has them.
 */
/** Guitar.adg's eight macros as the rack names them (read from the preset 2026-09-30), 0..127. */
function guitarRackParams() {
	const names = ['Gain', 'Drive', 'Fuzz', 'Spring', 'Tremolo Rate', 'Tremolo Amount', 'Room', 'Macro 8'];
	const values = [70, 40, 20, 30, 64, 50, 25, 0];
	return [['Device On', 'On', 0, 1, 1, ''], ...names.map((n, i) => [n, n, 0, 127, values[i], ''])];
}

function echoParams() {
	const p = Array.from({ length: 53 }, (_, i) => [`Param ${i}`, `P${i}`, 0, 1, 0, '']);
	p[0] = ['Device On', 'On', 0, 1, 1, ''];
	p[1] = ['L Sync', 'L Sync', 0, 1, 1, ''];
	p[2] = ['L Time', 'L Time', 0, 1, 0.4, ''];
	p[4] = ['L 16th', 'L 16th', 1, 16, 2, ''];
	p[16] = ['Feedback', 'Feedback', 0, 1, 0.42, ''];
	p[28] = ['Filter On', 'Filter', 0, 1, 1, ''];
	p[19] = ['Input Gain', 'Input Gain', 0, 1, 0.61, ''];
	p[20] = ['Output', 'Output', 0, 1, 0.45, ''];
	p[29] = ['HP Freq', 'HP Freq', 0, 1, 0.28, ''];
	p[30] = ['HP Res', 'HP Res', 0, 1, 0.26, ''];
	p[31] = ['LP Freq', 'LP Freq', 0, 1, 0.71, ''];
	p[32] = ['LP Res', 'LP Res', 0, 1, 0.3, ''];
	p[33] = ['LFO Wave', 'LFO Wave', 0, 5, 2, ''];
	p[34] = ['LFO Freq', 'LFO Freq', 0, 1, 0.64, ''];
	p[35] = ['LFO Sync', 'LFO Sync', 0, 1, 1, ''];
	p[36] = ['LFO Synced', 'LFO Synced', 0, 21, 17, ''];
	p[39] = ['Dly < Mod', 'Dly < Mod', 0, 1, 0.06, ''];
	p[40] = ['Flt < Mod', 'Flt < Mod', 0, 1, 0.55, ''];
	p[52] = ['Dry Wet', 'Dry Wet', 0, 1, 0.3, ''];
	return p;
}

function permuteParams({ mute, pitch, muteLength = 8, pitchLength = 8 }) {
	const steps = (pattern, fill) => Array.from({ length: 16 }, (_, i) => pattern[i] ?? fill);
	const m = steps(mute, 1);
	const pt = steps(pitch, 0);
	const p = [['Device On', 'On', 0, 1, 1, '']];
	for (let i = 0; i < 8; i++) p.push([`Mute ${i + 1}`, `M${i + 1}`, 0, 1, m[i], '']);
	p.push(['Mute Length', 'M Len', 1, 16, muteLength, '']);
	p.push(['Mute Rate', 'M Rate', 0, 7, 3, '']);
	for (let i = 0; i < 8; i++) p.push([`Pitch ${i + 1}`, `P${i + 1}`, 0, 1, pt[i], '']);
	p.push(['Pitch Length', 'P Len', 1, 16, pitchLength, '']);
	p.push(['Pitch Rate', 'P Rate', 0, 7, 3, '']);
	p.push(['Chance', 'Chance', 0, 1, 0.35, '%']);
	p.push(['Temperature', 'Temp', 0, 1, 0.6, '']);
	for (let i = 8; i < 16; i++) p.push([`Mute ${i + 1}`, `M${i + 1}`, 0, 1, m[i], '']);
	for (let i = 8; i < 16; i++) p.push([`Pitch ${i + 1}`, `P${i + 1}`, 0, 1, pt[i], '']);
	return p;
}

/**
 * Build Wavetable's parameter vector out to the highest index the UI
 * reads. Positional, for the same reason Permute's is:
 * `WavetableCentralView` addresses params by index (4/6 Osc 1, 9 Osc 2 On,
 * 12/14 Osc 2, 39/41 amp envelope), so a loose handful of plausible params
 * leaves every pad reading `undefined` and the view cannot be shot at all.
 *
 * Names, rails and defaults are the real ones, measured off
 * `Looping Presets/Instruments/Ableton/Synth/Ableton/Wavetable/Default.adv`
 * — the same artifact the view's own index map was measured from, so the
 * fixture and the component cannot drift apart on what index 9 means.
 * Stops at 41: nothing above it is read, and 93 params of filler would be
 * wire traffic in exchange for nothing.
 *
 * `osc2On` is a parameter of the fixture because it is the one state worth
 * photographing both ways — Wavetable ships with Osc 2 OFF, which is what
 * puts the second pad in its ghost.
 */
function wavetableParams({ osc2On = 0 } = {}) {
	const osc = (n, position, effect2, on) => [
		[`Osc ${n} On`, `O${n} On`, 0, 1, on, ''],
		[`Osc ${n} Transpose`, `O${n} Tr`, -24, 24, 0, 'st'],
		[`Osc ${n} Detune`, `O${n} Det`, -0.5, 0.5, 0, ''],
		[`Osc ${n} Position`, `O${n} Pos`, 0, 1, position, ''],
		[`Osc ${n} Effect 1`, `O${n} Fx1`, -1, 1, 0, ''],
		[`Osc ${n} Effect 2`, `O${n} Fx2`, 0, 1, effect2, ''],
		[`Osc ${n} Pan`, `O${n} Pan`, -1, 1, 0, ''],
		[`Osc ${n} Gain`, `O${n} Gain`, 0, 1, 1, '']
	];
	const filter = (n, on, freq) => [
		[`Filter ${n} On`, `F${n} On`, 0, 1, on, ''],
		[`Filter ${n} Type`, `F${n} Type`, 0, 4, 0, ''],
		[`Filter ${n} Circuit LpHp`, `F${n} Circ`, 0, 4, 0, ''],
		[`Filter ${n} Circuit BpNoMo`, `F${n} BpNo`, 0, 1, 0, ''],
		[`Filter ${n} Slope`, `F${n} Slope`, 0, 1, 0, ''],
		[`Filter ${n} Frequency`, `F${n} Freq`, 20, 20480, freq, 'Hz'],
		[`Filter ${n} Resonance`, `F${n} Res`, 0, 1.25, 0.18, ''],
		[`Filter ${n} Drive`, `F${n} Drive`, 0, 24, 0, 'dB'],
		[`Filter ${n} Morph`, `F${n} Morph`, 0, 1, 0, '']
	];
	return [
		['Device On', 'On', 0, 1, 1, ''], //  0
		...osc(1, 0.31, 0.62, 1), //  1 ..  8
		...osc(2, 0.68, 0.4, osc2On), //  9 .. 16
		['Sub On', 'Sub On', 0, 1, 0, ''], // 17
		['Sub Tone', 'Sub Tone', 0, 1, 0, ''], // 18
		['Sub Gain', 'Sub Gain', 0, 1, 0.5, ''], // 19
		['Sub Transpose', 'Sub Tr', 0, 2, 1, ''], // 20
		...filter(1, 1, 3200), // 21 .. 29
		...filter(2, 0, 20), // 30 .. 38
		// Amp envelope times are SECONDS on a 0..20 rail — the rail the view
		// normalizes its Time pad against.
		['Amp Attack', 'Att', 0, 20, 2.5, 's'], // 39
		['Amp Decay', 'Dec', 0.0015, 20, 0.42, 's'], // 40
		['Amp Release', 'Rel', 0.0015, 20, 8, 's'] // 41
	];
}

/**
 * Build Drift's parameter vector out to the highest index the UI reads.
 * Positional, like Permute's and Wavetable's and for the same reason:
 * `DriftCentralView` addresses params by index (1/2 filter, 20-26 the two
 * oscillators, 29/30 gains, 33/34 noise, 35/37 amp times, 60 drift depth),
 * so a short handful of plausible params leaves every control reading
 * `undefined` and the view cannot be shot at all.
 *
 * Names, rails and defaults measured off
 * `User Library/Defaults/Instruments/Drift.adv`. Drift has no nested
 * container elements, so the flat scan is sound and document order is LOM
 * order with Device On at 0. A few values are nudged off their stored
 * defaults so the capture reads as a live patch instead of a pile of
 * extremes (Live ships Drift with the filter wide open, osc 2 silent and
 * noise at zero): filter 3200 Hz / res 0.35, osc gains 0.9 and 0.6, noise
 * 0.25, amp attack 0.4 s and release 2.5 s.
 */
function driftParams({ osc2On = 1 } = {}) {
	const p = [
		['On', 'On', 0, 1, 1, ''], // 0
		['Filter Frequency', 'Filter Freq', 19.999998, 19999.9961, 3200, ''], // 1
		['Filter Resonance', 'Filter Res', 0, 1.01, 0.35, ''], // 2
		['Filter Type', 'Filter Type', 0, 1, 0, ''], // 3
		['Filter Hi Pass Frequency', 'Filter Hi Pa', 9.999999, 20479.998, 9.999999, ''], // 4
		['Filter Tracking', 'Filter Track', 0, 1, 0, ''], // 5
		['Filter Mod Amount1', 'Filter Mod A', -1, 1, 0.8, ''], // 6
		['Filter Mod Amount2', 'Filter Mod A', -1, 1, 0.15, ''], // 7
		['Filter Osc Through1', 'Filter Osc T', 0, 1, 1, ''], // 8
		['Filter Osc Through2', 'Filter Osc T', 0, 1, 1, ''], // 9
		['Filter Noise Through', 'Filter Noise', 0, 1, 1, ''], // 10
		['Lfo Mode', 'Lfo Mode', 0, 3, 0, ''], // 11
		['Lfo Rate', 'Lfo Rate', 0.17, 1700, 0.4, ''], // 12
		['Lfo Ratio', 'Lfo Ratio', 0.25, 16, 1, ''], // 13
		['Lfo Time', 'Lfo Time', 0.1, 60, 1.0, ''], // 14
		['Lfo Synced Rate', 'Lfo Sync Rat', 0, 21, 15, ''], // 15
		['Lfo Amount', 'Lfo Amt', 0, 1, 1, ''], // 16
		['Lfo Shape', 'Lfo Shape', 0, 8, 0, ''], // 17
		['Lfo Mod Amount', 'Lfo Mod Amt', -1, 1, 0, ''], // 18
		['Lfo Retrigger', 'Lfo Retrig', 0, 1, 0, ''], // 19
		['Osc1 Type', 'Osc1 Type', 0, 6, 4, ''], // 20
		['Osc1 Shape', 'Osc1 Shape', 0, 1, 0, ''], // 21
		['Osc1 Transpose', 'Osc1 Transp', -2, 3, 0, ''], // 22
		['Osc1 Shape Mod', 'Osc1 Shape M', -1, 1, 0.05, ''], // 23
		['Osc2 Type', 'Osc2 Type', 0, 4, 0, ''], // 24
		['Osc2 Detune', 'Osc2 Det', -7, 7, 0, ''], // 25
		['Osc2 Transpose', 'Osc2 Transp', -3, 2, -1, ''], // 26
		['Pitch Modulation Amount1', 'Pch Mod Amt1', -1, 1, 0, ''], // 27
		['Pitch Modulation Amount2', 'Pch Mod Amt2', -1, 1, 0, ''], // 28
		['Mixer Osc Gain1', 'Mix Osc Gain', 0, 1.995268, 0.9, ''], // 29
		['Mixer Osc Gain2', 'Mix Osc Gain', 0, 1.995268, 0.6, ''], // 30
		['Mixer Osc On1', 'Mix Osc On1', 0, 1, 1, ''], // 31
		['Mixer Osc On2', 'Mix Osc On2', 0, 1, 1, ''], // 32
		['Mixer Noise Level', 'Mix Noise Le', 0, 1.995268, 0.25, ''], // 33
		['Mixer Noise On', 'Mix Noise On', 0, 1, 1, ''], // 34
		['Envelope1 Attack', 'Env1 Att', 0, 60, 0.4, ''], // 35
		['Envelope1 Decay', 'Env1 Dec', 0.005, 60, 0.6, ''], // 36
		['Envelope1 Release', 'Env1 Rel', 0.01, 60, 2.5, ''], // 37
		['Envelope1 Sustain', 'Env1 Sus', 0, 1, 1, ''], // 38
		['Envelope2 Attack', 'Env2 Att', 0, 60, 0.001, ''], // 39
		['Envelope2 Decay', 'Env2 Dec', 0.005, 60, 0.6, ''], // 40
		['Envelope2 Release', 'Env2 Rel', 0.01, 60, 0.6, ''], // 41
		['Envelope2 Sustain', 'Env2 Sus', 0, 1, 0.2, ''], // 42
		['Cycling Envelope Mode', 'Cyc Env Mode', 0, 3, 0, ''], // 43
		['Cycling Envelope Rate', 'Cyc Env Rate', 0.17, 1700, 4.999999, ''], // 44
		['Cycling Envelope Ratio', 'Cyc Env Rati', 0.25, 16, 1, ''], // 45
		['Cycling Envelope Time', 'Cyc Env Time', 0.1, 60, 1.0, ''], // 46
		['Cycling Envelope Synced Rate', 'Cyc Env Sync', 0, 21, 15, ''], // 47
		['Cycling Envelope Mid Point', 'Cyc Env Mid', 0, 1, 0.5, ''], // 48
		['Cycling Envelope Hold', 'Cyc Env Hold', 0, 1, 0, ''], // 49
		['Modulation Matrix Amount1', 'Mod Mtx Amt1', -1, 1, 0.8, ''], // 50
		['Modulation Matrix Amount2', 'Mod Mtx Amt2', -1, 1, 0, ''], // 51
		['Modulation Matrix Amount3', 'Mod Mtx Amt3', -1, 1, 0, ''], // 52
		['Global Vol Vel Mod', 'Gbl Vol Vel', 0, 1, 0.5, ''], // 53
		['Global Reset Osc Phase', 'Gbl Reset Os', 0, 1, 0, ''], // 54
		['Global Envelope2 Mode', 'Gbl Env2 Mod', 0, 1, 0, ''], // 55
		['Global Poly Voice Depth', 'Gbl Poly Voi', 0, 1, 0, ''], // 56
		['Global Stereo Voice Depth', 'Gbl Stereo V', 0, 1, 0.1, ''], // 57
		['Global Unison Voice Depth', 'Gbl Unison V', 0, 1, 0.05, ''], // 58
		['Global Mono Voice Depth', 'Gbl Mono Voi', 0, 1, 0, ''], // 59
		['Global Drift Depth', 'Gbl Drift De', 0, 1, 0.072, ''], // 60
	];
	// 32 = Mixer_OscillatorOn2. Both oscillators ship ON, so a ghosted
	// oscillator card is a state a fixture has to ask for.
	p[32][4] = osc2On;
	return p;
}

/**
 * Permute is a Max for Live device, so Live reports it under the M4L
 * class rather than its own name — and `useTinySequencer` matches on that
 * class before it will read a step. Everything else can keep the
 * name-derived default.
 */
// Not to be confused with `NATIVE_DEVICE_NAMES` in
// `DeviceLoadComponent.py`, which points the OTHER way — class → display
// name, the name Live inserts a device by —
// and has no fallback because most of its rows are unrecoverable from the
// class string. This one falls back (see `deviceClassName` below), so a row
// is needed only where Live's class differs from the name's letters; rows
// that agree with the fallback, such as `Glue Compressor` → `GlueCompressor`,
// are inert. A row added on the assumption that every device needs one is a
// no-op, which is a confusing thing to debug in either direction.
const DEVICE_CLASS_NAMES = {
	Permute: 'MxDeviceAudioEffect',
	// The master rack is matched on CLASS, not name: `MasterRackControl`
	// and `audioEffectRackByPath` both look for AudioEffectGroupDevice.
	// Name-derived would give "Mastering" and neither would find it.
	Mastering: 'AudioEffectGroupDevice',
	// Wavetable's LOM class. `identifyInstrumentType` matches on the class,
	// not the name, so the name-derived default ('Wavetable') sent the
	// central view to the default fallback instead of WavetableCentralView.
	Wavetable: 'InstrumentVector',
	// The Drum Rack's LOM class. The name-derived default ('DrumRack') is not
	// an instrument class `findInstrumentInDeviceList` knows, so the Drums
	// track opened on the clip view and DrumRackCentralView — the one view a
	// drum track lands on after a load — could not be shot at all.
	'Drum-Rack': 'DrumGroupDevice',
	// The second fixture kit (below): a Drum Rack too, with Simpler pads.
	'32 Pad Kit Jazz': 'DrumGroupDevice',
	// The third: a Drum Rack whose pads are nested Instrument Racks.
	'Ethnic Drums': 'DrumGroupDevice',
	// The fourth: a Sampler kit.
	'50s Autumn': 'DrumGroupDevice',
	// Simpler's LOM class. Name-derived ('Simpler') is no instrument class, so
	// the Texture strip drew the generic note instead of the Simpler mark.
	Simpler: 'OriginalSimpler',
	// The classes Live reports for the app's own effect presets — the
	// `expectedClassName` column of `devicePresets.ts`, each verified on
	// the rig: the Reverb preset is a Hybrid Reverb saved as "Reverb",
	// Auto Filter and Chorus are the Live 12 rewrites, Utility is a
	// StereoGain, Variation a Beat Repeat, Tremolo an AU plugin. An FX-grid
	// tile matches on class AND name, so with the name-derived defaults
	// every fixture Reverb and Filter tile read ghost while the track
	// plainly carried one — found 2026-09-10 by measuring the Jazz track's
	// Reverb label against its Delay's. A pad load (below) names its
	// device after the tile (a file load after the file), so this is also
	// what makes a loaded pad effect complete its tile.
	'Auto Filter': 'AutoFilter2',
	'Channel EQ': 'ChannelEq',
	Chorus: 'Chorus2',
	Compressor: 'Compressor2',
	'Glue Compressor': 'GlueCompressor',
	Phaser: 'PhaserNew',
	Redux: 'Redux2',
	Reverb: 'Hybrid',
	Tremolo: 'AuPluginDevice',
	// The Bass preset is a Helix Native plug-in, and GuitarCentralView's
	// `bass` slot matches it on name AND class — without the entry the
	// Bass panel reads ghost on every shot and its reorder arrows (which
	// need a resolved device) can never be photographed.
	'Helix Native': 'AuPluginDevice',
	// The Guitar rack is an Audio Effect Rack; without the entry its slot
	// reads ghost and GuitarCentralView never draws the named macros.
	Guitar: 'AudioEffectGroupDevice',
	Utility: 'StereoGain',
	Variation: 'BeatRepeat',
	// The MIDI effects, so a pad load of one is typed 4 and placed before
	// the instrument the way the surface places it.
	Arpeggiator: 'MidiArpeggiator',
	Chord: 'MidiChord',
	Random: 'MidiRandom',
	Velocity: 'MidiVelocity',
	// A Max MIDI effect, so its class says `Mx…`, not `Midi…` — which is
	// why the type test below reads the whole class name rather than its
	// prefix. (The surface itself never guesses: it reads Live's own
	// `Device.type`.)
	'Note Chance': 'MxDeviceMidiEffect'
};

/** The class Live reports for a device of this name — the table above, else the name's letters. */
export function deviceClassName(name) {
	return DEVICE_CLASS_NAMES[name] ?? name.replace(/[^A-Za-z]/g, '');
}

/**
 * A `vm.members` census as the surface emits it (ADR-428, Milestone 1b):
 * the JSON string a Drum Rack consumer parses to decide its mode and
 * each control's state. `functions` counts member PARAMETERS per
 * function (fx1 is ten per DrumCell pad, fx2 nine, the rest one) and how
 * many of them are macro-held.
 */
function vmMembers({ padCount, padClasses, hasMacroMappings, mappedMacros = [], family, functions, macros = [], pitchMacro = null, pads = [] }) {
	return JSON.stringify({ family, functions, hasMacroMappings, macros, mappedMacros, padClasses, padCount, pads, pitchMacro });
}

/**
 * The census's pad list (2026-09-08): `{note, name, class}` per populated
 * pad in note order, the way the surface reads it off `DrumPad.name` —
 * what DrumPadGrid draws. Names are a kit's usual drum voices, cycled.
 */
const PAD_VOICES = [
	'Kick', 'Rim', 'Snare', 'Clap', 'Snare 2', 'Tom Lo', 'Hat Cl', 'Tom Mid',
	'Hat Ped', 'Tom Hi', 'Hat Op', 'Tom Hi 2', 'Crash', 'Tom Top', 'Ride', 'China',
	'Cowbell', 'Crash 2', 'Vibra', 'Ride 2', 'Bongo Hi', 'Bongo Lo', 'Conga Mt', 'Conga Op',
	'Conga Lo', 'Timb Hi', 'Timb Lo', 'Agogo Hi', 'Agogo Lo', 'Cabasa', 'Maracas', 'Whistle'
];
// Chain colours the way a kit-maker paints them: one colour per voice
// family, cycled — kicks olive, snares white, hats teal, toms amber, the
// rest violet (RGB ints, Live's own convention; measured on the Croydon
// kit: kick 0x85961f, snare 0xffffff).
const PAD_COLORS = [0x85961f, 0x85961f, 0xffffff, 0xffffff, 0xffffff, 0xe2a63b, 0x3fb8b0, 0xe2a63b,
	0x3fb8b0, 0xe2a63b, 0x3fb8b0, 0xe2a63b, 0xa066d0, 0xe2a63b, 0xa066d0, 0xa066d0];
function kitPads(first, count, className) {
	return Array.from({ length: count }, (_, i) => ({
		note: first + i,
		name: PAD_VOICES[i % PAD_VOICES.length],
		class: className,
		color: PAD_COLORS[i % PAD_COLORS.length]
	}));
}

/**
 * ` 606 + 808` as an UNMAPPED kit: 24 DrumCell pads, every function
 * fully live — the shape the library is heading for. Answers the Drums
 * track by name (PROPERTY_DEFAULTS below).
 */
const DRUMCELL_KIT_MEMBERS = vmMembers({
	padCount: 24,
	padClasses: { DrumCell: 24 },
	pads: kitPads(36, 24, 'DrumCell'),
	hasMacroMappings: false,
	family: true,
	functions: {
		fx1: { members: 240, held: 0 },
		fx2: { members: 216, held: 0 },
		fxType: { members: 24, held: 0 },
		pitch: { members: 24, held: 0 },
		attack: { members: 24, held: 0 },
		decay: { members: 24, held: 0 },
		release: { members: 0, held: 0 },
		start: { members: 24, held: 0 },
		sustain: { members: 0, held: 0 },
		oscAmount: { members: 0, held: 0 },
		oscCoarse: { members: 0, held: 0 },
		pitchEnvAmount: { members: 0, held: 0 },
		pitchEnvAttack: { members: 0, held: 0 },
		spread: { members: 0, held: 0 },
		// One `Volume` per cell (2026-09-08).
		gain: { members: 24, held: 0 },
		// The switch AND the amount, like oscAmount (2026-09-09).
		filterFreq: { members: 48, held: 0 },
		filterRes: { members: 24, held: 0 }
	}
});

/**
 * `32 Pad Kit Jazz` as Live ships it (still mapped): 31 Simpler pads and
 * one Sampler, macro 1 = Transpose and macro 2 = Release driving every
 * pad. One pad carries an Eq8 after its Simpler — the surface skips the
 * effect and still counts the pad, which is why the census reads 31
 * Simplers and not 30. The rack's macros are mapped, so the view shows
 * one slider per mapped macro — Transpose and Release — and none of its
 * own controls (user's decision, 2026-09-29).
 *
 * The census still carries the per-function counts a fuller profile
 * would use (start 31/0, attack/decay 32/0, fx 0).
 *
 * The per-device property answers are what the surface would cold-read
 * on this kit: `null` for the three FX functions (no member → nil).
 */
const JAZZ_KIT_MEMBERS = vmMembers({
	padCount: 32,
	padClasses: { OriginalSimpler: 31, MultiSampler: 1 },
	pads: [...kitPads(36, 31, 'OriginalSimpler'), { note: 67, name: 'Brush Swirl', class: 'MultiSampler' }],
	hasMacroMappings: true,
	mappedMacros: [1, 2],
	family: false,
	functions: {
		fx1: { members: 0, held: 0 },
		fx2: { members: 0, held: 0 },
		fxType: { members: 0, held: 0 },
		pitch: { members: 32, held: 31 },
		attack: { members: 32, held: 0 },
		decay: { members: 32, held: 0 },
		// Macro 2 = Release drives every pad's Ve Release on the shipped kit.
		release: { members: 32, held: 32 },
		start: { members: 31, held: 0 },
		// The one Sampler pad is the 43-parameter variant: its Osc and
		// Pitch-envelope sections list only their switches.
		sustain: { members: 32, held: 0 },
		oscAmount: { members: 1, held: 0 },
		oscCoarse: { members: 0, held: 0 },
		pitchEnvAmount: { members: 1, held: 0 },
		pitchEnvAttack: { members: 0, held: 0 },
		spread: { members: 32, held: 0 },
		// Every Simpler and the Sampler pad name it `Volume`, all free.
		gain: { members: 32, held: 0 },
		filterFreq: { members: 64, held: 0 },
		filterRes: { members: 32, held: 0 }
	}
});

const JAZZ_KIT_PROPERTIES = Object.freeze({
	'vm.members': JAZZ_KIT_MEMBERS,
	// 38, not 36: this track has no clip playing, so the grid draws the
	// selected pad and nothing else (2026-09-09) — and 38 is the pad whose
	// `vm.pad.38.*` rows this fixture answers, which is what makes the
	// documented `--hold '.pad-tile[data-note="38"]'` capture work here.
	'vm.selectedPad': 38,
	'vm.pad.38.attack': 0.31,
	'vm.pad.38.release': 0.42,
	'vm.pad.38.pitch': 5,
	'vm.fx1': null,
	'vm.fx2': null,
	'vm.fxType': null,
	'vm.attack': 0.08,
	'vm.decay': 0.58,
	'vm.release': 0.8,
	'vm.start': 0.12,
	'vm.pitch': 0,
	'vm.gain': 0.55,
	'vm.pad.38.gain': 0.68,
	'vm.filterFreq': 0.44,
	'vm.filterRes': 0.6
});

/**
 * `Ethnic Drums` as the rig reads it (2026-09-07): 32 pads, every one a
 * nested Instrument Rack around two Sampler chains, each rack carrying
 * the macros Attack / Release / Transpose / Osc / Pitch Attack / Pitch
 * Amount / Room (the Drum Rack's own macros wear the same names but are
 * unmapped — Live itself cannot drive them). None of the seven functions
 * has a member on it; the pad racks' macros are what the view controls
 * (`rack-macros` profile): a slider per name, "Pitch Attack" + "Pitch
 * Amount" paired into a Pitch XY pad, each writing `vm.macro.<name>`.
 * The Transpose macro is the kit's pitch member (`pitchMacro`), so the
 * Trnsp slider stands in its place, in semitones, and pitch reads live
 * on all 32 pads; Room reaches 20 of the 32 pads to show the coverage
 * badge.
 */
const ETHNIC_KIT_MEMBERS = vmMembers({
	padCount: 32,
	padClasses: { InstrumentGroupDevice: 32 },
	pads: kitPads(36, 32, 'InstrumentGroupDevice'),
	hasMacroMappings: false,
	family: false,
	functions: {
		fx1: { members: 0, held: 0 },
		fx2: { members: 0, held: 0 },
		fxType: { members: 0, held: 0 },
		pitch: { members: 32, held: 0 },
		attack: { members: 0, held: 0 },
		decay: { members: 0, held: 0 },
		release: { members: 0, held: 0 },
		start: { members: 0, held: 0 },
		sustain: { members: 0, held: 0 },
		oscAmount: { members: 0, held: 0 },
		oscCoarse: { members: 0, held: 0 },
		pitchEnvAmount: { members: 0, held: 0 },
		pitchEnvAttack: { members: 0, held: 0 },
		spread: { members: 0, held: 0 },
		// The pads' own CHAIN volumes — the only level a nested-rack kit
		// exposes, and the one fixed function it answers besides pitch.
		gain: { members: 32, held: 0 }
	},
	macros: [
		{ name: 'Attack', members: 32, held: 0 },
		{ name: 'Release', members: 32, held: 0 },
		{ name: 'Transpose', members: 32, held: 0 },
		{ name: 'Osc', members: 32, held: 0 },
		{ name: 'Pitch Attack', members: 32, held: 0 },
		{ name: 'Pitch Amount', members: 32, held: 0 },
		{ name: 'Room', members: 20, held: 0 }
	],
	pitchMacro: 'Transpose'
});

const ETHNIC_KIT_PROPERTIES = Object.freeze({
	'vm.members': ETHNIC_KIT_MEMBERS,
	'vm.selectedPad': 36,
	'vm.pad.38.macro.Attack': 0.66,
	'vm.pad.38.macro.Osc': 0.2,
	'vm.pad.38.pitch': -12,
	// The pad's own chain volume — the nested-rack kit's gain member.
	'vm.pad.38.gain': 0.8,
	'vm.gain': 0.62,
	'vm.fx1': null,
	'vm.fx2': null,
	'vm.fxType': null,
	'vm.attack': null,
	'vm.decay': null,
	'vm.start': null,
	'vm.pitch': -7,
	'vm.macro.Attack': 0.18,
	'vm.macro.Release': 0.55,
	'vm.macro.Transpose': 0.5,
	'vm.macro.Osc': 0.72,
	'vm.macro.Pitch Attack': 0.35,
	'vm.macro.Pitch Amount': 0.64,
	'vm.macro.Room': 0.4
});

/**
 * `50s Autumn` unmapped: 32 Sampler pads, so the Drum Rack view shows the
 * Sampler row (`sampler` profile, 2026-09-07) — Osc, Pitch-envelope and
 * Time pads, Decay / Sustain / Spread sliders and Trnsp, every control
 * fanned out to each pad's Sampler by name. Every section is on, as on
 * the rig's `50s Autumn Brushes` (108 parameters per pad): the switch
 * and the amount both count, so an amount function reads 64 members.
 */
const AUTUMN_KIT_MEMBERS = vmMembers({
	padCount: 32,
	padClasses: { MultiSampler: 32 },
	pads: kitPads(36, 32, 'MultiSampler'),
	hasMacroMappings: false,
	family: false,
	functions: {
		fx1: { members: 0, held: 0 },
		fx2: { members: 0, held: 0 },
		fxType: { members: 0, held: 0 },
		pitch: { members: 32, held: 0 },
		attack: { members: 32, held: 0 },
		decay: { members: 32, held: 0 },
		release: { members: 32, held: 0 },
		start: { members: 0, held: 0 },
		sustain: { members: 32, held: 0 },
		oscAmount: { members: 64, held: 0 },
		oscCoarse: { members: 32, held: 0 },
		pitchEnvAmount: { members: 64, held: 0 },
		pitchEnvAttack: { members: 32, held: 0 },
		spread: { members: 32, held: 0 },
		// One `Volume` per Sampler, -36..36 dB (2026-09-08).
		gain: { members: 32, held: 0 },
		filterFreq: { members: 64, held: 0 },
		filterRes: { members: 32, held: 0 }
	}
});

const AUTUMN_KIT_PROPERTIES = Object.freeze({
	'vm.members': AUTUMN_KIT_MEMBERS,
	'vm.selectedPad': 36,
	'vm.pad.38.decay': 0.9,
	'vm.pad.38.attack': 0.05,
	'vm.pad.38.pitch': 3,
	'vm.fx1': null,
	'vm.fx2': null,
	'vm.fxType': null,
	'vm.attack': 0.2,
	'vm.decay': 0.58,
	'vm.release': 0.66,
	'vm.start': null,
	'vm.pitch': 3,
	'vm.sustain': 1,
	'vm.oscAmount': 0.3,
	'vm.oscCoarse': 0.06,
	'vm.pitchEnvAmount': 0.75,
	'vm.pitchEnvAttack': 0.72,
	'vm.spread': 0.25,
	'vm.gain': 0.46,
	'vm.pad.38.gain': 0.3,
	'vm.filterFreq': 0.8,
	'vm.filterRes': 0.15
});

const DEVICE_PARAMS = {
	// Permute is the one device here whose params are read for their
	// INDEX, not their name: `useTinySequencer` / `sequencerStore` address
	// steps positionally (1..8 mute, 9 mute length, 11..18 pitch, 19 pitch
	// length — see the layout comment in sequencerStore). A loose handful
	// of plausible params leaves every step reading `undefined`, which
	// renders the strip's ghost row rather than a real sequencer, so the
	// mini-sequencer could not be shot at all. Full vector it is.
	Permute: permuteParams({
		mute: [1, 1, 0, 1, 1, 1, 0, 1],
		pitch: [0, 0, 1, 0, 0, 1, 0, 0]
	}),
	'Auto Filter': [
		['Frequency', 'Freq', 20, 20000, 8400, 'Hz'],
		['Resonance', 'Res', 0, 1, 0.28, ''],
		['LFO Amount', 'LFO', 0, 1, 0.12, '']
	],
	Compressor: [
		['Threshold', 'Thresh', -60, 0, -18.5, 'dB'],
		['Ratio', 'Ratio', 1, 20, 4, ':1'],
		['Attack', 'Att', 0.01, 100, 3.2, 'ms'],
		['Makeup', 'Gain', 0, 24, 4.5, 'dB']
	],
	Reverb: [
		['Dry/Wet', 'Wet', 0, 1, 0.24, '%'],
		['Decay Time', 'Decay', 200, 60000, 2800, 'ms'],
		['Room Size', 'Size', 0, 1, 0.62, '']
	],
	// Echo is read by INDEX (1 Sync, 2 L Time, 4 L 16th, 16 Feedback, 19/20
	// Input/Output, 29-32 the HP/LP filter, 33-36 + 39/40 the LFO, 52 Dry Wet), so
	// the vector runs out to 52 with plausible fillers between.
	Echo: echoParams(),
	Saturator: [
		['Drive', 'Drive', 0, 36, 8.5, 'dB'],
		['Output', 'Out', -36, 36, -1.5, 'dB']
	],
	// The Max device really does carry exactly these two, in this order:
	// its one `live.dial` plus the Device On every device has. The view
	// addresses Chance by INDEX (1), so the pair has to be listed.
	'Note Chance': [
		['Device On', 'On', 0, 1, 1, ''],
		['Chance', 'Chance', 0, 100, 72, '%']
	],
	Wavetable: wavetableParams(),
	Drift: driftParams(),
	// A Drum Rack's params are its macros, 0-127 and indexed from 1 (param 0
	// is the rack's on/off). Names as the pipeline family really has them
	// (` 606 + 808`, read from Live 2026-09-07): only macros 1 and 2 carry a
	// meaningful name, and `identifyInstrumentTypeAsync` routes to
	// `DrumRackCentralView` only when those two are literally FX1 / FX2
	// (anything else is read as a Komplete Kontrol mapping). The view no
	// longer reads the macros at all — its seven controls are the `vm.*`
	// virtual-macro properties (ADR-428), answered from PROPERTY_DEFAULTS
	// below — but the vector is what a captured scene would carry.
	'Drum-Rack': [
		['Device On', 'On', 0, 1, 1, ''], //  0
		['FX1', 'FX1', 0, 127, 0, ''], //  1
		['FX2', 'FX2', 0, 127, 63.5, ''], //  2
		['Macro 3', 'Macro 3', 0, 127, 0, ''], //  3
		['Macro 4', 'Macro 4', 0, 127, 63.5, ''], //  4
		['Kick', 'Kick', 0, 127, 107.95, ''], //  5
		['Snare', 'Snare', 0, 127, 107.95, ''], //  6
		['Hihat', 'Hihat', 0, 127, 107.95, ''], //  7
		['Perc', 'Perc', 0, 127, 107.95, ''], //  8
		['Macro 9', 'Macro 9', 0, 127, 85, ''], //  9
		['Macro 10', 'Macro 10', 0, 127, 127, ''], // 10
		['Macro 11', 'Macro 11', 0, 127, 0, ''] // 11
	],
	// The Jazz kit's macros, as the kit file names them: only the first
	// two carry a name (Transpose, Release — the two Live maps), the rest
	// are stock. Nothing in the virtual-macro view reads them; they are
	// here so the rack is the one the census describes, and so the macro
	// grid (which does read them) has something honest to show if a
	// scene ever routes this kit there.
	'32 Pad Kit Jazz': [
		['Device On', 'On', 0, 1, 1, ''], //  0
		['Transpose', 'Transpose', 0, 127, 63.5, ''], //  1
		['Release', 'Release', 0, 127, 63.5, ''], //  2
		...[3, 4, 5, 6, 7, 8].map((n) => [`Macro ${n}`, `Macro ${n}`, 0, 127, 0, ''])
	],
	// Macros read 0-127 and index from 1 — param 0 is the rack's on/off,
	// which is why `buildMacroLayout` starts at 1. Four named macros and
	// no filler: the unnamed rest of a real rack come through as
	// `Macro 5`… and are skipped by name, so omitting them is the same
	// picture with less wire.
	Mastering: [
		['Device On', 'On', 0, 1, 1, ''],
		['Glue', 'Glue', 0, 127, 78, ''],
		['Air', 'Air', 0, 127, 44, ''],
		['Width', 'Width', 0, 127, 96, ''],
		['Push', 'Push', 0, 127, 32, '']
	],
	Simpler: [
		['Start', 'Start', 0, 1, 0, '%'],
		['Filter Freq', 'Freq', 20, 20000, 12000, 'Hz'],
		['Volume', 'Vol', 0, 1, 0.78, '']
	]
};

/**
 * The synthetic set. Each entry becomes one T record plus its device
 * subtree and eight clip slots.
 *
 * `clips` is a sparse map of slotIndex → clip descriptor, so the grid
 * gets the ragged look of a real looping session rather than a filled
 * rectangle.
 */
const DEFAULT_TRACKS = [
	{
		name: 'Drums',
		color: COLOR.red,
		kind: 'midi',
		arm: 0,
		volume: 0.88,
		// Protocol 3.7.0 role: what a real drum load records, and what
		// mounts the Drum Buss rail beside the Drum Rack view (ADR-424).
		role: 'drum',
		// Pad 50 — one of the pads the playing clip draws — carries an Echo
		// on its own chain (issue #491): hold it and the grid's Echo tile
		// reads active while every other tile reads ghost.
		devices: [{ name: 'Drum-Rack', padChains: { 50: ['Echo'] } }, 'Compressor'],
		clips: {
			0: { name: 'Kick 4/4', length: 4, state: SLOT.playing },
			1: { name: 'Break A', length: 8 },
			2: { name: 'Break B', length: 8 }
		}
	},
	{
		name: 'Bass',
		color: COLOR.orange,
		kind: 'midi',
		arm: 0,
		volume: 0.81,
		// A 16-step mute row beside a pitch row at the default 8 (ADR-443):
		// the Permute view's two lengths side by side, half-width cells above
		// full-width ones.
		devices: [
			'Wavetable',
			{
				name: 'Permute',
				params: permuteParams({
					mute: [1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0],
					pitch: [0, 0, 1, 0, 0, 1, 0, 0],
					muteLength: 16
				})
			},
			'Saturator'
		],
		clips: {
			0: { name: 'Root Pulse', length: 4, state: SLOT.playing },
			1: { name: 'Walk', length: 8 }
		}
	},
	{
		name: 'Keys',
		color: COLOR.yellow,
		kind: 'midi',
		arm: 1,
		volume: 0.76,
		// Pitch row is inert here — every pitch step off, so Permute never
		// transposes. Its row should read as switched off, independently of
		// the mute row beside it.
		// Keys carries Drift rather than a fourth Wavetable — it is the only
		// track that can photograph DriftCentralView, and the scene had no
		// Drift at all before 2026-09-02.
		devices: [
			'Drift',
			{ name: 'Permute', params: permuteParams({ mute: [1, 0, 1, 1, 0, 1, 1, 1], pitch: [0, 0, 0, 0, 0, 0, 0, 0] }) },
			'Reverb'
		],
		clips: {
			0: { name: 'Chords I', length: 8, state: SLOT.playing },
			2: { name: 'Chords II', length: 8 }
		}
	},
	{
		name: 'Guitar',
		color: COLOR.green,
		kind: 'audio',
		arm: 1,
		volume: 0.7,
		// The Guitar rack carries Guitar.adg's own macro names, so
		// GuitarCentralView's Drive/Fuzz and Tremolo pads can be shot.
		devices: ['Auto Filter', 'Echo', 'Helix Native', { name: 'Guitar', params: guitarRackParams() }],
		clips: {
			0: { name: 'Loop 1', length: 8, state: SLOT.recording }
		}
	},
	{
		name: 'Vox',
		color: COLOR.cyan,
		kind: 'audio',
		arm: 0,
		volume: 0.74,
		devices: ['Compressor', 'Reverb', 'Echo'],
		clips: {
			1: { name: 'Verse', length: 16 },
			3: { name: 'Harm', length: 16 }
		}
	},
	{
		name: 'Pad',
		color: COLOR.blue,
		kind: 'midi',
		mute: 1,
		volume: 0.62,
		// Pad is the ghost-state Drift: osc 2 switched off, so DriftCentralView's
		// second oscillator card can be photographed dimmed. Keys carries the
		// ordinary both-on Drift. (Wavetable's two states live on Bass and Lead.)
		devices: [{ name: 'Drift', params: driftParams({ osc2On: 0 }) }, 'Reverb'],
		clips: { 0: { name: 'Swell', length: 16 } }
	},
	{
		name: 'Lead',
		color: COLOR.purple,
		kind: 'midi',
		solo: 0,
		volume: 0.69,
		// The mirror image: every mute step ON means Permute never mutes, so
		// the mute row is the inert one and the pitch row is live.
		//
		// This is also the ONE track whose Wavetable has Osc 2 switched on.
		// Wavetable ships with it off, so every other Wavetable here shows
		// WavetableCentralView's second pad in its ghost; shoot Lead to see
		// the live state, Bass to see the ghost. Keeping both in the fixture
		// means neither needs a scene edit to photograph.
		devices: [
			{ name: 'Wavetable', params: wavetableParams({ osc2On: 1 }) },
			{ name: 'Permute', params: permuteParams({ mute: [1, 1, 1, 1, 1, 1, 1, 1], pitch: [1, 0, 0, 1, 0, 1, 0, 0] }) },
			'Echo'
		],
		clips: { 2: { name: 'Hook', length: 8 } }
	},
	{
		name: 'Texture',
		color: COLOR.pink,
		kind: 'audio',
		volume: 0.55,
		devices: ['Simpler', 'Auto Filter', 'Reverb'],
		clips: { 1: { name: 'Field', length: 32, state: SLOT.playing } }
	},
	{
		// The second Drum Rack (ADR-428, Milestone 1b): a still-mapped
		// Simpler kit, so the Drum Rack view can be photographed with its
		// FX controls dimmed and Trnsp held — states the DrumCell kit on
		// Drums never shows. Last in the roster so every existing track
		// keeps its index.
		name: 'Jazz',
		color: COLOR.teal,
		kind: 'midi',
		arm: 0,
		volume: 0.8,
		role: 'drum',
		// Pad 38 — Live's selected pad here, so the grid draws it — carries
		// a Reverb of its own (issue #491), the pad the documented
		// `--hold '.pad-tile[data-note="38"]'` and pane recipes use, and
		// since ADR-435 a Permute of its own after it: the tile wears the
		// pad's step strip, and holding the pad makes the strip's Permute
		// section and the Permute view that pad's.
		devices: [{ name: '32 Pad Kit Jazz', properties: JAZZ_KIT_PROPERTIES, padChains: { 38: ['Reverb', 'Permute'] } }, 'Reverb'],
		clips: {
			0: { name: 'Brushes', length: 8 },
			2: { name: 'Ride', length: 8 }
		}
	},
	{
		// The third Drum Rack (2026-09-07): a kit of nested Instrument
		// Racks, so the `rack-macros` profile — one control per pad-rack
		// macro name — can be photographed. After Jazz, same reason.
		name: 'Ethnic',
		color: COLOR.pink,
		kind: 'midi',
		arm: 0,
		volume: 0.8,
		role: 'drum',
		// A Reverb, not the rig's Permute: the harness clicks the strip's centre,
		// and a Permute row there opens the sequencer view instead of the kit's.
		devices: [{ name: 'Ethnic Drums', properties: ETHNIC_KIT_PROPERTIES }, 'Reverb'],
		clips: {
			1: { name: 'Dhol', length: 16 }
		}
	},
	{
		// The fourth Drum Rack (2026-09-07): a Sampler kit, for the
		// `sampler` profile. After Ethnic, same reason.
		name: 'Autumn',
		color: COLOR.yellow,
		kind: 'midi',
		arm: 0,
		volume: 0.8,
		role: 'drum',
		devices: [{ name: '50s Autumn', properties: AUTUMN_KIT_PROPERTIES }, 'Reverb'],
		clips: {
			0: { name: 'Brushes', length: 8 }
		}
	},
	{
		// The ONLY track that can photograph OperatorCentralView — the scene
		// could not reach it at all before 2026-09-12, which is how its amp
		// envelope came to be rebuilt with no capture to check the layout
		// against. It is LAST on purpose: every shot recipe and the README
		// name tracks by index (8 Jazz, 9 Ethnic, 10 Autumn), so a track
		// inserted anywhere else would silently repoint all of them.
		//
		// MIDI, because fx1 is the instrument-slider split only on a MIDI
		// track — an audio track replaces that whole column with the clip's
		// pitch (ADR-383), so an Operator on one is unreachable from the
		// grid. That is what the first attempt here got wrong.
		name: 'FM',
		color: COLOR.purple,
		kind: 'midi',
		arm: 0,
		volume: 0.68,
		// ...and the only track carrying a Drum Buss (2026-09-12), so
		// DrumBussCentralView's controls can be photographed LIVE and a
		// scrub shot proves a write rather than a ghost load. On this track
		// rather than Drums, where it would light the Drum tile in every
		// existing Drum Rack capture.
		devices: ['Operator', 'Drum Buss', 'Reverb'],
		// Protocol 3.9.0's `preset` — see SCENE_PRESET. The only track that
		// records one, which is what lets the swap pill draw a name instead of
		// "No preset recorded".
		preset: SCENE_PRESET,
		clips: {
			1: { name: 'Bell', length: 8 }
		}
	}
];

const SLOTS_PER_TRACK = 8;

/**
 * Push one T record. Field order and arity are §3's, protocol 3.9.0:
 * 15 fields after the tag.
 */
function pushTrack(args, trackPath, t) {
	args.push(
		'T',
		trackPath,
		t.name,
		t.color ?? COLOR.grey,
		t.mute ?? 0,
		t.solo ?? 0,
		t.arm ?? 0,
		t.kind === 'midi' ? 1 : 0, // hasMidiInput
		t.kind === 'audio' ? 1 : 0, // hasAudioInput
		t.hasArrangementClips ?? 0,
		t.volume ?? 0.85,
		t.isFoldable ?? 0,
		t.foldState ?? 0,
		t.groupTrackIndex ?? -1,
		// Protocol 3.7.0 — the persisted rail. A scene can set it to
		// shoot the Drum Buss rail without depending on the machine's
		// generated catalogs being present.
		t.role ?? '',
		// Protocol 3.9.0 (ADR-439) — the preset the last prepare load
		// recorded, which the instrument views' swap control steps from.
		t.preset ?? ''
	);
}

/** One D record and its P records, the way §3 lays them out. */
function pushDeviceRecords(args, devicePath, name, className, params) {
	args.push('D', devicePath, name, className);
	params.forEach(([paramName, displayName, min, max, value, unit], paramIndex) => {
		args.push('P', `${devicePath}/params/${paramIndex}`, paramName, displayName, min, max, value, unit);
	});
}

/**
 * Swap one device of a built scene for another, in place: its D record's
 * name and class and, when `params` is given, its P records. The tour uses
 * it to reach instrument views the default scene has no track for — each
 * goes on the FM track in Operator's place. Without `params` the device
 * keeps the old one's, so a view that binds by name draws ghosted, which
 * is fine for what the tour measures (layout). Returns the scene.
 */
export function swapDevice(scene, devicePath, { name, className, params }) {
	const args = scene.treeArgs;
	const at = args.findIndex((v, k) => v === 'D' && args[k + 1] === devicePath);
	if (at < 0) throw new Error(`swapDevice: no device record at ${devicePath}`);
	const cls = className ?? deviceClassName(name);
	if (!params) {
		args[at + 2] = name;
		args[at + 3] = cls;
		return scene;
	}
	let end = at + 4;
	while (args[end] === 'P' && String(args[end + 1]).startsWith(`${devicePath}/params/`)) end += 8;
	const records = [];
	pushDeviceRecords(records, devicePath, name, cls, params);
	args.splice(at, end - at, ...records);
	return scene;
}

function pushDevices(args, trackPath, deviceNames, deviceProperties = {}, padRacks = {}) {
	deviceNames.forEach((entry, deviceIndex) => {
		// A device is either a bare name or `{ name, params, properties,
		// padChains }` — the object form lets one track's copy of a device
		// differ from another's, which is what makes a Permute with a dead
		// pitch row shootable next to one with a live it, and one Drum
		// Rack's `vm.members` census differ from another's. `properties`
		// are the mock's per-device `property/subscribe` answers (a side
		// table, not tree records — §3 carries no property values).
		const name = typeof entry === 'string' ? entry : entry.name;
		const devicePath = `${trackPath}/devices/${deviceIndex}`;
		const className = deviceClassName(name);
		if (typeof entry !== 'string' && entry.properties) {
			deviceProperties[devicePath] = { ...entry.properties };
		}
		const params = (typeof entry === 'string' ? null : entry.params) ?? DEVICE_PARAMS[name] ?? [];
		pushDeviceRecords(args, devicePath, name, className, params);

		// Every Drum Rack gets a pad table (issue #491): its census's pads,
		// each with the instrument the census names for it, plus whatever
		// effects `padChains` puts after it — `{ 38: ['Reverb'] }` is a
		// Reverb at chain index 1 behind pad 38's instrument. The mock
		// answers `vm.padFx` and `vm.padChain.<note>` from this table and
		// grows it on a pad-targeted `device/load`.
		if (className === 'DrumGroupDevice') {
			const census = JSON.parse(
				(typeof entry !== 'string' && entry.properties?.['vm.members']) || PROPERTY_DEFAULTS['vm.members']
			);
			const chains = {};
			for (const [note, effects] of Object.entries((typeof entry !== 'string' && entry.padChains) || {})) {
				chains[note] = effects.map((effectName) => padEffect(effectName));
			}
			padRacks[devicePath] = {
				pads: (census.pads ?? []).map(({ note, name: padName, class: padClass }) => ({ note, name: padName, class: padClass })),
				chains
			};
		}
	});
}

/**
 * One effect on a pad's chain. Its type follows its class — a class
 * naming Midi is a MIDI effect (4), anything else an audio effect (2);
 * that is a substring test rather than a prefix one because a Max MIDI
 * effect reports `MxDeviceMidiEffect` (no audio class here names Midi) — and
 * its position is decided by `padChainOrder`, never stored: MIDI effects
 * sit at the head of the chain before the instrument, audio effects after
 * it, the way the surface places them (2026-09-11).
 */
let padEffectSeq = 0;
function padEffect(name) {
	const className = deviceClassName(name);
	return { id: ++padEffectSeq, name, className, type: className.includes('Midi') ? 4 : 2, params: DEVICE_PARAMS[name] ?? [] };
}

/**
 * A pad's chain in Live's order — MIDI effects, the instrument, audio
 * effects — each entry carrying its chain index. The instrument is the
 * census's pad entry; `null` for a pad the kit has not populated.
 */
function padChainOrder(rack, note) {
	const pad = rack.pads.find((p) => p.note === note);
	if (!pad) return null;
	const effects = rack.chains[note] ?? [];
	const ordered = [
		...effects.filter((d) => d.type === 4),
		{ name: pad.name, className: pad.class, type: 1, instrument: true },
		...effects.filter((d) => d.type !== 4)
	];
	return ordered.map((d, index) => ({ ...d, index }));
}

/**
 * The rack's `vm.padFx` value (wire-protocol §2.6): every populated pad's
 * chain devices in chain order, as index, class, name and Live's
 * `Device.type` (1 instrument, 2 audio effect, 4 MIDI effect).
 */
export function vmPadFx(rack) {
	const pads = {};
	for (const pad of rack.pads) {
		pads[pad.note] = padChainOrder(rack, pad.note).map((d) => ({ index: d.index, class: d.className, name: d.name, type: d.type }));
	}
	return JSON.stringify({ pads });
}

/** The `vm.padChain.<note>` row's own value: that pad's presence entry, `null` for a pad the kit has not populated. */
export function padChainEntry(rack, note) {
	const pad = rack.pads.find((p) => p.note === note);
	if (!pad) return null;
	return JSON.stringify({ note, devices: JSON.parse(vmPadFx(rack)).pads[note] });
}

/**
 * A pad-scoped `state/full/tree`'s records (reason `pad-chain`): the D
 * and P records of the effects on the pad's chain, the instrument
 * skipped and its index kept, every path under `<rackPath>/pads/<note>`.
 * Empty for a pad with nothing but its instrument — a real answer.
 */
export function padChainRecords(rackPath, note, rack) {
	const args = [];
	for (const d of padChainOrder(rack, note) ?? []) {
		if (d.instrument) continue;
		pushDeviceRecords(args, `${rackPath}/pads/${note}/devices/${d.index}`, d.name, d.className, d.params);
	}
	return args;
}

/**
 * What a pad-targeted `device/load` does to the table: the preset joins
 * the pad's chain — an audio effect after the instrument, a MIDI effect
 * before it — named after its file the way Live names a freshly loaded
 * device (`Delay.adv` → Delay), with the class the table above says that
 * name reports. Returns the new entry with the chain index it landed at.
 */
export function appendPadDevice(rack, note, presetPath) {
	const file = String(presetPath).split('/').pop() ?? '';
	const name = file.replace(/\.(adv|adg|aupreset|amxd)$/i, '');
	const chain = (rack.chains[note] ??= []);
	const device = padEffect(name);
	chain.push(device);
	// `padChainOrder` copies its entries, so the match is by id — a second
	// Delay on the same pad must report its own index, not the first one's.
	const placed = padChainOrder(rack, note)?.find((d) => d.id === device.id);
	return { ...device, index: placed?.index ?? chain.length };
}

function pushSlots(args, trackPath, clips) {
	for (let slotIndex = 0; slotIndex < SLOTS_PER_TRACK; slotIndex++) {
		const slotPath = `${trackPath}/slots/${slotIndex}`;
		const clip = clips?.[slotIndex];
		args.push('S', slotPath, clip ? (clip.state ?? SLOT.hasClip) : SLOT.empty);
		if (clip) {
			args.push(
				'C',
				`${slotPath}/clip`,
				clip.name,
				clip.length ?? 4,
				clip.color ?? COLOR.grey,
				clip.pitch ?? 0
			);
		}
	}
}

/**
 * Device-property values the mock answers a `property/subscribe` with,
 * keyed by property name — the fallback behind a device's own
 * `properties` (see `pushDevices`). The Drum Rack view's seven virtual
 * macros (ADR-428): `t` in 0..1 for the pads and Start, the 0..8 FX-type
 * index, whole semitones for pitch — plus the `vm.members` census that
 * makes every control live (an unmapped DrumCell kit). Chosen so every
 * control reads off-centre in a shot — a pad dot away from the middle, a
 * selected FX type that isn't the first, a lifted Start, a transposed
 * kit.
 */
export const PROPERTY_DEFAULTS = Object.freeze({
	// Live's selected pad, and one pad's own values off the kit values (the
	// Drums kit answers by name): a `--hold '.pad-tile[data-note="38"]'`
	// shot photographs the controls re-adjusting to pad 38.
	'vm.selectedPad': 36,
	'vm.pad.38.fx1': 0.9,
	'vm.pad.38.fx2': 0.15,
	'vm.pad.38.fxType': 7,
	'vm.pad.38.attack': 0.5,
	'vm.pad.38.decay': 0.25,
	'vm.pad.38.start': 0.6,
	'vm.pad.38.pitch': 12,
	'vm.pad.38.gain': 0.72,
	// The pad mixer column beside the held pads: 36 at 0 dB, 38 muted and down.
	'vm.pad.36.chainVolume': 0.85,
	'vm.pad.36.chainMute': 0,
	'vm.pad.38.chainVolume': 0.55,
	'vm.pad.38.chainMute': 1,
	'vm.fx1': 0.62,
	'vm.fx2': 0.3,
	'vm.fxType': 3,
	'vm.attack': 0.14,
	'vm.decay': 0.69,
	'vm.release': null,
	'vm.start': 0.22,
	'vm.pitch': -7,
	'vm.sustain': null,
	'vm.oscAmount': null,
	'vm.oscCoarse': null,
	'vm.pitchEnvAmount': null,
	'vm.pitchEnvAttack': null,
	'vm.spread': null,
	'vm.gain': 0.35,
	'vm.filterFreq': 0.68,
	'vm.filterRes': 0.22,
	'vm.members': DRUMCELL_KIT_MEMBERS
});

/**
 * Build the built-in synthetic scene.
 *
 * `trackCount` trims or repeats the roster so a shot can exercise the
 * one-track and the crowded-set layouts from the same fixture.
 */
export function buildDefaultScene({ trackCount = DEFAULT_TRACKS.length } = {}) {
	const roster = [];
	for (let i = 0; i < trackCount; i++) {
		const base = DEFAULT_TRACKS[i % DEFAULT_TRACKS.length];
		roster.push(i < DEFAULT_TRACKS.length ? base : { ...base, name: `${base.name} ${Math.floor(i / DEFAULT_TRACKS.length) + 1}` });
	}

	const treeArgs = [];
	// Two side-tables the mock surface needs beyond the tree itself:
	// which slot each track is PLAYING (the live channel the grid
	// demotes a snapshot state without) and how long each clip is (so a
	// notes reply can fill the clip's own window).
	const playing = [];
	const clipLengths = {};
	const audioClips = {};
	// Per-device `property/subscribe` answers, keyed by devicePath — what
	// lets two Drum Racks carry two different censuses.
	const deviceProperties = {};
	// Every Drum Rack's pads and their chains (issue #491), keyed by the
	// rack's devicePath — what the mock answers `vm.padFx` and a pad's
	// `vm.padChain.<note>` bundle from, and grows on a pad load.
	const padRacks = {};
	// Every track Permute's step position, frozen mid-bar: the telemetry
	// wire the view's playhead rides, which a shot never showed without it.
	// Mute on step 7 (an OFF step on Bass), pitch on step 3 (an ON one),
	// so one shot photographs the marker on both.
	const permuteSteps = [];
	roster.forEach((track, index) => {
		const trackPath = `tracks/${index}`;
		pushTrack(treeArgs, trackPath, track);
		pushDevices(treeArgs, trackPath, track.devices ?? [], deviceProperties, padRacks);
		(track.devices ?? []).forEach((entry, deviceIndex) => {
			if ((typeof entry === 'string' ? entry : entry.name) === 'Permute') {
				permuteSteps.push({ devicePath: `${trackPath}/devices/${deviceIndex}`, mute: 6, pitch: 2 });
			}
		});
		pushSlots(treeArgs, trackPath, track.clips);
		for (const [slotIdx, clip] of Object.entries(track.clips ?? {})) {
			clipLengths[`${trackPath}/slots/${slotIdx}/clip`] = clip.length ?? 8;
			// The VALUE is the file `clip/sample` answers with, not just a flag:
			// an empty path is provisional to every reader of that reply.
			if (track.kind === 'audio') audioClips[`${trackPath}/slots/${slotIdx}/clip`] = SCENE_CLIP_FILE;
			if (clip.state === SLOT.playing || clip.state === SLOT.recording) {
				playing.push({
					trackPath,
					slotIdx: Number(slotIdx),
					isAudio: track.kind === 'audio',
					lengthBeats: clip.length ?? 8,
					status: clip.state === SLOT.recording ? 2 : 1
				});
			}
		}
	});

	// Master emits as a T with trackPath "master" and (0, 0, -1) for the
	// group fields — §3.
	pushTrack(treeArgs, 'master', {
		name: 'Master',
		color: COLOR.grey,
		kind: 'audio',
		volume: 0.85
	});
	pushDevices(treeArgs, 'master', ['Mastering', 'Compressor']);

	return {
		name: 'default',
		version: PROTOCOL_VERSION,
		generation: 1,
		session: {
			// Legacy address, not v3 — tempo is the one exception in the
			// session family (v3Session.ts:97). Seeded under the v3 spelling
			// it was never routed, so every capture rendered the hardcoded
			// 120.0 BPM default instead of this value.
			'/looping/session/tempo': [122.0],
			'/looping/v3/session/is_playing': [1],
			// Song position, in beats. Static on purpose: a moving value
			// would make every capture land on a different frame.
			// 6.5 beats in 4/4 reads as bar 2, beat 3, sixteenth 3.
			'/looping/v3/session/song_time': [6.5],
			// TotalMix monitor levels (the R P C H M strip). Deliberately
			// spread across the scale so a capture shows the letter-ink
			// flip at both ends: `click` sits below its letter, `phones`
			// well above it, `main` right about ON it.
			//
			// In dB, the unit this wire has spoken since ADR-423. These were
			// 0..1 fractions, which every fader read as dB near 0 — five full
			// bars, the one reading a stranger's mixer-less set never shows.
			// Each is the old fraction's own level on the −65..+6 dB fader
			// (35 / 70 / 12 / 92 / 55 %), so the spread above still holds.
			'/looping/v3/totalmix/room': [-40.2],
			'/looping/v3/totalmix/playback': [-15.3],
			'/looping/v3/totalmix/click': [-56.5],
			'/looping/v3/totalmix/phones': [0.3],
			'/looping/v3/totalmix/main': [-26.0],
			'/looping/v3/session/metronome': [0],
			'/looping/v3/session/session_record': [0],
			'/looping/v3/session/loop': [0],
			'/looping/v3/session/loop_start': [0.0],
			'/looping/v3/session/loop_length': [16.0],
			'/looping/v3/session/signature_num': [4],
			'/looping/v3/session/signature_den': [4],
			'/looping/v3/session/scale_root': [2],
			'/looping/v3/session/scale_name': ['Minor'],
			'/looping/v3/session/scale_mode': [1],
			'/looping/v3/session/groove_amount': [0.0],
			'/looping/v3/session/clip_trigger_quantization': [4],
			'/looping/v3/session/auto_arm': [1],
			'/looping/v3/session/move_volume_knob': [0],
			// Deliberately mixed: auto_arm on, move_volume_knob off,
			// auto_capture on — so a shot of the System view exercises
			// both states of the Behavior band rather than one.
			'/looping/v3/session/auto_capture': [1],
			// The rig's foot switch, seeded from midiPedals and heard:
			// [enabled, channel, cc, mode, learn, heard].
			'/looping/v3/session/foot_switch': [1, 10, 23, 'momentary', 'idle', 1],
			// The clip Live is showing. Nothing in the mock ever emitted this,
			// so `session.focusedClipPath` stayed null and the clip view's swap
			// pill — which mounts only for a focused AUDIO clip — could not be
			// photographed at all (ADR-440). Vox's "Verse" rather than the
			// Guitar's only clip, which is RECORDING: `clip/swap_file` refuses
			// one of those, so the pill would be photographing a refusal.
			'/looping/v3/clip/focused': ['tracks/4/slots/1/clip'],
			// Its groove, for the Groove view (opened by touching Q): on one of
			// the default tiles, at the approved design's Amount of 60.
			'/looping/v3/clip/groove/has_groove': ['tracks/4/slots/1/clip', 1],
			'/looping/v3/clip/groove/file': ['tracks/4/slots/1/clip', 'Swing MPC 3000 16ths 74'],
			'/looping/v3/clip/groove/property': ['tracks/4/slots/1/clip', 'timing_amount', 60.0]
		},
		// The AX helper's state as the BRIDGE publishes it (`/bridge/ax_helper`),
		// which is what gates the Drum Rack's kit/pad pill. Part of the scene so
		// a tour state can photograph the not-ready branch; it was hardcoded
		// `ready` in the mock, so that branch was unreachable.
		axHelper: { state: 'ready', detail: '' },
		// The bridge's feature switches as it publishes them
		// (`/bridge/features`, general-release audit §7b). The rig's by
		// default; a view or tour state can switch one off, or leave it on
		// with no answer, to photograph the general edition.
		features: structuredClone(DEFAULT_FEATURES),
		treeArgs,
		playing,
		permuteSteps,
		clipLengths,
		audioClips,
		deviceProperties,
		padRacks
	};
}

/**
 * The ETag token the mock puts on `state/full/tree`.
 *
 * A constant, deliberately. Until protocol 3.6.0 this file carried a
 * hand-mirrored FNV-1a because the UI *validated* the checksum on
 * `state/full/end` and a drifted copy showed up as a silently empty
 * UI. The UI no longer computes anything — it stores the token and
 * echoes it back as an ETag — so there is nothing here to keep in
 * step, and a mirror that can drift without consequence is worse than
 * no mirror.
 *
 * The mock never answers `state/full/unchanged`, so the value is never
 * compared to anything.
 */
export const SCENE_ETAG = '0x5cde0000';
