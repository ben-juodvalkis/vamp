/**
 * Device Preset Configuration
 * Simple configuration for FX Grid device presets
 *
 * Colors: every device wears one of the eight DEVICE_FAMILY_INKS below
 * (ADR-400) — device color is module identity in a fixed grid, not state,
 * so it needs function families, not a per-device rainbow.
 */

import constants from '$config/constants.json';

export type CurveType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'eq' | 'none';

export interface DeviceColorScheme {
  primary: string;    // Main color for borders and active states
  secondary: string;  // Background color with transparency
  accent: string;     // Bright color for highlights
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
  const presetPath = preset.presetPath ?? '';
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
  return preset.native ? `native:${preset.expectedClassName}` : (preset.presetPath ?? '');
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
  /**
   * One of Vamp's own effects (an amp rack, a Max effect), not shipped with
   * it: found by name in the user's effects folder (ADR-498,
   * `services/effectSources`), never a fixed path. Absent: a native device or
   * a Vamp utility (Permute) the app loads from Vamp Devices.
   */
  effect?: boolean;
  defaultName: string;
  /** Other names Live gives the same device: Live names a loaded file after
   *  itself, so a copy under another name (the shelf's "Tone Shaper.amxd",
   *  a Pitch Shift saved while it was "Octave.amxd") arrives under that name. */
  aliases?: readonly string[];
  expectedClassName: string;
  curveType?: CurveType;
  color: DeviceColorScheme;
  gridSlot?: boolean;           // NEW: false = virtual slot (default: true)
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
  /** MIDI effects and the sequencer — note machinery, and nothing that
   *  processes audio (user, 2026-11-11). H281 violet. */
  pitchSeq: { primary: '#8e90ff', accent: '#a29fff' },
  /** Instrument racks / vocal chains — sound sources. H348 rose. */
  rackVoice: { primary: '#f36fb8', accent: '#ff97cd' },
  /** Glitch Loop / Pitch Hack / Stutter — buffer tricks (user, 2026-11-11).
   *  H135 green, in the gap between gold and the loop signal. */
  glitch: { primary: '#79c24a', accent: '#8cd55e' },
  /** Guitar / Bass Amp / Wah — the guitar rig (user, 2026-11-11). H62
   *  amber, a low-chroma wood between orange and gold. */
  guitar: { primary: '#d38c49', accent: '#eea563' },
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
    color: familyScheme('dynamics')
  },
  gate: {
    padScoped: true,
    native: true,
    defaultName: 'Gate',
    expectedClassName: 'Gate',
    gridSlot: false,                    // Virtual device
    color: familyScheme('dynamics')
  },
  ott: {
    native: true,
    defaultName: 'Multiband Dynamics',
    expectedClassName: 'MultibandDynamics',
    gridSlot: false,                    // Virtual device
    color: familyScheme('dynamics')
  },
  squash: {
    padScoped: true,
    native: true,
    defaultName: 'Glue Compressor',
    expectedClassName: 'GlueCompressor',
    gridSlot: false,                    // Virtual device
    color: familyScheme('dynamics')
  },
  saturator: {
    padScoped: true,
    native: true,
    defaultName: 'Saturator',
    expectedClassName: 'Saturator',
    color: familyScheme('distortion')
  },
  roar: {
    // Roar (Live 12): three stages of shaper and filter, a routing mode,
    // feedback and four mod sources. Measured on the rig, 2026-11-07.
    padScoped: true,
    native: true,
    defaultName: 'Roar',
    expectedClassName: 'Roar',
    gridSlot: false,                    // Virtual device
    color: familyScheme('distortion')
  },
  variation: {
    padScoped: true,
    native: true,
    defaultName: 'Variation',
    expectedClassName: 'BeatRepeat',
    color: familyScheme('glitch')       // Glitch (user, 2026-11-11)
  },
  eq: {
    padScoped: true,
    native: true,
    defaultName: 'Channel EQ',
    expectedClassName: 'ChannelEq',
    curveType: 'eq',
    color: familyScheme('filter')
  },
  toneShaper: {
    // Ben's Adaptive Tone Shaper, beside the Channel EQ in the EQ view
    // (2026-10-07; oeksound bloom's sliders stood there the day before). Our
    // own Max for Live device, found by name in the user's effects folder
    // (ADR-498; the owner's shelf calls it "Tone Shaper"). Its graph (ToneShaperGraph) is the whole view
    // of it; the spectrum and the curve come from the device itself over
    // `/toneshaper/frame`, not from the LOM. Parameters, read off the
    // running device: 1 Amount 0..10, 2..5 Lows / Lo-mids / Hi-mids / Highs
    // -10..10, 6 Latency (1 = zero), 7 Quality (1 = eco), 8..11 the four
    // centers in Hz. Live names a loaded .amxd after its file.
    padScoped: true,
    effect: true,
    defaultName: "Ben's Adaptive Tone Shaper",
    aliases: ['Tone Shaper'],
    expectedClassName: 'MxDeviceAudioEffect',
    gridSlot: false,                    // Virtual device
    color: familyScheme('filter')       // A tone balancer, the EQ's family
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
    gridSlot: false,                    // Virtual device: no tile; PedalCentralView is its own view
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
  autoPanTremolo: {
    // Live 12's Auto Pan-Tremolo (2026-11-06), beside the Legacy one the
    // Tremolo slot drives. Live accepts its display name for an insert, so
    // the surface needs no row for it. Class measured off the running device.
    padScoped: true,
    native: true,
    defaultName: 'Auto Pan-Tremolo',
    expectedClassName: 'AutoPan2',
    gridSlot: false,                    // Virtual device
    color: familyScheme('modulation')
  },
  eq8: {
    // EQ Eight (2026-11-06): eight bands on a curve, Live's panel.
    padScoped: true,
    native: true,
    defaultName: 'EQ Eight',
    expectedClassName: 'Eq8',
    gridSlot: false,                    // Virtual device
    color: familyScheme('filter')
  },
  delay: {
    // Live's Delay (2026-11-06), the plain two-line delay beside Echo.
    padScoped: true,
    native: true,
    defaultName: 'Delay',
    expectedClassName: 'Delay',
    gridSlot: false,                    // Virtual device
    color: familyScheme('timeSpace')
  },
  limiter: {
    // Live's Limiter (2026-11-06).
    padScoped: true,
    native: true,
    defaultName: 'Limiter',
    expectedClassName: 'Limiter',
    gridSlot: false,                    // Virtual device
    color: familyScheme('dynamics')
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
    // Live's Shifter, one fader in ShifterCentralView (2026-10-26; in the
    // Pedal view from 2026-10-05, in place of the Digital rack's XY): 18 RM Coarse, written with 32 Mode = Ring
    // on load. Class and indices measured off the running device.
    padScoped: true,
    native: true,
    defaultName: 'Shifter',
    expectedClassName: 'Shifter',
    gridSlot: false,                    // Virtual device
    color: familyScheme('distortion')
  },
  redux: {
    padScoped: true,
    native: true,
    defaultName: 'Redux',
    expectedClassName: 'Redux2',
    gridSlot: false,                    // Virtual device
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
  comb: {
    // Comb is found by name in the user's effects folder (ADR-498). It is a Max rebuild of the owner's Zebrify
    // "Dissonant" comb patch (four cross-fed delays with a level limiter),
    // and took this slot from that plug-in preset (2026-10-05), so the tile
    // no longer needs a plug-in. The name is load-bearing: Blur, Permute and
    // Pitch Hack are MxDeviceAudioEffect too.
    padScoped: true,
    effect: true,
    defaultName: 'Comb',
    expectedClassName: 'MxDeviceAudioEffect',
    gridSlot: false,                    // Virtual device
    color: familyScheme('timeSpace')    // A space effect, with Echo and Reverb (user, 2026-11-11; gold from 2026-10-19)
  },
  phaser: {
    padScoped: true,
    native: true,
    defaultName: 'Phaser',
    expectedClassName: 'PhaserNew',
    gridSlot: false,                    // Virtual device
    color: familyScheme('modulation')   // Cyclic movement (user, 2026-11-11; rose from 2026-10-19)
  },
  pitchHack: {
    // Creative Extensions' Max pitch-shifting delay. The .adv is a preset of
    // the pack's .amxd (FileRef → Packs/Creative Extensions), so it loads
    // through the browser — a Max device has no insert-by-name path — and
    // Live names it after the .adv. The name is load-bearing: Permute is an
    // MxDeviceAudioEffect too.
    // Found by name in the user's effects folder (ADR-498).
    padScoped: true,
    effect: true,
    defaultName: 'Pitch Hack',
    expectedClassName: 'MxDeviceAudioEffect',
    gridSlot: false,                    // Virtual device
    color: familyScheme('glitch')       // Glitch (user, 2026-11-11)
  },
  glitchLoop: {
    // GlitchLoop: PitchLoop89 with built-in mod slots, built by the owner's
    // glitchloop repo. Its engine is a port of PitchLoop89, so it stays out
    // of this public repo; it is found by name in the user's effects folder
    // (ADR-498), where glitchloop's build copies dist/GlitchLoop.amxd on the
    // owner's Mac. Live's browser lists no symlink
    // (measured: a linked folder never appeared, a real one within 20 s),
    // and a copy elsewhere went stale. The Glitch tile and view drive it by
    // parameter name (glitchLoopParams.ts). The name is load-bearing: Blur,
    // Permute and Pitch Hack are MxDeviceAudioEffect too.
    padScoped: true,
    effect: true,
    defaultName: 'GlitchLoop',
    expectedClassName: 'MxDeviceAudioEffect',
    gridSlot: false,                    // Virtual device
    color: familyScheme('glitch')       // Glitch (user, 2026-11-11)
  },
  smudge: {
    // Blur is found by name in the user's effects folder (ADR-498). It is a Max freeze-looper: two voices take
    // turns holding a 45 ms slice of the input under long crossfades. It took
    // this slot from the owner's Saturn 2 preset (2026-10-03), so the tile no
    // longer needs a plug-in. The name is load-bearing: Permute and Pitch
    // Hack are MxDeviceAudioEffect too.
    padScoped: true,
    effect: true,
    defaultName: 'Blur',
    expectedClassName: 'MxDeviceAudioEffect',
    gridSlot: false,                    // Virtual device
    color: familyScheme('glitch')       // Glitch, as its folder is (user, 2026-11-11; orange from the Saturn tile until then)
  },
  // New grid devices to replace saturator slot
  guitar: {
    // The amp rack lives on a pad as well as on a track (user, 2026-09-11); it loads through the browser and is moved into the chain.
    padScoped: true,
    effect: true,
    defaultName: 'Guitar',
    expectedClassName: 'AudioEffectGroupDevice',
    color: familyScheme('guitar')       // The guitar rig (user, 2026-11-11)
  },
  bass: {
    // Same as Guitar: a rack, through the browser and into the chain. It was
    // a Helix Native preset until 2026-10-03; the rack (Pitch Shift → Glue
    // Compressor → TONE3000) shows one macro, the mix, which is all the
    // tile drives; no view repeats it. Live names it after the .adg, which
    // is how the slot re-finds it.
    padScoped: true,
    effect: true,
    defaultName: 'Bass Amp',
    expectedClassName: 'AudioEffectGroupDevice',
    // The Guitar's own ink since 2026-11-11 (violet from 2026-10-01, to
    // tell its controls apart in the Guitar view they share).
    color: familyScheme('guitar')       // The guitar rig (user, 2026-11-11)
  },
  octave: {
    // Pitch Shift: Ben's Polyphonic Pitch Shifter (2026-10-05, in place of
    // a Helix Native preset), the frozen 0.1.0 Max device from the
    // BensPolyphonicPitchShifter repo, so it carries `polypitch~` inside and
    // needs no Max package. Found by name in the user's effects folder
    // (ADR-498) as "Pitch Shift.amxd", so Live names it "Pitch Shift"; the
    // name is load-bearing, since Comb, Blur and Permute are
    // MxDeviceAudioEffect too. Called the Octave until 2026-11-01 (the user):
    // the key stays `octave`, and the old name is an alias for the devices
    // saved sets already hold. Measured off the
    // running device: 1 Semitones (-12..12), 2 Mix (0..100). No tile of
    // its own: the view is its only control.
    padScoped: true,
    effect: true,
    defaultName: 'Pitch Shift',
    aliases: ['Octave'],
    expectedClassName: 'MxDeviceAudioEffect',
    gridSlot: false,                    // Virtual device
    color: familyScheme('distortion')   // With Shifter; violet is the MIDI effects' alone (user, 2026-11-11)
  },
  // Virtual Smudge Device
  chorus: {
    padScoped: true,
    native: true,
    defaultName: 'Chorus',
    expectedClassName: 'Chorus2',
    color: familyScheme('modulation')   // Cyclic movement (user, 2026-11-11; azure beside Auto Pan from 2026-10-19)
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
    color: familyScheme('pitchSeq')     // A MIDI effect: violet, as they all are (user, 2026-11-11)
  },
  chord: {
    // MIDI effect: inserted at the head of the pad's chain (2026-09-11).
    padScoped: true,
    native: true,
    defaultName: 'Chord',
    expectedClassName: 'MidiChord',
    gridSlot: false,
    color: familyScheme('pitchSeq')
  },
  chance: {
    // A Max MIDI effect (one parameter: [1] Chance, 0-100 %, 101 steps),
    // so it never takes the insert-by-name path — no native class, no
    // Live default; the .amxd is found by name in the user's effects
    // folder (ADR-498) and Live names the device after the file. MIDI effect all the
    // same, so a pad load lands at the head of the pad's chain like
    // Random/Velocity/Chord. The library copy's own parameter_initial
    // is 100 (the Downloads original ships 50), so a fresh insert passes
    // every note until a finger says otherwise.
    padScoped: true,
    effect: true,
    defaultName: 'Note Chance',
    expectedClassName: 'MxDeviceMidiEffect',
    gridSlot: false,
    color: familyScheme('pitchSeq')
  },
  wah: {
    // Found by name in the user's effects folder (ADR-498). The pedal's own
    // load is the owner's `devices.wah.presetPath`; a load of a file named
    // Wah.adg lands at the head of the chain.
    padScoped: true,
    effect: true,
    defaultName: 'Wah',
    expectedClassName: 'AudioEffectGroupDevice',
    gridSlot: false,                    // Virtual device
    color: familyScheme('guitar')       // The guitar rig (user, 2026-11-11)
  },
  vocal: {
    // No control loads it: the entry is how a track's device band knows a
    // Vocal rack (its mic glyph). The preset is not shipped (2026-10-03).
    padScoped: true,
    presetPath: '',
    defaultName: 'Vocal',
    expectedClassName: 'AudioEffectGroupDevice',
    gridSlot: false,                    // Virtual device
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
