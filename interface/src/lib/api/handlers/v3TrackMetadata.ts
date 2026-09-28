/**
 * v3 Track Metadata handler (PR-5a wire / PR-5d-first UI reshape)
 *
 * Consumes `/looping/v3/track/<attr>` fires from the Python Control
 * Surface and writes them into the v3 normalized store via
 * `applyTrackMetadata`. Track-strip UI reads those fields through
 * `$derived` off `v3Store.tracks` — no CustomEvent re-dispatch, no
 * legacy `max-track-property` shim.
 *
 * Wire (see Looping's documentation/archive/m4l-to-python-v3/04-wire-protocol.md):
 *   /looping/v3/track/<attr>   [trackPath:string, value]
 * where trackPath is `tracks/<N>` for regular tracks. `pan` maps to
 * the `panning` TrackRecord field (LOM attribute name). Master /
 * returns paths are dropped — PR-5b / PR-5e own those.
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import {
	applyTrackMetadata,
	type TrackMetadataAttr
} from '$lib/stores/v3/normalized.svelte';

export const V3_TRACK_NAME_ADDRESS = '/looping/v3/track/name';
export const V3_TRACK_COLOR_ADDRESS = '/looping/v3/track/color';
export const V3_TRACK_ARM_ADDRESS = '/looping/v3/track/arm';
export const V3_TRACK_MUTE_ADDRESS = '/looping/v3/track/mute';
export const V3_TRACK_SOLO_ADDRESS = '/looping/v3/track/solo';
export const V3_TRACK_PAN_ADDRESS = '/looping/v3/track/pan';
export const V3_TRACK_VOLUME_ADDRESS = '/looping/v3/track/volume';
export const V3_TRACK_INPUT_ROUTING_TYPE_ADDRESS = '/looping/v3/track/input_routing_type';
export const V3_TRACK_INPUT_ROUTING_CHANNEL_ADDRESS = '/looping/v3/track/input_routing_channel';
/** Protocol 3.7.0 — write-path echo of `/looping/v3/track/set_role`. */
export const V3_TRACK_ROLE_ADDRESS = '/looping/v3/track/role';
/** Protocol 3.9.0 (ADR-439) — a `prepare_for_preset` load recorded
 *  `looping.preset` on the track. Surface-initiated; there is no set verb. */
export const V3_TRACK_PRESET_ADDRESS = '/looping/v3/track/preset';

const ADDRESS_TO_ATTR: Record<string, TrackMetadataAttr> = {
	[V3_TRACK_PRESET_ADDRESS]: 'preset',
	[V3_TRACK_NAME_ADDRESS]: 'name',
	[V3_TRACK_COLOR_ADDRESS]: 'color',
	[V3_TRACK_ARM_ADDRESS]: 'arm',
	[V3_TRACK_MUTE_ADDRESS]: 'mute',
	[V3_TRACK_SOLO_ADDRESS]: 'solo',
	[V3_TRACK_PAN_ADDRESS]: 'panning',
	[V3_TRACK_VOLUME_ADDRESS]: 'volume',
	[V3_TRACK_INPUT_ROUTING_TYPE_ADDRESS]: 'inputRoutingType',
	[V3_TRACK_INPUT_ROUTING_CHANNEL_ADDRESS]: 'inputRoutingChannel',
	[V3_TRACK_ROLE_ADDRESS]: 'role'
};

/** Wire attrs where the surface sends 0/1 and the TrackRecord field is
 *  typed as boolean. Keep coercion tight — `arm`/`mute`/`solo` only. */
const BOOLEAN_ATTRS = new Set<TrackMetadataAttr>(['arm', 'mute', 'solo']);

/** Wire attrs the TrackRecord types as `string`, coerced rather than
 *  passed through. `role` is read back verbatim as a category (the
 *  strip's device band falls back to it), so a non-string arriving here
 *  would become a role named `42`. */
const STRING_ATTRS = new Set<TrackMetadataAttr>(['role', 'preset']);

export function isV3TrackMetadataAddress(address: string): boolean {
	return address in ADDRESS_TO_ATTR;
}

export function handleV3TrackMetadata(address: string, args: OSCArg[]): void {
	const attr = ADDRESS_TO_ATTR[address];
	if (attr === undefined) return;

	if (args.length < 2) {
		logger.warn('v3 track metadata missing args', { address, args });
		return;
	}

	const trackPath = typeof args[0] === 'string' ? args[0] : String(args[0]);
	if (!trackPath.startsWith('tracks/')) {
		// Master / returns / unexpected path shapes aren't UI tracks
		// today. PR-5b / PR-5e will own those paths.
		logger.debug('v3 track metadata ignored for non-regular-track path', {
			address,
			trackPath
		});
		return;
	}

	const raw = args[1];
	let value: unknown = raw;
	if (BOOLEAN_ATTRS.has(attr)) value = toBool(raw);
	else if (STRING_ATTRS.has(attr)) value = typeof raw === 'string' ? raw : String(raw ?? '');
	applyTrackMetadata(trackPath, attr, value);
}

function toBool(v: OSCArg): boolean {
	if (typeof v === 'boolean') return v;
	if (typeof v === 'number') return v !== 0;
	if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
	return Boolean(v);
}
