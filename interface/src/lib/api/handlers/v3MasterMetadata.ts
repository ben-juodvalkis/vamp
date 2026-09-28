/**
 * v3 Master Metadata handler (PR-5b)
 *
 * Consumes `/looping/v3/master/<attr>` fires from the Python Control
 * Surface and writes them into the v3 normalized store via
 * `applyMasterMetadata`. The master strip + master panel UI read those
 * fields through `$derived` off `v3Store.tracks.get('master')` — no
 * CustomEvent re-dispatch.
 *
 * Wire (see Looping's documentation/archive/m4l-to-python-v3/04-wire-protocol.md §2.4):
 *   /looping/v3/master/<attr>   [value]
 * Master is a singleton per session, so the wire intentionally omits a
 * trackPath arg (saves bytes on meters; clearer master-vs-track seam
 * at every layer per the PR-5b design record §2.1).
 */

import type { OSCArg } from '$lib/types/osc';
import { logger } from '$lib/utils/logger';
import {
	applyMasterMetadata,
	type MasterMetadataAttr
} from '$lib/stores/v3/normalized.svelte';

export const V3_MASTER_VOLUME_ADDRESS = '/looping/v3/master/volume';
export const V3_MASTER_NAME_ADDRESS = '/looping/v3/master/name';
export const V3_MASTER_COLOR_ADDRESS = '/looping/v3/master/color';
export const V3_MASTER_PAN_ADDRESS = '/looping/v3/master/pan';
export const V3_MASTER_MUTE_ADDRESS = '/looping/v3/master/mute';

const ADDRESS_TO_ATTR: Record<string, MasterMetadataAttr> = {
	[V3_MASTER_VOLUME_ADDRESS]: 'volume',
	[V3_MASTER_NAME_ADDRESS]: 'name',
	[V3_MASTER_COLOR_ADDRESS]: 'color',
	[V3_MASTER_PAN_ADDRESS]: 'panning',
	[V3_MASTER_MUTE_ADDRESS]: 'mute'
};

/** Wire attrs where the surface sends 0/1 and the TrackRecord field is
 *  typed as boolean. `mute` only — name/color/volume/pan are scalar. */
const BOOLEAN_ATTRS = new Set<MasterMetadataAttr>(['mute']);

export function isV3MasterMetadataAddress(address: string): boolean {
	return address in ADDRESS_TO_ATTR;
}

export function handleV3MasterMetadata(address: string, args: OSCArg[]): void {
	const attr = ADDRESS_TO_ATTR[address];
	if (attr === undefined) return;

	if (args.length < 1) {
		logger.warn('v3 master metadata missing args', { address, args });
		return;
	}

	const raw = args[0];
	const value = BOOLEAN_ATTRS.has(attr) ? toBool(raw) : raw;
	applyMasterMetadata(attr, value);
}

function toBool(v: OSCArg): boolean {
	if (typeof v === 'boolean') return v;
	if (typeof v === 'number') return v !== 0;
	if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
	return Boolean(v);
}
