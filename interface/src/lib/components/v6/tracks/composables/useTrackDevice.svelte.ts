/**
 * useTrackDevice — the strip's DEVICE band (the third card section).
 *
 * The strip's other two sections each answer a question about the track
 * from data the v3 tree already carries: Clip says what is playing,
 * Permute says what is being done to it. This one says **what makes the
 * sound** — the head of the track's device chain and what its controls
 * are set to — and its tap is the door to that device's central view,
 * the same way Clip's and Permute's taps are doors to theirs.
 *
 * It is the same relationship `MiniSequencer` has with the Permute view:
 * the real controls, at thumbnail size, per track. Not the view
 * component scaled down — every central view reads `selectedTrackStore`,
 * so one can only ever render the SELECTED track and twelve strips
 * cannot each mount one. What is portable is the controls themselves,
 * and `config/instrumentGlanceMap.ts` holds the four each view leads
 * with, copied from that view's own parameter indices.
 *
 * The band carries NO TEXT (user, 2026-09-14). A strip is ~72px wide in
 * a twelve-track set and the three bands above and below it are already
 * dense; a device name and four parameter labels in that space read as
 * clutter rather than as information. So each track gets ONE picture,
 * and {@link TrackDeviceGlance.mode} is the choice of which:
 *
 *   glyph  an instrument whose preset came from a category — the
 *          category's mark (a keyboard for Key, a djembe for Perc, …; see
 *          `glyphForCategory`) — the pattern rack's shaker, and every
 *          audio track: one mark for what kind of thing this is
 *   knobs  any other instrument — its first control, at its position
 *          (FX, until FX has a mark, and a track that recorded no category)
 *   ghost  nothing on the track at all
 *
 * The names are all still here for the band's `title`, which is a
 * tooltip and costs no pixels.
 *
 * Reads nothing new off the wire. Device names, class names and every
 * parameter's value are already in the state/full tree for EVERY track
 * (`V3StateFullComponent` emits a P record per parameter per device, and
 * `LOMListeners` attaches a value listener to each), so the band is live
 * on unselected tracks without a single extra subscription. Anything
 * that would need one — a Drum Rack's `vm.*` virtual macros, Simpler's
 * `sample.*` — is deliberately NOT read here; those stay the selected
 * track's business.
 */

import { v3Store } from '$lib/stores/v3/normalized.svelte';
import type { DeviceRecord, ParamRecord, TrackRecord } from '$lib/stores/v3/normalized.svelte';
import {
	instrumentService,
	type InstrumentInfo,
	type InstrumentType
} from '$lib/services/instrumentService';
import {
	GLANCE_PARAM_COUNT,
	getInstrumentGlance,
	isEmptyMacroName,
	shortParamLabel,
	type GlanceParam
} from '$lib/config/instrumentGlanceMap';
import { DEVICE_PRESETS, type DevicePresetConfig } from '$lib/config/devicePresets';
import {
	CHARACTER_DEVICE_KEYS,
	glyphForCategory,
	glyphForInstrument,
	glyphForPresetKey,
	type DeviceGlyph
} from '$lib/config/deviceGlyphMap';
import { libraryCategoryOfPreset } from '$lib/utils/presetPath';
import { machineStore } from '$lib/stores/machineStore.svelte';
import { isViewRegistered } from '$lib/components/v6/central/viewRegistry';

/**
 * What the band is showing.
 *
 * - `instrument` — a MIDI track's chain-first instrument. The band names
 *   it and, when its type has a verified headline parameter, draws that
 *   parameter's position.
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
export type TrackDeviceMode = 'knobs' | 'glyph' | 'ghost';

/** One control in the band — a parameter of the head device, as the view draws it. */
export interface TrackDeviceControl {
	/** 1–5 characters: the view's own label, or Live's parameter name shortened. */
	label: string;
	/** The parameter's position on its own min..max, 0..1. */
	value: number;
	/** The path, so a future writable band has somewhere to send to. */
	paramPath: string;
}

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
	/**
	 * The controls `mode: 'knobs'` draws — the head device's, in the order
	 * its central view shows them. Empty when the device lists none of
	 * them (a rack with no macros named, a device whose parameters have
	 * not landed yet), which is what sends the band to a glyph instead.
	 */
	controls: TrackDeviceControl[];
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
	if (instrument.className !== 'InstrumentGroupDevice' || !instrument.devicePath) return base;
	const record = v3Store.deviceByPath.get(instrument.devicePath);
	if (!record) return base;
	const macro1 = [...record.params.values()][1]?.name;
	return macro1 && /^Pattern\s+\d+$/i.test(macro1) ? 'instrument-rack-pattern' : base;
}

/**
 * The parameters of one device, by name — the lookup the name-first
 * entries in `instrumentGlanceMap` need. Built per read rather than
 * cached: it is at most a few dozen entries and only the head device of
 * each strip is ever asked.
 */
function paramsByName(record: DeviceRecord): Map<string, ParamRecord> {
	const out = new Map<string, ParamRecord>();
	for (const param of record.params.values()) out.set(param.name, param);
	return out;
}

/** A parameter's position on its OWN min..max — never assumed to be 0..1. */
function fraction(param: ParamRecord): number | null {
	const span = param.max - param.min;
	if (!(span > 0)) return null;
	return Math.max(0, Math.min(1, (param.value - param.min) / span));
}

/** One table entry resolved against a device: name first, index as the fallback. */
function resolveGlanceParam(
	record: DeviceRecord,
	byName: Map<string, ParamRecord>,
	entry: GlanceParam
): TrackDeviceControl | null {
	const param =
		(entry.name ? byName.get(entry.name) : undefined) ??
		(entry.index !== undefined
			? record.params.get(`${record.devicePath}/params/${entry.index}`)
			: undefined);
	if (!param) return null;
	const value = fraction(param);
	if (value === null) return null;
	return { label: entry.label ?? shortParamLabel(param.name), value, paramPath: param.paramPath };
}

/**
 * The controls the band draws for one device.
 *
 * `auto` is the rack and unknown-device case: walk the device's own
 * parameters from `from`, skipping the ones Live never named (a bare
 * "Macro 5" says nothing a strip has room for), until four are found.
 * Deliberately a WALK rather than a fixed slice — a rack with macros 1, 2
 * and 7 mapped should show three controls, not one and two blanks.
 */
function deviceControls(record: DeviceRecord, type: InstrumentType | null): TrackDeviceControl[] {
	const glance = getInstrumentGlance(type);
	const byName = paramsByName(record);

	if (glance.kind === 'params') {
		const out: TrackDeviceControl[] = [];
		for (const entry of glance.params) {
			const control = resolveGlanceParam(record, byName, entry);
			if (control) out.push(control);
		}
		return out;
	}

	const params = [...record.params.values()];
	const out: TrackDeviceControl[] = [];
	for (let i = glance.from; i < params.length && out.length < glance.count; i++) {
		const param = params[i];
		if (isEmptyMacroName(param.name)) continue;
		const value = fraction(param);
		if (value === null) continue;
		out.push({ label: shortParamLabel(param.name), value, paramPath: param.paramPath });
	}
	return out.slice(0, GLANCE_PARAM_COUNT);
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
 * The glyph for a device the band is not drawing controls for.
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

/**
 * The category the track's instrument came from, and the folders under it.
 *
 * The recorded preset's own category folder first — its Place
 * (`Sidebar/<Place>/…`), or for a track loaded before the Places its type
 * folder (`<Vendor>/<Type>/…`), read exactly (`libraryCategoryOfPreset`).
 * Then the role the load recorded, which is what a track loaded before
 * protocol 3.9.0 carries, and what an xFull kit or a preset from a Place not
 * named for a role carries, their paths having no category folder to read.
 * The role is a rail id, but with no folders under it, so an Inst track
 * known only by its role is "an instrument" rather than a guess at which
 * kind.
 *
 * The preset answers first, and not only for its folders: a role recorded
 * before 2026-09-18 came from the deepest folder naming a category, so an
 * Omnisphere synth bass (`Omni/Bass/Synth/…`) recorded `synth`, and saved
 * Sets keep that until the track is next loaded through the app.
 */
function trackCategory(track: TrackRecord | undefined): { category: string | null; folders: string[] } {
	const filed = track?.preset
		? libraryCategoryOfPreset(track.preset, machineStore.paths.instrumentsBase)
		: null;
	return filed ?? { category: track?.role || null, folders: [] };
}

/** The glance for one track path. Pure over the v3 tree — exported for tests. */
export function trackDeviceGlance(trackPath: string): TrackDeviceGlance {
	const track = v3Store.tracks.get(trackPath);
	const devices = track ? [...track.devices.values()] : [];

	const instrument = canHoldInstrument(track)
		? instrumentService.findInstrumentInDeviceList(devices)
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
			controls: [],
			ink: null
		};
	}

	const ink = presetEntryFor(head)?.[1].color.primary ?? null;

	if (instrument && headPath) {
		const instrumentType = refineInstrumentType(
			instrument,
			instrumentService.identifyInstrumentType(instrument)
		);
		const controls = deviceControls(head, instrumentType);
		const { category, folders } = trackCategory(track);
		// The pattern rack draws its shaker whatever it was filed under: its
		// first macro is a pattern number, which a knob says nothing about
		// (user, 2026-09-17). Otherwise the category the preset came from
		// decides the mark (user, 2026-09-18) — the drum included, which a
		// Drum Rack no longer earns by its class alone — and only a track
		// with no category mark falls back to its first control.
		// Simpler and Sampler draw their own marks the same way, whatever
		// they were filed under (user, 2026-09-30).
		const ownMark =
			instrumentType === 'instrument-rack-pattern' ||
			instrumentType === 'simpler' ||
			instrumentType === 'sampler';
		const categoryGlyph = ownMark ? null : glyphForCategory(category, folders);
		const mode: TrackDeviceMode =
			ownMark || categoryGlyph
				? 'glyph'
				: controls.length > 0
					? 'knobs'
					: 'glyph';
		return {
			kind: 'instrument',
			name: head.name,
			instrumentType,
			instrumentViewType: isViewRegistered('instrument', instrumentType) ? instrumentType : null,
			instrument,
			headPath,
			deviceViewType: null,
			mode,
			glyph: categoryGlyph ?? glyphForInstrument(instrumentType),
			controls,
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
		// An audio track gets a glyph, never knobs. Its chain head is an
		// ordinary effect whose four leading parameters say much less
		// about the track than "this is the guitar" does.
		mode: 'glyph',
		glyph: glyphFor(glyphDevice(devices, head)),
		controls: [],
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
