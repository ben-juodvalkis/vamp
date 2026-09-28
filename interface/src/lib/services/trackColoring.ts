/**
 * trackColoring.ts — auto-color tracks (and their existing clips) on
 * preset load.
 *
 * Triggered from `presetLoader` after every successful
 * `prepare_for_preset/ack`. The color is derived from the preset's
 * **performance role** (ADR-399). A load from the browser says it
 * outright: every item of a Place carries its Place's role
 * (`Preset.role`, browser-places plan §2), and so does a Recent entry
 * whose file lies in a Place. Only a load with no Place behind it — a
 * Recent entry outside every Place — reads the role off its path
 * (`presetCategory`). A sample or clip loaded as audio takes the audio
 * color from `constants.json:vendors.special` and records no role.
 *
 * Sources of truth:
 * - `constants.json:vendors.types`   — the seven role colors
 *   (drum/bass/fx/inst/key/perc/synth); gap-placed, ink-envelope hues.
 * - `constants.json:vendors.special` — `audio` and `recent`.
 *
 * Recolor always applies on preset load — choosing an instrument from
 * the UI is an explicit intent signal regardless of the track's current
 * color.
 *
 * Clips: after writing the track color, every existing clip on the
 * track is recolored to match. New clips born after the recolor
 * inherit the track color from Live automatically — no follow-up
 * needed.
 *
 * Off-by-design: device-chain edits don't trigger recolor (preset
 * load only); there's no manual "recolor" button (preset load only);
 * a sample loaded from the browser gets the audio color, not its
 * Place's.
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

const V3_TRACK_COLOR_ADDRESS = '/looping/v3/track/color';
const V3_CLIP_SET_COLOR_ADDRESS = '/looping/v3/clip/set/color';
/** Protocol 3.7.0 — persist the rail an instrument was loaded from. */
const V3_TRACK_SET_ROLE_ADDRESS = '/looping/v3/track/set_role';

const TYPE_COLORS = constants.vendors.types as Record<string, { color: string }>;
const SPECIAL_COLORS = constants.vendors.special as Record<string, { color: string }>;

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

/** Look up a category color from `constants.json:vendors.types`. */
export function colorForCategory(category: string): number | null {
	const entry = TYPE_COLORS[category];
	if (!entry?.color) return null;
	return hexToInt(entry.color);
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

/**
 * Resolve the desired color for a prepare-ack — the role's color
 * (ADR-399), or the audio color for a sample loaded as audio.
 *
 * Returns `null` when the load names no role; the caller leaves color
 * alone.
 */
export function resolveAutoColor(presetPath: string, source: AutoColorSource = {}): number | null {
	if (source.audio) return colorForAudio();
	const role = resolveAutoRole(presetPath, source);
	return role === null ? null : colorForCategory(role);
}

/**
 * The *role* behind {@link resolveAutoColor} — the rail this preset came
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

/**
 * Auto-color the track and its existing clips after a preset prepare
 * ack. Always applies — choosing an instrument from the UI is an
 * explicit intent to load that preset, and the category color should
 * follow unconditionally.
 *
 * Color resolution: see `resolveAutoColor`. Returns silently when no
 * rule matches the inputs (unknown category, missing constants).
 */
export function applyAutoColorOnPrepareAck(opts: ApplyOptions): void {
	const { trackPath, presetPath } = opts;

	if (!trackPath.startsWith('tracks/')) {
		// Master / returns / unknown shapes — skip silently.
		return;
	}

	const color = resolveAutoColor(presetPath, opts);
	if (color === null) {
		logger.debug('applyAutoColor: no rule matched, skipping', {
			component: 'trackColoring', trackPath, presetPath
		});
		return;
	}

	logger.debug('applyAutoColor: writing track color', {
		component: 'trackColoring', trackPath, color: color.toString(16)
	});

	applyTrackMetadata(trackPath, 'color', color);
	// No generation token — preset load is an unconditional color signal,
	// stale-write gating doesn't apply here.
	send(V3_TRACK_COLOR_ADDRESS, [trackPath, color]);

	const track = v3Store.tracks.get(trackPath);
	if (!track) return;
	for (const slot of track.slots.values()) {
		if (!slot.clip) continue;
		send(V3_CLIP_SET_COLOR_ADDRESS, [slot.clip.clipPath, color]);
	}
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
