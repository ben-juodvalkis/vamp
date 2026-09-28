/**
 * Track-level orchestration — the "duplicate track" and "group track" gestures.
 *
 * `duplicateTrackAndReset` spins off a *variation* track: it duplicates a
 * whole track (keeping its instrument / FX / Permute chain), then clears
 * the copied clips and resets the copied Permute to defaults so the new
 * track starts on a clean slate.
 *
 * The duplicate itself rides a new request_id→ack wire mirroring
 * `trackPreparation.ts`'s prepare_for_preset pattern. Live's
 * `duplicate_track(N)` places the copy at `N+1` and carries the full
 * device chain, so the Python side duplicates, empties the copy's clips
 * and acks; the Permute reset is done here once the new track's state
 * echo lands.
 *
 * **The emptying is server-side on purpose.** A duplicate shifts every
 * track below it by one, so until the next `state/full` arrives the UI's
 * record at `tracks/<N+1>` still describes the track that used to sit
 * there. Deleting "the clips this track has" off that snapshot deleted
 * the wrong scenes. The same staleness is why `waitForNewTrackReady`
 * waits for the tree to actually grow before it trusts a record at that
 * path — a Permute read from the stale neighbour is a param reset aimed
 * at whatever device happens to occupy that chain index on the copy.
 */

import { send } from '$lib/api/simpleClient';
import {
    addOscMessageListener,
    removeOscMessageListener,
    type OscBusMessage
} from '$lib/api/connection/oscMessageBus';
import { v3Store } from '$lib/stores/v3/normalized.svelte';
import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';
import { generateRequestId, parseTrackIndex } from '$lib/services/trackPreparation';
import { resetParamsToDefaultsForDevice } from '$lib/stores/v6/sequencerStore.svelte';
import { logger } from '$lib/utils/logger';

const GROUP_ADDRESS = '/looping/v3/track/group';
const GROUP_REPLY_ADDRESS = '/looping/v3/track/group/reply';

// The gesture runs in Live's UI, not the LOM: real clicks build the
// selection, a real (menu-free) ⌘G commits it, all through the AX helper —
// and, since the tapping phase is now purely local (2026-09-20), all of it
// happens in this one round trip rather than spread across the gesture.
// Building the selection and the merge dance can mean a dozen retried clicks
// on the rig, so this is generous.
const GROUP_TIMEOUT_MS = 15000;

export interface GroupMember {
	path: string;
	name: string;
}

const DUPLICATE_ADDRESS = '/looping/v3/track/duplicate';
const DUPLICATE_ACK_ADDRESS = '/looping/v3/track/duplicate/ack';
const DUPLICATE_NACK_ADDRESS = '/looping/v3/track/duplicate/nack';

// Outer timeout for the duplicate round-trip. Matches prepare's 8s
// headroom; past that Live is unhealthy.
const DUPLICATE_TIMEOUT_MS = 8000;

// Poll cadence + ceiling for the new track's state echo (devices + slots
// appearing in v3Store). 3000ms matches clipOperations' AUTO_TRIM_TIMEOUT.
const READY_POLL_INTERVAL_MS = 50;
const READY_POLL_TIMEOUT_MS = 3000;

export interface DuplicateTrackResult {
	newTrackPath: string;
	newTrackIndex: number;
}

/**
 * Fire `/looping/v3/track/duplicate` and resolve when the matching ack
 * lands. Rejects on nack or timeout. New track path is server-returned
 * (`tracks/<source+1>`) so the caller never computes the shifted index.
 *
 * `clearClips` asks the surface to empty every slot on the copy before it
 * acks — the variation gesture. See the module docstring for why that
 * belongs on the Python side rather than here.
 */
function duplicateTrack(
	sourceTrackPath: string,
	clearClips: boolean
): Promise<DuplicateTrackResult> {
	const requestId = generateRequestId();
	logger.debug('duplicateTrack: sending', {
		component: 'trackOperations', requestId, sourceTrackPath, clearClips
	});

	return new Promise<DuplicateTrackResult>((resolve, reject) => {
		let settled = false;
		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			removeOscMessageListener(handler);
			clearTimeout(timer);
			fn();
		};

		const handler = (msg: OscBusMessage) => {
			if (!msg || !msg.address || !msg.args) return;
			if (msg.address !== DUPLICATE_ACK_ADDRESS && msg.address !== DUPLICATE_NACK_ADDRESS) return;
			if (msg.args[0] !== requestId) return;

			if (msg.address === DUPLICATE_ACK_ADDRESS) {
				const newTrackPath = String(msg.args[1] ?? '');
				const newTrackIndex = parseTrackIndex(newTrackPath);
				if (newTrackIndex < 0) {
					settle(() => reject(new Error(
						`duplicateTrack: malformed trackPath in ack: ${newTrackPath}`
					)));
					return;
				}
				logger.debug('duplicateTrack: ack', {
					component: 'trackOperations', requestId, newTrackPath
				});
				settle(() => resolve({ newTrackPath, newTrackIndex }));
			} else {
				const code = String(msg.args[1] ?? '');
				const detail = String(msg.args[2] ?? '');
				logger.warn('duplicateTrack: nack', {
					component: 'trackOperations', requestId, code, detail
				});
				settle(() => reject(new Error(`duplicateTrack ${code}: ${detail}`)));
			}
		};

		addOscMessageListener(handler);
		send(DUPLICATE_ADDRESS, [requestId, sourceTrackPath, clearClips ? 1 : 0]);

		const timer = setTimeout(() => {
			settle(() => reject(new Error(
				`duplicateTrack timeout (${DUPLICATE_TIMEOUT_MS}ms) for ${sourceTrackPath}`
			)));
		}, DUPLICATE_TIMEOUT_MS);
	});
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll v3Store until the new track appears with its copied chain. Returns
 * the track's Permute DeviceRecord, or null if the track materialized but
 * carries no Permute (degraded-but-fine — duplicate + empty still succeed).
 * Throws only if the track itself never appears within the timeout.
 *
 * `preDuplicateTrackCount` is the freshness gate. A record already sits at
 * `tracks/<N+1>` for any source that isn't the last track — it belongs to
 * the track the duplicate just pushed down — and it answers a `.get()`
 * instantly, with a Permute of its own in most sets. Waiting for the tree
 * to carry one more track than it did before the duplicate is what makes
 * the record we read the copy rather than its displaced neighbour.
 */
async function waitForNewTrackReady(
	newTrackPath: string,
	preDuplicateTrackCount: number
): Promise<DeviceRecord | null> {
	const deadline = Date.now() + READY_POLL_TIMEOUT_MS;
	for (;;) {
		const settled = v3Store.tracks.size > preDuplicateTrackCount;
		const track = settled ? v3Store.tracks.get(newTrackPath) : undefined;
		if (track) {
			const permute = [...track.devices.values()].find((d) => d.name === 'Permute');
			if (permute) return permute;
			// Track present but devices may still be streaming in. Keep
			// polling until the deadline; if it lapses with the track
			// present but no Permute, treat as "no Permute".
			if (Date.now() >= deadline) return null;
		} else if (Date.now() >= deadline) {
			throw new Error(`waitForNewTrackReady timeout for ${newTrackPath}`);
		}
		await delay(READY_POLL_INTERVAL_MS);
	}
}

/**
 * Button released (or tapped again while latched): group `members` (anchor
 * first, then every track tapped while the gesture was open — all of it
 * decided locally, per `groupGestureStore`). One request, sent only now —
 * nothing about the gesture touched Live before this.
 *
 * **Live's LOM cannot group tracks at all** — no create-group call, no track
 * move, and `group_track` / `is_foldable` / `is_grouped` are read-only — so
 * this drives Live's real Accessibility surface instead
 * (`handlers/liveGroupTracks.js`, ADR-439 research 2026-09-19/20): real
 * clicks build the selection fresh from `members`, and a real ⌘G commits it
 * with no context menu appearing on Live's screen. If the selection touches
 * an existing group, the bridge merges into it (ungroup, then re-group
 * everyone flat) rather than letting Live's own command nest one group
 * inside another, which is what it does unprompted.
 *
 * Rejects `already-grouped` when `members` is just the anchor and it is
 * already in a group (nothing to do), or `multi-group-merge-unsupported`
 * when the members span more than one existing group.
 */
export function commitGroupGesture(members: GroupMember[]): Promise<void> {
	const requestId = generateRequestId();
	logger.debug('groupGesture.commit: sending', { component: 'trackOperations', requestId, members });

	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			removeOscMessageListener(handler);
			clearTimeout(timer);
			fn();
		};

		const handler = (msg: OscBusMessage) => {
			if (!msg || msg.address !== GROUP_REPLY_ADDRESS || !msg.args) return;
			if (msg.args[0] !== requestId) return;
			if (Number(msg.args[1]) === 1) {
				settle(resolve);
				return;
			}
			const code = String(msg.args[2] ?? 'group-failed');
			const detail = String(msg.args[3] ?? '');
			logger.warn('groupGesture.commit: refused', { component: 'trackOperations', code, detail });
			settle(() => reject(new Error(`groupGesture.commit ${code}: ${detail}`)));
		};

		addOscMessageListener(handler);
		send(GROUP_ADDRESS, [requestId, JSON.stringify(members)]);

		const timer = setTimeout(() => {
			settle(() => reject(new Error(`groupGesture.commit timeout (${GROUP_TIMEOUT_MS}ms)`)));
		}, GROUP_TIMEOUT_MS);
	});
}

/**
 * Duplicate `sourceTrackPath` into a variation track: copy → empty all
 * clips (server-side, inside the duplicate) → reset Permute to defaults.
 * Resolves with the new track's path and index. A missing Permute or a
 * ready-poll lapse is downgraded to a warning — the duplicate itself, and
 * the emptying that rode with it, already succeeded.
 */
export async function duplicateTrackAndReset(
	sourceTrackPath: string
): Promise<DuplicateTrackResult> {
	// Read before the duplicate: the gate waitForNewTrackReady polls against.
	const preDuplicateTrackCount = v3Store.tracks.size;
	const result = await duplicateTrack(sourceTrackPath, true);

	let permute: DeviceRecord | null = null;
	try {
		permute = await waitForNewTrackReady(result.newTrackPath, preDuplicateTrackCount);
	} catch (err) {
		logger.warn('duplicateTrackAndReset: new track never settled; skipping cleanup', {
			component: 'trackOperations', newTrackPath: result.newTrackPath, err: String(err)
		});
		return result;
	}

	if (permute) {
		resetParamsToDefaultsForDevice(permute.devicePath);
	} else {
		logger.warn('duplicateTrackAndReset: no Permute on duplicate; reset skipped', {
			component: 'trackOperations', newTrackPath: result.newTrackPath
		});
	}

	return result;
}
