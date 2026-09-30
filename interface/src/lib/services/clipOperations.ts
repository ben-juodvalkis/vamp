/**
 * Clip Operations Service
 *
 * Stateless utility functions for clip manipulation. Owns:
 * - Loop length math (doubleLoop / halveLoop)
 * - An audio clip's gain (setAudioClipGain)
 * - Duplicate-loop / reverse / sample-to-Simpler / capture-to-Simpler
 * - The auto-trim flow (`armAutoStartMarker`) that runs after
 *   sample-to-Simpler and capture-to-Simpler land a fresh sample.
 *
 * Transpose / pitch / device-parameter shifts live in
 * `./clipTranspose.ts` (split out 2026-05; code-quality audit hotspot
 * #2). Their public exports are re-exported here so existing callers
 * (`ClipCentralView.svelte`, etc.) keep their imports unchanged.
 *
 * Architecture:
 * - Pure functions (no internal state)
 * - Reads context from stores (session, currentInstrument)
 * - Sends commands via send() which auto-routes via the bridge
 * - Returns Promises for operations that need query/response pattern
 *
 * Usage:
 *   import { transposeClipUp, doubleLoop } from '$lib/services/clipOperations';
 *   await transposeClipUp();  // Handles all track/instrument types automatically
 *   doubleLoop();             // Simple loop length adjustment
 */

import {
	send,
	sendClipDuplicate,
	sendClipDuplicateRegion,
} from '$lib/api/simpleClient';
import {
	V3_CLIP_SET_GAIN_ADDRESS,
	V3_CLIP_SET_LOOP_END_ADDRESS,
} from '$lib/api/handlers/v3Clip';
import { addPropertyValueWatcher } from '$lib/api/handlers/v3Property';
import { addSimplerReplacedWatcher } from '$lib/api/handlers/v3SimplerReplaced';
import { requireFocusedClip } from '$lib/stores/session.svelte';
import { clipPropertiesStore } from '$lib/stores/v6/clipPropertiesStore.svelte';
import { clipReverseStore } from '$lib/stores/clipReverse.svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { prepareForPreset, type PrepareResult } from './trackPreparation';
import { recentInstrumentsStore } from '$lib/stores/v6/recentInstrumentsStore.svelte';
import { requestSample } from './clipSampleService';
import { logger } from '$lib/utils/logger';
import { getClipContext } from './clipContext';
import { instrumentDisplayCoordinator } from './instrumentDisplayCoordinator.svelte';
import { selectTrackByIndex } from '$lib/components/v6/tracks/composables/useTrackData.svelte';

// Re-exports: transpose / pitch / device-parameter ops live in
// clipTranspose.ts now (audit #2 split). Surface them here so the
// pre-split import paths keep working.
export {
	transposeClip,
	transposeClipUp,
	transposeClipDown,
	transposeDevice,
	transposeDeviceUp,
	transposeDeviceDown,
	setAudioClipPitch,
} from './clipTranspose';

// ===== Loop Length Operations =====

/**
 * Set the focused audio clip's gain — Live's normalized 0..1, not dB.
 *
 * Under a Permute mute step the surface keeps the clip at 0 and makes
 * this the gain the step puts back; its echo is this value, not the 0
 * (see `ClipPropertiesComponent`). Updates the store optimistically, as
 * the pitch fader does.
 */
export function setAudioClipGain(value: number): void {
	const clipPath = requireFocusedClip({ component: 'clipOperations', op: 'setAudioClipGain' });
	if (!clipPath) return;
	const clamped = Math.max(0, Math.min(1, value));
	if (clamped === clipPropertiesStore.gain) return;
	clipPropertiesStore.handleGain(clamped);
	send(V3_CLIP_SET_GAIN_ADDRESS, [clipPath, clamped]);
}

/**
 * Live's dB text for a clip's gain, rounded to whole dB for the fader label
 * ("-3.5 dB" → "-4 dB", halves away from zero). Text with no number in it
 * ("-inf dB") comes back as Live wrote it.
 */
export function roundGainDisplay(text: string): string {
	const m = /^\s*([+-]?\d+(?:\.\d+)?)\s*dB\s*$/.exec(text);
	if (!m) return text;
	const x = Number(m[1]);
	const n = Math.sign(x) * Math.round(Math.abs(x));
	if (n === 0) return '0 dB';
	return `${n > 0 && m[1].startsWith('+') ? '+' : ''}${n} dB`;
}

/**
 * Double the loop length
 * Uses current loop region from clipPropertiesStore
 */
export function doubleLoop(): void {
	const clipPath = requireFocusedClip();
	if (!clipPath) return;
	const loopEnd = clipPropertiesStore.loopEnd;
	const loopStart = clipPropertiesStore.loopStart;
	const newEnd = loopStart + (loopEnd - loopStart) * 2;

	send(V3_CLIP_SET_LOOP_END_ADDRESS, [clipPath, newEnd]);
}

/**
 * Halve the loop length
 * Uses current loop region from clipPropertiesStore
 */
export function halveLoop(): void {
	const clipPath = requireFocusedClip();
	if (!clipPath) return;
	const loopEnd = clipPropertiesStore.loopEnd;
	const loopStart = clipPropertiesStore.loopStart;
	const newEnd = loopStart + (loopEnd - loopStart) / 2;

	send(V3_CLIP_SET_LOOP_END_ADDRESS, [clipPath, newEnd]);
}

/**
 * Double the looped region of the current MIDI clip in place.
 *
 * ROW 8 (2026-04-21): restored the pre-PR-7b in-place "duplicate loop"
 * semantic on a dedicated v3 wire. Fires
 * ``/looping/v3/clip/duplicate_region [slotPath]`` to the Python
 * ``ClipsComponent``, which invokes ``Clip.duplicate_loop()``. The
 * slot-copy gesture remains on ``/looping/v3/clip/duplicate`` (kept
 * deliberately — see 10-cleanup-plan.md Open Q #5).
 */
export async function duplicateLoop(): Promise<void> {
	const ctx = getClipContext();
	if (!ctx.detailClipIndices) {
		logger.warn('No detail clip selected for duplication', { component: 'clipOperations' });
		return;
	}

	if (ctx.trackType !== 'midi') {
		logger.warn('Duplicate loop only works on MIDI clips', { component: 'clipOperations' });
		return;
	}

	const { track, scene } = ctx.detailClipIndices;
	const slotPath = `tracks/${track}/slots/${scene}`;
	logger.debug('Duplicating loop in place (ROW 8)', {
		component: 'clipOperations',
		slotPath,
		address: '/looping/v3/clip/duplicate_region',
	});
	sendClipDuplicateRegion(slotPath);
}

/**
 * Copy the focused clip into the next slot down on the same track
 * (``/looping/v3/clip/duplicate`` → ``Track.duplicate_clip_slot``).
 * The surface refuses an occupied or missing next slot, so callers
 * offer this only when that slot is empty.
 */
export function duplicateClipToNextSlot(): void {
	const ctx = getClipContext();
	if (!ctx.detailClipIndices) {
		logger.warn('No detail clip selected for duplication', { component: 'clipOperations' });
		return;
	}
	const { track, scene } = ctx.detailClipIndices;
	sendClipDuplicate(`tracks/${track}/slots/${scene}`, `tracks/${track}/slots/${scene + 1}`);
}

// Note: quantizeNotes() removed (Phase 8 PR-8b) — never had a backend handler.
// Note: setNoteChance() removed - now handled via sequencerStore → Permute device
// Note: shiftNotes() removed - functionality not needed per user feedback

/**
 * Reverse the currently-focused audio clip.
 *
 * Live's LOM has no Clip.reverse() — the only way to reverse a Session
 * audio clip is the "Reverse" button in Clip View. On /cmd/clip/reverse the
 * bridge asks the Looping AX Helper (ADR-439) to press that button, and acks
 * on /cmd/clip/reverse/ack with `[1]` or **`[0, code, detail]`** — a named AX
 * code (`ax-helper-down`, `ax-untrusted`, `ax-control-missing`, …), not the
 * `[0, stderr]` of the osascript copy, which is gone along with
 * `liveAxClick.js`.
 *
 * Trusts session.focusedClipPath — the Live UI's selected clip mirrors
 * our focused clip via the selection echo, same assumption sampleClipToSimpler
 * makes. Symmetric: calling twice un-reverses.
 *
 * Drives clipReverseStore.isReversing so the UI lock is bound to actual
 * bridge completion rather than a detached client-side timer. The ceiling is
 * the helper client's `axHelper.requestTimeoutMs` (20 s), not an osascript
 * timeout.
 */
export function reverseFocusedAudioClip(): void {
	const clipPath = requireFocusedClip({
		component: 'clipOperations',
		op: 'reverseFocusedAudioClip',
	});
	if (!clipPath) return;
	logger.debug('reverseFocusedAudioClip: sending', {
		component: 'clipOperations',
		address: '/cmd/clip/reverse',
		clipPath,
	});
	clipReverseStore.begin();
	send('/cmd/clip/reverse', []);
}

// ===== Audio Clip Sampling =====

/** Clip-view convert. Its ack comes back stamped with this address. */
const V3_SIMPLER_REPLACE_SAMPLE_ADDRESS = '/looping/v3/simpler/replace_sample';
/** Capture flow's onto-a-prepared-track variant. */
const V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS =
	'/looping/v3/simpler/replace_sample_onto_track';

/**
 * Sample current focused audio clip to a new MIDI track + Simpler.
 *
 * Sends the focused clipPath to Python's SimplerLoadComponent, which
 * reads ``clip.file_path`` server-side, inserts a MIDI track adjacent
 * to the source audio track, inserts a Simpler onto it, then calls
 * ``simpler.replace_sample(file_path)``. Unblocked 2026-04-23 by Live
 * 12.4's SimplerDevice.replace_sample.
 *
 * The UI only needs to carry the clipPath; file_path lives in the
 * LOM and is cheaper to read there than to round-trip through the
 * store. On success the surface emits
 * `/looping/v3/simpler/replaced [address, devicePath, filePath]`,
 * which drives auto-trim and the Recent entry; the new track + device
 * still arrive separately through the state/full listener.
 */
export async function sampleClipToSimpler(): Promise<void> {
	const clipPath = requireFocusedClip({
		component: 'clipOperations',
		op: 'sampleClipToSimpler',
	});
	if (!clipPath) return Promise.reject(new Error('no-focused-clip'));
	logger.debug('sampleClipToSimpler: sending', {
		component: 'clipOperations',
		address: V3_SIMPLER_REPLACE_SAMPLE_ADDRESS,
		clipPath,
	});
	send(V3_SIMPLER_REPLACE_SAMPLE_ADDRESS, [clipPath]);

	// Recent, optimistically — the tile appears on the tap rather than a
	// round-trip later, and it survives a dropped ack on the UDP leg.
	// A convert that then fails on the surface emits `replace-sample-failed`
	// carrying this same path, and the v3 error handler prunes the entry.
	// The other failure modes (preset unconfigured, create-track raised)
	// leave an entry pointing at a perfectly loadable audio file, which is
	// what re-picking it from Recent would do anyway.
	addRecentFromClip(clipPath);

	// Auto-trim, resolved off the surface's ack: it names the Simpler's
	// devicePath and the sample's absolute path, neither of which this
	// flow can know on its own (the UI never reads clip.file_path — it
	// lives server-side). `onResolved` re-adds to Recent with the path
	// the surface actually loaded, which dedupes against the optimistic
	// entry above and corrects it if the two ever disagree.
	armAutoStartMarker({
		flow: 'convert',
		originAddress: V3_SIMPLER_REPLACE_SAMPLE_ADDRESS,
		onResolved: (devicePath, resolvedPath) => {
			showNewSimpler(devicePath);
			recentInstrumentsStore.addSample(
				deriveSampleDisplayName(resolvedPath),
				resolvedPath,
				'convert'
			);
		},
	});
}

/**
 * Add the clip's own sample to Recent without waiting for the load.
 *
 * The absolute path comes from `clipSampleService`, which the track
 * strip's waveform previews already populate — so for a clip the user
 * can see, this is a cache hit and the tile lands immediately. A miss
 * costs one `clip/sample/get` round trip, still typically ahead of the
 * load itself. Failures are silent: the ack path adds the entry anyway.
 */
function addRecentFromClip(clipPath: string): void {
	requestSample(clipPath)
		.then((sample) => {
			if (!sample.isAudioClip || !sample.filePath) return;
			recentInstrumentsStore.addSample(
				deriveSampleDisplayName(sample.filePath),
				sample.filePath,
				'convert'
			);
		})
		.catch((err: Error) => {
			logger.debug('addRecentFromClip: no path for clip', {
				component: 'clipOperations', clipPath, error: err.message,
			});
		});
}

/**
 * Load a just-captured WAV file into a new Simpler on a prepared MIDI track.
 *
 * Called from captureStore when /capture/file arrives from
 * Vamp-Recorder.amxd. Composes two existing pieces:
 *
 * 1. `prepareTrack('midi')` — finds or creates an empty MIDI track
 *    (dedup-locked, reuses empty tracks via clipStateStore, returns the
 *    final track index). Same mechanism the REC TO SIMPLER UX already
 *    uses for user-initiated track prep.
 * 2. Python `SimplerLoadComponent.handle_replace_sample_onto_track`
 *    inserts a Simpler onto that specific track and calls
 *    `replace_sample(filePath)`.
 *
 * Fire-and-forget: errors surface through the logger + /looping/v3/error
 * bus but don't block the capture pipeline (user can record again).
 */
export async function loadCaptureIntoSimpler(
	filePath: string
): Promise<PrepareResult | undefined> {
	if (!filePath) {
		logger.warn('loadCaptureIntoSimpler: empty filePath', { component: 'clipOperations' });
		return undefined;
	}
	logger.info('loadCaptureIntoSimpler: preparing MIDI track for capture', {
		component: 'clipOperations', filePath,
	});
	let prepareResult: PrepareResult;
	try {
		prepareResult = await prepareForPreset('midi', '');
	} catch (err) {
		// `prepareForPreset` rejects on timeout / nack — surfaced
		// already in /looping/v3/error and logger.warn inside the
		// prepare path. Nothing to do; next capture will try again.
		logger.warn('loadCaptureIntoSimpler: prepareForPreset failed', {
			component: 'clipOperations', filePath, err: String(err),
		});
		return undefined;
	}
	const { trackPath } = prepareResult;
	logger.info('loadCaptureIntoSimpler: sending replace_sample_onto_track', {
		component: 'clipOperations', trackPath, filePath,
	});
	send(V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS, [trackPath, filePath]);

	// Auto-trim: detect first transient + drop start_marker just before
	// it. Captured loops typically have ~100-300ms of room tone before
	// the first hit; this eliminates a routine manual nudge. See the
	// armAutoStartMarker docstring for guards (frame=0 no-op, user-edit
	// race, timeout).
	//
	// `onResolved` adds the loaded sample to the Recent tab once we know
	// the load succeeded. Same hook services the convert flow — see
	// sampleClipToSimpler.
	//
	// We pass `filePath` rather than a devicePath: `prepareTrack` reuses
	// non-empty MIDI tracks, so the Simpler's slot index isn't knowable
	// up front, while the WAV path is exact. It filters the ack and also
	// keys the echo fallback that covers a dropped ack.
	armAutoStartMarker({
		filePath,
		flow: 'capture',
		originAddress: V3_SIMPLER_REPLACE_SAMPLE_ONTO_TRACK_ADDRESS,
		onResolved: (devicePath, resolvedPath) => {
			showNewSimpler(devicePath);
			recentInstrumentsStore.addSample(
				deriveSampleDisplayName(resolvedPath),
				resolvedPath,
				'capture'
			);
		},
	});
	// Surface the prepare result so callers can run follow-up work that
	// needs `wasCreated` (auto-coloring, etc.) without re-querying.
	// Live-capture callers (captureStore) ignore the return — the
	// fire-and-forget contract is unchanged.
	return prepareResult;
}

/**
 * Select the track a sample just landed on and show its Simpler (user,
 * 2026-09-30): after a convert or a capture the new Simpler is the thing to
 * play. The surface inserts it with `insert_device`, which selects nothing,
 * so without this the view stayed on the source clip. The request is armed
 * before the select, so the coordinator shows the instrument view off
 * whichever device-list update carries the Simpler — and, for a capture,
 * once the capture goes idle.
 */
function showNewSimpler(devicePath: string): void {
	const match = /^tracks\/(\d+)\//.exec(devicePath);
	if (!match) return;
	instrumentDisplayCoordinator.requestInstrumentView();
	void selectTrackByIndex(Number(match[1]));
}

/**
 * Derive a tile-friendly display name from a sample's filesystem path.
 * Strips the directory and extension; leaves the rest as-is so the
 * `LOOPING_CAPTURE_<timestamp>` filename convention is still readable
 * (a future cleanup pass can format timestamps into something prettier).
 */
function deriveSampleDisplayName(filePath: string): string {
	const basename = filePath.split('/').pop() ?? filePath;
	const dot = basename.lastIndexOf('.');
	return dot > 0 ? basename.slice(0, dot) : basename;
}

// --- auto-trim-to-first-transient -----------------------------------------
//
// Both convert-clip-to-Simpler and capture-to-Simpler eventually land a
// fresh sample on a Simpler. We auto-set the Simpler's start position
// to a detected first-transient frame so the loaded loop sounds right
// without the user having to drag the start brace past the leading
// silence.
//
// Detection runs server-side in `/api/sample-peaks` (see
// `findFirstTransient` in transientDetector.js). Orchestration here:
//
// 1. Arm a watcher for the surface's `/looping/v3/simpler/replaced` ack.
//    It carries the Simpler's devicePath and the sample's absolute path
//    — the two things this flow needs and the UI cannot otherwise know
//    (the convert flow never sees `clip.file_path`, which lives
//    server-side, and neither flow is told where the device landed).
// 2. On resolve, hold our own `sample.length` / `sample.start_marker`
//    subscriptions for the rest of the window. Without them the write
//    only worked when a view happened to be mounted on that Simpler —
//    which, for a convert, meant the interface had to follow Live onto
//    the new track inside the timeout or nothing happened at all.
// 3. Fetch the transient frame and write Simpler's **parameter 3
//    (Sample Start, 0..1 normalized)** so the visual brace lands at the
//    transient in Classic mode. We deliberately do NOT touch
//    `sample.start_marker` — same posture as `setPlaybackMode` in
//    SimplerCentralView when switching out of Slicing: param 3 carries
//    the visual offset, while start_marker is kept at 0 so a later mode
//    switch can sweep the full sample without an offset baked in.
//
// The capture flow also accepts an exact-match `sample.file_path`
// property echo as a fallback, since it knows the WAV path up front —
// cheap insurance against a dropped ack on the UDP leg. The convert flow
// has no such key. Until 2026-09-17 it guessed, accepting any Simpler's
// `sample.file_path` echo from a devicePath that hadn't existed when we
// armed; the adjacent-track insert defeats that, because shifting every
// track below the source down one puts the new Simpler on a path an
// existing device already occupied. That guess is gone — the ack replaced
// it.
//
// Guards (any of these → no write, fail silently):
// - frame === 0 (sample is silent / too short / noise-dominated).
// - peaks fetch fails (corrupt WAV, network).
// - sample.length never lands (can't normalize).
// - timeout with no ack and no qualifying echo.
// - Brace already moved by the user (start_marker echo arrives non-zero
//   before our write).

/** Covers the surface's load + the `sample.length` cold read that follows
 *  our own subscribe. Was 3000 when the flow depended on overhearing a
 *  view's echo; the extra headroom costs nothing (an idle watcher) and
 *  covers a slow load of a long sample. */
const AUTO_TRIM_TIMEOUT_MS = 5000;

interface ArmAutoStartMarkerArgs {
	/** Absolute filesystem path of the sample, when known up front.
	 * Capture flow has it from Vamp-Recorder's `/capture/file` and
	 * uses it to filter both the ack and the echo fallback. Convert
	 * flow doesn't (clip.file_path is server-side only) and takes
	 * whatever path its ack reports. */
	filePath?: string;
	/** Tag used for log correlation only. */
	flow: 'capture' | 'convert';
	/** The gesture address this arming belongs to; the ack stamps its
	 * origin, so two flows in flight at once don't cross-resolve. */
	originAddress: string;
	/** One-shot callback fired with the resolved `(devicePath, filePath)`
	 * the first time the load is confirmed. Used by the recent-instruments
	 * hook. Independent of the auto-trim write itself: still fires when
	 * frame=0 / race-detected / length-missing make the write a no-op.
	 * Does NOT fire on timeout. */
	onResolved?: (devicePath: string, filePath: string) => void;
}

/**
 * Fetch the first-transient frame for `filePath` from the peaks
 * endpoint. Returns `null` on any error or when the field is missing
 * (older endpoint). Uses `bins=64` to keep the JSON small; the decode
 * itself dominates and is cached, so a follow-up waveform fetch reuses.
 */
async function fetchTransientFrame(filePath: string): Promise<number | null> {
	try {
		const url = `/api/sample-peaks?path=${encodeURIComponent(filePath)}&bins=64`;
		const r = await fetch(url);
		if (!r.ok) return null;
		const data = await r.json();
		const frame = data?.firstTransientFrame;
		return typeof frame === 'number' && Number.isFinite(frame) ? frame : null;
	} catch (e) {
		logger.debug('fetchTransientFrame: failed', {
			component: 'clipOperations', filePath, error: String(e),
		});
		return null;
	}
}

/**
 * Arm a one-shot watcher: when the surface confirms the load, write
 * `sample.start_marker`'s Classic-mode equivalent (param 3) to the
 * detected first-transient frame on that Simpler. See the module-level
 * comment for the resolution sources and guards.
 *
 * Fire-and-forget: returns immediately. The watcher self-disarms on
 * any of: success, timeout, peak fetch failure, race detection.
 */
function armAutoStartMarker(args: ArmAutoStartMarkerArgs): void {
	const expectedFilePath = args.filePath;
	const { flow, originAddress, onResolved } = args;

	// Discovered when the load is confirmed. `resolvedLength` is tracked
	// here rather than read from the store on demand because the store
	// drops property echoes for a devicePath `state/full` hasn't landed
	// yet — which is exactly the window a freshly-created track is in.
	let resolvedDevicePath: string | null = null;
	let resolvedFilePath: string | null = null;
	let resolvedLength: number | null = null;
	let onResolvedFired = false;
	let writeDispatched = false;
	// Suppress the auto-write if the user (or a prior write) has moved
	// start_marker on the resolved Simpler before we fire — the echo of
	// that move arrives as a non-zero `sample.start_marker`. Tracked
	// per devicePath so a stale tracker doesn't cross-contaminate.
	const raceDetectedFor = new Set<string>();
	let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
	// Watcher releases + our own property subscriptions, torn down together.
	const releases: Array<() => void> = [];

	const cleanup = () => {
		if (timeoutHandle !== null) {
			clearTimeout(timeoutHandle);
			timeoutHandle = null;
		}
		const pending = releases.splice(0, releases.length);
		for (const release of pending) {
			try {
				release();
			} catch (e) {
				logger.debug('auto-trim: release threw', {
					component: 'clipOperations', flow, error: String(e),
				});
			}
		}
	};

	const tryWrite = async () => {
		if (writeDispatched) return;
		const devicePath = resolvedDevicePath;
		const filePath = resolvedFilePath;
		if (!devicePath || !filePath) return;
		// Need sample.length to normalize the frame to 0..1 for param 3.
		// Not an error if it hasn't landed yet — our own subscribe's cold
		// read is in flight, and its echo re-enters here.
		const sampleLength = resolvedLength;
		if (sampleLength === null || sampleLength <= 0) return;
		writeDispatched = true;
		const frame = await fetchTransientFrame(filePath);
		if (frame === null || frame === 0) {
			logger.debug('auto-trim: skipping write', {
				component: 'clipOperations', flow, devicePath, filePath, frame,
			});
			cleanup();
			return;
		}
		if (raceDetectedFor.has(devicePath)) {
			logger.info('auto-trim: user moved brace first; skipping', {
				component: 'clipOperations', flow, devicePath, filePath,
			});
			cleanup();
			return;
		}
		const normalized = Math.max(0, Math.min(1, frame / sampleLength));
		logger.info('auto-trim: setting Simpler param 3 (Sample Start)', {
			component: 'clipOperations', flow, devicePath, filePath,
			frame, normalized,
		});
		selectedTrackStore.setParamValue(
			selectedTrackStore.paramPath(devicePath, 3),
			normalized
		);
		// Defensive reset: if a prior auto-trim (or any other path) left
		// `sample.start_marker` non-zero, push it back to 0 so the
		// "param 3 carries the offset; start_marker stays at 0" invariant
		// holds. No-op when start_marker is already 0 (the LOM listener
		// won't echo a same-value write).
		const startMarkerRaw = selectedTrackStore.propertyValue(
			devicePath,
			'sample.start_marker'
		);
		if (typeof startMarkerRaw === 'number' && startMarkerRaw !== 0) {
			selectedTrackStore.setPropertyValue(devicePath, 'sample.start_marker', 0);
		}
		cleanup();
	};

	/** First confirmation wins; later ones are no-ops. */
	const resolve = (devicePath: string, filePath: string) => {
		if (resolvedDevicePath !== null) return;
		resolvedDevicePath = devicePath;
		resolvedFilePath = filePath;
		logger.debug('auto-trim: load confirmed', {
			component: 'clipOperations', flow, devicePath, filePath,
		});
		if (!onResolvedFired && onResolved) {
			onResolvedFired = true;
			try {
				onResolved(devicePath, filePath);
			} catch (e) {
				logger.warn('armAutoStartMarker: onResolved callback threw', {
					component: 'clipOperations', flow, error: String(e),
				});
			}
		}
		// Own the subscriptions the write depends on, so it no longer
		// matters whether a view is mounted on this track.
		releases.push(
			selectedTrackStore.subscribeProperty(devicePath, 'sample.length'),
			selectedTrackStore.subscribeProperty(devicePath, 'sample.start_marker')
		);
		const lengthRaw = selectedTrackStore.propertyValue(devicePath, 'sample.length');
		if (typeof lengthRaw === 'number' && lengthRaw > 0) resolvedLength = lengthRaw;
		void tryWrite();
	};

	releases.push(
		addSimplerReplacedWatcher((ack) => {
			if (ack.originAddress !== originAddress) return;
			if (expectedFilePath && ack.filePath !== expectedFilePath) return;
			resolve(ack.devicePath, ack.filePath);
		})
	);

	releases.push(
		addPropertyValueWatcher((devicePath, propertyName, value) => {
			// Race detection covers the brace being moved before our write
			// lands. In Classic mode the brace is param 3 (Sample Start);
			// in Slicing it's `sample.start_marker`. Either non-zero echo on
			// a candidate devicePath flags the race. (The param-value
			// watcher is fed by a different code path — but property
			// listeners run synchronously alongside, and the
			// addPropertyValueWatcher signature doesn't reach params, so
			// we only catch the start_marker side here. The Classic-mode
			// race is rarer in practice — the user has to grab the brace
			// within the window.)
			if (
				propertyName === 'sample.start_marker' &&
				typeof value === 'number' &&
				value !== 0
			) {
				raceDetectedFor.add(devicePath);
				return;
			}
			if (propertyName === 'sample.length') {
				if (
					devicePath === resolvedDevicePath &&
					typeof value === 'number' &&
					value > 0
				) {
					resolvedLength = value;
					void tryWrite();
				}
				return;
			}
			// Echo fallback, capture flow only: an exact path match is a
			// safe identifier for the right Simpler, so this stands in for
			// a dropped ack. The convert flow has nothing to match on and
			// deliberately waits for its ack.
			if (propertyName !== 'sample.file_path') return;
			if (!expectedFilePath) return;
			if (typeof value !== 'string' || value !== expectedFilePath) return;
			resolve(devicePath, value);
		})
	);

	timeoutHandle = setTimeout(() => {
		logger.debug('auto-trim: timeout, load never confirmed', {
			component: 'clipOperations', flow, originAddress, expectedFilePath,
		});
		cleanup();
	}, AUTO_TRIM_TIMEOUT_MS);
}
