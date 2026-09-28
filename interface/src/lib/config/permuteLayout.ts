/**
 * Permute's pattern parameters, resolved by NAME.
 *
 * The thin Permute (permute ADR-020; `Vamp Devices/Permute/`) is
 * nothing but the 38 `live.*` pattern controls after Live's built-in
 * `Device On`. Their long names are the contract between the device and
 * both of its consumers — this UI and the surface's sequencer engine —
 * so the layout below is resolved by matching `ParamRecord.name` against
 * those names, and the positional table is only a fallback for a device
 * (or a fixture) whose records carry no names.
 *
 * Measured on the thin device (2026-09-07, Live 12.4.15b1); steps 9–16
 * appended after the other 22 by ADR-443 (2026-09-18), so every earlier
 * index held:
 *
 *   index  name          range        default
 *   0      Device On     0..1         1
 *   1..8   Mute 1..8     0..1         1   (1 = plays, 0 = muted)
 *   9      Mute Length   1..16        8   (1..8 before ADR-443)
 *   10     Mute Rate     0..7 enum    3   (ENUM_RATES order, 8 bar … 1/16)
 *   11..18 Pitch 1..8    0..1         0   (1 = +12 st while the step is on)
 *   19     Pitch Length  1..16        8
 *   20     Pitch Rate    0..7 enum    3
 *   21     Chance        0..1         1
 *   22     Temperature   0..1         0
 *   23..30 Mute 9..16    0..1         1
 *   31..38 Pitch 9..16   0..1         0
 *
 * Both readers (`sequencerStore`, `useTinySequencer`) and the reset used
 * by the duplicate-track flow go through `resolvePermuteLayout`, so a
 * layout change on the device is a one-line change here at most, and
 * usually none.
 */

import type { ParamRecord } from '$lib/stores/v3/normalized.svelte';
import { DEVICE_PRESETS } from '$lib/config/devicePresets';

/** The subset of a `DeviceRecord` that says whether it is a Permute. */
export interface PermuteCandidate {
	className: string;
	name: string;
}

/**
 * The Permute among `records` — by class AND name, the load-bearing pair
 * the surface's engine discovers by too (`SequencerComponent.is_permute`).
 * One rule for the track's chain (`selectedTrackStore.sequencerByPath`),
 * the strip's thumbnail and, since ADR-435, a pad's chain.
 */
export function findPermute<T extends PermuteCandidate>(records: Iterable<T>): T | undefined {
	const name = DEVICE_PRESETS.sequencer.defaultName;
	const className = DEVICE_PRESETS.sequencer.expectedClassName;
	for (const device of records) {
		if (device.className === className && device.name === name) return device;
	}
	return undefined;
}

/** The device's cells per lane — the longest a pattern can be (ADR-443; eight until 2026-09-18). */
export const PERMUTE_MAX_STEPS = 16;

/** One pattern control of the device, by role. */
export type PermuteRole =
	| 'mute1' | 'mute2' | 'mute3' | 'mute4' | 'mute5' | 'mute6' | 'mute7' | 'mute8'
	| 'mute9' | 'mute10' | 'mute11' | 'mute12' | 'mute13' | 'mute14' | 'mute15' | 'mute16'
	| 'muteLength' | 'muteRate'
	| 'pitch1' | 'pitch2' | 'pitch3' | 'pitch4' | 'pitch5' | 'pitch6' | 'pitch7' | 'pitch8'
	| 'pitch9' | 'pitch10' | 'pitch11' | 'pitch12' | 'pitch13' | 'pitch14' | 'pitch15' | 'pitch16'
	| 'pitchLength' | 'pitchRate'
	| 'chance' | 'temperature';

export const MUTE_STEP_ROLES = [
	'mute1', 'mute2', 'mute3', 'mute4', 'mute5', 'mute6', 'mute7', 'mute8',
	'mute9', 'mute10', 'mute11', 'mute12', 'mute13', 'mute14', 'mute15', 'mute16'
] as const satisfies readonly PermuteRole[];

export const PITCH_STEP_ROLES = [
	'pitch1', 'pitch2', 'pitch3', 'pitch4', 'pitch5', 'pitch6', 'pitch7', 'pitch8',
	'pitch9', 'pitch10', 'pitch11', 'pitch12', 'pitch13', 'pitch14', 'pitch15', 'pitch16'
] as const satisfies readonly PermuteRole[];

/** The device's long parameter names, per role. The contract. */
export const PERMUTE_PARAM_NAMES: Readonly<Record<PermuteRole, string>> = {
	mute1: 'Mute 1', mute2: 'Mute 2', mute3: 'Mute 3', mute4: 'Mute 4',
	mute5: 'Mute 5', mute6: 'Mute 6', mute7: 'Mute 7', mute8: 'Mute 8',
	muteLength: 'Mute Length',
	muteRate: 'Mute Rate',
	pitch1: 'Pitch 1', pitch2: 'Pitch 2', pitch3: 'Pitch 3', pitch4: 'Pitch 4',
	pitch5: 'Pitch 5', pitch6: 'Pitch 6', pitch7: 'Pitch 7', pitch8: 'Pitch 8',
	pitchLength: 'Pitch Length',
	pitchRate: 'Pitch Rate',
	chance: 'Chance',
	temperature: 'Temperature',
	mute9: 'Mute 9', mute10: 'Mute 10', mute11: 'Mute 11', mute12: 'Mute 12',
	mute13: 'Mute 13', mute14: 'Mute 14', mute15: 'Mute 15', mute16: 'Mute 16',
	pitch9: 'Pitch 9', pitch10: 'Pitch 10', pitch11: 'Pitch 11', pitch12: 'Pitch 12',
	pitch13: 'Pitch 13', pitch14: 'Pitch 14', pitch15: 'Pitch 15', pitch16: 'Pitch 16'
};

/**
 * Positional fallback (0-indexed `params/<i>`, matching the path grammar).
 * Used only for a role whose name is absent from the device's records.
 */
export const PERMUTE_PARAM_INDEX_FALLBACK: Readonly<Record<PermuteRole, number>> = {
	mute1: 1, mute2: 2, mute3: 3, mute4: 4, mute5: 5, mute6: 6, mute7: 7, mute8: 8,
	muteLength: 9,
	muteRate: 10,
	pitch1: 11, pitch2: 12, pitch3: 13, pitch4: 14, pitch5: 15, pitch6: 16, pitch7: 17, pitch8: 18,
	pitchLength: 19,
	pitchRate: 20,
	chance: 21,
	temperature: 22,
	mute9: 23, mute10: 24, mute11: 25, mute12: 26, mute13: 27, mute14: 28, mute15: 29, mute16: 30,
	pitch9: 31, pitch10: 32, pitch11: 33, pitch12: 34, pitch13: 35, pitch14: 36, pitch15: 37, pitch16: 38
};

/** Device defaults, per role — what a freshly loaded device stores. */
export const PERMUTE_PARAM_DEFAULTS: Readonly<Record<PermuteRole, number>> = {
	mute1: 1, mute2: 1, mute3: 1, mute4: 1, mute5: 1, mute6: 1, mute7: 1, mute8: 1,
	muteLength: 8,
	muteRate: 3,
	pitch1: 0, pitch2: 0, pitch3: 0, pitch4: 0, pitch5: 0, pitch6: 0, pitch7: 0, pitch8: 0,
	pitchLength: 8,
	pitchRate: 3,
	chance: 1,
	temperature: 0,
	mute9: 1, mute10: 1, mute11: 1, mute12: 1, mute13: 1, mute14: 1, mute15: 1, mute16: 1,
	pitch9: 0, pitch10: 0, pitch11: 0, pitch12: 0, pitch13: 0, pitch14: 0, pitch15: 0, pitch16: 0
};

export const PERMUTE_ROLES = Object.keys(PERMUTE_PARAM_NAMES) as PermuteRole[];

/** Role → paramPath for one device, plus how each role was resolved. */
export interface PermuteLayout {
	devicePath: string;
	paths: Readonly<Record<PermuteRole, string>>;
	/** Roles that fell back to the positional table (their name was absent). */
	positional: readonly PermuteRole[];
}

/** The subset of `DeviceRecord` the resolver reads — the record's own
 *  `params` map (`paramPath → ParamRecord`) or any iterable of records. */
export interface PermuteLayoutSource {
	devicePath: string;
	params:
		| ReadonlyMap<string, Pick<ParamRecord, 'paramPath' | 'name'>>
		| Iterable<Pick<ParamRecord, 'paramPath' | 'name'>>;
}

/**
 * Resolve every pattern control's paramPath on `device`.
 *
 * A role resolves to the first record whose `name` equals its long name;
 * otherwise to the positional fallback for that role. Name first, so the
 * layout survives an index shift; the fallback keeps the store working
 * against records that carry no names (older fixtures, minimal stubs).
 */
export function resolvePermuteLayout(device: PermuteLayoutSource): PermuteLayout {
	const byName = new Map<string, string>();
	const records = device.params instanceof Map ? device.params.values() : device.params;
	for (const p of records as Iterable<Pick<ParamRecord, 'paramPath' | 'name'>>) {
		if (p.name && !byName.has(p.name)) byName.set(p.name, p.paramPath);
	}
	const paths = {} as Record<PermuteRole, string>;
	const positional: PermuteRole[] = [];
	for (const role of PERMUTE_ROLES) {
		const named = byName.get(PERMUTE_PARAM_NAMES[role]);
		if (named !== undefined) {
			paths[role] = named;
		} else {
			paths[role] = `${device.devicePath}/params/${PERMUTE_PARAM_INDEX_FALLBACK[role]}`;
			positional.push(role);
		}
	}
	return { devicePath: device.devicePath, paths, positional };
}

/** Positional layout for a device path with no records in hand. */
export function positionalPermuteLayout(devicePath: string): PermuteLayout {
	return resolvePermuteLayout({ devicePath, params: [] });
}
