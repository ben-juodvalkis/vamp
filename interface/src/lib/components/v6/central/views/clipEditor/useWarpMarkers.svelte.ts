/**
 * useWarpMarkers — a warped audio clip's markers in the editor.
 *
 * Live's markers for the focused clip, or the drag's own picture of them
 * from the finger's first move until the surface echoes the move. A
 * grip's drag moves a marker's BEAT (its audio point stays: Live's
 * move_warp_marker), a double-tap on a grip removes the marker, and a
 * double-tap on the ruler adds one at the nearest transient.
 *
 * Call during component init with a getter-backed `view` (so each read
 * tracks only the field it reads).
 */

import { onDestroy } from 'svelte';
import { clipPropertiesStore } from '$lib/stores/v6/clipPropertiesStore.svelte';
import { moveWarpMarker, addWarpMarker, removeWarpMarker } from '$lib/services/clipCommands';
import { getTransients } from '$lib/services/clipTransientsService';
import { beatToX, xToBeat, clientDeltaToBeatDelta, type BeatWindow } from '$lib/utils/clip/clipEditorGeometry';
import {
	addTarget,
	canRemove,
	dragTarget,
	insertMarker,
	moveMarker,
	secToBeat,
	shownMarkers,
	withoutMarker,
	DOUBLE_TAP_MS,
	DOUBLE_TAP_PX,
	type WarpMarker
} from '$lib/utils/clip/warpMarkers';
import { createGestures } from './gestures';

const WARP_GRID_BEATS = 0.25;
const WARP_MIN_GAP_BEATS = 1 / 64;
const WARP_ECHO_TIMEOUT_MS = 2000;
const TRANSIENT_SNAP_BEATS = 0.125;

interface View {
	clipPath: string | null;
	isAudio: boolean;
	wavFilePath: string;
	beatWindow: BeatWindow;
	contentW: number;
}

export function useWarpMarkers(view: View) {
	const beginGesture = createGestures();

	let optimisticMarkers = $state.raw<WarpMarker[] | null>(null);
	const displayMarkers = $derived(optimisticMarkers ?? clipPropertiesStore.warpMarkers);
	const shown = $derived(view.isAudio ? shownMarkers(displayMarkers) : []);
	// Where each point of the file lands in clip beats, through the
	// markers, so the waveform stretches between them as Live plays it.
	// Undefined (evenly across the file's span) when unwarped or unknown.
	const place = $derived.by(() => {
		const markers = shown;
		const seconds = clipPropertiesStore.warpFileSeconds;
		if (markers.length < 2 || !(seconds > 0)) return undefined;
		return (fraction: number) => secToBeat(markers, fraction * seconds) ?? 0;
	});

	// The file's transients (seconds) — Live's own from its `.asd`, else the
	// server's detector — drawn as ticks on the ruler and snapped to by a
	// double-tap there. Only for a warped clip: an unwarped one has no
	// markers to add to.
	let transientSecs = $state.raw<number[]>([]);
	$effect(() => {
		const v = view;
		const path = v.isAudio && clipPropertiesStore.warpMarkers.length > 0 ? v.wavFilePath : '';
		transientSecs = [];
		if (!path) return;
		let cancelled = false;
		getTransients(path).then((secs) => {
			if (!cancelled) transientSecs = secs;
		});
		return () => {
			cancelled = true;
		};
	});

	const transientTicks = $derived.by(() => {
		const { beatWindow, contentW } = view;
		if (shown.length < 2 || contentW <= 0) return [];
		const out: number[] = [];
		for (const sec of transientSecs) {
			const beat = secToBeat(shown, sec);
			if (beat === null || beat < beatWindow.startBeats || beat > beatWindow.endBeats) continue;
			out.push(beatToX(beat, beatWindow, contentW));
		}
		return out;
	});

	const handles = $derived.by(() => {
		const { beatWindow, contentW } = view;
		return shown
			.map((m, index) => ({ index, beat: m.beat, x: beatToX(m.beat, beatWindow, contentW) }))
			.filter((h) => h.x >= -12 && h.x <= contentW + 12);
	});

	// ── Grip drag ────────────────────────────────────────────────────
	// Snapped to a 16th and held between its neighbors. Drawn
	// optimistically while the finger moves; ONE move goes to Live on
	// release (one undo step), and the picture holds until the surface's
	// echo replaces it.
	let dragIndex = $state<number | null>(null);
	let dragStartClientX = 0;
	let dragFromBeat = 0;
	let dragTo = 0;
	let dragShown: WarpMarker[] = [];
	let dragAll: WarpMarker[] = [];
	let echoAfter = $state<number | null>(null);
	let echoTimer: ReturnType<typeof setTimeout> | null = null;

	function startDrag(event: PointerEvent, index: number) {
		if (view.clipPath === null || view.contentW <= 0) return;
		if (event.cancelable) event.preventDefault();
		event.stopPropagation();
		if (gripDoubleTapped(index)) return;
		dragAll = clipPropertiesStore.warpMarkers;
		dragShown = shownMarkers(dragAll);
		const marker = dragShown[index];
		if (!marker) return;
		dragIndex = index;
		dragStartClientX = event.clientX;
		dragFromBeat = marker.beat;
		dragTo = marker.beat;
		echoAfter = null;
		beginGesture(onDragMove, onDragEnd);
	}

	function onDragMove(event: PointerEvent) {
		const { contentW, beatWindow } = view;
		if (dragIndex === null || contentW <= 0) return;
		if (event.cancelable) event.preventDefault();
		const delta = clientDeltaToBeatDelta(event.clientX - dragStartClientX, contentW, beatWindow);
		dragTo = dragTarget(dragShown, dragIndex, dragFromBeat + delta, WARP_GRID_BEATS, WARP_MIN_GAP_BEATS);
		optimisticMarkers = moveMarker(dragAll, dragFromBeat, dragTo);
	}

	function onDragEnd() {
		const index = dragIndex;
		dragIndex = null;
		const distance = dragTo - dragFromBeat;
		const path = view.clipPath;
		if (path === null || Math.abs(distance) < 1e-6) {
			optimisticMarkers = null;
			noteGripTap(index);
			return;
		}
		lastGripTap = null;
		sendEdit(() => moveWarpMarker(path, dragFromBeat, distance), optimisticMarkers);
	}

	/**
	 * Send one marker edit and draw `picture` until the surface's
	 * `warp_markers` echo replaces it. A surface that never answers (one
	 * Live has not restarted into) must not leave a marker drawn where
	 * Live does not have it, so the picture also lapses on a timer.
	 */
	function sendEdit(write: () => void, picture: WarpMarker[] | null) {
		optimisticMarkers = picture;
		echoAfter = clipPropertiesStore.warpMarkersVersion;
		write();
		if (echoTimer) clearTimeout(echoTimer);
		echoTimer = setTimeout(() => {
			echoTimer = null;
			if (dragIndex === null) {
				optimisticMarkers = null;
				echoAfter = null;
			}
		}, WARP_ECHO_TIMEOUT_MS);
	}

	// ── Double-tap a grip: remove that marker ────────────────────────
	// The first tap is a drag that never moved; a second landing on the
	// same marker within DOUBLE_TAP_MS removes it instead of dragging.
	// Live's first and last drawn markers stay (Live's UI keeps them too).
	let lastGripTap: { beat: number; at: number } | null = null;

	function noteGripTap(index: number | null) {
		const marker = index === null ? undefined : dragShown[index];
		lastGripTap = marker ? { beat: marker.beat, at: performance.now() } : null;
	}

	function gripDoubleTapped(index: number): boolean {
		const marker = shown[index];
		const prev = lastGripTap;
		lastGripTap = null;
		const path = view.clipPath;
		if (!marker || !prev || performance.now() - prev.at > DOUBLE_TAP_MS) return false;
		if (Math.abs(prev.beat - marker.beat) > 1e-9 || path === null) return false;
		if (canRemove(shown, index)) {
			sendEdit(
				() => removeWarpMarker(path, marker.beat),
				withoutMarker(clipPropertiesStore.warpMarkers, marker.beat)
			);
		}
		return true;
	}

	// ── Double-tap the ruler: add a marker at the nearest transient ──
	let lastRulerTap: { x: number; at: number } | null = null;

	function handleRulerPointerDown(e: PointerEvent) {
		const { isAudio, clipPath, contentW, beatWindow } = view;
		if (!isAudio || shown.length < 2 || clipPath === null || contentW <= 0) return;
		const x = e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left;
		const now = performance.now();
		const prev = lastRulerTap;
		if (!prev || now - prev.at > DOUBLE_TAP_MS || Math.abs(prev.x - x) > DOUBLE_TAP_PX) {
			lastRulerTap = { x, at: now };
			return;
		}
		lastRulerTap = null;
		const target = addTarget(
			shown,
			transientSecs,
			xToBeat(x, beatWindow, contentW),
			TRANSIENT_SNAP_BEATS,
			WARP_MIN_GAP_BEATS
		);
		if (!target) return;
		sendEdit(
			() => addWarpMarker(clipPath, target.sec, target.beat),
			insertMarker(clipPropertiesStore.warpMarkers, target)
		);
	}

	// The echo landed: Live's own markers take over.
	$effect(() => {
		const version = clipPropertiesStore.warpMarkersVersion;
		if (echoAfter === null || version <= echoAfter) return;
		echoAfter = null;
		optimisticMarkers = null;
	});
	// A new clip drops any picture of the old one's markers.
	$effect(() => {
		void view.clipPath;
		optimisticMarkers = null;
		echoAfter = null;
	});
	onDestroy(() => {
		if (echoTimer) clearTimeout(echoTimer);
	});

	return {
		/** At least two markers are drawn: the ruler takes a double-tap. */
		get active() { return shown.length >= 2; },
		get place() { return place; },
		get transientTicks() { return transientTicks; },
		get handles() { return handles; },
		get dragIndex() { return dragIndex; },
		startDrag,
		handleRulerPointerDown
	};
}
