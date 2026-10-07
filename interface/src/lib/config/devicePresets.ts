/**
 * Device Preset Configuration
 * Simple configuration for FX Grid device presets
 *
 * Colors: every device wears one of the eight DEVICE_FAMILY_INKS below
 * (ADR-400) — device color is module identity in a fixed grid, not state,
 * so it needs function families, not a per-device rainbow.
 */

import constants from '$config/constants.json';
import { machineStore } from '$lib/stores/machineStore.svelte';

export type CurveType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'eq' | 'none';

export interface DeviceColorScheme {
  primary: string;    // Main color for borders and active states
  secondary: string;  // Background color with transparency
  accent: string;     // Bright color for highlights
}

/**
 * A preset's path on the Mac. The table holds `{effectPresetsBase}` in place
 * of the owner's folder, which arrives from the bridge at run time
 * (`/bridge/machine`, onboarding.plan.md §6.5) — an iPad build compiles no
 * machine path in. Before a snapshot lands the folder is '', and the surface
 * answers `path-not-found`, which the tile shows as it always did.
 */
export function resolvePresetPath(presetPath: string): string {
  const base = machineStore.paths.effectPresetsBase;
  // No snapshot yet: the template goes as it is, which the surface answers
  // `path-not-found` exactly as it answers a missing preset file.
  return base ? presetPath.replace('{effectPresetsBase}', base) : presetPath;
}

/**
 * The `/looping/v3/device/load` arguments for a preset: `[trackPath,
 * devicePath, presetPath]`, plus `[source, rel]` when the preset names its
 * Place (3.11.0). A native device sends no path, `native:<class>` and the
 * name it takes (3.12.0).
 */
type LoadFields = Pick<DevicePresetConfig, 'presetPath' | 'source' | 'rel' | 'native' | 'expectedClassName' | 'defaultName'>;

export function deviceLoadArgs(trackPath: string, devicePath: string, preset: LoadFields): string[] {
  if (preset.native) return [trackPath, devicePath, '', loadKey(preset), preset.defaultName];
  const presetPath = resolvePresetPath(preset.presetPath ?? '');
  return preset.source && preset.rel
    ? [trackPath, devicePath, presetPath, preset.source, preset.rel]
    : [trackPath, devicePath, presetPath];
}

/**
 * What the surface names a failed load by, on `/looping/v3/error`'s `path`:
 * a native device's `native:<class>` source (3.12.0), else the preset's
 * path on the Mac.
 */
export function loadKey(preset: Pick<DevicePresetConfig, 'presetPath' | 'native' | 'expectedClassName'>): string {
  return preset.native ? `native:${preset.expectedClassName}` : resolvePresetPath(preset.presetPath ?? '');
}

export interface DevicePresetConfig {
  /** The preset file. Empty when `source` and `rel` name it instead (the surface fills the path in); absent on a native device. */
  presetPath?: string;
  /** A native Live device, inserted by name (protocol 3.12.0): the user's
   *  own default for it applies and no preset file is involved.
   *  `expectedClassName` names the device, `defaultName` what it is called
   *  once in. Racks, plug-in presets and Max devices are files. */
  native?: boolean;
  /** A load that names its Place (protocol 3.11.0): `place:<name>` and the path inside it. */
  source?: string;
  rel?: string;
  defaultName: string;
  expectedClassName: string;
  curveType?: CurveType;
  color: DeviceColorScheme;
  gridSlot?: boolean;           // NEW: false = virtual slot (default: true)
  centralViewGroup?: string;    // NEW: which central view hosts this device
  /** ADR-400: this device wears the focused TRACK's ink instead of its own
   *  color (utility/gain — "the track's own trim"). `color` stays as the
   *  fallback for contexts with no focused track. Honored by the fx-grid
   *  chokepoints (useFxGridSlot, BaseDeviceControl). */
  trackTint?: boolean;
  /** Issue #491 (2026-09-10): this device may live INSIDE a drum pad's
   *  chain — while a pad is held, its tile is that pad's, a touch loads it
   *  into the pad and a drag moves the pad's copy. Every preset sets it: a
   *  native device is inserted by name, a rack or plug-in preset loads
   *  through the browser and is moved into the chain, and a MIDI effect
   *  goes in after the MIDI effects already at the chain's head, directly
   *  before the pad's instrument. Permute joined on 2026-09-14 (ADR-435):
   *  it has no tile, but the strip's Permute section and the Permute view
   *  become the held pad's, and a first step edit ghost-loads one into the
   *  pad's chain, where the surface's engine drives that pad alone. Only
   *  OTT (the master's own column) is unset. Default false. */
  padScoped?: boolean;
}

/** `#rrggbb` → `rgba(r, g, b, alpha)`. Pure string helper — keeps this module
 *  free of color-math imports. */
function rgbaFromHex(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Build a full DeviceColorScheme from one calibrated ink hex (ADR-400).
 *  Used for trackTint devices, where primary/accent are the track ink itself
 *  and secondary is the standard 10% wash. */
export function schemeFromInk(ink: string): DeviceColorScheme {
  return { primary: ink, secondary: rgbaFromHex(ink, 0.1), accent: ink };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE FAMILY INKS (ADR-400)
//
// Eight function-family inks on the same gap-placed hue wheel as the track
// role palette (ADR-399, constants.json:vendors.types): every hue sits in a
// gap between the GRATICULE functional signal hues (app.css --act-*: rec 27,
// master 60, warn 80, loop 155, monitor 210, pitch 262, quant 300).
//
// The hexes are DELIBERATELY duplicated from — not read out of —
// constants.json: that file is user-tunable deployment config for TRACK
// roles; device families are code.
//
// Every primary/accent is a verified fixed point of the ink chain
// (trackInk(hex) === hex; the grey `utility` family through deviceInk(hex)
// === hex), so the chokepoint normalization (useFxGridSlot /
// BaseDeviceControl) and any view-side re-ink are byte no-ops. Accent
// recipe: primary at OKLCH L+0.08, clamped into TRACK_INK (lMax 0.80,
// cMax 0.19), same hue, re-fixed. Guarded by the fixed-point test in
// trackFormatters.test.ts.
//
// RE-BAKED 2026-08-31 for the single-skin cut. These were authored against
// the retired GRATICULE envelope (lMax 0.82 / cMax 0.21) and four accents
// were NOT fixed points of the Hybrid one, so they rendered two ways at
// once: clamped wherever a view re-inked them, raw wherever a component
// read the constant directly. The four are re-authored to the clamped
// value — i.e. to what the re-inking sites have already drawn since Hybrid
// became the default. The envelope is now polarity-independent, so there is
// no separate light-theme derivation.
// ─────────────────────────────────────────────────────────────────────────────

export const DEVICE_FAMILY_INKS = {
  /** Delay / reverb / repeat — effects that live in time and space. H183 teal. */
  timeSpace: { primary: '#00cfb9', accent: '#18dac6' },
  /** Filter / EQ / wah — spectral shaping. H235 azure. */
  filter: { primary: '#12b2f4', accent: '#33cdff' },
  /** Compressor / gate / velocity — level and dynamics. H100 gold. */
  dynamics: { primary: '#ceb92d', accent: '#d2bf45' },
  /** Saturation / distortion / amps / bit-crush. H45 burnt orange. */
  distortion: { primary: '#ff8244', accent: '#ff9e60' },
  /** Chorus / tremolo / comb — cyclic movement. H322 magenta. */
  modulation: { primary: '#d57ce3', accent: '#e79ef3' },
  /** Arpeggiator / pitch / sequencer / chord — note machinery. H281 violet. */
  pitchSeq: { primary: '#8e90ff', accent: '#a29fff' },
  /** Instrument racks / vocal chains — sound sources. H348 rose. */
  rackVoice: { primary: '#f36fb8', accent: '#ff97cd' },
  /** Gain / routing — non-sound plumbing. Near-neutral grey (deviceInk-gated,
   *  never chroma-boosted); in practice overridden by trackTint. */
  utility: { primary: '#a2acb7', accent: '#b5bfcb' }
} as const;

export type DeviceFamily = keyof typeof DEVICE_FAMILY_INKS;

/** The full DeviceColorScheme for a family — primary/accent from the ink
 *  table, secondary as the standard 10% wash. */
export function familyScheme(family: DeviceFamily): DeviceColorScheme {
  const { primary, accent } = DEVICE_FAMILY_INKS[family];
  return { primary, secondary: rgbaFromHex(primary, 0.1), accent };
}

export const DEVICE_PRESETS: Record<string, DevicePresetConfig> = {
  echo: {
    // Replaced the Delay tile 2026-09-14 (user's call).
    padScoped: true,
    native: true,
    defaultName: 'Echo',
    expectedClassName: 'Echo',
    color: familyScheme('timeSpace')
  },
  filter: {
    padScoped: true,
    native: true,
    defaultName: 'Auto Filter',
    expectedClassName: 'AutoFilter2',
    curveType: 'lowpass',
    color: familyScheme('filter')
  },
  compressor: {
    padScoped: true,
    native: true,
    defaultName: 'Compressor',
    expectedClassName: 'Compressor2',
    gridSlot: false,                    // Virtual device
    centralViewGroup: 'squash',         // Belongs to SquashCentralView (2026-09-11)
    color: familyScheme('dynamics')
  },
  gate: {
    padScoped: true,
    native: true,
    defaultName: 'Gate',
    expectedClassName: 'Gate',
    gridSlot: false,                    // Virtual device
    centralViewGroup: 'utility',        // Belongs to UtilityCentralView
    color: familyScheme('dynamics')
  },
  ott: {
    native: true,
    defaultName: 'Multiband Dynamics',
    expectedClassName: 'MultibandDynamics',
    gridSlot: false,                    // Master-only: the fx1 column, not a layout entry
    trackTint: true,                    // Wears master's ink, like the controls it stands in for
    color: familyScheme('dynamics')
  },
  squash: {
    padScoped: true,
    native: true,
    defaultName: 'Glue Compressor',
    expectedClassName: 'GlueCompressor',
    gridSlot: false,                    // Virtual device
    centralViewGroup: 'squash',         // Names SquashCentralView; the control itself is an FX-grid column
    color: familyScheme('dynamics')
  },
  saturator: {
    padScoped: true,
    native: true,
    defaultName: 'Saturator',
    expectedClassName: 'Saturator',
    centralViewGroup: 'pedal',          // Its grid tile (fx5, 2026-10-05) opens PedalCentralView
    color: familyScheme('distortion')
  },
  variation: {
    padScoped: true,
    native: true,
    defaultName: 'Variation',
    expectedClassName: 'BeatRepeat',
    color: familyScheme('timeSpace')
  },
  eq: {
    padScoped: true,
    native: true,
    defaultName: 'Channel EQ',
    expectedClassName: 'ChannelEq',
    curveType: 'eq',
    color: familyScheme('filter')
  },
  bloom: {
    // oeksound bloom, an AU tonal balancer, beside the Channel EQ in the EQ
    // view (2026-10-06). The plug-in is the owner's, so the preset loads from
    // the owner's Effect Patches folder; without the plug-in Live loads a
    // placeholder. Live names it "bloom" and reports AuPluginDevice, read off
    // the running device.
    padScoped: true,
    presetPath: '{effectPresetsBase}/bloom.aupreset',
    defaultName: 'bloom',
    expectedClassName: 'AuPluginDevice',
    gridSlot: false,                    // Virtual device
    centralViewGroup: 'eq',             // Belongs to EQCentralView
    color: familyScheme('filter')       // A tonal balancer, the EQ's family
  },
  drum: {
    // A Drum Buss belongs on a single pad as much as on the track — a
    // kick with its own is the ordinary case (user, 2026-09-11; the tile
    // shipped inert under a pad scope for a day).
    padScoped: true,
    native: true,
    defaultName: 'Drum Buss',
    expectedClassName: 'DrumBuss',
    color: familyScheme('distortion')
  },
  pedal: {
    padScoped: true,
    native: true,
    defaultName: 'Pedal',
    expectedClassName: 'Pedal',
    gridSlot: false,                    // Virtual device: its XY is a column of PedalCentralView (2026-10-05)
    centralViewGroup: 'pedal',
    color: familyScheme('distortion')
  },
  tremolo: {
    // Auto Pan Legacy, inserted by its display name (measured 2026-10-01).
    padScoped: true,
    native: true,
    defaultName: 'Auto Pan Legacy',
    expectedClassName: 'AutoPan',
    color: familyScheme('modulation')
  },
  arpeggiator: {
    // MIDI effects go BEFORE the pad's instrument; the surface inserts them at the chain's head (2026-09-11).
    padScoped: true,
    native: true,
    defaultName: 'Arpeggiator',
    expectedClassName: 'MidiArpeggiator',
    color: familyScheme('pitchSeq')
  },
  utility: {
    padScoped: true,
    native: true,
    defaultName: 'Utility',
    expectedClassName: 'StereoGain',
    trackTint: true,                    // Wears the focused track's ink (ADR-400)
    color: familyScheme('utility')
  },
  shifter: {
    // Live's Shifter, one fader in PedalCentralView (2026-10-05, in place
    // of the Digital rack's XY): 18 RM Coarse, written with 32 Mode = Ring
    // on load. Class and indices measured off the running device.
    padScoped: true,
    native: true,
    defaultName: 'Shifter',
    expectedClassName: 'Shifter',
    gridSlot: false,                    // Virtual device
    centralViewGroup: 'pedal',          // Belongs to PedalCentralView
    color: familyScheme('distortion')
  },
  redux: {
    padScoped: true,
    native: true,
    defaultName: 'Redux',
    expectedClassName: 'Redux2',
    gridSlot: false,                    // Virtual device
    centralViewGroup: 'pedal',          // Belongs to PedalCentralView
    color: familyScheme('distortion')
  },
  reverb: {
    padScoped: true,
    native: true,
    defaultName: 'Reverb',
    expectedClassName: 'Hybrid',
    color: familyScheme('timeSpace')
  },
  sequencer: {
    padScoped: true,
    // Permute ships in the repo, under `Vamp Devices`, and loads through
    // the "Vamp Devices" sidebar Place (onboarding.plan.md §6.3): the load
    // names the Place and the path inside it, and the surface — which knows
    // where the checkout is — fills the absolute path in. Until 2026-09-26 it
    // was `paths.placesRoots.Permute` from the config.
    presetPath: '',
    source: 'place:Vamp Devices',
    rel: 'Permute/Permute.amxd',
    defaultName: 'Permute',
    expectedClassName: 'MxDeviceAudioEffect',
    color: familyScheme('pitchSeq')
  },
  digital: {
    // Ships in the repo, in Vamp Devices, and loads through that Place
    // like Blur (2026-10-03; the User Library's Effect Patches before).
    padScoped: true,
    presetPath: '',
    source: 'place:Vamp Devices',
    rel: 'Digital/Digital.adg',
    defaultName: 'Digital',
    expectedClassName: 'AudioEffectGroupDevice',
    gridSlot: false,                    // Virtual device
    centralViewGroup: 'pedal',          // Belongs to PedalCentralView
    color: familyScheme('distortion')
  },
  comb: {
    // Comb ships in the repo beside Blur and loads the same way, through the
    // "Vamp Devices" Place. It is a Max rebuild of the owner's Zebrify
    // "Dissonant" comb patch (four cross-fed delays with a level limiter),
    // and took this slot from that plug-in preset (2026-10-05), so the tile
    // no longer needs a plug-in. The name is load-bearing: Blur, Permute and
    // Pitch Hack are MxDeviceAudioEffect too.
    padScoped: true,
    presetPath: '',
    source: 'place:Vamp Devices',
    rel: 'Comb/Comb.amxd',
    defaultName: 'Comb',
    expectedClassName: 'MxDeviceAudioEffect',
    gridSlot: false,                    // Virtual device
    centralViewGroup: 'smudge',         // Belongs to SmudgeCentralView
    color: familyScheme('modulation')
  },
  phaser: {
    padScoped: true,
    native: true,
    defaultName: 'Phaser',
    expectedClassName: 'PhaserNew',
    gridSlot: false,                    // Virtual device
    centralViewGroup: 'chorus',         // Belongs to ChorusCentralView
    color: familyScheme('modulation')
  },
  pitchHack: {
    // Creative Extensions' Max pitch-shifting delay. The .adv is a preset of
    // the pack's .amxd (FileRef → Packs/Creative Extensions), so it loads
    // through the browser — a Max device has no insert-by-name path — and
    // Live names it after the .adv. The name is load-bearing: Permute is an
    // MxDeviceAudioEffect too.
    // In Vamp Devices since 2026-10-03, like Digital.
    padScoped: true,
    presetPath: '',
    source: 'place:Vamp Devices',
    rel: 'Pitch Hack/Pitch Hack.adv',
    defaultName: 'Pitch Hack',
    expectedClassName: 'MxDeviceAudioEffect',
    gridSlot: false,                    // Virtual device
    centralViewGroup: undefined,        // No view since GlitchLoop took its place (2026-10-06)
    color: familyScheme('pitchSeq')     // A pitch shifter — function over host view
  },
  glitchLoop: {
    // GlitchLoop: PitchLoop89 with built-in mod slots, built by the owner's
    // glitchloop repo (dist/GlitchLoop.amxd). It embeds Ableton's PitchLoop89
    // patch, so it stays out of this public repo and loads from the owner's
    // Effect Patches folder, where the file is a hard link to the glitchloop
    // build. Took Pitch Hack's place in the Chorus view (2026-10-06). The
    // name is load-bearing: Blur, Permute and Pitch Hack are
    // MxDeviceAudioEffect too.
    padScoped: true,
    presetPath: '{effectPresetsBase}/GlitchLoop.amxd',
    defaultName: 'GlitchLoop',
    expectedClassName: 'MxDeviceAudioEffect',
    gridSlot: false,                    // Virtual device
    centralViewGroup: 'chorus',         // Belongs to ChorusCentralView
    color: familyScheme('distortion')   // Orange (user, 2026-10-07): violet sat too close to Octave beside it
  },
  smudge: {
    // Blur ships in the repo beside Permute and loads the same way, through
    // the "Vamp Devices" Place. It is a Max freeze-looper: two voices take
    // turns holding a 45 ms slice of the input under long crossfades. It took
    // this slot from the owner's Saturn 2 preset (2026-10-03), so the tile no
    // longer needs a plug-in. The name is load-bearing: Permute and Pitch
    // Hack are MxDeviceAudioEffect too.
    padScoped: true,
    presetPath: '',
    source: 'place:Vamp Devices',
    rel: 'Blur/Blur.amxd',
    defaultName: 'Blur',
    expectedClassName: 'MxDeviceAudioEffect',
    gridSlot: false,                    // Virtual device
    centralViewGroup: 'chorus',         // Belongs to ChorusCentralView
    color: familyScheme('distortion')   // Kept from the Saturn tile: its ink tells it apart inside the Chorus view
  },
  // New grid devices to replace saturator slot
  guitar: {
    // The amp rack lives on a pad as well as on a track (user, 2026-09-11); it loads through the browser and is moved into the chain.
    padScoped: true,
    presetPath: '{effectPresetsBase}/Guitar.adg',
    defaultName: 'Guitar',
    expectedClassName: 'AudioEffectGroupDevice',
    color: familyScheme('distortion')
  },
  bass: {
    // Same as Guitar: a rack, through the browser and into the chain. It was
    // a Helix Native preset until 2026-10-03; the rack (Octave Pedal → Glue
    // Compressor → TONE3000) shows one macro, the mix, which is all the
    // tile drives; no view repeats it. Live names it after the .adg, which
    // is how the slot re-finds it.
    padScoped: true,
    presetPath: '{effectPresetsBase}/Bass Amp.adg',
    defaultName: 'Bass Amp',
    expectedClassName: 'AudioEffectGroupDevice',
    // Violet, not the Guitar's orange (2026-10-01): it shares the Guitar
    // view, and its own ink is what tells its controls apart there.
    color: familyScheme('pitchSeq')
  },
  octave: {
    // The Chorus view's Octave panel: Ben's Polyphonic Pitch Shifter
    // (2026-10-05, in place of a Helix Native preset), the frozen 0.1.0
    // Max device from the BensPolyphonicPitchShifter repo, so it carries
    // `polypitch~` inside and needs no Max package. Saved as Octave.amxd,
    // so Live names it "Octave"; the name is load-bearing, since Comb,
    // Blur and Permute are MxDeviceAudioEffect too. Measured off the
    // running device: 1 Semitones (-12..12), 2 Mix (0..100). No tile of
    // its own: the view is its only control.
    padScoped: true,
    presetPath: '',
    source: 'place:Vamp Devices',
    rel: 'Octave/Octave.amxd',
    defaultName: 'Octave',
    expectedClassName: 'MxDeviceAudioEffect',
    gridSlot: false,                    // Virtual device
    centralViewGroup: 'chorus',         // Belongs to ChorusCentralView (OctavePanel)
    color: familyScheme('pitchSeq')
  },
  // Virtual Smudge Device
  chorus: {
    padScoped: true,
    native: true,
    defaultName: 'Chorus',
    expectedClassName: 'Chorus2',
    color: familyScheme('modulation')
  },
  // Virtual Arpeggiator Devices
  random: {
    // MIDI effect: inserted at the head of the pad's chain (2026-09-11).
    padScoped: true,
    native: true,
    defaultName: 'Random',
    expectedClassName: 'MidiRandom',
    color: familyScheme('pitchSeq')
  },
  velocity: {
    // MIDI effect: inserted at the head of the pad's chain (2026-09-11).
    padScoped: true,
    native: true,
    defaultName: 'Velocity',
    expectedClassName: 'MidiVelocity',
    gridSlot: false,
    centralViewGroup: 'arpeggiator',
    color: familyScheme('dynamics')
  },
  chord: {
    // MIDI effect: inserted at the head of the pad's chain (2026-09-11).
    padScoped: true,
    native: true,
    defaultName: 'Chord',
    expectedClassName: 'MidiChord',
    gridSlot: false,
    centralViewGroup: 'arpeggiator',
    color: familyScheme('pitchSeq')
  },
  chance: {
    // A Max MIDI effect (one parameter: [1] Chance, 0-100 %, 101 steps),
    // so it never takes the insert-by-name path — no native class, no
    // Live default; the browser loads the .amxd out of Effect Patches
    // and Live names the device after the file. MIDI effect all the
    // same, so a pad load lands at the head of the pad's chain like
    // Random/Velocity/Chord. The library copy's own parameter_initial
    // is 100 (the Downloads original ships 50), so a fresh insert passes
    // every note until a finger says otherwise.
    padScoped: true,
    presetPath: '{effectPresetsBase}/Note Chance.amxd',
    defaultName: 'Note Chance',
    expectedClassName: 'MxDeviceMidiEffect',
    gridSlot: false,
    centralViewGroup: 'arpeggiator',
    color: familyScheme('pitchSeq')
  },
  wah: {
    // In Vamp Devices since 2026-10-03, like Digital. The surface finds
    // the same file for the pedal (`live_library.WAH_REL`), and its path is
    // what lands the rack at the head of the chain.
    padScoped: true,
    presetPath: '',
    source: 'place:Vamp Devices',
    rel: 'Wah/Wah.adg',
    defaultName: 'Wah',
    expectedClassName: 'AudioEffectGroupDevice',
    gridSlot: false,                    // Virtual device
    centralViewGroup: 'pedal',          // Its button is in PedalCentralView
    color: familyScheme('filter')       // A wah IS a filter — function over host view
  },
  vocal: {
    // No control loads it: the entry is how a track's device band knows a
    // Vocal rack (its mic glyph). The preset is not shipped (2026-10-03).
    padScoped: true,
    presetPath: '',
    defaultName: 'Vocal',
    expectedClassName: 'AudioEffectGroupDevice',
    gridSlot: false,                    // Virtual device
    centralViewGroup: 'reverb',         // Belongs to ReverbCentralView
    color: familyScheme('rackVoice')
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SHARED CENTRAL-VIEW PALETTES (GRATICULE §5.5 — dedup)
// These were copy-pasted across ~9 device central views. Single source here;
// all derive from the family inks above, so they are ink fixed points too —
// the view-side `trackInk()` normalization idiom stays a byte no-op.
// ─────────────────────────────────────────────────────────────────────────────

/** MIDI pitch-bend wheel color. Shared across instrument central views.
 *  pitchSeq violet — the old blue (#3b82f6, OKLCH H260) sat 2° from the
 *  reserved --act-pitch signal hue. */
export const PITCH_COLOR: DeviceColorScheme = familyScheme('pitchSeq');

/** MIDI mod-wheel color. Shared across instrument central views.
 *  modulation magenta — the old orange (#f97316, H48) crowded --act-master. */
export const MOD_COLOR: DeviceColorScheme = familyScheme('modulation');

/** Chartreuse (H135) — the track-role "audio" hue (ADR-399); the 9th ink of
 *  the gap wheel. Fills the 8th macro slot so no macro wears the
 *  disabled-looking utility grey, and gives sub-device palettes (drum-rack
 *  modes, reverb algorithms) a green that stays off the loop-signal hue. */
export const CHARTREUSE_SCHEME: DeviceColorScheme = {
  primary: '#89ce5f',
  secondary: 'rgba(137, 206, 95, 0.1)',
  accent: '#96d273'
};

/** Per-macro control palette (instrument-rack macro grids) — the full 8-hue
 *  gap wheel, ordered for adjacent contrast; index 0 = the rack theme.
 *  Indexed via getControlColor(). */
export const CONTROL_COLORS: DeviceColorScheme[] = [
  familyScheme('rackVoice'),   // rose (rack theme)
  familyScheme('timeSpace'),   // teal
  familyScheme('dynamics'),    // gold
  familyScheme('filter'),      // azure
  familyScheme('distortion'),  // burnt orange
  CHARTREUSE_SCHEME,           // chartreuse
  familyScheme('modulation'),  // magenta
  familyScheme('pitchSeq')     // violet
];

/** Get the macro palette for a control by index (wraps). */
export function getControlColor(index: number): DeviceColorScheme {
  return CONTROL_COLORS[index % CONTROL_COLORS.length];
}

// Utility functions for slot classification
export function getGridSlots(): string[] {
  return Object.entries(DEVICE_PRESETS)
    .filter(([_, config]) => config.gridSlot !== false)
    .map(([key, _]) => key);
}

export function getVirtualSlots(): string[] {
  return Object.entries(DEVICE_PRESETS)
    .filter(([_, config]) => config.gridSlot === false)
    .map(([key, _]) => key);
}

export function getCentralViewDevices(viewGroup: string): string[] {
  return Object.entries(DEVICE_PRESETS)
    .filter(([_, config]) => config.centralViewGroup === viewGroup)
    .map(([key, _]) => key);
}
