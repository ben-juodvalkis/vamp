/**
 * V3 Handshake handlers — Phase 2 PR-2c.
 *
 * Drives the UI side of the v3 protocol-version negotiation per
 * [04 §8](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/04-wire-protocol.md#8-handshake).
 *
 * ## Wire shape
 *
 * ```
 * UI →   /looping/v3/handshake/hello   [versions:string[]]
 * Surf → /looping/v3/handshake/accept  [version:string, sessionId:string, generation:int]
 * Surf → /looping/v3/error             [originatingAddress, code, path, detail]
 * ```
 *
 * ## Cold start and reconnect are the same path
 *
 * Per [04 §8.5], the Python surface emits a `state/full` with
 * `reason="accept"` immediately after every `accept` reply — both on
 * cold-start (first hello after WS connect) and on reconnect (second
 * or later hello after a WS drop). The UI does nothing extra in either
 * case: the `state/full/tree` message arrives on its own and populates
 * `v3Store` via the v3StateFull handler.
 *
 * Pre-PR-3b this handler issued `/looping/v3/state/resync` on
 * reconnects (where `attemptCount > 1`) to compensate for the
 * surface's bring-up-time `emit_on_init` racing UI connect. PR-3b
 * makes accept the universal cold-start trigger, so the reconnect
 * resync is obsolete: firing it would just double the bundle on every
 * reconnect. `attemptCount` is still maintained in the store for
 * telemetry, but no longer gates behaviour here. The `sendStateResync`
 * helper remains exported for UDP packet-loss recovery per
 * [07 §2.4](https://github.com/ben-juodvalkis/Looping/blob/dbae35ae/documentation/archive/m4l-to-python-v3/07-validation-guide.md#24-udp-packet-loss-tolerance).
 *
 * ## Error handling
 *
 * `handshake-version-mismatch` flips handshakeState to `failed` with a
 * detail string for UI surfacing. Per [04 §8.3] there is no mid-session
 * fallback — we don't silently retry with 2.0.0. A fresh WS-connect
 * cycle is the only way to recover (user reloads the page, bridge
 * restarts, etc).
 *
 * Other v3 errors (stale-generation, path-not-found, etc.) are logged
 * but not surfaced to the handshake store — they land against specific
 * param writes and the store's drop-on-missing already handles the
 * fallout. This handler only interprets handshake-scoped errors.
 */

import { logger } from '$lib/utils/logger';
import { toNumber, toString } from './oscTypeHelpers';
import { setHandshake, v3Store } from '$lib/stores/v3/normalized.svelte';
import { heldEtagToken } from './stateFullEtagStore';
import {
	markHelloSent,
	markAccepted,
	markFailed,
	handshakeState
} from '$lib/stores/v3/handshakeState.svelte';
import type { OSCArg } from '$lib/types/osc';

// ============================================
// Address constants
// ============================================

export const V3_HANDSHAKE_HELLO_ADDRESS = '/looping/v3/handshake/hello';
export const V3_HANDSHAKE_ACCEPT_ADDRESS = '/looping/v3/handshake/accept';
export const V3_ERROR_ADDRESS = '/looping/v3/error';

/** ADR-415 — errors for this address route to clipSampleService. */
const V3_CLIP_SAMPLE_GET_ADDRESS = '/looping/v3/clip/sample/get';
export const V3_STATE_RESYNC_ADDRESS = '/looping/v3/state/resync';

/** UI-supported protocol versions, in preference order. Mirrors
 *  Python `HandshakeComponent.SUPPORTED_VERSIONS`; adding a version
 *  here requires code that implements it. Exactly one version is
 *  listed, because this parser's record arities *and* its wire
 *  addresses are fixed — it can only decode the shape it was written
 *  against.
 *
 *  ADR-410 (2026-07-27) moves that to 3.4.0: the T-record grew 10 ->
 *  13 fields (isFoldable / foldState / groupTrackIndex). Against a
 *  3.3.0 surface this parser would over-read every T record and take
 *  the following record's tag as an int field, so the bump and the
 *  arity change ship together.
 *
 *  The Python surface's SUPPORTED_VERSIONS tuple still contains the
 *  older entries so a 3.4.0 surface can negotiate down for a
 *  downgrade-revert UI. The asymmetry is intentional: an older UI can
 *  run against a newer surface (trailing fields it doesn't know are
 *  harmless *only* where arity grew at the end, which is why every
 *  addition appends), but a newer UI cannot parse an older surface's
 *  shorter records.
 *
 *  Prior bumps for the same reason: ROW 5 (2026-04-21) shrank the
 *  D-record 4 -> 3 (legacyId retired) at 3.3.0; 3.2.0 added
 *  hasArrangementClips to T.
 *
 *  **3.5.0 (2026-08-31) was the first bump that is not an arity
 *  change.** It adds the client-declared ETag: an `etag:0x...` token
 *  in hello / resync, answered with `state/full/unchanged` when the
 *  surface recomputes the same tree. Record shapes untouched, so for
 *  one release this list held two entries — a 3.5.0 UI against a
 *  3.4.0 surface simply never sees a marker and always gets a full
 *  tree, which is the pre-3.5.0 behaviour.
 *
 *  **3.6.0 (2026-08-31) collapses `state/full` into a single
 *  `state/full/tree` message**, and takes the list back to one entry —
 *  for a new reason. Earlier bumps were about record *shape*, where an
 *  older UI could sometimes cope. This one changed the *addresses*:
 *  `begin` / `chunk` / `end` are gone, and this handler no longer has
 *  code that could read them. Negotiating down to 3.5.0 would produce
 *  a handshake that succeeds and a tree that never arrives — a blank
 *  UI with no error anywhere, which is the exact failure ADR-418 was
 *  written about.
 *
 *  So we advertise one version alone and let an older surface answer
 *  `handshake-version-mismatch` on `/looping/v3/error`. A loud,
 *  named failure the user can act on ("restart Live — it caches
 *  Remote Script bytecode until a full restart") beats a silent one.
 *
 *  **3.7.0 (2026-08-31) grows the T record 13 -> 14 fields**, adding
 *  `role` — the rail an instrument was loaded from, persisted in
 *  Live's per-track key-value store instead of re-derived every
 *  session. An ordinary arity bump, and the ordinary consequence: this
 *  parser reads 14 fields, so against a 3.6.0 surface it would
 *  under-read every T record and take the next record's tag as a
 *  field. Surface and UI ship together.
 *
 *  **3.8.0 (2026-09-10, issue #491) adds the drum pad chain**: a
 *  note-keyed `pads/<note>` path segment under a Drum Rack, a
 *  `pad-chain` `state/full/tree` whose scope is a pad path (D and P
 *  records, no T, applied to a pad map of their own), and a
 *  `device/load` that reads its `devicePath`. Record arities are
 *  unchanged, so a 3.7.0 UI would parse the bundles — and mis-index a
 *  nested device path in its chain-order device array, which is what
 *  the bump marks.
 *
 *  **3.9.0 (2026-09-15, ADR-439) grows the T record 14 -> 15 fields**,
 *  appending `preset` — the path the track's instrument was last loaded
 *  from through `prepare_for_preset`, persisted in Live's per-track store
 *  as `looping.preset`; the instrument views' swap control steps from it.
 *  An arity bump with 3.7.0's consequence: surface and UI ship together.
 */
export const UI_SUPPORTED_VERSIONS: readonly string[] = ['3.12.0'];

/** Closed-enum code per [04 §7.2] for the specific error the handshake
 *  can produce. Listed here (not in a generic v3 error module) because
 *  it's the only code this handler branches on. */
const HANDSHAKE_VERSION_MISMATCH_CODE = 'handshake-version-mismatch';
const POOL_EXHAUSTED_CODE = 'pool-exhausted';
const REPLACE_SAMPLE_FAILED_CODE = 'replace-sample-failed';

// ============================================
// Outbound: hello + resync
// ============================================

/** Injected send function — broken out so tests don't need a real
 *  WebSocket. `simpleClient.ts` calls `setSender(wsSend)` at module
 *  load. */
type Sender = (address: string, args: OSCArg[]) => void;
let sender: Sender | null = null;

export function setSender(fn: Sender | null): void {
	sender = fn;
}

/**
 * Listeners run after every accept this client owns — a fresh session,
 * whether the first or a reconnect. Registered by the modules that need
 * to reset session-scoped state (`v3DrumPadHold` drops the Move pad
 * holds, ADR-432) rather than imported here: this module sits under
 * `simpleClient`, which calls `setSender` at load, so a static import
 * of a store from here closes a cycle that lands `setSender` on an
 * uninitialised binding. Returns the unregister function.
 */
const acceptedListeners = new Set<() => void>();

export function onHandshakeAccepted(listener: () => void): () => void {
	acceptedListeners.add(listener);
	return () => {
		acceptedListeners.delete(listener);
	};
}

/** The hello crosses a UDP hop (bridge → surface, port 11020) and is
 *  unacknowledged. A drop there — a full socket buffer, or a Live tick
 *  stall, which `bridge.log` records at 3–12s — strands the UI in
 *  `pending` forever: no accept, so no `state/full`, so no tracks,
 *  meters or playheads, while outbound writes keep working because
 *  they're fire-and-forget. That reads exactly like a frozen UI whose
 *  faders still reach Live, and only a reload cleared it.
 *
 *  So the hello repeats until an accept lands. Attempts stop at
 *  MAX_RETRIES; a genuinely absent surface is picked up later by the
 *  reconnect path or by `surface/hello`, both of which start a fresh
 *  sequence. */
const HELLO_RETRY_MS = 2_000;
const HELLO_MAX_RETRIES = 8;
let helloRetryTimer: ReturnType<typeof setTimeout> | null = null;
let helloRetries = 0;

function clearHelloRetry(): void {
	if (helloRetryTimer !== null) {
		clearTimeout(helloRetryTimer);
		helloRetryTimer = null;
	}
	helloRetries = 0;
}

function armHelloRetry(): void {
	if (helloRetryTimer !== null) return;
	helloRetryTimer = setTimeout(() => {
		helloRetryTimer = null;
		if (handshakeState.phase === 'accepted') return;
		if (helloRetries >= HELLO_MAX_RETRIES) {
			logger.error('v3 handshake: no accept after retries — giving up until reconnect', {
				retries: helloRetries,
				intervalMs: HELLO_RETRY_MS
			});
			return;
		}
		helloRetries += 1;
		logger.warn('v3 handshake: no accept — resending hello', {
			retry: helloRetries,
			of: HELLO_MAX_RETRIES
		});
		sendHandshakeHello(true);
	}, HELLO_RETRY_MS);
}

/** Test-only: stop any in-flight retry so a suite can't leak a timer. */
export function __clearHelloRetryForTests(): void {
	clearHelloRetry();
}

/**
 * Send `/looping/v3/handshake/hello [versions]`. Bumps the store's
 * attempt counter and transitions to `pending`. Returns the attempt
 * number so the caller can log it.
 *
 * Called from `simpleClient.onConnected` on every WS-connect
 * (including reconnects — the WebSocketConnection module's
 * `onConnectCallback` naturally fires on each successful open).
 */
export function sendHandshakeHello(isRetry = false): number {
	// A caller-initiated hello (connect / surface restart) starts a
	// fresh sequence; a retry continues the current one.
	if (!isRetry) clearHelloRetry();

	const attempt = markHelloSent();
	if (!sender) {
		logger.warn('v3 handshake: hello requested but no sender wired', { attempt });
		return attempt;
	}
	// Protocol 3.5.0: declare the tree we already hold, so a reconnect
	// against an unchanged set gets a marker instead of ~390 KB. The
	// token is namespaced (`etag:0x...`) rather than positional
	// because this arg list is an open-ended set of version strings —
	// a bare checksum would be indistinguishable from a version. A
	// 3.4.0 surface simply fails to match it and ignores it.
	//
	// Omitted entirely on a cold start: claiming nothing is what makes
	// the surface send the whole tree, which is the correct answer
	// when we have none.
	const etagToken = heldEtagToken();
	const helloArgs: string[] = [...UI_SUPPORTED_VERSIONS];
	if (etagToken !== null) helloArgs.push(etagToken);

	sender(V3_HANDSHAKE_HELLO_ADDRESS, helloArgs);
	logger.info('v3 handshake: hello sent', {
		versions: UI_SUPPORTED_VERSIONS,
		heldEtag: etagToken,
		attempt
	});
	armHelloRetry();
	return attempt;
}

/**
 * Send `/looping/v3/state/resync`. Reserved for UDP packet-loss
 * recovery per [07 §2.4] — cold-start and reconnect both receive a
 * state/full automatically from the surface (see module-level comment
 * and [04 §8.5]). The surface binds this address to
 * `V3StateFullComponent.emit_on_resync`
 * ([LoopingSurface.py:407-409]), which emits a state/full with
 * `reason="resync"`.
 */
export function sendStateResync(): void {
	if (!sender) {
		logger.warn('v3 handshake: resync requested but no sender wired');
		return;
	}
	// Protocol 3.5.0: `[sessionId?, "etag:0x..."?]`, both optional and
	// both absent before 3.5.0.
	//
	// The sessionId rides along because the surface has no per-client
	// channel — every UI's traffic arrives from the bridge's single UDP
	// port — so it needs the id to tag a marker that only we should
	// act on.
	//
	// Note the deliberate asymmetry with what resync is *for*: a UI
	// recovering from packet loss holds an incomplete tree, and
	// `recordAppliedEtag` is only ever called after a bundle applies
	// cleanly. So the ETag we declare here can only describe a tree we
	// genuinely completed, and a torn one declares the last good value
	// or nothing — either way the surface resends.
	const args: string[] = [v3Store.sessionId || ''];
	const etagToken = heldEtagToken();
	if (etagToken !== null) args.push(etagToken);

	sender(V3_STATE_RESYNC_ADDRESS, args);
	logger.info('v3 handshake: state/resync sent (reconnect recovery)', {
		heldEtag: etagToken
	});
}

// ============================================
// Inbound: accept + error
// ============================================

/**
 * Handle `/looping/v3/handshake/accept [version, sessionId, generation]`.
 *
 * Updates both the handshake state (phase → accepted) and the
 * normalized store (sessionId, generation). On reconnect (attempt > 1),
 * fires state/resync to get a fresh tree — see module-level comment.
 *
 * Malformed payloads are logged and dropped without transitioning
 * state; the handshake stays `pending` and any subsequent well-formed
 * accept will resolve it. In practice the Python surface never emits
 * malformed accept so this branch is belt-and-braces.
 */
export function handleV3HandshakeAccept(args: OSCArg[]): void {
	if (args.length < 3) {
		logger.warn('v3 handshake/accept: short payload', { length: args.length });
		return;
	}
	const version = toString(args[0]);
	const sessionId = toString(args[1]);
	const generation = toNumber(args[2]);

	if (!version) {
		logger.warn('v3 handshake/accept: empty version');
		return;
	}
	if (!sessionId) {
		logger.warn('v3 handshake/accept: empty sessionId', { version });
		return;
	}
	if (!Number.isFinite(generation) || generation < 1) {
		logger.warn('v3 handshake/accept: invalid generation', { generation });
		return;
	}
	if (!UI_SUPPORTED_VERSIONS.includes(version)) {
		// Not ours. Accepts are BROADCAST to every WebSocket client, and
		// other clients negotiate their own versions — the menubar app
		// (owner/menubar Wire.swift) advertises 3.3.0, so its accept
		// lands here too. A genuine "surface can't speak our version"
		// never arrives as an accept: `HandshakeComponent._pick_version`
		// returns None and the surface emits /looping/v3/error instead.
		// So this can only be someone else's, and failing our own
		// handshake on it would be wrong — ignore it and keep waiting
		// for the accept that answers our hello.
		logger.debug('v3 handshake/accept: ignoring another client\'s accept', {
			version,
			uiSupported: UI_SUPPORTED_VERSIONS
		});
		return;
	}

	clearHelloRetry();
	setHandshake(sessionId, generation);
	markAccepted(version);
	for (const listener of acceptedListeners) {
		try {
			listener();
		} catch (e) {
			logger.warn('v3 handshake: accepted-listener threw', { error: String(e) });
		}
	}

	// `attemptCount` is incremented inside `markHelloSent` at hello
	// time; it persists across phase changes (only _resetForTests
	// zeroes it). Kept for telemetry / log correlation — PR-3b
	// removed the `attempt > 1 → sendStateResync` branch because the
	// surface now emits a state/full with `reason="accept"` after
	// every accept (see module docstring and [04 §8.5]).
	const attempt = handshakeState.attemptCount;
	logger.info('v3 handshake: accepted', {
		version,
		sessionId,
		generation,
		attempt
	});
}

/**
 * Handle `/looping/v3/error`.
 *
 * Two on-wire shapes share this address:
 *
 * - 4-arg from DevicesComponent and friends:
 *   `[originatingAddress, code, path, detail]`.
 * - 5-arg from PropertyComponent (PR-3.5.7-impl):
 *   `[originatingAddress, code, devicePath, propertyName, detail]`.
 *   Property errors carry both `(devicePath, propertyName)` because
 *   the property key is a pair, not a single path. We dispatch on
 *   `args.length` so the `detail` field stays in the last slot for
 *   both shapes.
 *
 * Only the handshake-scoped code transitions handshake state; other
 * codes are surfaced as warn-level logs and left to the
 * operation-specific handlers (none today; param/set errors are
 * swallowed by the surface's echo-on-clamp behaviour).
 */
/** The pad path a `load-failed` detail names after `;scope=`, or '' (the track). */
export function loadFailureScope(detail: string): string {
	const at = detail.lastIndexOf(';scope=');
	return at === -1 ? '' : detail.slice(at + ';scope='.length).trim();
}

export function handleV3Error(args: OSCArg[]): void {
	if (args.length < 2) {
		logger.warn('v3 error: short payload', { length: args.length });
		return;
	}
	const originatingAddress = toString(args[0]);
	const code = toString(args[1]);
	let path = '';
	let propertyName = '';
	let detail = '';
	if (args.length >= 5) {
		path = toString(args[2]);
		propertyName = toString(args[3]);
		detail = toString(args[4]);
	} else {
		path = args.length >= 3 ? toString(args[2]) : '';
		detail = args.length >= 4 ? toString(args[3]) : '';
	}

	// ADR-415: a `sample/get` failure must reject its pending promise,
	// or the requesting cell would sit on a 5s timeout before falling
	// back. The surface's error payload carries no requestId, so the
	// service rejects by clipPath — exact, because sample/get is
	// single-flight per path.
	//
	// Deliberately NOT an early return: routing to the service is an
	// extra consumer, not a replacement for the shared error handling
	// below. Returning here would take `sample/get` failures out of the
	// banner and the trailing warn log entirely, making them invisible
	// in the general error stream. The dynamic import keeps the v3
	// handler off a static edge to the v6 service; it needs its own
	// `catch`, since a rejected chunk load here is otherwise an
	// unhandled rejection.
	if (originatingAddress === V3_CLIP_SAMPLE_GET_ADDRESS) {
		import('$lib/services/clipSampleService')
			.then(({ handleSampleError }) => {
				handleSampleError({ clipPath: path, code, detail });
			})
			.catch((err: Error) => {
				logger.warn('v3 error: failed to route sample/get error', {
					error: err.message
				});
			});
	}

	if (code === HANDSHAKE_VERSION_MISMATCH_CODE) {
		logger.error('v3 handshake: version mismatch', {
			originatingAddress,
			detail
		});
		markFailed(detail || 'handshake version mismatch');
		return;
	}

	if (code === POOL_EXHAUSTED_CODE) {
		// PR-5e2: GroovePoolComponent refused a groove assignment because
		// all 32 pool slots are in use. Surface a transient banner so the
		// user knows why the set didn't take. Dynamic import avoids a
		// top-of-module dependency on a v6 store from this v3 handler.
		logger.warn('v3 pool exhausted', { originatingAddress, path, detail });
		import('$lib/stores/v6/v3ErrorBannerStore.svelte').then(
			({ v3ErrorBannerStore }) => {
				v3ErrorBannerStore.show(code, path, detail);
			}
		);
		return;
	}

	// Recent sample-backed Simpler entries point at filesystem paths
	// that may have moved/been deleted since the entry was added. When
	// the surface fails to load a sample (file gone, unreadable, etc.),
	// `path` carries the absolute filesystem path — prune the matching
	// recent so a future tap doesn't keep retrying the same dead file.
	// Dynamic import keeps this v3 handler off a v6-store import edge.
	if (code === REPLACE_SAMPLE_FAILED_CODE && path) {
		import('$lib/stores/v6/recentInstrumentsStore.svelte').then(
			({ recentInstrumentsStore }) => {
				recentInstrumentsStore.removeSampleByFilePath(path);
			}
		);
	}

	// ADR-360: route notes/get errors to the clipNotesService so a
	// ``clip-not-midi`` reply resolves the matching pending promise
	// with `[]` (UI shows ghost), and other codes reject so the
	// caller can surface the failure. Dynamic import avoids a top-of-
	// module dependency on a v6 service from this v3 handler.
	if (originatingAddress === '/looping/v3/clip/notes/get') {
		import('$lib/services/clipNotesService').then(({ handleNotesError }) => {
			handleNotesError({ originatingAddress, code, clipPath: path });
		});
	}

	// clip-view-mirror M3: route rich/get errors so a benign
	// ``clip-not-midi`` / ``clip-not-found`` resolves the editor's pull
	// with `[]` (empty piano-roll) rather than hanging until timeout.
	if (originatingAddress === '/looping/v3/clip/notes/rich/get') {
		import('$lib/services/clipRichNotesService').then(({ handleRichError }) => {
			handleRichError({ originatingAddress, code, clipPath: path });
		});
	}

	// A rejected device load leaves the FX-grid slot stuck in
	// `loading`/`error` — the device control's `isGhost || isLoading`
	// gate then refuses to retry. Reset the matching slot to `ghost` so
	// the next drag re-issues the load. `path` carries the preset path.
	// Issue #491: a pad-targeted load's failure carries `;scope=<padPath>`
	// in `detail`, because the slot reset matches on the preset path alone
	// and could not otherwise tell a pad-scope Reverb from the track's.
	if (originatingAddress === '/looping/v3/device/load' && path) {
		const scope = loadFailureScope(detail);
		import('$lib/stores/v6/selectedTrackStore.svelte').then(({ fxGrid }) => {
			fxGrid.handleLoadFailed(path, scope);
		});
	}

	// Non-handshake v3 error. Log and move on; the per-address handlers
	// don't have a common error channel to route to yet. Adding one is
	// out of PR-2c scope — see 06-risks-and-open-questions.md §2 for the
	// error-UX conversation.
	logger.warn('v3 error', {
		originatingAddress,
		code,
		path,
		...(propertyName ? { propertyName } : {}),
		detail
	});
}
