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
	import { selectedDrumRack } from '$lib/services/deviceViewRouter.svelte';
	import { parseVmMembers, padTileLabels, VM } from '$lib/services/drumVirtualMacros';
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
	import {
		setClipLoopStart,
		setClipLoopEnd,
		moveWarpMarker,
		addWarpMarker,
		removeWarpMarker
	} from '$lib/services/clipCommands';
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
	import { getTransients } from '$lib/services/clipTransientsService';
	import { logger } from '$lib/utils/logger';

	interface Props {
		/** Track color for note/waveform tinting. */
		color?: string;
	}

	let { color }: Props = $props();

	const CENTRAL_BINS = 1024;
	const PITCH_AXIS_W = 36; // piano-key gutter width (px)
	const DRUM_PITCH_AXIS_W = 80; // wide enough for a pad's name
	const TIME_AXIS_H = 18; // bar/beat ruler height (px)
	const VELOCITY_LANE_H = 56; // velocity-lane strip height (px, MIDI only)
	const TOOLBAR_W = 96; // MIDI edit-toolbar column beside the roll (px), so the roll keeps the full height

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
	// ── Drum Rack pad names for the gutter ───────────────────────────
	// A clip on a Drum Rack track names its lanes after the pads, with the
	// labels the pad grid wears (`padTileLabels`: the kit's shared words
	// dropped). Only when the focused clip is on the selected track, whose
	// instrument `selectedDrumRack` reads.
	let drumRackPath = $derived.by(() => {
		if (!isMidi || focusedTrackPath !== selectedTrackStore.selectedTrackPath) return undefined;
		return selectedDrumRack()?.rackPath;
	});
	$effect(() => {
		if (!drumRackPath) return;
		return selectedTrackStore.subscribeProperty(drumRackPath, VM.members);
	});
	let padLabels = $derived.by((): Map<number, string> => {
		const out = new Map<number, string>();
		if (!drumRackPath) return out;
		const census = parseVmMembers(selectedTrackStore.propertyValue(drumRackPath, VM.members));
		for (const [note, text] of padTileLabels(census?.pads ?? [])) if (text.label) out.set(note, text.label);
		return out;
	});
	let pitchAxisW = $derived(padLabels.size > 0 ? DRUM_PITCH_AXIS_W : PITCH_AXIS_W);

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

	// ── Warp markers (audio, warped) ─────────────────────────────────
	// Live's markers for the focused clip, or the drag's own picture of
	// them from the finger's first move until the surface echoes the move.
	let optimisticMarkers = $state.raw<WarpMarker[] | null>(null);
	let displayMarkers = $derived(optimisticMarkers ?? clipPropertiesStore.warpMarkers);
	let shownWarpMarkers = $derived(isAudio ? shownMarkers(displayMarkers) : []);
	// Where each point of the file lands in clip beats, through the
	// markers, so the waveform stretches between them as Live plays it.
	// Undefined (evenly across the file's span) when unwarped or unknown.
	let warpPlace = $derived.by(() => {
		const shown = shownWarpMarkers;
		const seconds = clipPropertiesStore.warpFileSeconds;
		if (shown.length < 2 || !(seconds > 0)) return undefined;
		return (fraction: number) => secToBeat(shown, fraction * seconds) ?? 0;
	});

	// The file's transients (seconds) — Live's own from its `.asd`, else the
	// server's detector — drawn as ticks on the ruler and snapped to by a
	// double-tap there. Only for a warped clip: an unwarped one has no
	// markers to add to.
	let transientSecs = $state.raw<number[]>([]);
	$effect(() => {
		const path = isAudio && clipPropertiesStore.warpMarkers.length > 0 ? wavFilePath : '';
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
		const axisW = pitchAxisW;
		const ro = new ResizeObserver(() => {
			contentW = Math.max(0, el.clientWidth - axisW);
			contentH = Math.max(0, el.clientHeight - TIME_AXIS_H - reserve);
			containerH = el.clientHeight;
		});
		ro.observe(el);
		contentW = Math.max(0, el.clientWidth - axisW);
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
		const place = warpPlace;
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
			place,
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

	let transientTicks = $derived.by(() => {
		const shown = shownWarpMarkers;
		if (shown.length < 2 || contentW <= 0) return [];
		const out: number[] = [];
		for (const sec of transientSecs) {
			const beat = secToBeat(shown, sec);
			if (beat === null || beat < beatWindow.startBeats || beat > beatWindow.endBeats) continue;
			out.push(beatToX(beat, beatWindow, contentW));
		}
		return out;
	});

	let warpHandles = $derived(
		shownWarpMarkers
			.map((m, index) => ({ index, beat: m.beat, x: beatToX(m.beat, beatWindow, contentW) }))
			.filter((h) => h.x >= -12 && h.x <= contentW + 12)
	);

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
			? contentLocal(e.clientX, e.clientY, rect, pitchAxisW, TIME_AXIS_H).x
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

	// ── Warp marker drag ─────────────────────────────────────────────
	// A marker's grip at the foot of the waveform drags its BEAT; its
	// audio point stays (Live's move_warp_marker). Snapped to a 16th and
	// held between its neighbors. Drawn optimistically while the finger
	// moves; ONE move goes to Live on release (one undo step), and the
	// picture holds until the surface's echo replaces it.
	const WARP_GRID_BEATS = 0.25;
	const WARP_MIN_GAP_BEATS = 1 / 64;
	const WARP_ECHO_TIMEOUT_MS = 2000;
	let warpDragIndex = $state<number | null>(null);
	let warpDragStartClientX = 0;
	let warpDragFromBeat = 0;
	let warpDragTo = 0;
	let warpDragShown: WarpMarker[] = [];
	let warpDragAll: WarpMarker[] = [];
	let warpEchoAfter = $state<number | null>(null);
	let warpEchoTimer: ReturnType<typeof setTimeout> | null = null;

	function startWarpDrag(event: PointerEvent, index: number) {
		if (!hasClip || contentW <= 0) return;
		if (event.cancelable) event.preventDefault();
		event.stopPropagation();
		if (gripDoubleTapped(index)) return;
		warpDragAll = clipPropertiesStore.warpMarkers;
		warpDragShown = shownMarkers(warpDragAll);
		const marker = warpDragShown[index];
		if (!marker) return;
		warpDragIndex = index;
		warpDragStartClientX = event.clientX;
		warpDragFromBeat = marker.beat;
		warpDragTo = marker.beat;
		warpEchoAfter = null;
		beginGesture(onWarpDragMove, onWarpDragEnd);
	}

	function onWarpDragMove(event: PointerEvent) {
		if (warpDragIndex === null || contentW <= 0) return;
		if (event.cancelable) event.preventDefault();
		const delta = clientDeltaToBeatDelta(event.clientX - warpDragStartClientX, contentW, beatWindow);
		warpDragTo = dragTarget(
			warpDragShown,
			warpDragIndex,
			warpDragFromBeat + delta,
			WARP_GRID_BEATS,
			WARP_MIN_GAP_BEATS
		);
		optimisticMarkers = moveMarker(warpDragAll, warpDragFromBeat, warpDragTo);
	}

	function onWarpDragEnd() {
		const index = warpDragIndex;
		warpDragIndex = null;
		const distance = warpDragTo - warpDragFromBeat;
		if (clipPath === null || Math.abs(distance) < 1e-6) {
			optimisticMarkers = null;
			noteGripTap(index);
			return;
		}
		lastGripTap = null;
		const path = clipPath;
		sendWarpEdit(() => moveWarpMarker(path, warpDragFromBeat, distance), optimisticMarkers);
	}

	/**
	 * Send one marker edit and draw `picture` until the surface's
	 * `warp_markers` echo replaces it. A surface that never answers (one
	 * Live has not restarted into) must not leave a marker drawn where
	 * Live does not have it, so the picture also lapses on a timer.
	 */
	function sendWarpEdit(write: () => void, picture: WarpMarker[] | null) {
		optimisticMarkers = picture;
		warpEchoAfter = clipPropertiesStore.warpMarkersVersion;
		write();
		if (warpEchoTimer) clearTimeout(warpEchoTimer);
		warpEchoTimer = setTimeout(() => {
			warpEchoTimer = null;
			if (warpDragIndex === null) {
				optimisticMarkers = null;
				warpEchoAfter = null;
			}
		}, WARP_ECHO_TIMEOUT_MS);
	}

	// ── Double-tap a grip: remove that marker ────────────────────────
	// The first tap is a drag that never moved; a second landing on the
	// same marker within DOUBLE_TAP_MS removes it instead of dragging.
	// Live's first and last drawn markers stay (Live's UI keeps them too).
	let lastGripTap: { beat: number; at: number } | null = null;

	function noteGripTap(index: number | null) {
		const marker = index === null ? undefined : warpDragShown[index];
		lastGripTap = marker ? { beat: marker.beat, at: performance.now() } : null;
	}

	function gripDoubleTapped(index: number): boolean {
		const marker = shownWarpMarkers[index];
		const prev = lastGripTap;
		lastGripTap = null;
		if (!marker || !prev || performance.now() - prev.at > DOUBLE_TAP_MS) return false;
		if (Math.abs(prev.beat - marker.beat) > 1e-9 || clipPath === null) return false;
		if (canRemove(shownWarpMarkers, index)) {
			const path = clipPath;
			sendWarpEdit(
				() => removeWarpMarker(path, marker.beat),
				withoutMarker(clipPropertiesStore.warpMarkers, marker.beat)
			);
		}
		return true;
	}

	// ── Double-tap the ruler: add a marker at the nearest transient ──
	const TRANSIENT_SNAP_BEATS = 0.125;
	let lastRulerTap: { x: number; at: number } | null = null;

	function handleRulerPointerDown(e: PointerEvent) {
		if (!isAudio || shownWarpMarkers.length < 2 || clipPath === null || contentW <= 0) return;
		const x = e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left;
		const now = performance.now();
		const prev = lastRulerTap;
		if (!prev || now - prev.at > DOUBLE_TAP_MS || Math.abs(prev.x - x) > DOUBLE_TAP_PX) {
			lastRulerTap = { x, at: now };
			return;
		}
		lastRulerTap = null;
		const target = addTarget(
			shownWarpMarkers,
			transientSecs,
			xToBeat(x, beatWindow, contentW),
			TRANSIENT_SNAP_BEATS,
			WARP_MIN_GAP_BEATS
		);
		if (!target) return;
		const path = clipPath;
		sendWarpEdit(
			() => addWarpMarker(path, target.sec, target.beat),
			insertMarker(clipPropertiesStore.warpMarkers, target)
		);
	}

	// The echo landed: Live's own markers take over.
	$effect(() => {
		const version = clipPropertiesStore.warpMarkersVersion;
		if (warpEchoAfter === null || version <= warpEchoAfter) return;
		warpEchoAfter = null;
		optimisticMarkers = null;
	});
	// A new clip drops any picture of the old one's markers.
	$effect(() => {
		void clipPath;
		optimisticMarkers = null;
		warpEchoAfter = null;
	});
	onDestroy(() => {
		if (warpEchoTimer) clearTimeout(warpEchoTimer);
	});

	function commitLoop(range: LoopRange, prev: LoopRange): void {
		if (clipPath === null) return;
		// Only emit edges that actually moved (avoids a redundant
		// start-marker side-effect write when only the end moved).
		if (Math.abs(range.start - prev.start) >= 1e-3) {
			setClipLoopStart(clipPath, range.start);
		}
		if (Math.abs(range.end - prev.end) >= 1e-3) {
			setClipLoopEnd(clipPath, range.end);
		}
	}

	// ── MIDI note editing (M4) ───────────────────────────────────────
	// One mode, no selection (the user's call, 2026-10-07: a selection
	// needs Shift/⌘ the iPad doesn't have, and the Select/Draw toggle was
	// a mode to keep track of mid-set). A tap on empty grid draws a note
	// (drag right to set its length); a drag on a note moves it (pitch +
	// time) or, from its right edge, resizes it; a DOUBLE-tap on a note
	// erases it, so a near-miss single tap can't delete one. Quantize acts
	// on the whole clip.
	// Optimistic-apply to focusedNotesStore, emit the write, reconcile on
	// the surface's notes/changed re-pull (own-write echo suppressed —
	// see the notes effect above + clipRichNotesService.markLocalWrite).

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
	// Drag state for a note move/resize gesture: the grabbed note and its
	// pre-drag geometry.
	type NoteDragKind = 'move' | 'resize';
	let noteDrag = $state<{
		kind: NoteDragKind;
		noteId: number;
		startClientX: number;
		startClientY: number;
		startBeats: number;
		startPitch: number;
		startDuration: number;
		moved: boolean;
	} | null>(null);

	// Double-tap a note: erase it. The first tap is a drag that never
	// moved; a second on the same note within DOUBLE_TAP_MS removes it.
	let lastNoteTap: { noteId: number; at: number } | null = null;

	function gridBeatsForSnap(): number {
		// The UI-chosen snap grid (toolbar selector), in beats.
		return gridBeats;
	}

	// --- gesture document-listener lifecycle ─────────────────────────
	// Every drag gesture (note/brace/velocity/draw) attaches
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

		// Decide move vs resize from where in the note it was grabbed.
		const noteX = beatToX(note.startBeats, beatWindow, contentW);
		const noteEndX = beatToX(note.startBeats + note.durationBeats, beatWindow, contentW);
		const localX = noteEventLocalX(event);
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
			moved: false
		};

		beginGesture(onNoteDragMove, onNoteDragEnd);
	}

	function noteEventLocalX(e: PointerEvent): number {
		const rect = containerRef?.getBoundingClientRect();
		if (!rect) return 0;
		return contentLocal(e.clientX, e.clientY, rect, pitchAxisW, TIME_AXIS_H).x;
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
			const snappedDur = Math.max(grid, snapToGrid(noteDrag.startDuration + deltaBeats, grid));
			focusedNotesStore.optimisticModify(noteDrag.noteId, { durationBeats: snappedDur });
		} else {
			// Negate: dragging down (larger clientY) lowers pitch.
			// Folded, the delta counts shown lanes and `shiftPitch` steps
			// to a neighbouring shown pitch.
			const deltaPitch = -clientDeltaToPitchDelta(event.clientY - noteDrag.startClientY, contentH, viewPitchWindow);
			focusedNotesStore.optimisticModify(noteDrag.noteId, {
				startBeats: Math.max(0, snapToGrid(noteDrag.startBeats + deltaBeats, grid)),
				pitch: shiftPitch(noteDrag.startPitch, deltaPitch, viewPitchWindow)
			});
		}
	}

	function onNoteDragEnd() {
		const drag = noteDrag;
		noteDrag = null;
		heldFoldLanes = null;
		if (drag === null || clipPath === null) return;
		if (!drag.moved) {
			const prev = lastNoteTap;
			const now = performance.now();
			if (prev && prev.noteId === drag.noteId && now - prev.at <= DOUBLE_TAP_MS) {
				lastNoteTap = null;
				deleteNote(drag.noteId);
			} else {
				lastNoteTap = { noteId: drag.noteId, at: now };
			}
			return;
		}
		lastNoteTap = null;
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
		sendRemoveNotes(clipPath, [noteId]);
	}

	// Draw-on-empty-grid. Pointerdown mints a temp note at the
	// grid cell; DRAGGING right extends its duration (snapped, ≥ one cell);
	// pointerup commits the add with the final length. A plain tap (no
	// drag) commits a one-cell note. The wire send is deferred to
	// pointerup so a drag produces a single add at the chosen length.
	let drawNote = $state<{ tempId: number; startBeats: number; pitch: number } | null>(null);

	function handleGridTap(event: PointerEvent) {
		if (!isMidi || clipPath === null || contentW <= 0) return;
		const rect = containerRef?.getBoundingClientRect();
		if (!rect) return;
		const { x: localX, y: localY } = contentLocal(event.clientX, event.clientY, rect, pitchAxisW, TIME_AXIS_H);
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
		drawNote = { tempId, startBeats, pitch };

		beginGesture(onDrawDragMove, commitDrawNote);
	}

	function onDrawDragMove(event: PointerEvent) {
		if (drawNote === null || contentW <= 0) return;
		if (event.cancelable) event.preventDefault();
		const rect = containerRef?.getBoundingClientRect();
		if (!rect) return;
		const localX = contentLocal(event.clientX, event.clientY, rect, pitchAxisW, TIME_AXIS_H).x;
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
	// quantize is client-side: snap every note's start in the clip to the
	// grid and batch-modify. No new wire.
	function quantizeClip() {
		if (clipPath === null) return;
		const grid = gridBeatsForSnap();
		const specs = [];
		for (const n of notes) {
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

	// --- velocity lane (M5, plan decision 9) ─────────────────────────
	// A strip under the roll, one bar per visible note (height ∝ velocity).
	// Vertical drag on a bar sets that note's velocity. Pitch-drag (on the roll) and
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
		velDrag = { ids: [noteId] };
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
				class:warp-ruler={isAudio && shownWarpMarkers.length >= 2}
				style="left: {pitchAxisW}px; height: {TIME_AXIS_H}px;"
				onpointerdown={handleRulerPointerDown}
			>
				{#each transientTicks as x, i (i)}
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
				<div class="pitch-gutter" style="top: {TIME_AXIS_H}px; width: {pitchAxisW}px;">
					{#each pitchLanes as lane (lane.pitch)}
						<div
							class="key"
							class:black={lane.black}
							style="top: {lane.y}px; height: {lane.h}px;"
						>
							{#if padLabels.has(lane.pitch)}<span class="key-label pad-label">{padLabels.get(lane.pitch)}</span>
							{:else if folded || lane.pitch % 12 === 0}<span class="key-label">{pitchName(lane.pitch)}</span>{/if}
						</div>
					{/each}
				</div>
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
					{#if notesLoadState === 'loading' && notes.length === 0}
						<div class="state-msg overlay">Loading notes…</div>
					{:else}
						{#each visibleNotes as note (note.key)}
							<div
								class="note"
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
					<!-- Warp markers: a line through the waveform and a grip at
					     its head and its foot, the grips alone taking the finger
					     so the rest of the canvas still pans. -->
					{#each warpHandles as handle (handle.index)}
						<div
							class="warp-marker"
							class:dragging={warpDragIndex === handle.index}
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
									onpointerdown={(e) => startWarpDrag(e, handle.index)}
								></div>
							{/each}
						</div>
					{/each}
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
					style="left: {pitchAxisW}px; height: {VELOCITY_LANE_H}px; width: {contentW}px;"
				>
					{#each velBars as bar (bar.noteId)}
						<div
							class="vel-bar"
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

		<!-- MIDI edit toolbar: a column beside the roll, so the roll takes
		     the full height. Own pointer surface, outside the pan/zoom canvas. -->
		{#if isMidi}
			<div class="edit-toolbar" style:width="{TOOLBAR_W}px">
				<button
					class="edit-chip"
					class:active={fold}
					onclick={() => (fold = !fold)}
					title="Fold: show only the pitches this clip plays"
				>
					Fold
				</button>

				<span class="toolbar-sep"></span>

				<!-- Snap grid selector (M5 polish): cycles 1/4·1/8·1/16·1/32
				     and a triplet toggle. Drives snap, draw length, quantize
				     and the visible gridlines. -->
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
				>
					Triplet
				</button>

				<span class="toolbar-sep"></span>

				<button
					class="edit-chip"
					disabled={notes.length === 0}
					onclick={quantizeClip}
					title="Quantize every note in the clip to the grid"
				>
					Quantize
				</button>
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
	.pad-label {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
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
	   loop-region (1) < draw-catcher (2) < note (4)
	   < brace-handle (6) < playhead (7).
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
	/* Its own column beside the roll (the canvas stops TOOLBAR_W short of
	   the right edge), so the roll keeps the full height. Chips stack at a
	   44 px touch floor and share the height. The top is padded clear of
	   ClipCentralView's editor-toggle chip, which floats over this corner. */
	.edit-toolbar {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		display: flex;
		flex-direction: column;
		flex-wrap: nowrap;
		gap: var(--spacing-xs);
		padding: 32px 0 0 8px;
		z-index: 20;
		pointer-events: none; /* chips opt back in; gaps pass through */
	}
	.edit-toolbar > * {
		pointer-events: auto;
	}
	.toolbar-sep {
		height: 1px;
		flex: none;
		margin: 3px 0;
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
		min-height: 44px;
		max-height: 72px;
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
		left: -14px;
		width: 28px;
		height: 36px;
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
		left: 9px;
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
	/* Notes: solid ink, ClipBorder frame. */
	:global([data-grammar="flat"]) .note {
		box-shadow: none;
		border: 1px solid var(--flat-clip-border);
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
