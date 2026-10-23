/**
 * useTrackDevice — the strip's DEVICE band (the third card section).
 *
 * The strip's other two sections each answer a question about the track
 * from data the v3 tree already carries: Clip says what is playing,
 * Permute says what is being done to it. This one says **what makes the
 * sound** — the head of the track's device chain — and its tap is the
 * door to that device's central view, the same way Clip's and Permute's
 * taps are doors to theirs.
 *
 * The band carries NO TEXT (user, 2026-09-14). A strip is ~72px wide in
 * a twelve-track set and the three bands above and below it are already
 * dense; a device name in that space reads as clutter rather than as
 * information. So each track gets ONE picture,
 * and {@link TrackDeviceGlance.mode} is the choice of which:
 *
 *   glyph  one mark for what kind of thing this is: for an instrument,
 *          the category its preset came from (a keyboard for Key, a
 *          djembe for Perc, …; see `glyphForCategory`), else the
 *          instrument's own mark (Omnisphere's orb, Drift's saw, …; user,
 *          2026-10-20, in place of a knob on its first control); the
 *          pattern rack's shaker; and every audio track's, from its devices
 *   ghost  nothing on the track at all
 *
 * The name is still here for the band's `title`, which is a tooltip and
 * costs no pixels.
 *
 * Reads nothing new off the wire: device names and class names are
 * already in the state/full tree for EVERY track.
 */

import { v3Store } from '$lib/stores/v3/normalized.svelte';
import type { DeviceRecord, TrackRecord } from '$lib/stores/v3/normalized.svelte';
import {
	instrumentService,
	type InstrumentInfo,
	type InstrumentType
} from '$lib/services/instrumentService';
import { DEVICE_PRESETS, type DevicePresetConfig } from '$lib/config/devicePresets';
import {
	CHARACTER_DEVICE_KEYS,
	glyphForCategory,
	glyphForInstrument,
	glyphForPresetKey,
	type DeviceGlyph
} from '$lib/config/deviceGlyphMap';
import { trackCategory } from '$lib/services/trackCategory';
import { isViewRegistered } from '$lib/components/v6/central/viewRegistry';

/**
 * What the band is showing.
 *
 * - `instrument` — a MIDI track's chain-first instrument.
 * - `device` — no instrument (an audio track, or a MIDI track that has
 *   lost its instrument): the chain-first device stands in. Same band,
 *   same tap, different head.
 * - `empty` — an empty chain. Ghost rows, and the tap still selects.
 */
export type TrackDeviceKind = 'instrument' | 'device' | 'empty';

/**
 * What the band draws. Decided here rather than in the component so the
 * rule is one readable function and a test can pin it.
 */
export type TrackDeviceMode = 'glyph' | 'ghost';

export interface TrackDeviceGlance {
	kind: TrackDeviceKind;
	/** The head device's name — Live's, so a rack reads as its PRESET ("32 Pad Kit Jazz"). */
	name: string | null;
	/** Set when `kind === 'instrument'` — including the types no view is registered for. */
	instrumentType: InstrumentType | null;
	/**
	 * The instrument type a tap should OPEN, which is `instrumentType`
	 * only when the rig has a view registered for it. A third-party
	 * plug-in bottoms out at `plugin` / `unknown`, and opening the
	 * instrument view on one lands on the empty default view — a tap
	 * that visibly does nothing. Null sends the tap to the same fallback
	 * a chain with no view takes.
	 */
	instrumentViewType: InstrumentType | null;
	/** The record the instrument central view is handed, when the head is an instrument. */
	instrument: InstrumentInfo | null;
	/** The head's device path. */
	headPath: string | null;
	/**
	 * The registry key of the head's central view when it is a plain
	 * device with one (`filter`, `delay`, …), else null. Null is not a
	 * failure: a plug-in the rig has no view for is still named and
	 * still selects its track — the tap just falls back to the view
	 * selecting an audio track always gives (see `TrackStrip`).
	 */
	deviceViewType: string | null;
	/** Which picture the band draws. */
	mode: TrackDeviceMode;
	/** The mark for `mode: 'glyph'` — see `config/deviceGlyphMap.ts`. */
	glyph: DeviceGlyph;
	/** The head's own ink — the device family's, when the rig knows the device. */
	ink: string | null;
}

/**
 * Class names several presets share, where the class alone cannot name
 * the device. `AuPluginDevice` is Guitar, Helix Native, Omnisphere and
 * Komplete Kontrol at once; `AudioEffectGroupDevice` is every rack the
 * rig ships. For these the preset's `defaultName` has to match too, or
 * the band would ink a Helix Native as a Wah.
 */
const AMBIGUOUS_CLASSES = new Set([
	'AuPluginDevice',
	'PluginDevice',
	'AudioEffectGroupDevice',
	'InstrumentGroupDevice',
	'MxDeviceAudioEffect',
	'MxDeviceMidiEffect'
]);

/**
 * The rig's preset entry for a device: an exact `(className, name)` match
 * — the same predicate the FX grid's slot matcher uses — else, for a
 * class only one preset claims, that preset.
 */
function presetEntryFor(device: DeviceRecord): [string, DevicePresetConfig] | null {
	let byClassOnly: [string, DevicePresetConfig] | null = null;
	for (const entry of Object.entries(DEVICE_PRESETS)) {
		const config = entry[1];
		if (config.expectedClassName !== device.className) continue;
		if (config.defaultName === device.name) return entry;
		if (!AMBIGUOUS_CLASSES.has(device.className) && !byClassOnly) byClassOnly = entry;
	}
	return byClassOnly;
}

/** The central-view registry key for a device, or null when the rig has no view for it. */
function deviceViewTypeFor(device: DeviceRecord): string | null {
	const entry = presetEntryFor(device);
	if (!entry) return null;
	return isViewRegistered('device', entry[0]) ? entry[0] : null;
}

/**
 * Can this track hold an instrument at all?
 *
 * The same classification `selectedTrackStore.trackType` makes, per
 * track rather than for the selected one: a group is neither (it reports
 * `hasAudioInput` but hosts nothing), MIDI wins where both flags are set
 * (an External Instrument track can host one), and everything else is
 * audio.
 *
 * Load-bearing here rather than a nicety. `AuPluginDevice` is in
 * `INSTRUMENT_CLASSES` — it has to be, it is how Omnisphere and Komplete
 * Kontrol are found — so on an audio track the instrument finder claims
 * the first plug-in in the chain, and a guitar track's amp sim came back
 * as the track's "instrument", inked as the track's voice and opening an
 * instrument view that does not exist. An audio track has no instrument,
 * whatever its device classes say.
 */
function canHoldInstrument(track: TrackRecord | undefined): boolean {
	if (!track) return false;
	if (track.isFoldable) return false;
	return track.hasMidiInput;
}

/**
 * The Instrument Rack split `identifyInstrumentTypeAsync` makes — first
 * macro named "Pattern NN" means the pattern rack — done here rather than
 * called, because that method resolves macro names through
 * `selectedTrackStore`, which would answer for the SELECTED track on
 * every strip. The names are path-keyed in the tree, so the same test
 * runs per track, synchronously. Keep the regex in step with
 * `instrumentService`: this decides the view type a band tap opens, and
 * the two disagreeing would show a rack one way from the strip and
 * another from the coordinator.
 */
function refineInstrumentType(instrument: InstrumentInfo, base: InstrumentType): InstrumentType {
	const rack =
		instrument.className === 'InstrumentGroupDevice' ||
		instrument.className === 'AudioEffectGroupDevice';
	if (!rack || !instrument.devicePath) return base;
	const record = v3Store.deviceByPath.get(instrument.devicePath);
	if (!record) return base;
	const macro1 = [...record.params.values()][1]?.name;
	return macro1 && /^Pattern\s+\d+$/i.test(macro1) ? 'instrument-rack-pattern' : base;
}

/**
 * The device whose glyph the band should draw: the first CHARACTER
 * device anywhere in the chain (see `deviceGlyphMap`), else the head.
 * The guitar track is the case — its chain head is an Auto Filter and
 * its identity is the amp three devices later.
 */
function glyphDevice(devices: DeviceRecord[], head: DeviceRecord): DeviceRecord {
	for (const device of devices) {
		const key = presetEntryFor(device)?.[0];
		if (key && CHARACTER_DEVICE_KEYS.includes(key)) return device;
	}
	return head;
}

/**
 * The glyph for a device that is not the track's instrument.
 *
 * The rig's own preset vocabulary answers first — that is what knows a
 * Helix Native from a Wah. Failing that, a device of an INSTRUMENT class
 * is read as the instrument it is: an audio track can carry a Simpler
 * (the Texture track does), and "sampler" says far more about it than
 * the generic mark would.
 */
function glyphFor(device: DeviceRecord): DeviceGlyph {
	const key = presetEntryFor(device)?.[0];
	if (key) return glyphForPresetKey(key);
	if (!instrumentService.isInstrumentClass(device.className)) return glyphForPresetKey(null);
	return glyphForInstrument(
		instrumentService.identifyInstrumentType({
			deviceIndex: 0,
			className: device.className,
			name: device.name,
			type: 'instrument'
		})
	);
}

/** The glance for one track path. Pure over the v3 tree — exported for tests. */
export function trackDeviceGlance(trackPath: string): TrackDeviceGlance {
	const track = v3Store.tracks.get(trackPath);
	const devices = track ? [...track.devices.values()] : [];

	// An audio track's one "instrument" is a pattern rack (the Shaker's).
	const instrument = canHoldInstrument(track)
		? instrumentService.findInstrumentInDeviceList(devices)
		: track && !track.isFoldable
			? instrumentService.findPatternRackInDeviceList(devices)
			: null;
	// `findInstrumentInDeviceList` returns the chain-FIRST instrument and
	// its path; with none, the chain-first device stands in, which is the
	// same rule one step down.
	const headPath = instrument?.devicePath ?? devices[0]?.devicePath ?? null;
	const head = headPath ? devices.find((d) => d.devicePath === headPath) : undefined;

	if (!head) {
		return {
			kind: 'empty',
			name: null,
			instrumentType: null,
			instrumentViewType: null,
			instrument: null,
			headPath: null,
			deviceViewType: null,
			mode: 'ghost',
			glyph: 'device',
			ink: null
		};
	}

	const ink = presetEntryFor(head)?.[1].color.primary ?? null;

	if (instrument && headPath) {
		const instrumentType = refineInstrumentType(
			instrument,
			instrumentService.identifyInstrumentType(instrument)
		);
		const { category, folders } = trackCategory(track);
		// The pattern rack draws its shaker whatever it was filed under
		// (user, 2026-09-17), and Simpler and Sampler their own marks
		// (user, 2026-09-30). Otherwise the category the preset came from
		// decides the mark (user, 2026-09-18) — the drum included, which a
		// Drum Rack no longer earns by its class alone — and a track with
		// no category mark draws the instrument's own (user, 2026-10-20).
		const ownMark =
			instrumentType === 'instrument-rack-pattern' ||
			instrumentType === 'simpler' ||
			instrumentType === 'sampler';
		const categoryGlyph = ownMark ? null : glyphForCategory(category, folders);
		return {
			kind: 'instrument',
			name: head.name,
			instrumentType,
			instrumentViewType: isViewRegistered('instrument', instrumentType) ? instrumentType : null,
			instrument,
			headPath,
			deviceViewType: null,
			mode: 'glyph',
			glyph: categoryGlyph ?? glyphForInstrument(instrumentType),
			ink
		};
	}

	return {
		kind: 'device',
		name: head.name,
		instrumentType: null,
		instrumentViewType: null,
		instrument: null,
		headPath,
		deviceViewType: deviceViewTypeFor(head),
		mode: 'glyph',
		glyph: glyphFor(glyphDevice(devices, head)),
		ink
	};
}

export function useTrackDevice(trackPath: string): { readonly glance: TrackDeviceGlance } {
	const glance = $derived.by(() => trackDeviceGlance(trackPath));
	return {
		get glance() {
			return glance;
		}
	};
}
