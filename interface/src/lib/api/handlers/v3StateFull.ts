/**
 * V3 State Full Handler.
 *
 * Parses `/looping/v3/state/full/tree` — the whole canonical tree in
 * one message — and installs the result in the v3 normalized store.
 *
 * ## Framing (protocol 3.6.0)
 *
 * `[reason:string, generation:int, etag:string, scope:string, ...tree_args]`
 *
 * The four header args are **positional and always present**. `scope`
 * is `''` for a whole-song bundle, else the `tracks/<N>` or `master`
 * subtree path the bundle covers.
 *
 * Until 3.6.0 this was `begin → chunk… → end` with a 453-line
 * reassembler behind it, because the tree had to fit darwin's
 * 9,216-byte UDP datagram cap — 99 chunks on a realistic set. The
 * surface now writes it to an ordered TCP stream (port 11022) in one
 * go, so the chunk buffer, the completeness check and the integrity
 * checksum were all guarding against a failure mode that no longer
 * exists.
 *
 * ## Tree args layout per [04 §5]
 *
 * Records are depth-first in LOM position order. Each record is a
 * one-char OSC string tag followed by typed fields:
 *
 * - `T` track:   `trackPath, name, color, mute, solo, arm, hasMidiInput, hasAudioInput, hasArrangementClips, volume, isFoldable, foldState, groupTrackIndex, role`
 * - `D` device:  `devicePath, name, className` (ROW 5 / 3.3.0; legacyId retired)
 * - `P` param:   `paramPath, name, displayName, min, max, value, unit`
 * - `S` slot:    `slotPath, state`
 * - `C` clip:    `clipPath, name, length, color, pitch`
 *
 * ## Contextual assembly
 *
 * Records carry full paths, so in principle the reducer could parse
 * flat. We still walk a depth-first cursor — "current track, current
 * device" — because:
 *
 * 1. It catches malformed streams (a D record whose devicePath isn't
 *    a child of the current T track is a surface-side emission bug
 *    and should log rather than silently attach to the wrong track).
 * 2. It preserves insertion order into the Map-of-devices and
 *    Map-of-params, which the UI relies on for "devices in LOM
 *    position order" rendering. Map iteration order is insertion
 *    order in every supported runtime.
 *
 * ## The ETag is not a checksum any more
 *
 * We never compute this value — we read it off the header, store it,
 * and declare it back on the next hello / resync (§5.1.1). It is a
 * token minted by the surface for its own comparison, so there is
 * nothing here to verify it against and no cross-language byte
 * contract to keep in step. `parseChecksumHex` survives only because
 * the ETag store keys on a number.
 *
 * The one thing that *would* be silently wrong is claiming an ETag
 * for a tree we failed to apply, which is why `recordAppliedEtag`
 * runs after the store write and nowhere else.
 *
 * ## Dedupe
 *
 * If a bundle arrives with the same ETag AND the same generation as
 * the last one applied, we skip reinstallation — no store mutation,
 * no `$derived` re-run across the whole UI. `accept` and `resync` are
 * exempt: both follow a tree wipe (`accept` after a surface-restart
 * re-handshake, `resync` as explicit recovery), and deduping them
 * left the UI blank with no path to repair.
 *
 * @see docs/reference/wire-protocol.md §2.2, §3
 */

import { SvelteMap } from 'svelte/reactivity';
import { logger } from '$lib/utils/logger';
import { toNumber, toString } from './oscTypeHelpers';
import {
	replaceTree,
	mergeSubtreeAtPath,
	type TrackRecord,
	type DeviceRecord,
	type ParamRecord,
	type SlotRecord,
	type ClipRecord,
	type SlotState,
	stampGeneration,
	v3Store,
	UNSET_GENERATION,
	mergePadChain
} from '$lib/stores/v3/normalized.svelte';
import type { OSCArg } from '$lib/types/osc';
import { parsePadPath } from '$lib/utils/padPaths';
import { recordAppliedEtag } from './stateFullEtagStore';

// ============================================
// Wire addresses
// ============================================

/** Protocol 3.6.0 — the whole tree, one message. */
export const V3_STATE_FULL_TREE_ADDRESS = '/looping/v3/state/full/tree';

/** Protocol 3.5.0 — "you already hold the current tree". */
export const V3_STATE_FULL_UNCHANGED_ADDRESS = '/looping/v3/state/full/unchanged';

/** Header args ahead of the record stream: reason, generation, etag, scope. */
const HEADER_ARITY = 4;

/**
 * Reason enum from [04 §3.2](04-wire-protocol.md#32-reason-enum).
 * `"accept"` replaces `"init"` under PR-3b — the Python surface emits
 * a state/full right after every handshake accept (cold-start and
 * reconnect), not fire-and-forget at bring-up. See [04 §8.5].
 */
export type V3StateFullReason = 'accept' | 'structural' | 'resync' | 'selection-change' | 'pad-chain';

function toReason(arg: OSCArg | undefined): V3StateFullReason | null {
	if (typeof arg !== 'string') return null;
	if (
		arg === 'accept' ||
		arg === 'structural' ||
		arg === 'resync' ||
		arg === 'selection-change' ||
		arg === 'pad-chain'
	) {
		return arg;
	}
	return null;
}

/**
 * Parse `"0xDEADBEEF"` → number, or null on malformed. Accepts both
 * `0x`-prefixed and raw hex. Case-insensitive.
 *
 * The value is opaque to us — see "The ETag is not a checksum any
 * more" above. This exists because the ETag store keys on a number,
 * not because anything here interprets the bits.
 */
export function parseChecksumHex(raw: string): number | null {
	const trimmed = raw.trim().toLowerCase();
	const body = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
	if (body.length === 0 || !/^[0-9a-f]+$/.test(body)) return null;
	const n = Number.parseInt(body, 16);
	return Number.isFinite(n) ? n : null;
}

// ============================================
// Parsed shape — what we hand to replaceTree
// ============================================

export interface V3StateFull {
	reason: V3StateFullReason;
	generation: number;
	tracks: TrackRecord[];
	/** Total tree_args consumed — useful for size probes and logs. */
	wireArgs: number;
}

/**
 * Dedupe key: the (generation, etag) of the last bundle we installed.
 *
 * Module-local rather than a class, because it is the only state the
 * handler still carries. Its predecessor was a 453-line reassembler
 * that also owned a chunk buffer and a waiter list; both went with the
 * chunking.
 */
let lastApplied: { generation: number; etag: number } | null = null;

/** Test-only: reset module-local state between tests. */
export function _resetV3StateFull_forTests(): void {
	lastApplied = null;
}

// ============================================
// Handler
// ============================================

/**
 * Handle `/looping/v3/state/full/tree`.
 *
 * Args: `[reason, generation, etag, scope, ...tree_args]`.
 *
 * A non-empty `scope` marks a Phase-12 `"selection-change"` bundle
 * carrying only the subtree at that path (`tracks/<N>` or `master`),
 * which routes to {@link mergeSubtreeAtPath} rather than
 * {@link replaceTree} — merging a subtree through `replaceTree` would
 * wipe every sibling track.
 */
export function handleV3StateFullTree(args: OSCArg[]): void {
	if (args.length < HEADER_ARITY) {
		logger.warn('v3 state/full/tree: short header', { length: args.length });
		return;
	}

	const reason = toReason(args[0]);
	if (!reason) {
		logger.warn('v3 state/full/tree: invalid reason', { raw: args[0] });
		return;
	}

	const generation = toNumber(args[1]);
	if (!Number.isFinite(generation) || generation < 1) {
		// Per [04 §4.4] generation starts at 1; zero is the UI-side
		// "unset" sentinel and must never appear on the wire.
		logger.warn('v3 state/full/tree: invalid generation', { generation });
		return;
	}

	const etagHex = toString(args[2]);
	const etag = parseChecksumHex(etagHex);

	// Empty string means whole-song. Anything else is a subtree path.
	const rawScope = toString(args[3]);
	const scope = rawScope.length > 0 ? rawScope : undefined;

	const flat = args.slice(HEADER_ARITY);

	// Dedupe. `accept` and `resync` are the two reasons that follow a
	// tree wipe — `accept` after a surface restart re-handshake
	// (`v3SurfaceHello` calls `resetForSurfaceRestart`, which clears the
	// store but not this key), `resync` as explicit recovery. Reloading
	// the control surface against an unchanged set produces an identical
	// bundle, so deduping those left the UI blank with no path to repair.
	// `pad-chain` is exempt too (issue #491): a pad bundle answers a
	// subscription, and the client asking may hold nothing for it — its
	// pad map was pruned with its rack, or it is a second client bumping
	// the refcount — so it needs the same records again, unchanged tree,
	// same etag, or not. (A pad map is not dropped on unsubscribe; it goes
	// with its rack, and presence outranks it meanwhile — see
	// `selectedTrackStore.padDevices`.)
	if (
		etag !== null &&
		reason !== 'accept' &&
		reason !== 'resync' &&
		reason !== 'pad-chain' &&
		lastApplied !== null &&
		lastApplied.generation === generation &&
		lastApplied.etag === etag
	) {
		logger.debug('v3 state/full: identical bundle, deduped', { generation, etag });
		return;
	}

	if (scope !== undefined && parsePadPath(scope)?.padPath === scope) {
		// Issue #491 (3.8.0): the effects on one drum pad's chain — D and P
		// records with no T, applied to the pad's own map. An empty bundle
		// empties the pad. Never recorded as a held ETag: the token the UI
		// declares at hello is the whole-song tree's.
		const devices = parsePadChainArgs(flat, scope);
		if (!devices) return;
		mergePadChain(generation, scope, devices);
		logger.info('v3 state/full received (pad chain)', {
			generation,
			scope,
			devices: devices.size,
			wireArgs: flat.length
		});
		return;
	}

	const parsed = parseV3TreeArgs(flat, reason, generation);
	if (!parsed) {
		// `parseV3TreeArgs` already logged where it bailed. The store was
		// NOT updated, so no ETag is recorded and no dedupe key moves —
		// the next bundle must be treated as new.
		return;
	}

	if (scope !== undefined) {
		// Phase 12 pr12-3 — scoped apply. `parsed.tracks` may be empty
		// (Python suppresses the emit on an unresolvable scope; a valid
		// resolve produces exactly one T).
		const scopedTrack = parsed.tracks[0] ?? null;
		if (parsed.tracks.length > 1) {
			logger.warn('v3 state/full scoped: unexpected multi-track payload', {
				scope,
				trackCount: parsed.tracks.length
			});
		}
		mergeSubtreeAtPath(generation, scope, scopedTrack);
	} else {
		replaceTree(generation, parsed.tracks);
	}

	if (etag !== null) {
		lastApplied = { generation, etag };
		// Protocol 3.5.0: remember what we now hold so the next hello /
		// resync can declare it. Recorded here, after the apply, so a
		// bundle that failed to parse (returns above) never leaves us
		// claiming a tree we don't have.
		recordAppliedEtag(scope ?? null, etag);
	} else {
		// An unreadable token costs us the ETag optimisation on the next
		// reconnect — a full resend, which is always correct if slower —
		// and nothing else. The tree itself applied fine.
		logger.warn('v3 state/full/tree: unusable etag, tree applied without one', {
			etagHex,
			generation
		});
	}

	// ROW 5 (2026-04-21): legacyIdPairs ingest retired alongside the
	// D-record `legacyId` field. `deviceMoveService` now sends
	// `/looping/v3/device/{select,move_to_top,move_to_end}` directly
	// against path_resolver.resolve_device on the Python side — no
	// side-table translation needed.

	const deviceCount = parsed.tracks.reduce((s, t) => s + t.devices.size, 0);
	const paramCount = parsed.tracks.reduce(
		(s, t) => s + [...t.devices.values()].reduce((s2, d) => s2 + d.params.size, 0),
		0
	);
	logger.info('v3 state/full received', {
		reason,
		generation,
		scope,
		tracks: parsed.tracks.length,
		devices: deviceCount,
		params: paramCount,
		wireArgs: parsed.wireArgs
	});
}

/**
 * Handle `/looping/v3/state/full/unchanged`.
 *
 * Args: `[reason, generation, sessionId, etag:string]`.
 *
 * The surface recomputed its tree, found it identical to the ETag we
 * declared in hello / resync, and sent this instead of re-shipping
 * ~390 KB we already have. Our tree stays exactly as it is; the only
 * thing that moves is the generation stamp, which outbound writes
 * need.
 *
 * **The sessionId check is load-bearing.** The surface has no
 * per-client channel — every emit goes to the bridge, which fans out
 * to every connected UI. A marker minted for the Mac's session will
 * therefore also land on the iPad, whose tree may be older. Applying
 * another client's marker would advance our generation while leaving
 * a stale tree in place, which is silent corruption. An empty
 * sessionId on the wire (surface couldn't attribute it) is likewise
 * not ours.
 */
export function handleV3StateFullUnchanged(args: OSCArg[]): void {
	const reason = toString(args[0]);
	const generation = toNumber(args[1]);
	const sessionId = toString(args[2]);
	const checksumHex = toString(args[3]);

	const ourSession = v3Store.sessionId;
	if (!sessionId || sessionId !== ourSession) {
		logger.debug('v3 state/full/unchanged: not our session, ignoring', {
			markerSession: sessionId,
			ourSession
		});
		return;
	}

	// `toNumber` coerces anything unparseable to 0 — which is exactly
	// `UNSET_GENERATION`. Stamping that would silently reset us to
	// "no generation yet", and every outbound `/looping/v3/param/set`
	// would then be rejected as stale. A real generation is a positive
	// integer, so require one rather than trusting the coercion.
	if (!Number.isInteger(generation) || generation <= UNSET_GENERATION) {
		logger.warn('v3 state/full/unchanged: unusable generation, ignoring', {
			generation,
			args
		});
		return;
	}

	stampGeneration(generation);

	// Move the dedupe key forward too. The tree did not change, but the
	// generation did — and the dedupe in `handleV3StateFullTree` requires
	// BOTH to match. Leaving `lastApplied` on the old generation means the
	// next genuinely-identical bundle fails that check and is reparsed and
	// reapplied in full: exactly the work the dedupe exists to avoid, on
	// exactly the reconnect path the ETag was built for.
	if (lastApplied !== null) {
		lastApplied = { generation, etag: lastApplied.etag };
	}

	logger.info('v3 state/full unchanged — kept local tree', {
		reason,
		generation,
		etag: checksumHex
	});
}

// ============================================
// Tree-args parser
// ============================================

/**
 * Parse the flat tree_args payload into TrackRecord[]. Depth-first
 * cursor walk per [04 §5] — T opens a new track context, D opens a
 * new device within the current track, P attaches a param to the
 * current device, S opens a new slot within the current track,
 * C attaches a clip to the current slot.
 *
 * Null return on any structural anomaly — the parser prefers bailing
 * and logging over producing a half-assembled tree the UI would
 * render wrong.
 */
export function parseV3TreeArgs(
	args: OSCArg[],
	reason: V3StateFullReason,
	generation: number
): V3StateFull | null {
	let i = 0;
	const tracks: TrackRecord[] = [];
	let currentTrack: TrackRecord | null = null;
	let currentDevice: DeviceRecord | null = null;
	let currentSlot: SlotRecord | null = null;

	try {
		while (i < args.length) {
			const tag = toString(args[i++]);
			switch (tag) {
				case 'T': {
					const t = parseTrackRecord(args, i);
					if (!t) return bail('T record malformed', i);
					tracks.push(t.record);
					currentTrack = t.record;
					currentDevice = null;
					currentSlot = null;
					i = t.next;
					break;
				}
				case 'D': {
					if (!currentTrack) return bail('D without T', i);
					const d = parseDeviceRecord(args, i);
					if (!d) return bail('D record malformed', i);
					if (!d.record.devicePath.startsWith(currentTrack.trackPath + '/')) {
						return bail(
							`D devicePath ${d.record.devicePath} not under current track ${currentTrack.trackPath}`,
							i
						);
					}
					currentTrack.devices.set(d.record.devicePath, d.record);
					currentDevice = d.record;
					i = d.next;
					break;
				}
				case 'P': {
					if (!currentDevice) return bail('P without D', i);
					const p = parseParamRecord(args, i);
					if (!p) return bail('P record malformed', i);
					if (!p.record.paramPath.startsWith(currentDevice.devicePath + '/')) {
						return bail(
							`P paramPath ${p.record.paramPath} not under current device ${currentDevice.devicePath}`,
							i
						);
					}
					currentDevice.params.set(p.record.paramPath, p.record);
					i = p.next;
					break;
				}
				case 'S': {
					if (!currentTrack) return bail('S without T', i);
					const s = parseSlotRecord(args, i);
					if (!s) return bail('S record malformed', i);
					if (!s.record.slotPath.startsWith(currentTrack.trackPath + '/')) {
						return bail(
							`S slotPath ${s.record.slotPath} not under current track ${currentTrack.trackPath}`,
							i
						);
					}
					currentTrack.slots.set(s.record.slotPath, s.record);
					currentSlot = s.record;
					i = s.next;
					break;
				}
				case 'C': {
					if (!currentSlot) return bail('C without S', i);
					const c = parseClipRecord(args, i);
					if (!c) return bail('C record malformed', i);
					if (c.record.clipPath !== `${currentSlot.slotPath}/clip`) {
						return bail(
							`C clipPath ${c.record.clipPath} does not match current slot ${currentSlot.slotPath}/clip`,
							i
						);
					}
					currentSlot.clip = c.record;
					i = c.next;
					break;
				}
				default:
					return bail(`unknown record tag '${tag}'`, i);
			}
		}

		return { reason, generation, tracks, wireArgs: args.length };
	} catch (error) {
		logger.warn('v3 state/full: parse threw', {
			error: String(error),
			position: i,
			length: args.length
		});
		return null;
	}
}

/**
 * Parse a pad-scoped bundle's records (issue #491): `D` records whose
 * path sits directly under the pad path, each followed by its `P`s. No
 * `T` — a pad is not a track. Returns the devices in chain order, or
 * `null` on a malformed stream (logged; nothing applied).
 */
export function parsePadChainArgs(args: OSCArg[], padPath: string): Map<string, DeviceRecord> | null {
	const devices = new Map<string, DeviceRecord>();
	let currentDevice: DeviceRecord | null = null;
	let i = 0;
	while (i < args.length) {
		const tag = toString(args[i++]);
		switch (tag) {
			case 'D': {
				const d = parseDeviceRecord(args, i);
				if (!d) return bail('pad D record malformed', i);
				if (!d.record.devicePath.startsWith(padPath + '/devices/')) {
					return bail(`pad D devicePath ${d.record.devicePath} not under ${padPath}`, i);
				}
				devices.set(d.record.devicePath, d.record);
				currentDevice = d.record;
				i = d.next;
				break;
			}
			case 'P': {
				if (!currentDevice) return bail('pad P without D', i);
				const p = parseParamRecord(args, i);
				if (!p) return bail('pad P record malformed', i);
				if (!p.record.paramPath.startsWith(currentDevice.devicePath + '/')) {
					return bail(`pad P paramPath ${p.record.paramPath} not under ${currentDevice.devicePath}`, i);
				}
				currentDevice.params.set(p.record.paramPath, p.record);
				i = p.next;
				break;
			}
			default:
				return bail(`pad bundle: unexpected record tag '${tag}'`, i);
		}
	}
	return devices;
}

function bail(why: string, position: number): null {
	logger.warn('v3 state/full: parse bailed', { why, position });
	return null;
}

function parseTrackRecord(
	args: OSCArg[],
	i: number
): { record: TrackRecord; next: number } | null {
	// ROW 6.5 (2026-04-21): T arity is 10 fields (added `volume` at
	// offset 9). Previously 9 fields since PR-7c pr7c-3/pr7c-5.
	// Offsets 6/7 are LOM track-input capability (PR-3.5.3 — per
	// [04 §5.1] doctrine, per-track stable metadata belongs on T,
	// not derived UI-side from device classNames). Offset 8 is
	// hasArrangementClips (pr7c-5 completion of the arrangement-clip
	// migration off M4L's queryTrackSummaries). Offset 9 is volume —
	// carrying it on T retired the mount-time `/looping/track/query`
	// round-trip; `TrackMetadataComponent`'s mixer listener (ROW 2-F3)
	// keeps it fresh post-mount. Master / returns emit 0 for all three
	// capability flags — the UI's trackType derivation reads (0, 0) as
	// null, and hasArrangementClips is structurally meaningless there.
	//
	// ADR-410 (2026-07-27, protocol 3.4.0): T arity 10 → 13. Offsets
	// 10/11/12 are isFoldable / foldState / groupTrackIndex — Group
	// Track structure. `groupTrackIndex` is the parent group's LOM
	// index or -1; it's carried instead of a bare `isGrouped` bit
	// because visibility is an ancestor walk (a track is hidden when
	// ANY ancestor is folded), which nested groups make a tree
	// question rather than a single flag. Master / returns emit
	// (0, 0, -1).
	//
	// Protocol 3.7.0: T arity 13 -> 14. Offset 13 is `role` — the rail
	// the track's instrument was loaded from, persisted in Live's
	// per-track key-value store rather than re-derived every session.
	// Empty string means no role recorded, which is what every track
	// made before 3.7.0 (and every track made outside this app) carries.
	//
	// Protocol 3.9.0 (ADR-439): T arity 14 -> 15. Offset 14 is `preset` —
	// the path of the preset `prepare_for_preset` last loaded onto the
	// track (Live's per-track store, `looping.preset`), which the
	// instrument views' swap control steps from. Empty when none recorded.
	if (i + 15 > args.length) return null;
	const trackPath = toString(args[i]);
	const name = toString(args[i + 1]);
	const color = toNumber(args[i + 2]);
	const mute = toNumber(args[i + 3]) === 1;
	const solo = toNumber(args[i + 4]) === 1;
	const arm = toNumber(args[i + 5]) === 1;
	const hasMidiInput = toNumber(args[i + 6]) === 1;
	const hasAudioInput = toNumber(args[i + 7]) === 1;
	const hasArrangementClips = toNumber(args[i + 8]) === 1;
	const volume = toNumber(args[i + 9]);
	const isFoldable = toNumber(args[i + 10]) === 1;
	const foldState = toNumber(args[i + 11]) === 1;
	const groupTrackIndex = toNumber(args[i + 12]);
	const role = toString(args[i + 13]);
	const preset = toString(args[i + 14]);
	if (!trackPath) return null;
	return {
		record: {
			trackPath,
			name,
			color,
			mute,
			solo,
			arm,
			hasMidiInput,
			hasAudioInput,
			hasArrangementClips,
			volume,
			isFoldable,
			foldState,
			groupTrackIndex,
			role,
			preset,
			// ADR-002: reactive collections. Plain Map here would
			// leave the tree non-reactive for consumers; see the
			// block comment on `tracks` in normalized.svelte.ts.
			devices: new SvelteMap(),
			slots: new SvelteMap()
		},
		next: i + 15
	};
}

function parseDeviceRecord(
	args: OSCArg[],
	i: number
): { record: DeviceRecord; next: number } | null {
	if (i + 3 > args.length) return null;
	const devicePath = toString(args[i]);
	const name = toString(args[i + 1]);
	const className = toString(args[i + 2]);
	if (!devicePath) return null;
	return {
		// ADR-002: `params` is a SvelteMap so applyParamValue's
		// `.set()` on write fires `$derived` consumers.
		// PR-3.5.7: `properties` is a SvelteMap for the same reason —
		// applyPropertyValue's `.set()` fires Device.properties consumers.
		// State/full carries no property values today (per ADR-002,
		// properties don't ride the structural record); the slot is born
		// empty and populated by /looping/v3/property/value arrivals.
		// ROW 5 (2026-04-21, protocol 3.3.0): D-record arity dropped 4
		// to 3 — `legacyId` retired alongside the M4L-served
		// `/looping/device/{select,move_appointed_*}` senders. The
		// path-addressed v3 `/looping/v3/device/{select,move_to_*}`
		// wires on DeviceCommandsComponent read `path_resolver` directly.
		record: {
			devicePath,
			name,
			className,
			params: new SvelteMap(),
			properties: new SvelteMap()
		},
		next: i + 3
	};
}

function parseParamRecord(
	args: OSCArg[],
	i: number
): { record: ParamRecord; next: number } | null {
	if (i + 7 > args.length) return null;
	const paramPath = toString(args[i]);
	const name = toString(args[i + 1]);
	const displayName = toString(args[i + 2]);
	const min = toNumber(args[i + 3]);
	const max = toNumber(args[i + 4]);
	const value = toNumber(args[i + 5]);
	const unit = toString(args[i + 6]);
	if (!paramPath) return null;
	return {
		record: { paramPath, name, displayName, min, max, value, unit },
		next: i + 7
	};
}

function parseSlotRecord(
	args: OSCArg[],
	i: number
): { record: SlotRecord; next: number } | null {
	if (i + 2 > args.length) return null;
	const slotPath = toString(args[i]);
	const stateRaw = toNumber(args[i + 1]);
	if (!slotPath) return null;
	const state = slotStateFromInt(stateRaw);
	if (!state) return null;
	return {
		record: { slotPath, state },
		next: i + 2
	};
}

function parseClipRecord(
	args: OSCArg[],
	i: number
): { record: ClipRecord; next: number } | null {
	if (i + 5 > args.length) return null;
	const clipPath = toString(args[i]);
	const name = toString(args[i + 1]);
	const length = toNumber(args[i + 2]);
	const color = toNumber(args[i + 3]);
	const pitch = toNumber(args[i + 4]);
	if (!clipPath) return null;
	return {
		record: {
			clipPath,
			name,
			length,
			color,
			pitch,
			// ADR-002: reactive properties Map; see normalized.svelte.ts.
			properties: new SvelteMap()
		},
		next: i + 5
	};
}

function slotStateFromInt(v: number): SlotState | null {
	switch (v) {
		case 0:
			return 'empty';
		case 1:
			return 'has_clip';
		case 2:
			return 'playing';
		case 3:
			return 'recording';
		default:
			return null;
	}
}
