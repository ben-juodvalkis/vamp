<script lang="ts">
	/**
	 * ClipEditorView — clip-view-mirror M1 (read-only central canvas).
	 *
	 * A full-size mirror of Live's Detail/Clip view for the focused clip:
	 *   - MIDI: piano-roll grid + axes, notes as DOM divs (velocity→alpha,
	 *     track-color hue, reusing TrackClipMidiView's color logic), a
	 *     30 Hz playhead, and loop/start-end braces (read-only in M1).
	 *   - Audio: waveform at central scale (canvas), playhead, braces.
	 *
	 * Scroll/zoom on both axes (pinch + drag). Read-only: no edits, no new
	 * wire. Data comes entirely from existing read paths —
	 * `clipPropertiesStore` (focused-clip loop/markers/type),
	 * `clipNotesService` (cheap blob), `clipWaveformService` (peaks), and
	 * `playingClipsStore` (file path + live playhead when the focused clip
	 * is the playing one). Activation is the manual toggle (decision 8);
	 * this view never auto-switches itself in.
	 */

	import { onDestroy } from 'svelte';
	import { familyScheme } from '$lib/config/devicePresets';
	import { session } from '$lib/stores/session.svelte';
	import { clipPropertiesStore } from '$lib/stores/v6/clipPropertiesStore.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import {
		playingClipsStore,
		type PlayingClipEntry
	} from '$lib/stores/v6/playingClipsStore.svelte';
	import { subscribeNotesChanged } from '$lib/services/clipNotesService';
	import {
		requestRichNotes,
		sendRemoveNotes,
		sendModifyNotes,
		sendAddNotes,
		sendSelectNotes,
		sendDuplicateNotes,
		shouldSuppressReconcile,
		type RichNote
	} from '$lib/services/clipRichNotesService';
	import { focusedNotesStore } from '$lib/stores/v6/focusedNotesStore.svelte';
	import { getPeaks, type PeakData } from '$lib/services/clipWaveformService';
	import {
		invalidateSample,
		peekSample,
		requestSample,
		type ClipSample
	} from '$lib/services/clipSampleService';
	import { v3Store } from '$lib/stores/v3/normalized.svelte';
	import { slotOfClip } from '$lib/services/clipSimilarSwap.svelte';
	import { paintPeaks, peakSpan } from '$lib/utils/waveformPaint';
	import { paintTokens, paintMode, withAlpha } from '$lib/utils/paintTokens';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
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
		defaultBeatWindow,
		defaultPitchWindow,
		type BeatWindow,
		type PitchWindow
	} from '$lib/utils/clip/clipEditorGeometry';
	import { contentLocal, velocityFromY } from '$lib/utils/clip/clipPointerMath';
	import {
		applyLoopDrag,
		snapToGrid,
		type DragHandle,
		type LoopRange
	} from '$lib/utils/clip/clipGesture';
	import { send } from '$lib/api/simpleClient';
	import {
		V3_CLIP_SET_LOOP_START_ADDRESS,
		V3_CLIP_SET_LOOP_END_ADDRESS,
		V3_CLIP_SET_PITCH_COARSE_ADDRESS,
		V3_CLIP_SET_GAIN_ADDRESS
	} from '$lib/api/handlers/v3Clip';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import { logger } from '$lib/utils/logger';

	interface Props {
		/** Track color for note/waveform tinting. */
		color?: string;
	}

	let { color }: Props = $props();

	const CENTRAL_BINS = 1024;
	const PITCH_AXIS_W = 36; // piano-key gutter width (px)
	const TIME_AXIS_H = 18; // bar/beat ruler height (px)
	const VELOCITY_LANE_H = 56; // velocity-lane strip height (px, MIDI only)
	const TOOLBAR_H = 56; // MIDI edit-toolbar band under the roll (px): 44 px chips + padding

	// ── Focused clip identity ────────────────────────────────────────
	let clipPath = $derived(session.focusedClipPath);
	let clipIndices = $derived(session.focusedClipIndices);
	let hasClip = $derived(clipPath !== null && clipIndices !== null);
	// Clip type: prefer the selected track's type (the reliable v3 signal
	// ClipCentralView itself branches on), then the playing entry's audio
	// flag, then clipPropertiesStore. `clipPropertiesStore.clipType` alone
	// is `null` for the focused clip — `is_audio_clip` is still M4L-fed and
	// `clearAll()` deliberately doesn't reseed it (see clipPropertiesStore).
	let clipType = $derived.by<'audio' | 'midi' | null>(() => {
		const tt = selectedTrackStore.trackType; // 'midi' | 'audio' | null
		if (tt === 'midi' || tt === 'audio') return tt;
		if (entryMatchesFocus && playingEntry) return playingEntry.isAudioClip ? 'audio' : 'midi';
		return clipPropertiesStore.clipType;
	});
	let isAudio = $derived(clipType === 'audio');
	let isMidi = $derived(clipType === 'midi');

	// ── Loop / markers (focused clip, always live via clipPropertiesStore)
	let loopStart = $derived(clipPropertiesStore.loopStart);
	let loopEnd = $derived(clipPropertiesStore.loopEnd);
	let startMarker = $derived(clipPropertiesStore.startMarker);
	let endMarker = $derived(clipPropertiesStore.endMarker);
	let looping = $derived(clipPropertiesStore.loopEnabled);

	// ── Playing-clip entry for this focused clip (file path + playhead) ──
	let focusedTrackPath = $derived(
		clipIndices !== null ? `tracks/${clipIndices.track}` : ''
	);
	let playingEntry = $derived<PlayingClipEntry | undefined>(
		focusedTrackPath ? playingClipsStore.get(focusedTrackPath) : undefined
	);
	// Only treat the playing entry as "this clip" when its clipPath matches
	// the focused clip — otherwise the file path / playhead belong to a
	// different slot on the same track.
	let entryMatchesFocus = $derived(
		!!playingEntry && playingEntry.clipPath === clipPath && playingEntry.slotIdx >= 0
	);
	// A focused audio clip that ISN'T the track's playing (or display)
	// clip has no entry to read — another slot on the same track is
	// playing. Ask for its sample the way a session-grid cell does
	// (`clip/sample/get`), so the editor draws the clip you're looking at
	// rather than nothing. Asked again when a different clip lands in the
	// same slot — `useClipSwap`'s identity rule, off the C record.
	let focusedClipRecord = $derived.by(() => {
		const slot = clipPath ? slotOfClip(clipPath) : null;
		return slot ? v3Store.tracks.get(slot.trackPath)?.slots.get(slot.slotPath)?.clip : undefined;
	});
	let pulledSample = $state<ClipSample | null>(null);
	let lastPulledIdentity: string | null = null;
	$effect(() => {
		const path = clipPath;
		if (!path || !isAudio || entryMatchesFocus) {
			pulledSample = null;
			return;
		}
		const identity = `${path}::${focusedClipRecord?.name ?? ''}::${focusedClipRecord?.length ?? 0}`;
		if (lastPulledIdentity?.startsWith(`${path}::`) && lastPulledIdentity !== identity) {
			invalidateSample(path);
		}
		lastPulledIdentity = identity;
		const cached = peekSample(path);
		if (cached) {
			pulledSample = cached;
			return;
		}
		let cancelled = false;
		requestSample(path)
			.then((answer) => {
				if (!cancelled) pulledSample = answer;
			})
			.catch(() => {
				if (!cancelled) pulledSample = null;
			});
		return () => {
			cancelled = true;
		};
	});

	let wavFilePath = $derived(
		entryMatchesFocus && playingEntry
			? playingEntry.filePath
			: pulledSample?.isAudioClip
				? pulledSample.filePath
				: ''
	);
	// Where the file sits in clip time — what the peaks array covers.
	// `0, 0` = unknown; the draw then falls back to `[0, totalBeats]`.
	let fileStartBeats = $derived(
		entryMatchesFocus && playingEntry ? playingEntry.fileStartBeats : (pulledSample?.fileStartBeats ?? 0)
	);
	let fileEndBeats = $derived(
		entryMatchesFocus && playingEntry ? playingEntry.fileEndBeats : (pulledSample?.fileEndBeats ?? 0)
	);

	// Total beat extent the view can reach — end marker is the right edge
	// for audio, the file's own end when it runs past it; MIDI uses
	// loopEnd/endMarker too. Fall back to a small window.
	let totalBeats = $derived(
		Math.max(endMarker, loopEnd, clipPropertiesStore.clipLength, fileEndBeats, 4)
	);
	// No playhead on a stopped clip — only one Live is playing (or holds as
	// playing while the transport is stopped) has a position worth drawing.
	let livePosition = $derived(
		entryMatchesFocus && focusedTrackPath && playingClipsStore.liveStatus(focusedTrackPath) > 0
			? playingClipsStore.position(focusedTrackPath)
			: -1
	);

	// ── Notes (M3: rich, id-carrying channel via focusedNotesStore) ──
	// The editor reads from the rich channel (note identity is what makes
	// M4 editing possible); strip thumbnails keep the cheap blob. The
	// store is the reconcile point — a fresh pull REPLACES its id-keyed
	// map, so external edits + write rejections both land here.
	let notes = $derived<RichNote[]>(focusedNotesStore.notes);
	let notesLoadState = $derived(focusedNotesStore.loadState);

	$effect(() => {
		const path = clipPath;
		if (!path || !isMidi) {
			focusedNotesStore.clearAll();
			return;
		}
		let cancelled = false;
		focusedNotesStore.setLoading(path);
		const fetch = () => {
			requestRichNotes(path)
				.then((result) => {
					if (cancelled) return;
					focusedNotesStore.reconcile(path, result);
				})
				.catch((err: Error) => {
					if (cancelled) return;
					logger.debug('ClipEditorView: rich notes fetch failed', {
						clipPath: path,
						error: err.message
					});
					focusedNotesStore.setError();
				});
		};
		fetch();
		// Re-pull on notes/changed — but suppress our OWN-write echo
		// (plan decision 4) so we don't reconcile against our optimistic
		// edit mid-gesture. External edits (no recent local write) re-pull.
		const release = subscribeNotesChanged(path, () => {
			if (shouldSuppressReconcile(path)) return;
			fetch();
		});
		return () => {
			cancelled = true;
			release();
		};
	});

	// ── Waveform peaks (audio) ───────────────────────────────────────
	let peakData = $state<PeakData | null>(null);
	$effect(() => {
		if (!isAudio || !wavFilePath) {
			peakData = null;
			return;
		}
		const path = wavFilePath;
		let cancelled = false;
		getPeaks(path, CENTRAL_BINS).then((data) => {
			if (cancelled) return;
			peakData = data;
		});
		return () => {
			cancelled = true;
		};
	});

	// ── View windows (zoom/scroll state) ─────────────────────────────
	let beatWindow = $state<BeatWindow>({ startBeats: 0, endBeats: 4 });
	let pitchWindow = $state<PitchWindow>({ lowPitch: 48, highPitch: 72 });
	// Re-seed default windows when the focused clip changes (path or type).
	let lastSeedKey = $state<string>('');
	$effect(() => {
		const key = `${clipPath ?? ''}:${clipType ?? ''}`;
		if (key === lastSeedKey) return;
		lastSeedKey = key;
		if (!hasClip) return;
		beatWindow = clampBeatWindow(
			defaultBeatWindow({
				looping,
				loopStartBeats: loopStart,
				loopEndBeats: loopEnd,
				lengthBeats: totalBeats
			}),
			totalBeats
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
		if (!isMidi || notesLoadState !== 'loaded') return;
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
	let viewPitchWindow = $derived.by((): PitchWindow => {
		const lanes = heldFoldLanes ?? liveFoldLanes;
		return fold && isMidi && lanes.length > 0 ? { ...pitchWindow, lanes } : pitchWindow;
	});
	let folded = $derived(!!viewPitchWindow.lanes);

	// ── Canvas sizing ────────────────────────────────────────────────
	// MIDI clips reserve a velocity-lane strip at the bottom; audio doesn't.
	let velocityLaneShown = $derived(isMidi);
	let bottomReserve = $derived(velocityLaneShown ? VELOCITY_LANE_H : 0);
	let containerRef = $state<HTMLElement | null>(null);
	let contentW = $state(0);
	let contentH = $state(0);
	let containerH = $state(0);
	$effect(() => {
		const el = containerRef;
		if (!el) return;
		// Reference bottomReserve so the roll height recomputes when the
		// lane appears/disappears (MIDI↔audio focus change).
		const reserve = bottomReserve;
		const ro = new ResizeObserver(() => {
			contentW = Math.max(0, el.clientWidth - PITCH_AXIS_W);
			contentH = Math.max(0, el.clientHeight - TIME_AXIS_H - reserve);
			containerH = el.clientHeight;
		});
		ro.observe(el);
		contentW = Math.max(0, el.clientWidth - PITCH_AXIS_W);
		containerH = el.clientHeight;
		contentH = Math.max(0, el.clientHeight - TIME_AXIS_H - reserve);
		return () => ro.disconnect();
	});

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

	// Piano-roll horizontal lane lines + key labels.
	let pitchLanes = $derived.by(() => {
		const out: { y: number; h: number; pitch: number; black: boolean }[] = [];
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
			x: number;
			w: number;
			y: number;
			h: number;
			velocity: number;
		}[] = [];
		if (contentW <= 0 || contentH <= 0) return out;
		const win = viewPitchWindow;
		const h = laneHeight(win, contentH);
		for (let i = 0; i < notes.length; i++) {
			const n = notes[i];
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
				x,
				w: Math.max(2, xEnd - x),
				y: pitchToY(n.pitch, win, contentH),
				h,
				velocity: n.velocity
			});
		}
		return out;
	});

	// The gutter's naming (C4 = 60, as it always drew the Cs). Folded lanes
	// aren't contiguous, so each one carries its own name; unfolded, only
	// the Cs do.
	const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
	function pitchName(p: number): string {
		return `${PITCH_NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;
	}

	function noteColor(velocity: number): string {
		// GRATICULE (§5.4): velocity drives BOTH saturation (toward signal-dim)
		// and alpha — shared with the velocity-lane bars for visual rhyme. The
		// trackInk-normalized track color is the hue anchor.
		const t = Math.min(1, Math.max(0, velocity / 127));
		const satPct = Math.round((0.45 + 0.55 * t) * 100);
		const alphaPct = Math.round((0.5 + 0.5 * t) * 100);
		const ink = color ? trackInk(color, paintModeReactive()) : 'var(--signal-dim)';
		const sat = `color-mix(in oklab, ${ink} ${satPct}%, var(--signal-dim))`;
		return `color-mix(in oklab, ${sat} ${alphaPct}%, transparent)`;
	}

	// ── Waveform canvas draw ─────────────────────────────────────────
	let waveCanvasRef = $state<HTMLCanvasElement | null>(null);
	$effect(() => {
		const canvas = waveCanvasRef;
		if (!canvas || !isAudio) return;
		const data = peakData;
		const w = contentW;
		const h = contentH;
		const win = beatWindow;
		const total = totalBeats;
		const fileStart = fileStartBeats;
		const fileEnd = fileEndBeats;
		const colorStyle = color;
		if (w <= 0 || h <= 0) return;

		const dpr = window.devicePixelRatio || 1;
		const targetW = Math.round(w * dpr);
		const targetH = Math.round(h * dpr);
		if (canvas.width !== targetW) canvas.width = targetW;
		if (canvas.height !== targetH) canvas.height = targetH;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (!data || !data.peaks.length || total <= 0) return;

		// GRATICULE two-tone (§4.5): inside the loop braces → trackInk; outside →
		// DIM_GREY @45%. ONE createLinearGradient per repaint for the vertical
		// alpha falloff (NOT per bin). fillStyle stays canvas-safe strings.
		const pt = paintTokens();
		const ink = colorStyle ? trackInk(colorStyle, paintMode()) : pt.EDITOR_ACCENT;
		const dim = pt.DIM_GREY_45;
		const inkGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
		inkGrad.addColorStop(0, withAlpha(ink, 0.4));
		inkGrad.addColorStop(0.5, ink);
		inkGrad.addColorStop(1, withAlpha(ink, 0.4));
		const looped = displayLoopEnd > displayLoopStart;
		const braceStartPx = braceLoopStartX * dpr;
		const braceEndPx = braceLoopEndX * dpr;
		// Peaks placed by time under the view window — the file's own span
		// when known, so a take that doesn't start at beat 0 (or runs past
		// the end marker) still lines up with the grid and the braces.
		paintPeaks(ctx, data.peaks, canvas.width, canvas.height, {
			span: peakSpan(fileStart, fileEnd, total),
			view: { start: win.startBeats, end: win.endBeats },
			amplitude: 'perceptual',
			headroom: 0.9,
			ink: (x0) => (!looped || (x0 >= braceStartPx && x0 < braceEndPx) ? inkGrad : dim)
		});
	});

	// ── Brace drag state (M2) ────────────────────────────────────────
	// Optimistic loop values shown during a brace drag — the surface
	// echoes back via clip/property to reconcile (ADR-358 pattern).
	let optimisticLoop = $state<LoopRange | null>(null);
	let displayLoopStart = $derived(optimisticLoop?.start ?? loopStart);
	let displayLoopEnd = $derived(optimisticLoop?.end ?? loopEnd);

	// Reconcile: once the surface's clip/property echo brings the store's
	// loop bounds in line with the optimistic value (or the user focuses
	// away), drop the optimistic overlay so the brace tracks real state.
	$effect(() => {
		if (optimisticLoop === null) return;
		const settled =
			Math.abs(loopStart - optimisticLoop.start) < 1e-3 &&
			Math.abs(loopEnd - optimisticLoop.end) < 1e-3;
		if (settled) optimisticLoop = null;
	});
	// Drop any in-flight optimistic loop when the focused clip changes.
	$effect(() => {
		void clipPath;
		optimisticLoop = null;
	});

	// ── Brace / marker overlays ──────────────────────────────────────
	let braceLoopStartX = $derived(beatToX(displayLoopStart, beatWindow, contentW));
	let braceLoopEndX = $derived(beatToX(displayLoopEnd, beatWindow, contentW));
	let markerStartX = $derived(beatToX(startMarker, beatWindow, contentW));
	let markerEndX = $derived(beatToX(endMarker, beatWindow, contentW));

	// ── Playhead overlay ─────────────────────────────────────────────
	let playheadX = $derived(
		livePosition >= 0 ? beatToX(livePosition, beatWindow, contentW) : -1
	);
	let playheadVisible = $derived(
		playheadX >= 0 && playheadX <= contentW
	);

	// ── Canvas gesture: drag-pan + wheel/pinch-zoom (NO brace logic) ──
	// Brace dragging lives on dedicated handle elements (see below), in
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

	function localCoords(e: PointerEvent | Touch): { x: number; y: number } {
		const rect = containerRef?.getBoundingClientRect();
		if (!rect) return { x: 0, y: 0 };
		return contentLocal(e.clientX, e.clientY, rect, PITCH_AXIS_W, TIME_AXIS_H);
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
			dragKind = 'pinch';
			const pts = Array.from(activePointers.values());
			pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
			pinchCenterX = (pts[0].x + pts[1].x) / 2;
			pinchCenterY = (pts[0].y + pts[1].y) / 2;
			dragStartBeatWindow = { ...beatWindow };
			dragStartPitchWindow = { ...pitchWindow };
		}
	}

	function handlePointerMove(e: PointerEvent) {
		if (!activePointers.has(e.pointerId)) return;
		const { x, y } = localCoords(e);
		activePointers.set(e.pointerId, { x, y });
		if (contentW <= 0 || contentH <= 0) return;

		if (dragKind === 'pan' && activePointers.size === 1) {
			// Inverse-drag: window moves opposite the finger, so negate.
			const deltaBeats = -clientDeltaToBeatDelta(x - dragStartX, contentW, dragStartBeatWindow);
			beatWindow = panBeatWindow(dragStartBeatWindow, deltaBeats, totalBeats);
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
			beatWindow = zoomBeatWindow(dragStartBeatWindow, factor, anchorFrac, totalBeats);
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
			? contentLocal(e.clientX, e.clientY, rect, PITCH_AXIS_W, TIME_AXIS_H).x
			: contentW / 2;
		const anchorFrac = Math.min(1, Math.max(0, localX / contentW));
		const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
		beatWindow = zoomBeatWindow(beatWindow, factor, anchorFrac, totalBeats);
	}

	// ── Brace handle drag (dedicated elements, ClipLoopControlV6 style) ──
	// Each handle owns its own drag: a down on the handle attaches
	// document-level move/up listeners, so it never shares state with the
	// canvas pan/zoom pointer surface. Pixels→beats maps through the
	// current zoomable `beatWindow` (NOT 0..endMarker), so handles track
	// zoom/scroll. Snap to bars; optimistic-apply + reconcile (ADR-358).
	let braceDragging = $state<Exclude<DragHandle, null> | null>(null);
	let braceDragStartClientX = 0;
	let braceDragStartRange: LoopRange = { start: 0, end: 0 };
	let braceLastSent: LoopRange = { start: 0, end: 0 };

	function startBraceDrag(event: PointerEvent, handle: Exclude<DragHandle, null>) {
		if (!hasClip || contentW <= 0) return;
		if (event.cancelable) event.preventDefault();
		// Stop the canvas pan/zoom pointer surface from also reacting.
		event.stopPropagation();
		braceDragging = handle;
		braceDragStartClientX = event.clientX;
		braceDragStartRange = { start: displayLoopStart, end: displayLoopEnd };
		braceLastSent = { ...braceDragStartRange };
		optimisticLoop = { ...braceDragStartRange };

		beginGesture(onBraceDragMove, onBraceDragEnd);
	}

	function onBraceDragMove(event: PointerEvent) {
		if (braceDragging === null || contentW <= 0) return;
		if (event.cancelable) event.preventDefault();
		const clientX = event.clientX;
		const deltaBeats = clientDeltaToBeatDelta(clientX - braceDragStartClientX, contentW, beatWindow);
		const next = applyLoopDrag({
			range: braceDragStartRange,
			handle: braceDragging,
			deltaBeats,
			min: 0,
			max: totalBeats,
			minGap: 0.25,
			gridBeats: beatsPerBar
		});
		optimisticLoop = next;
		// Stream the write during drag (matches ClipLoopControlV6) so Live
		// follows the gesture, but only when the snapped value actually
		// changed since the last send — avoids flooding OSC on every move.
		commitLoop(next, braceLastSent);
		braceLastSent = next;
	}

	function onBraceDragEnd() {
		if (optimisticLoop !== null) {
			// Commit the final value into the store before clearing the
			// optimistic overlay so the brace doesn't snap back to a stale
			// value while the surface echo is in flight.
			clipPropertiesStore.handleLoopStart(optimisticLoop.start);
			clipPropertiesStore.handleLoopEnd(optimisticLoop.end);
		}
		braceDragging = null;
	}

	function commitLoop(range: LoopRange, prev: LoopRange): void {
		if (clipPath === null) return;
		// Only emit edges that actually moved (avoids a redundant
		// start-marker side-effect write when only the end moved).
		if (Math.abs(range.start - prev.start) >= 1e-3) {
			send(V3_CLIP_SET_LOOP_START_ADDRESS, [clipPath, range.start]);
		}
		if (Math.abs(range.end - prev.end) >= 1e-3) {
			send(V3_CLIP_SET_LOOP_END_ADDRESS, [clipPath, range.end]);
		}
	}

	// ── Audio continuous controls (M2): pitch + gain ─────────────────
	let pitchCoarse = $derived(clipPropertiesStore.pitchCoarse);
	let gain = $derived(clipPropertiesStore.gain);

	function handlePitchInteraction(value: number) {
		if (clipPath === null) return;
		const next = Math.round(value);
		clipPropertiesStore.handlePitchCoarse(next); // optimistic
		send(V3_CLIP_SET_PITCH_COARSE_ADDRESS, [clipPath, next]);
	}

	function handleGainInteraction(value: number) {
		if (clipPath === null) return;
		clipPropertiesStore.handleGain(value); // optimistic
		send(V3_CLIP_SET_GAIN_ADDRESS, [clipPath, value]);
	}

	// ── MIDI note editing (M4) ───────────────────────────────────────
	// Two modes (plan M5 will add marquee/quantize): 'select' (drag a note
	// to move pitch+time, drag its right edge to resize, tap to select →
	// Delete removes) and 'draw' (tap an empty lane to add a note, tap a
	// note to erase it).
	// Optimistic-apply to focusedNotesStore, emit the write, reconcile on
	// the surface's notes/changed re-pull (own-write echo suppressed —
	// see the notes effect above + clipRichNotesService.markLocalWrite).
	type EditMode = 'select' | 'draw';
	// Draw by default (the user's call, 2026-09-25) — notes can still be
	// grabbed, moved and resized in Draw; only a tap that doesn't move differs.
	let editMode = $state<EditMode>('draw');
	// Multi-select (M5): the set of selected note ids. Reassigned (not
	// mutated in place) so Svelte 5 tracks it. Tap = replace, shift/⌘-tap
	// = toggle-add, marquee drag = box-select. Mirrored to Live's piano
	// roll as a batch (M6 sendSelectNotes takes an id array).
	let selectedIds = $state<Set<number>>(new Set());
	let selectedCount = $derived(selectedIds.size);

	// Drop stale selection when the focused clip changes. Without this,
	// a selection from clip A persists into clip B — the toolbar shows a
	// stale count and Delete/quantize fire clip A's note ids
	// against clip B (Live's ids are session-monotonic, so a collision is
	// possible). Mirrors the optimisticLoop clear on path change.
	$effect(() => {
		void clipPath;
		selectedIds = new Set();
	});

	// Snap grid (M5 polish): a UI-chosen division of a beat (a quarter
	// note = 1 beat). `gridDenom` is the note value (4=1/4, 8=1/8, …);
	// `gridTriplet` shrinks the cell to 2/3 for triplet feel. Self-
	// consistent with the editor's own gridlines (we don't mirror Live's
	// grid_quantization — see ADR-382). One grid cell in beats:
	//   beats = (4 / gridDenom) * (gridTriplet ? 2/3 : 1)
	const GRID_DENOMS = [4, 8, 16, 32] as const;
	let gridDenom = $state<number>(16);
	let gridTriplet = $state<boolean>(false);
	let gridBeats = $derived((4 / gridDenom) * (gridTriplet ? 2 / 3 : 1));
	let gridLabel = $derived(`1/${gridDenom}${gridTriplet ? 'T' : ''}`);
	// Default duration for a drawn note: one grid cell.
	let drawDuration = $derived(gridBeats);

	function cycleGrid() {
		const i = GRID_DENOMS.indexOf(gridDenom as (typeof GRID_DENOMS)[number]);
		gridDenom = GRID_DENOMS[(i + 1) % GRID_DENOMS.length];
	}
	// Drag state for a note move/resize gesture. ``members`` snapshots the
	// pre-drag pitch/start/duration of every selected note so a group move
	// applies the same delta to all of them; ``anchorId`` is the grabbed
	// note (drives resize + the move/resize kind decision).
	type NoteDragKind = 'move' | 'resize';
	interface NoteDragMember {
		noteId: number;
		startBeats: number;
		startPitch: number;
		startDuration: number;
	}
	let noteDrag = $state<{
		kind: NoteDragKind;
		anchorId: number;
		startClientX: number;
		startClientY: number;
		members: NoteDragMember[];
		moved: boolean;
		// Grabbed with shift / ⌘ / ctrl: a selection gesture, never an erase.
		additive: boolean;
	} | null>(null);

	function gridBeatsForSnap(): number {
		// The UI-chosen snap grid (toolbar selector), in beats.
		return gridBeats;
	}

	// --- gesture document-listener lifecycle ─────────────────────────
	// Every drag gesture (note/brace/marquee/velocity/draw) attaches
	// document-level pointermove/up/cancel listeners. They normally tear
	// down in the gesture's own end handler, but if the component unmounts
	// mid-drag (editor toggled away during a drag) the listeners would
	// leak and close over stale state. Track each gesture's teardown here
	// and drain any still-active on destroy.
	const activeGestureTeardowns = new Set<() => void>();

	/**
	 * Attach a drag gesture's move/end listeners with leak-safe teardown.
	 * ``onMove`` runs on pointermove; ``onEnd`` runs once on pointerup/
	 * cancel (or on component destroy). Returns nothing — the gesture is
	 * self-cleaning.
	 */
	function beginGesture(
		onMove: (e: PointerEvent) => void,
		onEnd: () => void
	): void {
		const move = (e: PointerEvent) => onMove(e);
		let done = false;
		const teardown = () => {
			if (done) return;
			done = true;
			document.removeEventListener('pointermove', move);
			document.removeEventListener('pointerup', end);
			document.removeEventListener('pointercancel', end);
			activeGestureTeardowns.delete(teardown);
		};
		const end = () => {
			onEnd();
			teardown();
		};
		document.addEventListener('pointermove', move);
		document.addEventListener('pointerup', end);
		document.addEventListener('pointercancel', end);
		activeGestureTeardowns.add(teardown);
	}

	onDestroy(() => {
		// Detach any gesture listeners still live at unmount (no onEnd —
		// we don't want a half-finished drag to emit a write on destroy).
		for (const teardown of [...activeGestureTeardowns]) teardown();
	});

	function startNoteDrag(event: PointerEvent, noteId: number) {
		if (!isMidi || clipPath === null) return;
		event.stopPropagation();
		if (event.cancelable) event.preventDefault();
		const note = focusedNotesStore.get(noteId);
		if (!note) return;

		// Selection semantics on grab:
		//  - shift / ⌘ / ctrl tap: toggle this note in/out of the set.
		//  - tap on an already-selected note: keep the set (group drag).
		//  - tap on an unselected note: replace selection with just it.
		const additive = event.shiftKey || event.metaKey || event.ctrlKey;
		if (additive) {
			toggleInSelection(noteId);
		} else if (!selectedIds.has(noteId)) {
			selectOnly(noteId);
		}
		// If the grabbed note ended up deselected (additive toggle-off),
		// there's nothing to drag.
		if (!selectedIds.has(noteId)) return;

		// Decide move vs resize from where in the anchor note was grabbed.
		const noteX = beatToX(note.startBeats, beatWindow, contentW);
		const noteEndX = beatToX(note.startBeats + note.durationBeats, beatWindow, contentW);
		const localX = noteEventLocalX(event);
		const kind: NoteDragKind = grabResizesNote(localX, noteX, noteEndX) ? 'resize' : 'move';

		// Snapshot every selected note's pre-drag geometry for a group move.
		const members: NoteDragMember[] = [];
		for (const id of selectedIds) {
			const n = focusedNotesStore.get(id);
			if (!n) continue;
			members.push({
				noteId: id,
				startBeats: n.startBeats,
				startPitch: n.pitch,
				startDuration: n.durationBeats
			});
		}

		heldFoldLanes = liveFoldLanes;
		noteDrag = {
			kind,
			anchorId: noteId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			members,
			moved: false,
			additive
		};

		beginGesture(onNoteDragMove, onNoteDragEnd);
	}

	function noteEventLocalX(e: PointerEvent): number {
		const rect = containerRef?.getBoundingClientRect();
		if (!rect) return 0;
		return contentLocal(e.clientX, e.clientY, rect, PITCH_AXIS_W, TIME_AXIS_H).x;
	}

	function onNoteDragMove(event: PointerEvent) {
		if (noteDrag === null || contentW <= 0 || contentH <= 0) return;
		if (event.cancelable) event.preventDefault();
		const deltaBeats = clientDeltaToBeatDelta(event.clientX - noteDrag.startClientX, contentW, beatWindow);
		const grid = gridBeatsForSnap();
		const dx = event.clientX - noteDrag.startClientX;
		const dy = event.clientY - noteDrag.startClientY;
		if (!noteDrag.moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
			noteDrag.moved = true;
			// A drag off the resize handle that sets off up or down is a
			// pitch move: a resize would ignore the pitch and snap the length.
			if (noteDrag.kind === 'resize' && Math.abs(dy) > Math.abs(dx)) noteDrag.kind = 'move';
		}

		if (noteDrag.kind === 'resize') {
			// Resize: same snapped duration delta applied to every member.
			const anchor = noteDrag.members.find((m) => m.noteId === noteDrag!.anchorId);
			const base = anchor ? anchor.startDuration : 0;
			const snappedDur = Math.max(grid, snapToGrid(base + deltaBeats, grid));
			const durDelta = snappedDur - base;
			for (const m of noteDrag.members) {
				focusedNotesStore.optimisticModify(m.noteId, {
					durationBeats: Math.max(grid, m.startDuration + durDelta)
				});
			}
		} else {
			// Move: snap the anchor's start, derive the beat delta from it,
			// apply the same delta + pitch delta to every member.
			const anchor = noteDrag.members.find((m) => m.noteId === noteDrag!.anchorId);
			const anchorBase = anchor ? anchor.startBeats : 0;
			const anchorNewStart = Math.max(0, snapToGrid(anchorBase + deltaBeats, grid));
			const beatDelta = anchorNewStart - anchorBase;
			// Negate: dragging down (larger clientY) lowers pitch.
			// Folded, the delta counts shown lanes and `shiftPitch` steps
			// each member to a neighbouring shown pitch.
			const deltaPitch = -clientDeltaToPitchDelta(event.clientY - noteDrag.startClientY, contentH, viewPitchWindow);
			for (const m of noteDrag.members) {
				focusedNotesStore.optimisticModify(m.noteId, {
					startBeats: Math.max(0, m.startBeats + beatDelta),
					pitch: shiftPitch(m.startPitch, deltaPitch, viewPitchWindow)
				});
			}
		}
	}

	function onNoteDragEnd() {
		const drag = noteDrag;
		noteDrag = null;
		heldFoldLanes = null;
		if (drag === null || clipPath === null) return;
		// A drag that never moved = a tap. In Draw it erases the note under
		// the finger, as Live's draw mode does (the user's call,
		// 2026-09-29); in Select it only selected, so there is no write.
		if (!drag.moved) {
			if (editMode === 'draw' && !drag.additive) deleteNote(drag.anchorId);
			return;
		}
		// Batch-modify every moved member in one wire message (coalesced —
		// no per-pointer-move OSC flood). Real ids only.
		const specs = [];
		for (const m of drag.members) {
			const n = focusedNotesStore.get(m.noteId);
			if (!n || n.noteId < 0) continue;
			specs.push({
				noteId: n.noteId,
				pitch: n.pitch,
				startBeats: n.startBeats,
				durationBeats: n.durationBeats,
				velocity: n.velocity,
				mute: n.mute
			});
		}
		if (specs.length > 0) sendModifyNotes(clipPath, specs);
	}

	// --- selection set helpers (M5 multi-select) ---------------------
	// Apply a new selection set locally AND mirror it to Live's piano
	// roll (M6). Only real (>= 0) ids go upstream — a temp negative id
	// (freshly-drawn note awaiting its real id) is held locally and
	// pushed once `notes/added` swaps it.
	function applySelection(ids: Set<number>) {
		selectedIds = ids;
		if (clipPath === null) return;
		const realIds = [...ids].filter((id) => id >= 0);
		sendSelectNotes(clipPath, realIds); // empty array clears in Live
	}

	function selectOnly(noteId: number) {
		applySelection(new Set([noteId]));
	}

	function toggleInSelection(noteId: number) {
		const next = new Set(selectedIds);
		if (next.has(noteId)) next.delete(noteId);
		else next.add(noteId);
		applySelection(next);
	}

	function clearSelection() {
		if (selectedIds.size === 0) return;
		applySelection(new Set());
	}

	function deleteSelectedNotes() {
		if (clipPath === null || selectedIds.size === 0) return;
		const ids = [...selectedIds];
		selectedIds = new Set();
		focusedNotesStore.optimisticRemove(ids); // optimistic, batch
		sendRemoveNotes(clipPath, ids);
		sendSelectNotes(clipPath, []); // nothing selected after delete
	}

	function deleteNote(noteId: number) {
		if (clipPath === null) return;
		const next = new Set(selectedIds);
		next.delete(noteId);
		applySelection(next);
		focusedNotesStore.optimisticRemove([noteId]);
		sendRemoveNotes(clipPath, [noteId]);
	}

	function handleEditorKey(event: KeyboardEvent) {
		if (!isMidi) return;
		if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.size > 0) {
			event.preventDefault();
			deleteSelectedNotes();
		} else if (event.key === 'Escape' && selectedIds.size > 0) {
			event.preventDefault();
			clearSelection();
		}
	}

	// Draw-on-empty-grid (draw mode). Pointerdown mints a temp note at the
	// grid cell; DRAGGING right extends its duration (snapped, ≥ one cell);
	// pointerup commits the add with the final length. A plain tap (no
	// drag) commits a one-cell note. The wire send is deferred to
	// pointerup so a drag produces a single add at the chosen length.
	let drawNote = $state<{ tempId: number; startBeats: number; pitch: number } | null>(null);

	function handleGridTap(event: PointerEvent) {
		if (editMode !== 'draw' || !isMidi || clipPath === null || contentW <= 0) return;
		const rect = containerRef?.getBoundingClientRect();
		if (!rect) return;
		const { x: localX, y: localY } = contentLocal(event.clientX, event.clientY, rect, PITCH_AXIS_W, TIME_AXIS_H);
		if (localX < 0 || localY < 0 || localX > contentW || localY > contentH) return;
		const grid = gridBeatsForSnap();
		const startBeats = Math.max(0, snapToGrid(xToBeat(localX, beatWindow, contentW), grid));
		const pitch = Math.max(0, Math.min(127, Math.round(yToPitch(localY, viewPitchWindow, contentH))));
		const tempId = focusedNotesStore.nextTempId();
		focusedNotesStore.optimisticAdd({
			noteId: tempId,
			pitch,
			startBeats,
			durationBeats: drawDuration,
			velocity: 100,
			mute: false
		});
		selectedIds = new Set([tempId]); // local-only until the real id arrives
		drawNote = { tempId, startBeats, pitch };

		beginGesture(onDrawDragMove, commitDrawNote);
	}

	function onDrawDragMove(event: PointerEvent) {
		if (drawNote === null || contentW <= 0) return;
		if (event.cancelable) event.preventDefault();
		const rect = containerRef?.getBoundingClientRect();
		if (!rect) return;
		const localX = contentLocal(event.clientX, event.clientY, rect, PITCH_AXIS_W, TIME_AXIS_H).x;
		const grid = gridBeatsForSnap();
		const endBeats = snapToGrid(xToBeat(localX, beatWindow, contentW), grid);
		const dur = Math.max(grid, endBeats - drawNote.startBeats);
		focusedNotesStore.optimisticModify(drawNote.tempId, { durationBeats: dur });
	}

	function commitDrawNote() {
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
				if (newIds.length > 0) {
					focusedNotesStore.swapTempId(tempId, newIds[0]);
					// Real Live id now exists — mirror selection upstream.
					if (selectedIds.has(tempId)) selectOnly(newIds[0]);
				}
			})
			.catch((err: Error) => {
				logger.debug('ClipEditorView: add note failed', {
					clipPath: path,
					error: err.message
				});
				focusedNotesStore.optimisticRemove([tempId]);
			});
	}

	// --- marquee box-select (M5) ─────────────────────────────────────
	// A drag on empty grid in Select mode draws a rubber-band box; on
	// release, every note intersecting it is selected (additive when
	// shift/⌘ held). Lives on a dedicated catcher layer so it never
	// tangles with the canvas pan/zoom surface.
	let marquee = $state<{
		x0: number;
		y0: number;
		x1: number;
		y1: number;
		additive: boolean;
		baseIds: Set<number>;
	} | null>(null);
	let marqueeRect = $derived(
		marquee
			? {
					left: Math.min(marquee.x0, marquee.x1),
					top: Math.min(marquee.y0, marquee.y1),
					width: Math.abs(marquee.x1 - marquee.x0),
					height: Math.abs(marquee.y1 - marquee.y0)
				}
			: null
	);

	function startMarquee(event: PointerEvent) {
		if (editMode !== 'select' || !isMidi || clipPath === null || contentW <= 0) return;
		event.stopPropagation();
		if (event.cancelable) event.preventDefault();
		const { x, y } = localCoords(event);
		const additive = event.shiftKey || event.metaKey || event.ctrlKey;
		marquee = { x0: x, y0: y, x1: x, y1: y, additive, baseIds: new Set(selectedIds) };

		beginGesture((e) => {
			if (marquee === null) return;
			const p = localCoords(e);
			marquee = { ...marquee, x1: p.x, y1: p.y };
		}, finishMarquee);
	}

	function finishMarquee() {
		const m = marquee;
		marquee = null;
		if (m === null) return;
		const left = Math.min(m.x0, m.x1);
		const right = Math.max(m.x0, m.x1);
		const top = Math.min(m.y0, m.y1);
		const bottom = Math.max(m.y0, m.y1);
		// A click (no drag) on empty grid clears the selection.
		if (right - left < 3 && bottom - top < 3) {
			if (!m.additive) clearSelection();
			return;
		}
		const hits = new Set<number>(m.additive ? m.baseIds : []);
		const laneH = laneHeight(viewPitchWindow, contentH);
		for (const n of notes) {
			const nx = beatToX(n.startBeats, beatWindow, contentW);
			const nxEnd = beatToX(n.startBeats + n.durationBeats, beatWindow, contentW);
			const ny = pitchToY(n.pitch, viewPitchWindow, contentH);
			const nyEnd = ny + laneH;
			// AABB intersection test.
			if (nxEnd >= left && nx <= right && nyEnd >= top && ny <= bottom) {
				hits.add(n.noteId);
			}
		}
		applySelection(hits);
	}

	// --- quantize (M5) ───────────────────────────────────────────────
	// Live's Clip has no `quantize` LOM method (SelectionProbe dump), so
	// quantize is client-side: snap each selected note's start to the grid
	// and batch-modify. No new wire.
	function quantizeSelected() {
		if (clipPath === null || selectedIds.size === 0) return;
		const grid = gridBeatsForSnap();
		const specs = [];
		for (const id of selectedIds) {
			const n = focusedNotesStore.get(id);
			if (!n || n.noteId < 0) continue;
			const snapped = Math.max(0, snapToGrid(n.startBeats, grid));
			if (Math.abs(snapped - n.startBeats) < 1e-6) continue; // already on grid
			focusedNotesStore.optimisticModify(id, { startBeats: snapped }); // optimistic
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

	// --- duplicate (M5) ──────────────────────────────────────────────
	// Duplicate the selected notes one grid-step (or their own span) later
	// via the M5 duplicate endpoint → clip.duplicate_notes_by_id. The
	// surface replies notes/added with the new ids; we select those.
	function duplicateSelected() {
		if (clipPath === null || selectedIds.size === 0) return;
		const ids = [...selectedIds].filter((id) => id >= 0);
		if (ids.length === 0) return;
		const path = clipPath;
		sendDuplicateNotes(path, ids)
			.then(async (newIds) => {
				// Unlike add/move/delete there is no optimistic copy to draw —
				// only Live knows where the copies landed — and the write
				// marks itself local, so the notes/changed echo that would
				// re-pull is suppressed. Pull the notes now, or the copies
				// show in the strip thumbnails but never here.
				const fresh = await requestRichNotes(path);
				if (focusedNotesStore.clipPath !== path) return;
				focusedNotesStore.reconcile(path, fresh);
				if (newIds.length > 0) applySelection(new Set(newIds));
			})
			.catch((err: Error) => {
				logger.debug('ClipEditorView: duplicate failed', {
					clipPath,
					error: err.message
				});
			});
	}

	// --- velocity lane (M5, plan decision 9) ─────────────────────────
	// A strip under the roll, one bar per visible note (height ∝ velocity).
	// Vertical drag on a bar sets that note's velocity; if the dragged
	// note is part of the current multi-selection, ALL selected notes get
	// the same velocity (group edit). Pitch-drag (on the roll) and
	// velocity-drag (here) stay spatially separate — no modifier needed.
	const VELOCITY_MAX = 127;
	let velBars = $derived.by(() => {
		const out: { noteId: number; x: number; w: number; velocity: number }[] = [];
		if (contentW <= 0 || !velocityLaneShown) return out;
		for (const n of notes) {
			const noteEnd = n.startBeats + n.durationBeats;
			if (noteEnd <= beatWindow.startBeats || n.startBeats >= beatWindow.endBeats) continue;
			const x = beatToX(n.startBeats, beatWindow, contentW);
			const xEnd = beatToX(noteEnd, beatWindow, contentW);
			out.push({ noteId: n.noteId, x, w: Math.max(3, xEnd - x), velocity: n.velocity });
		}
		return out;
	});

	let velDrag = $state<{ ids: number[] } | null>(null);

	function velocityFromClientY(clientY: number): number {
		const rect = containerRef?.getBoundingClientRect();
		if (!rect) return 0;
		// Lane spans the bottom VELOCITY_LANE_H px of the container; top of
		// the lane = max velocity, bottom = 0.
		return velocityFromY(clientY, rect.top, containerH, VELOCITY_LANE_H, VELOCITY_MAX);
	}

	function startVelocityDrag(event: PointerEvent, noteId: number) {
		if (clipPath === null) return;
		event.stopPropagation();
		if (event.cancelable) event.preventDefault();
		// Drag the whole selection if this bar's note is selected, else
		// just this one (and make it the selection).
		const ids = selectedIds.has(noteId) ? [...selectedIds] : [noteId];
		if (!selectedIds.has(noteId)) selectOnly(noteId);
		velDrag = { ids };
		applyVelocity(event.clientY);

		beginGesture((e) => applyVelocity(e.clientY), commitVelocity);
	}

	function applyVelocity(clientY: number) {
		if (velDrag === null) return;
		const vel = velocityFromClientY(clientY);
		for (const id of velDrag.ids) {
			if (id < 0) continue;
			focusedNotesStore.optimisticModify(id, { velocity: vel }); // optimistic
		}
	}

	function commitVelocity() {
		const drag = velDrag;
		velDrag = null;
		if (drag === null || clipPath === null) return;
		const specs = [];
		for (const id of drag.ids) {
			const n = focusedNotesStore.get(id);
			if (!n || n.noteId < 0) continue;
			specs.push({
				noteId: n.noteId,
				pitch: n.pitch,
				startBeats: n.startBeats,
				durationBeats: n.durationBeats,
				velocity: n.velocity,
				mute: n.mute
			});
		}
		if (specs.length > 0) sendModifyNotes(clipPath, specs);
	}
</script>

<div class="clip-editor h-full w-full">
	{#if !hasClip}
		<div class="state-msg">No clip focused</div>
	{:else}
		<!-- role="application" is the ARIA role for a surface that handles its own
		     pointer and keys, which this is; Svelte's lint counts it as
		     non-interactive, so both of its complaints are about the role, not
		     the element. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
		<div
			class="canvas-wrap"
			style:bottom={isMidi ? `${TOOLBAR_H}px` : undefined}
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
			onkeydown={handleEditorKey}
		>
			<!-- Time ruler (top) -->
			<div class="time-ruler" style="left: {PITCH_AXIS_W}px; height: {TIME_AXIS_H}px;">
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
				<div class="pitch-gutter" style="top: {TIME_AXIS_H}px; width: {PITCH_AXIS_W}px;">
					{#each pitchLanes as lane (lane.pitch)}
						<div
							class="key"
							class:black={lane.black}
							style="top: {lane.y}px; height: {lane.h}px;"
						>
							{#if folded || lane.pitch % 12 === 0}<span class="key-label">{pitchName(lane.pitch)}</span>{/if}
						</div>
					{/each}
				</div>
			{/if}

			<!-- Content area -->
			<div
				class="content"
				style="left: {PITCH_AXIS_W}px; top: {TIME_AXIS_H}px; width: {contentW}px; height: {contentH}px;"
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

					<!-- Draw-mode tap catcher (M4): sits above the grid, below
					     the notes, so a tap on an empty lane mints a note while
					     taps on a note still hit the note's own handler. -->
					{#if editMode === 'draw'}
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
					{:else}
						<!-- Select-mode marquee catcher: a drag on empty grid
						     box-selects; below notes (z 2 < 4) so note taps
						     still hit the note. -->
						<div
							class="marquee-catcher"
							role="button"
							tabindex="-1"
							aria-label="Select notes"
							onpointerdown={startMarquee}
						></div>
						{#if marqueeRect}
							<div
								class="marquee-box"
								style="left: {marqueeRect.left}px; top: {marqueeRect.top}px; width: {marqueeRect.width}px; height: {marqueeRect.height}px;"
							></div>
						{/if}
					{/if}

					<!-- Notes -->
					{#if notesLoadState === 'loading' && notes.length === 0}
						<div class="state-msg overlay">Loading notes…</div>
					{:else}
						{#each visibleNotes as note (note.key)}
							<div
								class="note"
								class:selected={selectedIds.has(note.noteId)}
								style="left: {note.x}px; width: {note.w}px; top: {note.y}px; height: {note.h}px; background: {noteColor(note.velocity)};"
								role="button"
								tabindex="-1"
								aria-label="MIDI note"
								onpointerdown={(e) => startNoteDrag(e, note.noteId)}
							></div>
						{/each}
					{/if}
				{:else if isAudio}
					<canvas bind:this={waveCanvasRef} class="waveform"></canvas>
				{/if}

				<!-- Start/End markers (audio: clip extent) -->
				{#if isAudio}
					<div class="marker marker-start" style="left: {markerStartX}px;"></div>
					<div class="marker marker-end" style="left: {markerEndX}px;"></div>
				{/if}

				<!-- Loop braces (dedicated draggable handles — M2) -->
				{#if looping || displayLoopEnd > displayLoopStart}
					<!-- Middle region: drag to move the whole loop -->
					<div
						class="loop-region"
						class:enabled={looping}
						class:dragging={braceDragging === 'move'}
						style="left: {braceLoopStartX}px; width: {Math.max(0, braceLoopEndX - braceLoopStartX)}px;"
						role="slider"
						tabindex="-1"
						aria-label="Move loop"
						aria-valuenow={Math.round(displayLoopStart)}
						onpointerdown={(e) => startBraceDrag(e, 'move')}
					></div>
					<!-- Start handle -->
					<div
						class="brace-handle brace-start"
						class:dragging={braceDragging === 'start'}
						style="left: {braceLoopStartX}px;"
						role="slider"
						tabindex="-1"
						aria-label="Loop start"
						aria-valuenow={Math.round(displayLoopStart)}
						onpointerdown={(e) => startBraceDrag(e, 'start')}
					>
						<div class="brace-line"></div>
					</div>
					<!-- End handle -->
					<div
						class="brace-handle brace-end"
						class:dragging={braceDragging === 'end'}
						style="left: {braceLoopEndX}px;"
						role="slider"
						tabindex="-1"
						aria-label="Loop end"
						aria-valuenow={Math.round(displayLoopEnd)}
						onpointerdown={(e) => startBraceDrag(e, 'end')}
					>
						<div class="brace-line"></div>
					</div>
				{/if}

				<!-- Playhead -->
				{#if playheadVisible}
					<div class="playhead" style="left: {playheadX}px;"></div>
				{/if}
			</div>

			<!-- Velocity lane (M5): one bar per visible note, vertical drag
			     sets velocity. Aligned with the content's x via the pitch
			     gutter offset; sits in the reserved bottom strip. -->
			{#if velocityLaneShown}
				<div
					class="velocity-lane"
					style="left: {PITCH_AXIS_W}px; height: {VELOCITY_LANE_H}px; width: {contentW}px;"
				>
					{#each velBars as bar (bar.noteId)}
						<div
							class="vel-bar"
							class:selected={selectedIds.has(bar.noteId)}
							style="left: {bar.x}px; width: {bar.w}px; height: {(bar.velocity / VELOCITY_MAX) * 100}%; background: {noteColor(bar.velocity)};"
							role="slider"
							tabindex="-1"
							aria-label="Note velocity"
							aria-valuenow={Math.round(bar.velocity)}
							aria-valuemin={0}
							aria-valuemax={VELOCITY_MAX}
							onpointerdown={(e) => startVelocityDrag(e, bar.noteId)}
						></div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- MIDI edit toolbar: mode · grid · ops. Own pointer
		     surface, outside the pan/zoom canvas. -->
		{#if isMidi}
			<div class="edit-toolbar" style:height="{TOOLBAR_H}px">
				<button
					class="edit-chip"
					class:active={fold}
					onclick={() => (fold = !fold)}
					title="Fold: show only the pitches this clip plays"
				>
					Fold
				</button>

				<span class="toolbar-sep"></span>

				<button
					class="edit-chip"
					class:active={editMode === 'select'}
					onclick={() => (editMode = 'select')}
					title="Select / move notes"
				>
					Select
				</button>
				<button
					class="edit-chip"
					class:active={editMode === 'draw'}
					onclick={() => (editMode = 'draw')}
					title="Draw notes"
				>
					Draw
				</button>

				<span class="toolbar-sep"></span>

				<!-- Snap grid selector (M5 polish): cycles 1/4·1/8·1/16·1/32
				     and a triplet toggle. Drives snap, draw length, and the
				     visible gridlines. -->
				<button
					class="edit-chip grid-chip"
					onclick={cycleGrid}
					title="Snap grid (tap to cycle)"
				>
					{gridLabel}
				</button>
				<button
					class="edit-chip"
					class:active={gridTriplet}
					onclick={() => (gridTriplet = !gridTriplet)}
					title="Triplet grid"
					data-narrow
				>
					T
				</button>

				<span class="toolbar-sep"></span>


				<button
					class="edit-chip"
					disabled={selectedCount === 0}
					onclick={quantizeSelected}
					title="Quantize selected notes to grid"
				>
					Quantize
				</button>
				<button
					class="edit-chip"
					disabled={selectedCount === 0}
					onclick={duplicateSelected}
					title="Duplicate selected notes"
				>
					Duplicate
				</button>
				<button
					class="edit-chip delete"
					disabled={selectedCount === 0}
					onclick={deleteSelectedNotes}
					title="Delete selected notes"
				>
					Delete{selectedCount > 1 ? ` (${selectedCount})` : ''}
				</button>
			</div>
		{/if}

		<!-- Audio continuous controls (M2) — own pointer surface, outside
		     the pan/zoom canvas. Pitch (coarse semitones) + clip gain. -->
		{#if isAudio}
			<div class="audio-controls">
				<div class="audio-control">
					<DeviceSlider
						value={pitchCoarse}
						title="Pitch"
						min={-48}
						max={48}
						centerValue={0}
						color={familyScheme('pitchSeq')}
						onInteraction={handlePitchInteraction}
					/>
				</div>
				<div class="audio-control">
					<DeviceSlider
						value={gain}
						title="Gain"
						min={0}
						max={1}
						color={familyScheme('dynamics')}
						onInteraction={handleGainInteraction}
					/>
				</div>
			</div>
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

	.audio-controls {
		position: absolute;
		right: 8px;
		top: 8px;
		bottom: 8px;
		width: 116px;
		display: flex;
		gap: var(--spacing-sm);
		z-index: 15;
		pointer-events: none; /* let the strip background pass through; children opt back in */
	}
	.audio-control {
		flex: 1;
		min-width: 0;
		pointer-events: auto;
		border-radius: var(--radius-sm);
		background: var(--secondary);
		padding: 2px;
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

	.pitch-gutter {
		position: absolute;
		left: 0;
		bottom: 0;
		overflow: hidden;
		border-right: 1px solid var(--line);
	}

	/* Real mini piano keys (§5.4): white keys --secondary, black keys --canvas. */
	.key {
		position: absolute;
		left: 0;
		right: 0;
		background: var(--secondary);
		border-bottom: 1px solid var(--line-faint);
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding-right: 2px;
	}
	.key.black {
		background: var(--canvas);
	}
	.key-label {
		font-family: var(--font-mono);
		font-size: 8px;
		line-height: 1;
		color: var(--fg-tertiary);
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
	   loop-region (1) < draw-catcher (2) < note (4) < note.selected (5)
	   < brace-handle (6) < playhead (7).
	   Notes MUST sit above the loop-region: the region spans the whole
	   loop window, so without this a note tap inside the loop hits
	   "Move loop" instead of selecting the note (caught in live test). */
	.note {
		position: absolute;
		border-radius: 2px;
		min-height: 2px;
		/* Interactive in M4 — own pointer handler for move/resize/select.
		   touch-action:none so a note drag doesn't scroll the page. */
		pointer-events: auto;
		touch-action: none;
		cursor: pointer;
		z-index: 4;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--background), transparent 40%);
	}
	.note.selected {
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--background), transparent 40%),
			0 0 0 1px white;
		z-index: 5;
	}

	/* Draw-mode tap catcher: transparent, fills the content area, above
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

	/* Select-mode marquee catcher: same layer as draw-catcher (z 2),
	   below notes so note taps win; a drag on empty grid box-selects. */
	.marquee-catcher {
		position: absolute;
		inset: 0;
		z-index: 2;
		cursor: default;
		touch-action: none;
	}
	.marquee-box {
		position: absolute;
		z-index: 6;
		border: 1px solid var(--phosphor);
		background: var(--phosphor-wash);
		pointer-events: none;
	}

	/* Velocity lane: bottom strip, bars grow upward from the baseline. */
	.velocity-lane {
		position: absolute;
		bottom: 0;
		overflow: hidden;
		border-top: 1px solid var(--line);
		background: var(--line-faint);
	}
	.vel-bar {
		position: absolute;
		bottom: 0;
		min-height: 2px;
		border-radius: 1px 1px 0 0;
		cursor: ns-resize;
		touch-action: none;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--background), transparent 50%);
	}
	.vel-bar.selected {
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--background), transparent 50%),
			0 0 0 1px white;
	}

	/* Its own band under the roll (the canvas stops TOOLBAR_H short of the
	   bottom), not an overlay on the velocity lane. Chips share the width
	   evenly at a 44 px touch height — at 11 px type and ~16 px tall they
	   were too small to hit on the iPad. */
	.edit-toolbar {
		position: absolute;
		left: 8px;
		bottom: 0;
		right: 8px;
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		gap: var(--spacing-xs);
		z-index: 20;
		pointer-events: none; /* chips opt back in; gaps pass through */
	}
	.edit-toolbar > * {
		pointer-events: auto;
	}
	/* One-character labels give their width to the long ones ("Duplicate"). */
	.edit-chip[data-narrow] {
		flex-grow: 0.6;
	}
	.toolbar-sep {
		width: 1px;
		height: 44px;
		flex: none;
		margin: 0 3px;
		background: var(--line);
		pointer-events: none;
	}
	/* Not `.grid`: that is Tailwind's display:grid utility, and it pinned
	   the label to the top of the chip. */
	.edit-chip.grid-chip {
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.edit-chip {
		flex: 1 1 0;
		min-width: 0;
		height: 44px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 15px;
		line-height: 1;
		padding: 0 var(--spacing-xs);
		border-radius: var(--radius-sm);
		background: var(--secondary);
		color: var(--muted-foreground);
		border: 1px solid var(--line);
		cursor: pointer;
	}
	.edit-chip.active {
		background: color-mix(in oklab, var(--phosphor) 25%, transparent);
		color: var(--foreground);
		border-color: var(--phosphor);
	}
	.edit-chip.delete {
		color: color-mix(in srgb, var(--act-rec), var(--muted-foreground) 30%);
	}
	.edit-chip:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.waveform {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}

	.loop-region {
		position: absolute;
		top: 0;
		bottom: 0;
		background: var(--phosphor-wash-lo);
		cursor: grab;
		touch-action: none;
		/* Below notes (z 4) so a note tap inside the loop selects the
		   note. The loop is still movable via empty space inside the
		   window and via the brace edge handles (z 6). */
		z-index: 1;
	}
	.loop-region.enabled {
		background: var(--phosphor-wash);
	}
	.loop-region.dragging {
		cursor: grabbing;
		background: color-mix(in oklab, var(--phosphor) 28%, transparent);
		box-shadow: inset 0 0 0 1.5px var(--phosphor);
	}

	/* Draggable edge handle: a thin visible line centered in a wide
	   transparent hit zone so it's findable on touch. */
	.brace-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 22px;
		margin-left: -11px;
		display: flex;
		justify-content: center;
		cursor: ew-resize;
		touch-action: none;
		/* Above notes so the loop start/end edges stay grabbable even
		   when a note sits right at the brace. */
		z-index: 6;
	}
	.brace-line {
		width: 2px;
		height: 100%;
		background: var(--phosphor);
	}
	/* Machined grip cap (notched pill) at the top of each handle (§4.5). */
	.brace-line::before {
		content: '';
		position: absolute;
		top: 0;
		width: 9px;
		height: 9px;
		margin-left: -3.5px;
		border-radius: 2px;
		background: var(--phosphor);
	}
	/* Drag = brighter phosphor; NO glow (GRATICULE bans glows). */
	.brace-handle.dragging .brace-line,
	.brace-handle.dragging .brace-line::before {
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
	   ink with Live's ClipBorder, selection in SelectionBackground, the
	   loop brace grip square, and the toolbar chips as control fields —
	   OFF = ControlBackground + dark frame, ON = solid ChosenDefault with
	   dark text, Delete keeps its red glyph, disabled = the disabled
	   foreground on the same field (never opacity). Nothing here reaches
	   the GRATICULE render. */
	:global([data-grammar="flat"]) .clip-editor {
		--clip-grid-beat: color-mix(in srgb, var(--foreground) 10%, var(--surface-well));
		--clip-grid-bar: color-mix(in srgb, var(--foreground) 24%, var(--surface-well));
		border: 1px solid var(--line-strong);
	}
	:global([data-grammar="flat"]) .audio-control {
		background: var(--popover); /* DetailViewBackground pad under the slider */
	}
	:global([data-grammar="flat"]) .time-ruler {
		border-bottom-color: var(--line-strong);
	}
	:global([data-grammar="flat"]) .pitch-gutter {
		border-right-color: var(--line-strong);
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
	/* Notes: solid ink, ClipBorder frame; selected = SelectionBackground
	   frame (inner border + 1px outline stands in for the white ring). */
	:global([data-grammar="flat"]) .note {
		box-shadow: none;
		border: 1px solid var(--flat-clip-border);
	}
	:global([data-grammar="flat"]) .note.selected {
		box-shadow: none;
		border-color: var(--flat-selection);
		outline: 1px solid var(--flat-selection);
	}
	:global([data-grammar="flat"]) .marquee-box {
		border-color: var(--flat-selection);
		background: color-mix(in srgb, var(--flat-selection) 14%, transparent);
	}
	:global([data-grammar="flat"]) .velocity-lane {
		background: var(--surface-well);
		border-top-color: var(--line-strong);
	}
	:global([data-grammar="flat"]) .vel-bar {
		border-radius: 0;
		box-shadow: none;
		border: 1px solid var(--flat-clip-border);
		border-bottom-width: 0;
	}
	:global([data-grammar="flat"]) .vel-bar.selected {
		box-shadow: none;
		border-color: var(--flat-selection);
		outline: 1px solid var(--flat-selection);
	}
	:global([data-grammar="flat"]) .toolbar-sep {
		background: var(--line-strong);
	}
	:global([data-grammar="flat"]) .edit-chip {
		border-radius: 2px;
		border-color: var(--line-strong);
		background: var(--surface-well);
		color: var(--foreground);
	}
	:global([data-grammar="flat"]) .edit-chip.active {
		background: var(--phosphor);
		border-color: var(--phosphor);
		color: var(--flat-on-fg);
	}
	/* Light: an ON fill sits at ~1:1 luminance against the light ladder, so
	   the frame stays dark for the chip's boundary to survive. */
	:global(.light[data-grammar="flat"]) .edit-chip.active {
		border-color: var(--line-strong);
	}
	:global([data-grammar="flat"]) .edit-chip.delete {
		color: var(--act-rec);
	}
	:global([data-grammar="flat"]) .edit-chip:disabled {
		opacity: 1;
		color: var(--flat-disabled-fg);
	}
	/* Loop window: the flat wash tokens (orange, app.css) still tint the
	   region — a solid fill would hide the notes under it — but the drag
	   state drops its inset ring; the edge handles already mark the brace. */
	:global([data-grammar="flat"]) .loop-region.dragging {
		background: var(--phosphor-wash);
		box-shadow: none;
	}
	:global([data-grammar="flat"]) .brace-line::before {
		border-radius: 0; /* square grip cap */
	}
	:global([data-grammar="flat"]) .marker {
		background: var(--act-warn); /* solid, no alpha */
	}
</style>
