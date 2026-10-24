<script lang="ts">
	/**
	 * ClipEditorView — the clip-view-mirror central canvas (ADR-382).
	 *
	 * A full-size mirror of Live's Detail/Clip view for the focused clip:
	 *   - MIDI: piano-roll grid + axes, notes as DOM divs (velocity → alpha,
	 *     track-color hue), a velocity lane, the edit toolbar.
	 *   - Audio: waveform at central scale (canvas) and its warp markers.
	 *   - Both: a 30 Hz playhead and draggable loop braces.
	 *
	 * Scroll/zoom on both axes (pinch + drag). This file is the composition
	 * root: the zoom/scroll windows, the canvas pan/pinch surface, and note
	 * editing (draw, move, resize, erase, quantize), which share the canvas's
	 * pointers. The pieces live in `clipEditor/`: what the editor reads
	 * about the focused clip (`useFocusedClip`), the warp markers
	 * (`useWarpMarkers`), and the gutter, velocity lane, braces, waveform
	 * and toolbar as components. Activation is the manual toggle in
	 * ClipCentralView (decision 8); this view never auto-switches itself in.
	 */

	import { untrack } from 'svelte';
	import { session } from '$lib/stores/session.svelte';
	import { clipPropertiesStore } from '$lib/stores/v6/clipPropertiesStore.svelte';
	import {
		sendRemoveNotes,
		sendModifyNotes,
		sendAddNotes
	} from '$lib/services/clipRichNotesService';
	import { focusedNotesStore } from '$lib/stores/v6/focusedNotesStore.svelte';
	import {
		beatToX,
		pitchToY,
		laneHeight,
		xToBeat,
		yToPitch,
		zoomBeatWindow,
		zoomPitchWindow,
		panBeatWindow,
		clampBeatWindow,
		clampPitchWindow,
		clientDeltaToBeatDelta,
		clientDeltaToPitchDelta,
		foldLanes,
		shiftPitch,
		grabResizesNote,
		noteInCell,
		formatBeatPosition,
		formatNoteLength,
		defaultBeatWindow,
		defaultPitchWindow,
		type BeatWindow,
		type PitchWindow
	} from '$lib/utils/clip/clipEditorGeometry';
	import { contentLocal } from '$lib/utils/clip/clipPointerMath';
	import { snapToGrid, type LoopRange } from '$lib/utils/clip/clipGesture';
	import { MOMENTARY_HOLD_MS } from '$lib/components/v6/tracks/TrackStrip/utils/momentaryPress';
	import { logger } from '$lib/utils/logger';
	import { useFocusedClip } from './clipEditor/useFocusedClip.svelte';
	import { useWarpMarkers } from './clipEditor/useWarpMarkers.svelte';
	import { createGestures } from './clipEditor/gestures';
	import { noteColor as inkNote, pitchName } from './clipEditor/noteStyle';
	import PitchGutter, { type PitchLane } from './clipEditor/PitchGutter.svelte';
	import VelocityLane from './clipEditor/VelocityLane.svelte';
	import LoopBraces from './clipEditor/LoopBraces.svelte';
	import Waveform from './clipEditor/Waveform.svelte';
	import EditToolbar from './clipEditor/EditToolbar.svelte';

	interface Props {
		/** Track color for note/waveform tinting. */
		color?: string;
	}

	let { color }: Props = $props();

	const PITCH_AXIS_W = 36; // piano-key gutter width (px)
	const DRUM_PITCH_AXIS_W = 80; // wide enough for a pad's name
	const TIME_AXIS_H = 18; // bar/beat ruler height (px)
	const VELOCITY_LANE_H = 56; // velocity-lane strip height (px, MIDI only)
	const TOOLBAR_W = 96; // MIDI edit-toolbar column beside the roll (px), so the roll keeps the full height

	const clip = useFocusedClip();
	const beginGesture = createGestures();

	let clipPath = $derived(clip.clipPath);
	let isMidi = $derived(clip.isMidi);
	let isAudio = $derived(clip.isAudio);
	let notes = $derived(clip.notes);
	let padLabels = $derived(clip.padLabels);
	let padColors = $derived(clip.padColors);
	let pitchAxisW = $derived(padLabels.size > 0 ? DRUM_PITCH_AXIS_W : PITCH_AXIS_W);

	// ── Loop / markers (focused clip, always live via clipPropertiesStore)
	let loopStart = $derived(clipPropertiesStore.loopStart);
	let loopEnd = $derived(clipPropertiesStore.loopEnd);
	let looping = $derived(clipPropertiesStore.loopEnabled);

	// ── View windows (zoom/scroll state) ─────────────────────────────
	let beatWindow = $state<BeatWindow>({ startBeats: 0, endBeats: 4 });
	let pitchWindow = $state<PitchWindow>({ lowPitch: 48, highPitch: 72 });
	// A marker moved in Live narrows the range under the view: pull the
	// view back inside it. Keyed on the range alone.
	$effect(() => {
		const start = clip.viewStart;
		const end = clip.viewEnd;
		untrack(() => {
			const next = clampBeatWindow(beatWindow, end, start);
			if (next.startBeats !== beatWindow.startBeats || next.endBeats !== beatWindow.endBeats) {
				beatWindow = next;
			}
		});
	});
	// Re-seed default windows when the focused clip changes (path or type).
	let lastSeedKey = $state<string>('');
	$effect(() => {
		const key = `${clipPath ?? ''}:${clip.clipType ?? ''}`;
		if (key === lastSeedKey) return;
		lastSeedKey = key;
		if (!clip.hasClip) return;
		beatWindow = clampBeatWindow(
			defaultBeatWindow({
				looping,
				loopStartBeats: loopStart,
				loopEndBeats: loopEnd,
				lengthBeats: clip.totalBeats
			}),
			clip.viewEnd,
			clip.viewStart
		);
		if (isMidi) {
			pitchWindow = defaultPitchWindow(notes.map((n) => n.pitch));
		}
	});
	// Once notes land for a freshly-focused MIDI clip, fit the pitch
	// window to them (the seed above runs before notes resolve).
	//
	// Keyed on the clip alone, deliberately. `notes.length` used to be part
	// of this key, which made every note add or delete a new key and threw
	// the performer's zoom back to the auto-fit mid-edit. Fitting is a
	// per-clip arrival behaviour, not a per-edit one: once the window has
	// been fitted for a clip, the performer owns it until they focus
	// another.
	let notesFitKey = $state<string>('');
	$effect(() => {
		if (!isMidi || clip.notesLoadState !== 'loaded') return;
		const key = clipPath ?? '';
		if (key === notesFitKey) return;
		notesFitKey = key;
		pitchWindow = defaultPitchWindow(notes.map((n) => n.pitch));
	});

	// ── Fold (Live's Fold) ───────────────────────────────────────────
	// On by default (the user's call, 2026-09-25): the roll shows only the
	// pitches the clip plays, each lane an equal share of the height, so a
	// sparse part gets fat, easy-to-hit notes. Vertical pan/pinch have
	// nothing to do while folded and are skipped; the performer's unfolded
	// window (`pitchWindow`) is kept untouched underneath for when Fold is
	// switched off. An empty clip has nothing to fold to and shows the
	// unfolded window, so there is somewhere to draw the first note.
	//
	// The lane set is held still for the length of a note drag: moving the
	// only note on a pitch would otherwise delete the lane under the finger
	// and re-divide the height mid-gesture.
	let fold = $state(true);
	let liveFoldLanes = $derived(foldLanes(notes.map((n) => n.pitch)));
	let heldFoldLanes = $state<number[] | null>(null);

	// ── Solo rows (a note name, ADR-471) ─────────────────────────────
	// The roll shows only the soloed pitches, as lanes the way Fold shows
	// its own, so the notes on them are fat and the rest are out of reach:
	// hidden, untouched by a draw, a drag, the velocity lane or Quantize.
	// It outranks Fold, and holds while the soloed rows empty (a row whose
	// last note was moved or deleted stays, to draw on). The gutter decides
	// latch or momentary, Mute's rule; a new clip starts with none.
	let soloPitches = $state<number[]>([]);
	$effect(() => {
		void clipPath;
		soloPitches = [];
	});
	function solo(pitches: number[]) {
		soloPitches = [...new Set(pitches)].sort((a, b) => a - b);
	}
	let soloSet = $derived(new Set(soloPitches));
	let shownNotes = $derived(soloPitches.length > 0 ? notes.filter((n) => soloSet.has(n.pitch)) : notes);

	let viewPitchWindow = $derived.by((): PitchWindow => {
		if (isMidi && soloPitches.length > 0) return { ...pitchWindow, lanes: soloPitches };
		const lanes = heldFoldLanes ?? liveFoldLanes;
		return fold && isMidi && lanes.length > 0 ? { ...pitchWindow, lanes } : pitchWindow;
	});
	let folded = $derived(!!viewPitchWindow.lanes);

	// ── Canvas sizing ────────────────────────────────────────────────
	// MIDI clips reserve a velocity-lane strip at the bottom; audio doesn't.
	let bottomReserve = $derived(isMidi ? VELOCITY_LANE_H : 0);
	let containerRef = $state<HTMLElement | null>(null);
	let contentW = $state(0);
	let contentH = $state(0);
	$effect(() => {
		const el = containerRef;
		if (!el) return;
		// Reference bottomReserve so the roll height recomputes when the
		// lane appears/disappears (MIDI↔audio focus change).
		const reserve = bottomReserve;
		const axisW = pitchAxisW;
		const ro = new ResizeObserver(() => {
			contentW = Math.max(0, el.clientWidth - axisW);
			contentH = Math.max(0, el.clientHeight - TIME_AXIS_H - reserve);
		});
		ro.observe(el);
		contentW = Math.max(0, el.clientWidth - axisW);
		contentH = Math.max(0, el.clientHeight - TIME_AXIS_H - reserve);
		return () => ro.disconnect();
	});

	// ── Snap grid (M5 polish) ────────────────────────────────────────
	// A UI-chosen division of a beat (a quarter note = 1 beat), picked on
	// the toolbar. `gridDenom` is the note value (4=1/4, 8=1/8, …);
	// `gridTriplet` shrinks the cell to 2/3 for triplet feel. One grid
	// cell in beats: (4 / gridDenom) * (gridTriplet ? 2/3 : 1). It drives
	// snap, the drawn note's length, quantize and the gridlines.
	let gridDenom = $state<number>(16);
	let gridTriplet = $state<boolean>(false);
	let gridBeats = $derived((4 / gridDenom) * (gridTriplet ? 2 / 3 : 1));

	// ── Grid lines (bar / beat) ──────────────────────────────────────
	let beatsPerBar = $derived(Math.max(1, session.timeSignature?.numerator ?? 4));
	let gridLines = $derived.by(() => {
		const out: { x: number; bar: boolean; barNum: number | null }[] = [];
		if (contentW <= 0) return out;
		const start = beatWindow.startBeats;
		const end = beatWindow.endBeats;
		const span = end - start;
		// Base the visible grid on the chosen snap grid so lines and snap
		// agree; double the step when lines would crowd (< 8 px apart).
		let step = isMidi ? gridBeats : 1;
		if (step <= 0) step = 1;
		while ((step / span) * contentW < 8) step *= 2;
		const first = Math.ceil(start / step) * step;
		for (let b = first; b <= end + 1e-6; b += step) {
			const isBar = Math.abs(b % beatsPerBar) < 1e-6;
			out.push({
				x: beatToX(b, beatWindow, contentW),
				bar: isBar,
				barNum: isBar ? Math.round(b / beatsPerBar) + 1 : null
			});
		}
		return out;
	});

	// Piano-roll horizontal lanes (the gutter's keys and the lane shading).
	let pitchLanes = $derived.by(() => {
		const out: PitchLane[] = [];
		if (contentH <= 0 || !isMidi) return out;
		const win = viewPitchWindow;
		const h = laneHeight(win, contentH);
		const blackKeys = new Set([1, 3, 6, 8, 10]);
		const shown = win.lanes ?? [];
		if (!win.lanes) for (let p = win.lowPitch; p <= win.highPitch; p++) shown.push(p);
		for (const p of shown) {
			out.push({
				y: pitchToY(p, win, contentH),
				h,
				pitch: p,
				black: blackKeys.has(((p % 12) + 12) % 12)
			});
		}
		return out;
	});

	// ── Visible notes (windowed, with screen coords) ─────────────────
	let visibleNotes = $derived.by(() => {
		const out: {
			key: string;
			noteId: number;
			pitch: number;
			x: number;
			w: number;
			y: number;
			h: number;
			velocity: number;
		}[] = [];
		if (contentW <= 0 || contentH <= 0) return out;
		const win = viewPitchWindow;
		const h = laneHeight(win, contentH);
		for (let i = 0; i < shownNotes.length; i++) {
			const n = shownNotes[i];
			const noteEnd = n.startBeats + n.durationBeats;
			if (noteEnd <= beatWindow.startBeats || n.startBeats >= beatWindow.endBeats) continue;
			if (!win.lanes && (n.pitch < win.lowPitch || n.pitch > win.highPitch)) continue;
			const x = beatToX(n.startBeats, beatWindow, contentW);
			const xEnd = beatToX(noteEnd, beatWindow, contentW);
			out.push({
				// Key by stable noteId so Svelte preserves the DOM node
				// across an optimistic edit (no fl/re-mount mid-drag).
				key: String(n.noteId),
				noteId: n.noteId,
				pitch: n.pitch,
				x,
				w: Math.max(2, xEnd - x),
				y: pitchToY(n.pitch, win, contentH),
				h,
				velocity: n.velocity
			});
		}
		return out;
	});

	// A Drum Rack row wears its pad's chain colour; any other note the
	// track's.
	function noteColor(velocity: number, pitch?: number): string {
		const pad = pitch !== undefined ? padColors.get(pitch) : undefined;
		return pad ? inkNote(pad, velocity, true) : inkNote(color, velocity);
	}

	// ── Loop braces, warp markers, playhead ──────────────────────────
	// The braces' drag draws this overlay until Live echoes the loop; the
	// waveform inks the loop from it as it moves.
	let optimisticLoop = $state<LoopRange | null>(null);
	let displayLoopStart = $derived(optimisticLoop?.start ?? loopStart);
	let displayLoopEnd = $derived(optimisticLoop?.end ?? loopEnd);

	const warp = useWarpMarkers({
		get clipPath() { return clipPath; },
		get isAudio() { return isAudio; },
		get wavFilePath() { return clip.wavFilePath; },
		get beatWindow() { return beatWindow; },
		get contentW() { return contentW; }
	});

	let markerStartX = $derived(beatToX(clipPropertiesStore.startMarker, beatWindow, contentW));
	let markerEndX = $derived(beatToX(clipPropertiesStore.endMarker, beatWindow, contentW));

	let playheadX = $derived(
		clip.livePosition >= 0 ? beatToX(clip.livePosition, beatWindow, contentW) : -1
	);
	let playheadVisible = $derived(playheadX >= 0 && playheadX <= contentW);

	// ── Canvas gesture: drag-pan + wheel/pinch-zoom (NO brace logic) ──
	// Brace dragging lives on dedicated handle elements (LoopBraces), in
	// ClipLoopControlV6's proven style — kept off the shared canvas
	// pointer surface so pan/zoom and brace drag never tangle.
	type DragKind = 'pan' | 'pinch';
	let dragKind = $state<DragKind | null>(null);
	let dragStartX = 0;
	let dragStartY = 0;
	let dragStartBeatWindow: BeatWindow = { startBeats: 0, endBeats: 4 };
	let dragStartPitchWindow: PitchWindow = { lowPitch: 48, highPitch: 72 };
	let pinchStartDist = 0;
	let pinchCenterX = 0;
	let pinchCenterY = 0;

	function localCoords(e: { clientX: number; clientY: number }): { x: number; y: number } {
		const rect = containerRef?.getBoundingClientRect();
		if (!rect) return { x: 0, y: 0 };
		return contentLocal(e.clientX, e.clientY, rect, pitchAxisW, TIME_AXIS_H);
	}

	const activePointers = new Map<number, { x: number; y: number }>();

	function handlePointerDown(e: PointerEvent) {
		try {
			(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
		} catch {
			// Synthetic / already-released pointers can throw; non-fatal.
		}
		const { x, y } = localCoords(e);
		activePointers.set(e.pointerId, { x, y });
		if (activePointers.size === 1) {
			dragKind = 'pan';
			dragStartX = x;
			dragStartY = y;
			dragStartBeatWindow = { ...beatWindow };
			dragStartPitchWindow = { ...pitchWindow };
		} else if (activePointers.size === 2) {
			beginPinch();
		}
	}

	function beginPinch() {
		dragKind = 'pinch';
		const pts = Array.from(activePointers.values());
		pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
		pinchCenterX = (pts[0].x + pts[1].x) / 2;
		pinchCenterY = (pts[0].y + pts[1].y) / 2;
		dragStartBeatWindow = { ...beatWindow };
		dragStartPitchWindow = { ...pitchWindow };
	}

	/**
	 * A finger that started a pan took on a gesture of its own (a held
	 * note name): take it off the pan and undo the few px it panned inside
	 * the slop.
	 */
	function releasePan(pointerId: number) {
		if (activePointers.delete(pointerId) && activePointers.size === 0) {
			dragKind = null;
			beatWindow = { ...dragStartBeatWindow };
			pitchWindow = { ...dragStartPitchWindow };
		}
	}

	// ── A second finger on the grid is a pinch ───────────────────────
	// The grid and the notes take a finger for themselves (draw, move),
	// so a pinch landing there used to draw two notes. The first finger's
	// edit is recorded here; a second finger landing anywhere on the grid
	// while it — or a pan — is down cancels that edit (nothing has reached
	// Live: a draw and a move write on release) and both fingers zoom.
	let editGesture: {
		id: number;
		x: number;
		y: number;
		teardown: () => void;
		revert: () => void;
	} | null = null;

	function joinsPinch(event: PointerEvent): boolean {
		if (editGesture === null && activePointers.size === 0) return false;
		event.stopPropagation();
		if (event.cancelable) event.preventDefault();
		const first = editGesture;
		if (first !== null) {
			editGesture = null;
			first.teardown();
			first.revert();
			activePointers.set(first.id, localCoords({ clientX: first.x, clientY: first.y }));
		}
		activePointers.set(event.pointerId, localCoords(event));
		if (activePointers.size >= 2) beginPinch();
		return true;
	}

	/** Track the editing finger's position; false for any other finger. */
	function isEditPointer(event: PointerEvent): boolean {
		const g = editGesture;
		if (g === null) return true;
		if (event.pointerId !== g.id) return false;
		g.x = event.clientX;
		g.y = event.clientY;
		return true;
	}

	function handlePointerMove(e: PointerEvent) {
		if (!activePointers.has(e.pointerId)) return;
		const { x, y } = localCoords(e);
		activePointers.set(e.pointerId, { x, y });
		if (contentW <= 0 || contentH <= 0) return;

		if (dragKind === 'pan' && activePointers.size === 1) {
			// Inverse-drag: window moves opposite the finger, so negate.
			const deltaBeats = -clientDeltaToBeatDelta(x - dragStartX, contentW, dragStartBeatWindow);
			beatWindow = panBeatWindow(dragStartBeatWindow, deltaBeats, clip.viewEnd, clip.viewStart);
			if (isMidi && !folded) {
				const deltaPitch = clientDeltaToPitchDelta(y - dragStartY, contentH, dragStartPitchWindow);
				pitchWindow = clampPitchWindow({
					lowPitch: dragStartPitchWindow.lowPitch + deltaPitch,
					highPitch: dragStartPitchWindow.highPitch + deltaPitch
				});
			}
		} else if (dragKind === 'pinch' && activePointers.size >= 2) {
			const pts = Array.from(activePointers.values());
			const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
			const factor = pinchStartDist / dist; // fingers apart → factor<1 → zoom in
			const anchorFrac = Math.min(1, Math.max(0, pinchCenterX / contentW));
			beatWindow = zoomBeatWindow(dragStartBeatWindow, factor, anchorFrac, clip.viewEnd, clip.viewStart);
			if (isMidi && !folded) {
				const anchorPitchFrac = Math.min(1, Math.max(0, pinchCenterY / contentH));
				pitchWindow = zoomPitchWindow(dragStartPitchWindow, factor, anchorPitchFrac);
			}
		}
	}

	function endPointer(e: PointerEvent) {
		activePointers.delete(e.pointerId);
		if (activePointers.size === 0) dragKind = null;
		else if (activePointers.size === 1) {
			dragKind = 'pan';
			const only = Array.from(activePointers.values())[0];
			dragStartX = only.x;
			dragStartY = only.y;
			dragStartBeatWindow = { ...beatWindow };
			dragStartPitchWindow = { ...pitchWindow };
		}
	}

	function handleWheel(e: WheelEvent) {
		if (contentW <= 0) return;
		e.preventDefault();
		const rect = containerRef?.getBoundingClientRect();
		const localX = rect
			? contentLocal(e.clientX, e.clientY, rect, pitchAxisW, TIME_AXIS_H).x
			: contentW / 2;
		const anchorFrac = Math.min(1, Math.max(0, localX / contentW));
		const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
		beatWindow = zoomBeatWindow(beatWindow, factor, anchorFrac, clip.viewEnd, clip.viewStart);
	}

	// ── MIDI note editing (M4) ───────────────────────────────────────
	// One mode, no selection (the user's call, 2026-10-07: a selection
	// needs Shift/⌘ the iPad doesn't have, and the Select/Draw toggle was
	// a mode to keep track of mid-set). A tap on empty grid draws a note
	// (drag right to set its length); a drag on a note moves it (pitch +
	// time) or, from its right edge, resizes it; a tap on a note erases it
	// (the user's call, 2026-10-24, ADR-471: it was a double-tap). A note
	// grabbed and let go without moving after a hold is left alone, so a
	// change of mind mid-grab deletes nothing. Quantize acts on the notes
	// shown.
	// Optimistic-apply to focusedNotesStore, emit the write, reconcile on
	// the surface's notes/changed re-pull (own-write echo suppressed —
	// see useFocusedClip + clipRichNotesService.markLocalWrite).

	// Drag state for a note move/resize gesture: the grabbed note and its
	// pre-drag geometry.
	type NoteDragKind = 'move' | 'resize';
	const NOTE_TAP_SLOP_PX = 8;
	let noteDrag = $state<{
		kind: NoteDragKind;
		noteId: number;
		startClientX: number;
		startClientY: number;
		startBeats: number;
		startPitch: number;
		startDuration: number;
		at: number;
		moved: boolean;
	} | null>(null);

	function startNoteDrag(event: PointerEvent, noteId: number) {
		if (!isMidi || clipPath === null) return;
		if (joinsPinch(event)) return;
		event.stopPropagation();
		if (event.cancelable) event.preventDefault();
		const note = focusedNotesStore.get(noteId);
		if (!note) return;

		// Decide move vs resize from where in the note it was grabbed.
		const noteX = beatToX(note.startBeats, beatWindow, contentW);
		const noteEndX = beatToX(note.startBeats + note.durationBeats, beatWindow, contentW);
		const localX = localCoords(event).x;
		const kind: NoteDragKind = grabResizesNote(localX, noteX, noteEndX) ? 'resize' : 'move';

		heldFoldLanes = liveFoldLanes;
		noteDrag = {
			kind,
			noteId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			startBeats: note.startBeats,
			startPitch: note.pitch,
			startDuration: note.durationBeats,
			at: performance.now(),
			moved: false
		};

		const teardown = beginGesture(onNoteDragMove, onNoteDragEnd);
		const start = { startBeats: note.startBeats, pitch: note.pitch, durationBeats: note.durationBeats };
		editGesture = {
			id: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			teardown,
			revert: () => {
				focusedNotesStore.optimisticModify(noteId, start);
				noteDrag = null;
				heldFoldLanes = null;
			}
		};
	}

	function onNoteDragMove(event: PointerEvent) {
		if (noteDrag === null || contentW <= 0 || contentH <= 0) return;
		if (!isEditPointer(event)) return;
		if (event.cancelable) event.preventDefault();
		const deltaBeats = clientDeltaToBeatDelta(event.clientX - noteDrag.startClientX, contentW, beatWindow);
		const grid = gridBeats;
		const dx = event.clientX - noteDrag.startClientX;
		const dy = event.clientY - noteDrag.startClientY;
		// A fingertip rolls a few px on a tap, and a tap erases: it is a
		// drag only past the slop.
		if (!noteDrag.moved && Math.hypot(dx, dy) > NOTE_TAP_SLOP_PX) {
			noteDrag.moved = true;
			// A drag off the resize handle that sets off up or down is a
			// pitch move: a resize would ignore the pitch and snap the length.
			if (noteDrag.kind === 'resize' && Math.abs(dy) > Math.abs(dx)) noteDrag.kind = 'move';
		}
		// Inside the slop the note stays put: a tap or a hold that lets go
		// must leave nothing moved that Live was never told about.
		if (!noteDrag.moved) return;

		if (noteDrag.kind === 'resize') {
			const snappedDur = Math.max(grid, snapToGrid(noteDrag.startDuration + deltaBeats, grid));
			focusedNotesStore.optimisticModify(noteDrag.noteId, { durationBeats: snappedDur });
		} else {
			// Negate: dragging down (larger clientY) lowers pitch.
			// Folded, the delta counts shown lanes and `shiftPitch` steps
			// to a neighbouring shown pitch.
			const deltaPitch = -clientDeltaToPitchDelta(event.clientY - noteDrag.startClientY, contentH, viewPitchWindow);
			focusedNotesStore.optimisticModify(noteDrag.noteId, {
				// The MOVE snaps to whole grid steps, not the landing spot, so
				// an off-grid note keeps its offset from the grid and a drag
				// that is only up or down leaves its timing alone.
				startBeats: Math.max(0, noteDrag.startBeats + snapToGrid(deltaBeats, grid)),
				pitch: shiftPitch(noteDrag.startPitch, deltaPitch, viewPitchWindow)
			});
		}
	}

	function onNoteDragEnd() {
		editGesture = null;
		const drag = noteDrag;
		noteDrag = null;
		heldFoldLanes = null;
		if (drag === null || clipPath === null) return;
		if (!drag.moved) {
			if (performance.now() - drag.at < MOMENTARY_HOLD_MS) deleteNote(drag.noteId);
			return;
		}
		const n = focusedNotesStore.get(drag.noteId);
		if (!n || n.noteId < 0) return;
		sendModifyNotes(clipPath, [
			{
				noteId: n.noteId,
				pitch: n.pitch,
				startBeats: n.startBeats,
				durationBeats: n.durationBeats,
				velocity: n.velocity,
				mute: n.mute
			}
		]);
	}

	function deleteNote(noteId: number) {
		if (clipPath === null) return;
		focusedNotesStore.optimisticRemove([noteId]);
		// A note still drawing has no id in Live yet; its add lands and
		// the next re-pull reconciles it.
		if (noteId >= 0) sendRemoveNotes(clipPath, [noteId]);
	}

	// Draw-on-empty-grid. Pointerdown mints a temp note at the
	// grid cell; DRAGGING right extends its duration (snapped, ≥ one cell);
	// pointerup commits the add with the final length. A plain tap (no
	// drag) commits a one-cell note. The wire send is deferred to
	// pointerup so a drag produces a single add at the chosen length.
	let drawNote = $state<{ tempId: number; startBeats: number; pitch: number } | null>(null);

	function handleGridTap(event: PointerEvent) {
		if (!isMidi || clipPath === null || contentW <= 0) return;
		if (joinsPinch(event)) return;
		if (!containerRef) return;
		const { x: localX, y: localY } = localCoords(event);
		if (localX < 0 || localY < 0 || localX > contentW || localY > contentH) return;
		const grid = gridBeats;
		const tapBeats = xToBeat(localX, beatWindow, contentW);
		const pitch = Math.max(0, Math.min(127, Math.round(yToPitch(localY, viewPitchWindow, contentH))));
		// A note thinner than its grid cell is hit across the whole cell, so
		// a short note takes a fingertip without the cells beside it, where
		// the next note goes, losing anything.
		const hit = noteInCell(shownNotes, pitch, tapBeats, grid);
		if (hit !== null) {
			startNoteDrag(event, hit);
			return;
		}
		const startBeats = Math.max(0, snapToGrid(tapBeats, grid));
		const tempId = focusedNotesStore.nextTempId();
		focusedNotesStore.optimisticAdd({
			noteId: tempId,
			pitch,
			startBeats,
			// A drawn note's default length: one grid cell.
			durationBeats: gridBeats,
			velocity: 100,
			mute: false
		});
		drawNote = { tempId, startBeats, pitch };

		const teardown = beginGesture(onDrawDragMove, commitDrawNote);
		editGesture = {
			id: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			teardown,
			revert: () => {
				focusedNotesStore.optimisticRemove([tempId]);
				drawNote = null;
			}
		};
	}

	function onDrawDragMove(event: PointerEvent) {
		if (drawNote === null || contentW <= 0) return;
		if (!isEditPointer(event)) return;
		if (event.cancelable) event.preventDefault();
		if (!containerRef) return;
		const localX = localCoords(event).x;
		const grid = gridBeats;
		const endBeats = snapToGrid(xToBeat(localX, beatWindow, contentW), grid);
		const dur = Math.max(grid, endBeats - drawNote.startBeats);
		focusedNotesStore.optimisticModify(drawNote.tempId, { durationBeats: dur });
	}

	function commitDrawNote() {
		editGesture = null;
		const dn = drawNote;
		drawNote = null;
		if (dn === null || clipPath === null) return;
		const n = focusedNotesStore.get(dn.tempId);
		if (!n) return;
		const tempId = dn.tempId;
		const path = clipPath;
		sendAddNotes(path, [
			{
				noteId: tempId,
				pitch: n.pitch,
				startBeats: n.startBeats,
				durationBeats: n.durationBeats,
				velocity: n.velocity,
				mute: n.mute
			}
		])
			.then((newIds) => {
				if (newIds.length > 0) focusedNotesStore.swapTempId(tempId, newIds[0]);
			})
			.catch((err: Error) => {
				logger.debug('ClipEditorView: add note failed', {
					clipPath: path,
					error: err.message
				});
				focusedNotesStore.optimisticRemove([tempId]);
			});
	}

	// --- quantize (M5) ───────────────────────────────────────────────
	// Live's Clip has no `quantize` LOM method (SelectionProbe dump), so
	// quantize is client-side: snap every shown note's start to the grid
	// (the whole clip, or the soloed rows) and batch-modify. No new wire.
	function quantizeClip() {
		if (clipPath === null) return;
		const grid = gridBeats;
		const specs = [];
		for (const n of shownNotes) {
			if (n.noteId < 0) continue;
			const snapped = Math.max(0, snapToGrid(n.startBeats, grid));
			if (Math.abs(snapped - n.startBeats) < 1e-6) continue; // already on grid
			focusedNotesStore.optimisticModify(n.noteId, { startBeats: snapped }); // optimistic
			specs.push({
				noteId: n.noteId,
				pitch: n.pitch,
				startBeats: snapped,
				durationBeats: n.durationBeats,
				velocity: n.velocity,
				mute: n.mute
			});
		}
		if (specs.length > 0) sendModifyNotes(clipPath, specs);
	}

	// ── Drag readout ─────────────────────────────────────────────────
	// The finger covers the note it moves, so while a note is dragged or
	// drawn its pitch, position and length show above it; while a note
	// name scales its pitch's velocities, the scale shows above its lane.
	const READOUT_LIFT_PX = 40;
	let velScale = $state<{ pitch: number; factor: number } | null>(null);
	let dragReadout = $derived.by(() => {
		if (velScale !== null) {
			const lane = pitchLanes.find((l) => l.pitch === velScale!.pitch);
			const pct = Math.round(velScale.factor * 100);
			return {
				text: `${padLabels.get(velScale.pitch) ?? pitchName(velScale.pitch)} · velocity ${pct}%`,
				x: 0,
				y: Math.max(2, (lane?.y ?? 0) - READOUT_LIFT_PX)
			};
		}
		const id = noteDrag?.moved ? noteDrag.noteId : (drawNote?.tempId ?? null);
		if (id === null) return null;
		const box = visibleNotes.find((v) => v.noteId === id);
		const n = focusedNotesStore.get(id);
		if (!box || !n) return null;
		return {
			text: `${pitchName(n.pitch)} · ${formatBeatPosition(n.startBeats, beatsPerBar)} · ${formatNoteLength(n.durationBeats)}`,
			x: Math.max(0, Math.min(contentW, box.x)),
			y: Math.max(2, box.y - READOUT_LIFT_PX)
		};
	});
</script>

<div class="clip-editor h-full w-full">
	{#if !clip.hasClip}
		<div class="state-msg">No clip focused</div>
	{:else}
		<!-- role="application" is the ARIA role for a surface that handles its own
		     pointer and keys, which this is; Svelte's lint counts it as
		     non-interactive, so both of its complaints are about the role, not
		     the element. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
		<div
			class="canvas-wrap"
			style:right={isMidi ? `${TOOLBAR_W}px` : undefined}
			bind:this={containerRef}
			role="application"
			aria-label="Clip editor"
			tabindex="0"
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={endPointer}
			onpointercancel={endPointer}
			onpointerleave={endPointer}
			onwheel={handleWheel}
		>
			<!-- Time ruler (top) -->
			<!-- Double-tap to add a warp marker (audio, warped). -->
			<div
				class="time-ruler"
				class:warp-ruler={isAudio && warp.active}
				style="left: {pitchAxisW}px; height: {TIME_AXIS_H}px;"
				onpointerdown={warp.handleRulerPointerDown}
			>
				{#each warp.transientTicks as x, i (i)}
					<div class="transient-tick" style="left: {x}px;"></div>
				{/each}
				{#each gridLines as line (line.x)}
					<div
						class="ruler-tick"
						class:bar={line.bar}
						style="left: {line.x}px;"
					></div>
					{#if line.barNum != null}
						<span class="ruler-num num" style="left: {line.x}px;">{line.barNum}</span>
					{/if}
				{/each}
			</div>

			<!-- Pitch gutter (left, MIDI only) -->
			{#if isMidi}
				<PitchGutter
					lanes={pitchLanes}
					{notes}
					{padLabels}
					{padColors}
					{folded}
					soloed={soloPitches}
					{clipPath}
					top={TIME_AXIS_H}
					width={pitchAxisW}
					onHoldStart={releasePan}
					onSolo={solo}
					bind:scaling={velScale}
				/>
			{/if}

			<!-- Content area -->
			<div
				class="content"
				style="left: {pitchAxisW}px; top: {TIME_AXIS_H}px; width: {contentW}px; height: {contentH}px;"
			>
				<!-- Vertical gridlines -->
				{#each gridLines as line (line.x)}
					<div class="gridline" class:bar={line.bar} style="left: {line.x}px;"></div>
				{/each}

				{#if isMidi}
					<!-- Horizontal lane shading (black keys) -->
					{#each pitchLanes as lane (lane.pitch)}
						{#if lane.black}
							<div class="lane-shade" style="top: {lane.y}px; height: {lane.h}px;"></div>
						{/if}
					{/each}

					<!-- Draw tap catcher (M4): sits above the grid, below the
					     notes, so a tap on an empty lane mints a note while taps
					     on a note still hit the note's own handler. -->
					<div
						class="draw-catcher"
						role="button"
						tabindex="-1"
						aria-label="Draw note"
						onpointerdown={(e) => {
							e.stopPropagation();
							handleGridTap(e);
						}}
					></div>

					<!-- Notes -->
					{#if clip.notesLoadState === 'loading' && notes.length === 0}
						<div class="state-msg overlay">Loading notes…</div>
					{:else}
						{#each visibleNotes as note (note.key)}
							<div
								class="note"
								style="left: {note.x}px; width: {note.w}px; top: {note.y}px; height: {note.h}px; background: {noteColor(note.velocity, note.pitch)};"
								role="button"
								tabindex="-1"
								aria-label="MIDI note"
								onpointerdown={(e) => startNoteDrag(e, note.noteId)}
							></div>
						{/each}
					{/if}
				{:else if isAudio}
					<Waveform
						peakData={clip.peakData}
						width={contentW}
						height={contentH}
						{beatWindow}
						totalBeats={clip.totalBeats}
						fileStartBeats={clip.fileStartBeats}
						fileEndBeats={clip.fileEndBeats}
						{color}
						place={warp.place}
						loopStartX={beatToX(displayLoopStart, beatWindow, contentW)}
						loopEndX={beatToX(displayLoopEnd, beatWindow, contentW)}
						looped={displayLoopEnd > displayLoopStart}
					/>
				{/if}

				<!-- Start/End markers (audio: clip extent) -->
				{#if isAudio}
					<div class="marker marker-start" style="left: {markerStartX}px;"></div>
					<div class="marker marker-end" style="left: {markerEndX}px;"></div>
					<!-- Warp markers: a line through the waveform and a grip at
					     its head and its foot, the grips alone taking the finger
					     so the rest of the canvas still pans. -->
					{#each warp.handles as handle (handle.index)}
						<div
							class="warp-marker"
							class:dragging={warp.dragIndex === handle.index}
							style="left: {handle.x}px;"
						>
							<div class="warp-line"></div>
							{#each ['top', 'bottom'] as end (end)}
								<div
									class="warp-grip {end}"
									role="slider"
									tabindex="-1"
									aria-label="Warp marker"
									aria-valuenow={handle.beat}
									onpointerdown={(e) => warp.startDrag(e, handle.index)}
								></div>
							{/each}
						</div>
					{/each}
				{/if}

				<LoopBraces
					{clipPath}
					{looping}
					{loopStart}
					{loopEnd}
					totalBeats={clip.totalBeats}
					{beatsPerBar}
					{beatWindow}
					{contentW}
					bind:optimisticLoop
				/>

				{#if dragReadout}
					<div class="drag-readout num" style="left: {dragReadout.x}px; top: {dragReadout.y}px;">{dragReadout.text}</div>
				{/if}

				<!-- Playhead -->
				{#if playheadVisible}
					<div class="playhead" style="left: {playheadX}px;"></div>
				{/if}
			</div>

			<!-- Velocity lane (M5): sits in the reserved bottom strip. -->
			{#if isMidi}
				<VelocityLane
					notes={shownNotes}
					{beatWindow}
					{clipPath}
					left={pitchAxisW}
					width={contentW}
					height={VELOCITY_LANE_H}
					{noteColor}
				/>
			{/if}
		</div>

		{#if isMidi}
			<EditToolbar
				width={TOOLBAR_W}
				bind:fold
				bind:gridDenom
				bind:gridTriplet
				canQuantize={shownNotes.length > 0}
				onQuantize={quantizeClip}
			/>
		{/if}
	{/if}
</div>

<style>
	/* Editor canvas region is a WELL (§5.4) — the brightest zone is the deepest. */
	.clip-editor {
		position: relative;
		overflow: hidden;
		background: var(--surface-well);
	}

	.canvas-wrap {
		position: absolute;
		inset: 0;
		touch-action: none; /* we own pinch/drag; stop page zoom on iPad Safari */
		overflow: hidden;
		user-select: none;
		-webkit-user-select: none;
	}

	.time-ruler {
		position: absolute;
		top: 0;
		right: 0;
		border-bottom: 1px solid var(--line);
	}

	/* Double-tap target for a new warp marker: no double-tap zoom. */
	.time-ruler.warp-ruler {
		touch-action: manipulation;
		cursor: copy;
	}
	/* A transient a new marker would snap to: a short tick from the
	   ruler's foot, in the warp markers' ink, fainter than the grid. */
	.transient-tick {
		position: absolute;
		bottom: 0;
		height: 55%;
		width: 1px;
		background: color-mix(in oklab, var(--act-warn) 45%, transparent);
		pointer-events: none;
	}

	/* Tick weights = the line ladder (§5.4): bars strong, beats standard. */
	.ruler-tick {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--line);
	}
	.ruler-tick.bar {
		background: var(--line-strong);
	}
	/* Mono bar numbers (§5.4). */
	.ruler-num {
		position: absolute;
		top: 1px;
		transform: translateX(2px);
		font-size: 9px;
		line-height: 1;
		color: var(--fg-tertiary);
		pointer-events: none;
	}

	.content {
		position: absolute;
		overflow: hidden;
	}

	.gridline {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--line-faint);
		pointer-events: none;
	}
	.gridline.bar {
		background: var(--line);
	}

	.lane-shade {
		position: absolute;
		left: 0;
		right: 0;
		background: color-mix(in srgb, var(--foreground) 5%, transparent);
		pointer-events: none;
	}

	/* Editor stacking order (content layer), low → high:
	   loop-region (1) < draw-catcher (2) < brace-handle (3) < note (4)
	   < brace-grip (6) < playhead, warp-marker (7) < drag-readout (8).
	   Notes MUST sit above the loop-region: the region spans the whole
	   loop window, so without this a note tap inside the loop hits
	   "Move loop" instead of selecting the note (caught in live test). */
	.note {
		position: absolute;
		border-radius: 2px;
		min-height: 2px;
		/* Interactive in M4 — own pointer handler for move/resize/erase.
		   touch-action:none so a note drag doesn't scroll the page. */
		pointer-events: auto;
		touch-action: none;
		cursor: pointer;
		z-index: 4;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--background), transparent 40%);
	}
	/* Draw tap catcher: transparent, fills the content area, above
	   the loop-region so a draw-tap anywhere in the loop window mints a
	   note. Notes sit above it (z 4 > 2) so tapping an existing note in
	   draw mode hits the note, not the catcher. */
	.draw-catcher {
		position: absolute;
		inset: 0;
		z-index: 2;
		cursor: crosshair;
		touch-action: none;
	}

	.drag-readout {
		position: absolute;
		z-index: 8;
		padding: 2px 6px;
		border-radius: 2px;
		font-size: 13px;
		line-height: 1.4;
		white-space: nowrap;
		color: var(--foreground);
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		pointer-events: none;
	}

	/* Warp markers: the line takes no pointer; a grip at each end is a
	   28×36 touch target, above the braces (z 6; the grips alone, so a
	   brace sharing its x is still grabbable between them) — a clip's
	   start and end markers usually sit exactly on the loop edges. */
	.warp-marker {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 0;
		pointer-events: none;
		z-index: 7;
	}
	.warp-line {
		position: absolute;
		top: 0;
		bottom: 0;
		left: -0.5px;
		width: 1px;
		background: color-mix(in oklab, var(--act-warn) 55%, transparent);
	}
	.warp-grip {
		position: absolute;
		left: -22px;
		width: 44px;
		height: 44px;
		pointer-events: auto;
		touch-action: none;
		cursor: ew-resize;
	}
	.warp-grip.top {
		top: 0;
	}
	.warp-grip.bottom {
		bottom: 0;
	}
	.warp-grip::after {
		content: '';
		position: absolute;
		left: 17px;
		width: 10px;
		height: 14px;
		border-radius: 2px;
		background: var(--act-warn);
	}
	.warp-grip.top::after {
		top: 4px;
	}
	.warp-grip.bottom::after {
		bottom: 4px;
	}
	.warp-marker.dragging .warp-line {
		background: var(--act-warn);
	}
	.warp-marker.dragging .warp-grip::after {
		background: var(--phosphor-100);
	}

	.marker {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: color-mix(in oklab, var(--act-warn) 70%, transparent);
		pointer-events: none;
	}

	/* Playhead (§4.2): phosphor-white — the brightest value in the system — with
	   a static 6px triangular cap at the ruler line. The single `left` write is
	   UNTRANSITIONED (33ms steps are the design); the cap moves with it. */
	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--playhead);
		pointer-events: none;
		transform: translateX(-0.5px);
		z-index: 7;
	}
	.playhead::before {
		content: '';
		position: absolute;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		border-left: 4px solid transparent;
		border-right: 4px solid transparent;
		border-top: 6px solid var(--playhead);
	}

	.state-msg {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--muted-foreground);
		font-size: 0.875rem;
	}
	.state-msg.overlay {
		background: transparent;
	}

	/* ---- Live skin (flat grammar): the editor is Live's note/sample
	   editor — a ControlBackground well in a 1px dark frame, grid lines as
	   opaque steps off the well (the flat line ladder runs DARKER than the
	   surface on the dark skins, so --line/--line-faint would invert bar vs
	   beat weight on this well; mixing the foreground over the well keeps
	   bars stronger than beats in both polarities), notes as solid track
	   ink with Live's ClipBorder. The gutter, lane, braces and toolbar
	   carry their own flat blocks in clipEditor/. */
	:global([data-grammar="flat"]) .clip-editor {
		--clip-grid-beat: color-mix(in srgb, var(--foreground) 10%, var(--surface-well));
		--clip-grid-bar: color-mix(in srgb, var(--foreground) 24%, var(--surface-well));
		border: 1px solid var(--line-strong);
	}
	:global([data-grammar="flat"]) .time-ruler {
		border-bottom-color: var(--line-strong);
	}
	:global([data-grammar="flat"]) .ruler-tick {
		background: var(--clip-grid-bar);
	}
	:global([data-grammar="flat"]) .ruler-tick.bar {
		background: var(--fg-tertiary); /* same ink as the bar numbers */
	}
	:global([data-grammar="flat"]) .gridline {
		background: var(--clip-grid-beat);
	}
	:global([data-grammar="flat"]) .gridline.bar {
		background: var(--clip-grid-bar);
	}
	/* Notes: solid ink, ClipBorder frame. */
	:global([data-grammar="flat"]) .note {
		box-shadow: none;
		border: 1px solid var(--flat-clip-border);
	}
	:global([data-grammar="flat"]) .marker {
		background: var(--act-warn); /* solid, no alpha */
	}
</style>
