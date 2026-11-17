/**
 * trackColoring.ts — a track's colour is its instrument's (ADR-545).
 *
 * Every track wears the colour of the instrument type it holds: Drum
 * Rack, Drift, Collision, Meld, … each one colour, from
 * `constants.json:vendors.devices` (the same colours the browser's preset
 * cards wear), Omnisphere and Komplete Kontrol their brand's
 * (`vendors.brands`). A sample or clip loaded as audio takes
 * `vendors.special.audio`.
 *
 * When it is written:
 * - a load from the app (`applyAutoColorOnPrepareAck`): an audio load at
 *   once; an instrument load is marked pending, and coloured when the
 *   track's instrument is seen in the tree (the device lands after the
 *   ack), even when the type did not change, since a load is intent;
 * - a track whose instrument TYPE changes while the app watches
 *   (`useInstrumentTrackColors`, mounted by the root layout), a load in
 *   Live included.
 * Opening a set recolours nothing: the first tree is the baseline.
 *
 * The track's existing clips are recoloured with it; clips born later
 * take the track's colour from Live.
 *
 * Until ADR-545 the colour was the preset's ROLE (ADR-399: the Place it
 * came from). The role is still recorded (`applyAutoRoleOnPrepareAck`).
 */

import { send } from '$lib/api/simpleClient';
import {
	applyTrackMetadata,
	v3Store
} from '$lib/stores/v3/normalized.svelte';
import constants from '$config/constants.json';
import { machineStore } from '$lib/stores/machineStore.svelte';
import { logger } from '$lib/utils/logger';
import { presetCategory } from '$lib/utils/presetPath';
import type { InstrumentType } from '$lib/services/instrumentService';

const V3_TRACK_COLOR_ADDRESS = '/looping/v3/track/color';
const V3_CLIP_SET_COLOR_ADDRESS = '/looping/v3/clip/set/color';
/** Protocol 3.7.0 — persist the rail an instrument was loaded from. */
const V3_TRACK_SET_ROLE_ADDRESS = '/looping/v3/track/set_role';

const TYPE_COLORS = constants.vendors.types as Record<string, { color: string }>;
const SPECIAL_COLORS = constants.vendors.special as Record<string, { color: string }>;
const DEVICE_COLORS = constants.vendors.devices as Record<string, { color: string }>;
const BRAND_COLORS = constants.vendors.brands as Record<string, { color: string }>;

/**
 * Where an instrument type's colour is kept: a `vendors.devices` key (Live's
 * name for the device) or a `vendors.brands` key. A type with none (a
 * generic plug-in, an instrument the rig does not know) leaves the colour
 * alone.
 */
const INSTRUMENT_COLOR_KEYS: Readonly<Partial<Record<InstrumentType, { devices?: string; brands?: string }>>> = {
	drumrack: { devices: 'Drum Rack' },
	'instrument-rack': { devices: 'Instrument Rack' },
	'instrument-rack-pattern': { devices: 'Instrument Rack' },
	operator: { devices: 'Operator' },
	analog: { devices: 'Analog' },
	wavetable: { devices: 'Wavetable' },
	drift: { devices: 'Drift' },
	collision: { devices: 'Collision' },
	electric: { devices: 'Electric' },
	meld: { devices: 'Meld' },
	sampler: { devices: 'Sampler' },
	simpler: { devices: 'Simpler' },
	omnisphere: { brands: 'Omni' },
	'komplete-kontrol': { brands: 'NI' }
};

// ---------------------------------------------------------------------------
// Color resolution
// ---------------------------------------------------------------------------
//
// What a preset path *means* is read in `$lib/utils/presetPath`, shared
// with the device band. This file only turns roles into colors.

/**
 * Hex string → int RGB (e.g. `'#e63946'` → `0xe63946`). Returns `null`
 * for malformed input; the caller treats that as "skip recolor".
 */
function hexToInt(hex: string): number | null {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex);
	if (!m) return null;
	return parseInt(m[1], 16);
}

/** Audio color from `constants.json:vendors.special.audio`. */
export function colorForAudio(): number | null {
	const entry = SPECIAL_COLORS.audio;
	if (!entry?.color) return null;
	return hexToInt(entry.color);
}

/** What a load says about where its preset came from. */
export interface AutoColorSource {
	/** A sample or clip loaded from the browser: the audio color, and no role. */
	audio?: boolean;
	/**
	 * The role of the browser Place the preset came from (`Preset.role`, which
	 * Recent stamps too for a file in a Place); `null` = a Place with no role.
	 * Absent when no Place is behind the load.
	 */
	placeRole?: string | null;
}

/** An instrument type's track colour (ADR-545), or `null` to leave the colour alone. */
export function colorForInstrument(type: InstrumentType | null): number | null {
	if (!type) return null;
	const key = INSTRUMENT_COLOR_KEYS[type];
	if (!key) return null;
	const entry = key.devices ? DEVICE_COLORS[key.devices] : key.brands ? BRAND_COLORS[key.brands] : undefined;
	return entry?.color ? hexToInt(entry.color) : null;
}

/**
 * The *role* of a load — the rail this preset came
 * from — or `null` when the load says nothing about it.
 *
 * This was always computed here; it was just immediately converted to a
 * colour and discarded. Recovering it downstream is what the Drum Buss
 * rail's gate used a 2.46 MB catalog fetch and a three-tier guess to do.
 * Since protocol 3.7.0 the caller instead writes it to the track
 * (`/looping/v3/track/set_role`), where Live persists it.
 *
 * `null` means "this load says nothing about the rail", and the caller
 * must then leave any existing role alone rather than overwrite it with a
 * guess. That restraint carries weight since the reconstruction tiers
 * were deleted (2026-08-31): the recorded role is believed outright, with
 * nothing underneath it to disagree.
 */
export function resolveAutoRole(presetPath: string, source: AutoColorSource = {}): string | null {
	if (source.audio) return null;
	const { placeRole } = source;
	// A browser Place's role (the Places catalog stamps it on every item) is
	// the answer, not a hint: a Place's folders are its own, so a path read
	// by shape can name a subfolder — an Omnisphere drum under `Drum/Synth/…`
	// read as synth, the 13,504-file mistake of 2026-09-18. Only the seven
	// rail roles count; anything else records nothing.
	if (placeRole !== undefined) return placeRole && TYPE_COLORS[placeRole] ? placeRole : null;
	// No Place behind the load (a Recent entry outside every Place): the
	// category folder when the path has one, else the deepest folder naming
	// a category (`presetCategory`).
	// The library's folder comes from the Mac at run time (`/bridge/machine`),
	// not from the build (onboarding.plan.md §6.5).
	const category = presetCategory(presetPath, machineStore.paths.instrumentsBase);
	return category && TYPE_COLORS[category] ? category : null;
}

// The colour reverse-lookup that used to live here retired with
// protocol 3.7.0. `roleFromTrackColor` mapped a track's Live colour back
// to a performance role, as tier 2 of the Drum Buss gate — a proxy for a
// fact nobody had written down. The role is written down now
// (`applyAutoRoleOnPrepareAck` below), so the proxy had no callers left.
//
// Its one durable finding, kept because it constrains anything that ever
// reads a colour back: **Live QUANTIZES LOM colour writes to its own
// swatch palette.** Measured 2026-08-28 — drum `#f36fb8` comes back as
// `#e553a0` (Δ≈39.4), perc `#ff8244` as `#ffa529` (Δ≈44.2), synth
// `#8e90ff` as `#92a7ff` (Δ≈23.3). Exact equality never worked, and the
// tolerance that did sat under the nearest non-role neighbour
// (Ableton brand yellow, Δ≈51.8) by less than seven units.


interface ApplyOptions extends AutoColorSource {
	/** Canonical wire path of the prepared track (e.g. `tracks/3`). */
	trackPath: string;
	/** Filesystem path of the loaded preset, or `''` for bare prep. */
	presetPath: string;
}

/** Write a colour onto a track and every clip it holds. */
function writeTrackColor(trackPath: string, color: number): void {
	applyTrackMetadata(trackPath, 'color', color);
	send(V3_TRACK_COLOR_ADDRESS, [trackPath, color]);

	const track = v3Store.tracks.get(trackPath);
	if (!track) return;
	for (const slot of track.slots.values()) {
		if (!slot.clip) continue;
		send(V3_CLIP_SET_COLOR_ADDRESS, [slot.clip.clipPath, color]);
	}
}

/** Tracks an instrument was just loaded onto from the app, waiting for it to land. */
const pendingInstrumentColor = new Set<string>();

/**
 * Was an instrument loaded onto this track from the app since it was last
 * coloured? Clears the mark: the watcher colours the track once.
 */
export function takePendingInstrumentColor(trackPath: string): boolean {
	return pendingInstrumentColor.delete(trackPath);
}

/**
 * After a preset prepare ack: an audio load takes the audio colour now; an
 * instrument load is marked, and coloured by its instrument when the
 * device lands (`applyInstrumentColor`, from the watcher). The ack comes
 * before the tree carries the new device, so its type is not known here.
 */
export function applyAutoColorOnPrepareAck(opts: ApplyOptions): void {
	const { trackPath } = opts;
	if (!trackPath.startsWith('tracks/')) return;

	if (opts.audio) {
		const color = colorForAudio();
		if (color !== null) writeTrackColor(trackPath, color);
		return;
	}
	pendingInstrumentColor.add(trackPath);
}

/**
 * Colour a track by the instrument it holds. Returns whether it wrote:
 * an instrument type with no colour of its own leaves the track alone.
 */
export function applyInstrumentColor(trackPath: string, type: InstrumentType | null): boolean {
	if (!trackPath.startsWith('tracks/')) return false;
	const color = colorForInstrument(type);
	if (color === null) return false;
	logger.debug('applyInstrumentColor: writing track color', {
		component: 'trackColoring', trackPath, type, color: color.toString(16)
	});
	writeTrackColor(trackPath, color);
	return true;
}

/**
 * Record the rail this preset came from onto the track it landed on
 * (protocol 3.7.0).
 *
 * Sibling of {@link applyAutoColorOnPrepareAck}, fired at the same
 * instant from the same call site — and kept separate from it because a
 * load can legitimately produce a colour and no role (a sample loaded as
 * audio), and the two must not be able to drag each other along.
 *
 * The surface persists this in Live's per-track key-value store, so the
 * answer survives the session that produced it. That is the whole
 * point: the Drum Buss rail's gate previously reconstructed it from a
 * 2.46 MB catalog fetch plus a three-tier guess, purely because there
 * was nowhere to write it down.
 *
 * **A load that says nothing about the rail leaves the existing role
 * alone.** `resolveAutoRole` returns `null` rather than guessing, and
 * overwriting a known-good role with a guess is worse than leaving a
 * stale one — the stale one at least came from a real load.
 */
export function applyAutoRoleOnPrepareAck(opts: ApplyOptions): void {
	const { trackPath, presetPath } = opts;
	if (!trackPath.startsWith('tracks/')) return;

	const role = resolveAutoRole(presetPath, opts);
	if (role === null) {
		logger.debug('applyAutoRole: no rail matched, leaving role alone', {
			component: 'trackColoring', trackPath, presetPath
		});
		return;
	}

	logger.debug('applyAutoRole: writing track role', {
		component: 'trackColoring', trackPath, role
	});

	// Optimistic, like the colour beside it: the Drum Buss rail should
	// appear on the same frame as the preset that earned it, not a
	// round-trip later.
	applyTrackMetadata(trackPath, 'role', role);
	send(V3_TRACK_SET_ROLE_ADDRESS, [trackPath, role]);
}
