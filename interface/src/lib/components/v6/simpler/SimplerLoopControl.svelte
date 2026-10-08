<script lang="ts">
	/**
	 * SimplerLoopControl - Loop brace control for Simpler sample start/length
	 *
	 * Features:
	 * - Left handle: Sample Start
	 * - Right handle: Visual End (derived from Start + Length in Classic, or End Marker in Slicing)
	 * - Middle drag: Move entire loop region
	 *
	 * Mode-specific behavior:
	 * - Classic mode (PLAYBACK_MODE.CLASSIC): Uses parameters START and LENGTH, 0-1 normalized
	 * - Slicing mode (PLAYBACK_MODE.SLICING): Uses properties sample.start_marker and sample.end_marker (in frames)
	 *   Normalized using sample.length for display
	 */
	import { selectedTrackStore, type DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { CHARTREUSE_SCHEME, type DeviceColorScheme } from '$lib/config/devicePresets';
	import { paintTokens } from '$lib/utils/paintTokens';
	import { paintPeaks } from '$lib/utils/waveformPaint';
	import { drag as dragAction, type DragInfo, type DragOptions } from '$lib/actions/drag';

	// Simpler parameter indices (matching SimplerCentralView)
	const SIMPLER_PARAMS = {
		START: 3,   // Sample start position (0-1)
		LENGTH: 4,  // Sample length (0-1)
		FADE: 7     // Fade amount (0-1)
	} as const;

	// Simpler playback modes
	const PLAYBACK_MODE = {
		CLASSIC: 0,
		SLICING: 2
	} as const;

	interface Props {
		device: DeviceRecord;
		/** PR-3.5.7-impl: v3 path-keyed device id, threaded from the
		 * parent (SimplerCentralView) so this control can read/write the
		 * `sample.*` properties via `/looping/v3/property/*` instead of
		 * the legacy M4L LiveAPI bridge. Optional during the v2/v3
		 * transition; falls back to default values when undefined (cold
		 * start, before state/full lands). */
		devicePath?: string;
		playbackMode?: number; // PLAYBACK_MODE.CLASSIC or PLAYBACK_MODE.SLICING
		color?: DeviceColorScheme;
		/** Slice frame positions from `sample.slices` (Live 11+). Parent
		 * subscribes + JSON-parses; we just render. Empty array when no
		 * sample is loaded, slicing isn't engaged on the LOM yet, or
		 * Live's slice list is empty. Drawn only in Slicing playback
		 * mode — Classic mode ignores them. */
		slices?: number[];
	}

	// Chartreuse — SimplerCentralView's Classic-mode ink (callers always pass
	// the live mode color; this is the no-prop fallback). ADR-400.
	const DEFAULT_COLOR: DeviceColorScheme = CHARTREUSE_SCHEME;

	let { device, devicePath, playbackMode = PLAYBACK_MODE.CLASSIC, color = DEFAULT_COLOR, slices = [] }: Props = $props();

	// Check if we're in slicing mode
	let isSlicing = $derived(playbackMode === PLAYBACK_MODE.SLICING);

	// Classic mode: Read parameters (0-1 normalized)
	let paramStart = $derived(
		selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, SIMPLER_PARAMS.START)) ?? 0
	);
	let paramLength = $derived(
		selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, SIMPLER_PARAMS.LENGTH)) ?? 1
	);
	let paramFade = $derived(
		selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, SIMPLER_PARAMS.FADE)) ?? 0
	);

	// Slicing mode: Read properties (frame-based) via v3 path-keyed API.
	let startMarker = $derived<number>(
		(devicePath ? selectedTrackStore.propertyValue(devicePath, 'sample.start_marker') as number | undefined : undefined) ?? 0
	);
	let endMarker = $derived<number>(
		(devicePath ? selectedTrackStore.propertyValue(devicePath, 'sample.end_marker') as number | undefined : undefined) ?? 0
	);
	let sampleLengthFrames = $derived<number>(
		(devicePath ? selectedTrackStore.propertyValue(devicePath, 'sample.length') as number | undefined : undefined) ?? 1
	);
	let sampleFilePath = $derived<string>(
		(devicePath ? selectedTrackStore.propertyValue(devicePath, 'sample.file_path') as string | undefined : undefined) ?? ''
	);

	// PR-3.5.7-impl: own subscriptions for the four `sample.*` properties
	// this control reads. SimplerCentralView also subscribes to these —
	// the refcount manager idempotently dedupes (refcount → 2, then → 1
	// when one consumer leaves), no second wire subscribe.
	$effect(() => {
		if (!devicePath) return;
		const release = [
			selectedTrackStore.subscribeProperty(devicePath, 'sample.start_marker'),
			selectedTrackStore.subscribeProperty(devicePath, 'sample.end_marker'),
			selectedTrackStore.subscribeProperty(devicePath, 'sample.length'),
			selectedTrackStore.subscribeProperty(devicePath, 'sample.file_path')
		];
		return () => release.forEach((fn) => fn());
	});

	// Unified normalized values (0-1) for display - adapts based on mode
	let sampleStart = $derived(
		isSlicing && sampleLengthFrames > 0
			? startMarker / sampleLengthFrames
			: paramStart
	);

	let sampleLength = $derived(
		isSlicing && sampleLengthFrames > 0
			? (endMarker - startMarker) / sampleLengthFrames
			: paramLength
	);

	// UI state
	let containerRef = $state<HTMLElement | null>(null);
	let canvasRef = $state<HTMLCanvasElement | null>(null);
	let isDragging = $state<'start' | 'end' | 'range' | null>(null);
	let dragStartValues = $state({ start: 0, length: 0 });

	type Peaks = { peaks: [number, number][]; bins: number };
	// Keep the previous waveform visible until a new fetch resolves —
	// avoids flicker on rapid sample swaps.
	let peakData = $state<Peaks | null>(null);

	// Display values (cache updates optimistically)
	let displayStart = $derived(sampleStart);
	let displayLength = $derived(sampleLength);
	let displayEnd = $derived(Math.min(1, displayStart + displayLength));

	// Calculate positions as percentages (0-100%)
	let startPercentage = $derived(displayStart * 100);
	let endPercentage = $derived(displayEnd * 100);
	let widthPercentage = $derived(Math.max(0, endPercentage - startPercentage));

	// Fade ramps mirror Live's overlay: a fade-in triangle outside the
	// loop's leading edge and a fade-out triangle inside the trailing
	// edge, each sized as `fade * loopWidth` so at fade=1.0 the ramps
	// span the full loop width (matching Live's UI). Clamped to the
	// container's left edge — if the start brace is closer to 0 than
	// the requested fade width, both triangles shrink in lockstep so
	// they stay symmetric (asymmetry would misrepresent Live's actual
	// fade behavior, which uses the same time on both sides). Classic
	// mode only; Simpler's Fade doesn't apply in Slicing.
	let fadeWidthPercentage = $derived.by(() => {
		if (isSlicing) return 0;
		const requested = Math.max(0, Math.min(1, paramFade)) * widthPercentage;
		// Fade-in lives in [startPercentage - w, startPercentage]; cap so
		// the left edge never goes negative.
		return Math.min(requested, startPercentage);
	});


	// Set start position - handles both modes
	function setStart(value: number) {
		const clamped = Math.max(0, Math.min(1, value));

		if (isSlicing && sampleLengthFrames > 0) {
			// Slicing mode: convert normalized to frames and set property
			const frameValue = Math.round(clamped * sampleLengthFrames);
			if (devicePath) selectedTrackStore.setPropertyValue(devicePath, 'sample.start_marker', frameValue);
		} else {
			// Classic mode: set parameter directly
			selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, SIMPLER_PARAMS.START), clamped);
		}
	}

	// Live rejects `end_marker >= sample.length` ("Cannot set marker outside
	// of the sample"), so the highest valid frame index is length - 1.
	function clampEndMarkerFrames(frameValue: number): number {
		const maxFrame = Math.max(0, sampleLengthFrames - 1);
		return Math.max(0, Math.min(maxFrame, frameValue));
	}

	// Set end position (or length in Classic mode) - handles both modes
	function setEnd(value: number) {
		const clamped = Math.max(0, Math.min(1, value));

		if (isSlicing && sampleLengthFrames > 0) {
			// Slicing mode: convert normalized to frames and set end_marker property
			const frameValue = clampEndMarkerFrames(Math.round(clamped * sampleLengthFrames));
			if (devicePath) selectedTrackStore.setPropertyValue(devicePath, 'sample.end_marker', frameValue);
		} else {
			// Classic mode: set length parameter
			selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, SIMPLER_PARAMS.LENGTH), clamped);
		}
	}

	// Wrapper for setting length in classic mode or adjusting end in slicing mode
	function setLength(value: number) {
		const clamped = Math.max(0, Math.min(1, value));

		if (isSlicing && sampleLengthFrames > 0) {
			// Slicing mode: length = end - start, so end = start + length
			const newEnd = sampleStart + clamped;
			const frameValue = clampEndMarkerFrames(Math.round(Math.min(1, newEnd) * sampleLengthFrames));
			if (devicePath) selectedTrackStore.setPropertyValue(devicePath, 'sample.end_marker', frameValue);
		} else {
			// Classic mode: set length parameter directly
			selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, SIMPLER_PARAMS.LENGTH), clamped);
		}
	}

	// Convert screen position to normalized value (0-1)
	function screenToNormalized(screenX: number): number {
		if (!containerRef) return 0;

		const rect = containerRef.getBoundingClientRect();
		const percentage = (screenX - rect.left) / rect.width;

		return Math.max(0, Math.min(1, percentage));
	}

	/**
	 * The three brace drags (ADR-427).
	 *
	 * Horizontal here rather than vertical — this is a waveform — but the
	 * bug was the same one: `event.touches[0].clientX` is *the first finger
	 * on the glass*, not the finger that started this drag. Trimming a
	 * sample while the other hand held anything made the brace follow the
	 * other hand.
	 *
	 * `commit: 'immediate'` because a brace handle has no tap meaning to
	 * disambiguate from: the whole control is the value. The hand-rolled
	 * `activeDragHandlers` / `detachActiveDragHandlers` pair this replaces
	 * was the correct implementation of document-drag bookkeeping — it is
	 * what `documentDrag.ts` was lifted from — and it is gone because the
	 * action owns its own teardown, not because it was wrong.
	 */
	/**
	 * Which brace a press grabs, decided from where it landed rather than
	 * from which element sits under the finger. The whole track is one
	 * drag surface: a press within `BRACE_GRAB_PX` of a brace line takes
	 * that brace — the nearer one when both are in reach, so close braces
	 * split the gap instead of End always winning — and a press elsewhere
	 * inside the loop moves the range. At the sample's edges, where the
	 * braces sit by default, only the inside half of the zone exists, so
	 * the reach is sized for that half to clear a 44px touch target.
	 * Inside the loop a brace reaches at most a third of the loop's width,
	 * so a narrow loop keeps its middle third for moving the range.
	 */
	const BRACE_GRAB_PX = 48;
	function hitTest(clientX: number): 'start' | 'end' | 'range' | null {
		if (!containerRef) return null;
		const rect = containerRef.getBoundingClientRect();
		const x = clientX - rect.left;
		const startX = displayStart * rect.width;
		const endX = displayEnd * rect.width;
		const inside = x > startX && x < endX;
		const reach = inside ? Math.min(BRACE_GRAB_PX, (endX - startX) / 3) : BRACE_GRAB_PX;
		const toStart = Math.abs(x - startX);
		const toEnd = Math.abs(x - endX);
		if (Math.min(toStart, toEnd) <= reach) {
			if (toStart === toEnd) return x <= startX ? 'start' : 'end';
			return toStart < toEnd ? 'start' : 'end';
		}
		return inside ? 'range' : null;
	}

	function braceDrag(): DragOptions {
		return {
			commit: 'immediate',
			touchAction: 'none',
			stopPropagation: true,
			onStart: ({ downX }: DragInfo) => {
				isDragging = hitTest(downX);
				dragStartValues = { start: sampleStart, length: sampleLength };
			},
			onMove: ({ dx }: DragInfo) => applyDrag(dx),
			onEnd: () => {
				isDragging = null;
			}
		};
	}

	/** `deltaX` is pixels travelled RIGHT from the press point. */
	function applyDrag(deltaX: number) {
		if (!isDragging || !containerRef) return;

		const rect = containerRef.getBoundingClientRect();
		const deltaNormalized = deltaX / rect.width;

		let newStart = sampleStart;
		let newLength = sampleLength;

		if (isDragging === 'start') {
			// Drag left handle - adjust Start, recalculate Length to keep right handle stationary
			const oldEnd = dragStartValues.start + dragStartValues.length;
			newStart = Math.max(0, Math.min(oldEnd - 0.01, dragStartValues.start + deltaNormalized));
			newLength = oldEnd - newStart;
		} else if (isDragging === 'end') {
			// Drag right handle - adjust Length (Start stays constant)
			const oldEnd = dragStartValues.start + dragStartValues.length;
			const newEnd = Math.max(dragStartValues.start + 0.01, Math.min(1, oldEnd + deltaNormalized));
			newLength = newEnd - dragStartValues.start;
		} else if (isDragging === 'range') {
			// Drag middle - move Start, keep Length constant
			newStart = Math.max(0, Math.min(1 - dragStartValues.length, dragStartValues.start + deltaNormalized));
			newLength = dragStartValues.length; // Length stays constant
		}

		// Send updates (cache updates optimistically, with small threshold to avoid spam)
		if (isDragging === 'start' || isDragging === 'range') {
			if (Math.abs(newStart - sampleStart) >= 0.001) {
				setStart(newStart);
			}
		}
		if (isDragging === 'end' || isDragging === 'start') {
			if (Math.abs(newLength - sampleLength) >= 0.001) {
				setLength(newLength);
			}
		}
	}

	const trackDrag: DragOptions = braceDrag();

	// Fetch waveform peaks when the loaded sample's path changes. Empty
	// path → no fetch (Simpler with no sample). Routed through
	// `clipWaveformService` (ADR-360) so the prod-path Vite trap on
	// `/api/sample-peaks` has a single audit point shared with the
	// track-strip TrackClipView (which fetches at bins=256). The
	// service handles AbortController cancellation + cross-component
	// LRU caching internally.
	$effect(() => {
		const path = sampleFilePath;
		if (!path) {
			peakData = null;
			return;
		}
		let cancelled = false;
		import('$lib/services/clipWaveformService').then(
			({ getPeaks, cancelPeaks }) => {
				if (cancelled) return;
				getPeaks(path, 1024).then((data) => {
					if (cancelled) return;
					peakData = data;
				});
				return () => {
					cancelled = true;
					cancelPeaks(path, 1024);
				};
			}
		);
		return () => {
			cancelled = true;
		};
	});

	// Draw peaks. Re-runs on peak/slices/loop-edge/color change and
	// container resize. Inside-loop bins paint the mode ink; outside-loop
	// bins (and slice lines) paint grey so the active loop region
	// reads at a glance even when the brace handles are tucked under
	// the user's finger. The CSS dim overlays underneath the canvas
	// (see template) still wash the background — the canvas's own
	// in/out coloring is what actually carries the in-loop signal,
	// since the waveform sits above those overlays.
	//
	// Out-of-loop grey comes from `paintTokens().SIMPLER_LOOP_OUT` — the
	// skin- and theme-aware canvas twin of --signal-dim (§2.11), read once
	// per draw (pure getter, no reactive dependency).

	$effect(() => {
		const canvas = canvasRef;
		if (!canvas) return;
		const data = peakData;
		const WAVEFORM_COLOR_OUT = paintTokens().SIMPLER_LOOP_OUT;

		const container = containerRef;
		if (!container) return;

		const dpr = window.devicePixelRatio || 1;
		const w = container.clientWidth;
		const h = container.clientHeight;
		if (w === 0 || h === 0) return;

		const targetW = Math.round(w * dpr);
		const targetH = Math.round(h * dpr);
		if (canvas.width !== targetW) canvas.width = targetW;
		if (canvas.height !== targetH) canvas.height = targetH;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Loop region as canvas-space x bounds. `displayStart`/`displayEnd`
		// are normalized (0-1) and follow whichever mode is active, so a
		// single calculation handles Classic + Slicing.
		const loopStartX = displayStart * canvas.width;
		const loopEndX = displayEnd * canvas.width;

		if (data && data.peaks.length > 0) {
			// The whole sample, always: Simpler's markers are already fractions
			// of it, so span and view are both the unit interval. Same painter
			// as the clip views (`waveformPaint`), keeping this view's linear
			// amplitude rather than their perceptual curve.
			const whole = { start: 0, end: 1 };
			paintPeaks(ctx, data.peaks, canvas.width, canvas.height, {
				span: whole,
				view: whole,
				amplitude: 'linear',
				headroom: 0.92,
				ink: (x0, x1) => {
					const binCenterX = (x0 + x1) / 2;
					return binCenterX >= loopStartX && binCenterX <= loopEndX
						? color.primary
						: WAVEFORM_COLOR_OUT;
				}
			});
		}

		// Slice lines (Slicing mode only). One thin vertical tick per
		// frame position from `sample.slices`. Frame 0 is the implicit
		// "first slice starts at the sample head"; rendering it would
		// just paint over the left edge, so we skip values <= 0. Lines
		// inside the loop region take the mode-tinted accent (active
		// slices); lines outside grey out so the loop range reads.
		if (isSlicing && slices.length > 0 && sampleLengthFrames > 0) {
			const lineWidth = Math.max(1, Math.round(dpr));
			for (let i = 0; i < slices.length; i++) {
				const frame = slices[i];
				if (frame <= 0 || frame >= sampleLengthFrames) continue;
				const x = Math.floor((frame / sampleLengthFrames) * canvas.width);
				ctx.fillStyle = x >= loopStartX && x <= loopEndX
					? color.accent
					: WAVEFORM_COLOR_OUT;
				ctx.fillRect(x, 0, lineWidth, canvas.height);
			}
		}
	});

	// Container resize → redraw. Tracked separately so the draw effect
	// above doesn't need to take a width/height dep that would force it
	// to read DOM measurements every reactive tick.
	$effect(() => {
		const container = containerRef;
		if (!container) return;
		const ro = new ResizeObserver(() => {
			// Touch a $state to trigger the draw effect.
			peakData = peakData ? { ...peakData } : null;
		});
		ro.observe(container);
		return () => ro.disconnect();
	});

	// Format percentage for display
	function formatPercent(value: number): string {
		return `${Math.round(value * 100)}%`;
	}

	// Keyboard step size for accessibility
	const KEYBOARD_STEP = 0.01;
	const KEYBOARD_LARGE_STEP = 0.1;

	// Keyboard handler for start handle
	function handleStartKeydown(event: KeyboardEvent) {
		const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
		switch (event.key) {
			case 'ArrowLeft':
				event.preventDefault();
				setStart(sampleStart - step);
				break;
			case 'ArrowRight':
				event.preventDefault();
				setStart(Math.min(sampleStart + sampleLength - 0.01, sampleStart + step));
				break;
		}
	}

	// Keyboard handler for end handle
	function handleEndKeydown(event: KeyboardEvent) {
		const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
		const currentEnd = sampleStart + sampleLength;
		switch (event.key) {
			case 'ArrowLeft':
				event.preventDefault();
				setLength(Math.max(0.01, sampleLength - step));
				break;
			case 'ArrowRight':
				event.preventDefault();
				setLength(Math.min(1 - sampleStart, sampleLength + step));
				break;
		}
	}

	// Keyboard handler for range (moves both start and end together)
	function handleRangeKeydown(event: KeyboardEvent) {
		const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
		switch (event.key) {
			case 'ArrowLeft':
				event.preventDefault();
				if (sampleStart - step >= 0) {
					setStart(sampleStart - step);
				}
				break;
			case 'ArrowRight':
				event.preventDefault();
				if (sampleStart + sampleLength + step <= 1) {
					setStart(sampleStart + step);
				}
				break;
		}
	}
</script>

<div class="w-full h-full flex items-center">
	<!-- Loop Range Track: the one drag surface for both braces and the
	     range (`hitTest` picks which). The region and handle divs below
	     are paint and keyboard focus only. -->
	<div
		bind:this={containerRef}
		class="loop-track relative w-full h-full bg-muted rounded-lg select-none transition-all duration-200 overflow-hidden"
		class:cursor-ew-resize={isDragging === 'start' || isDragging === 'end'}
		class:cursor-grabbing={isDragging === 'range'}
		style="touch-action: none; --loop-ink: {color.primary};"
		use:dragAction={trackDrag}
		role="slider"
		tabindex={0}
		aria-label="Sample loop range"
		aria-valuemin={0}
		aria-valuemax={1}
		aria-valuenow={displayStart}
		aria-valuetext="Start {Math.round(displayStart * 100)}%, length {Math.round(displayLength * 100)}%"
	>
		<!-- Outside-loop dim overlays. Each is a full-width div positioned
		     with transform-only updates so brace drags stay on the GPU
		     compositor (no layout, no paint). Left dim: scaled to match
		     loop start, anchored left. Right dim: anchored right and
		     scaled to the remaining space. Both anchor to the container
		     edge (no translateX %, which was % of own width and bled
		     past the container into the next grid column). -->
		<div
			class="loop-dim absolute inset-y-0 left-0 w-full pointer-events-none bg-muted/70 rounded-l-lg origin-left"
			style="transform: scaleX({startPercentage / 100});"
			aria-hidden="true"
		></div>
		<div
			class="loop-dim absolute inset-y-0 right-0 w-full pointer-events-none bg-muted/70 rounded-r-lg origin-right"
			style="transform: scaleX({(100 - endPercentage) / 100});"
			aria-hidden="true"
		></div>

		<!-- Fade ramps (Classic only). Each triangle is a full-width div
		     with a fixed clip-path, then transformed into place. Updates
		     are transform-only — compositor-cheap, no layout or repaint.
		     fadeWidthPercentage is shared and pre-clamped so both shrink
		     together if the start brace is too close to 0. -->
		{#if !isSlicing && fadeWidthPercentage > 0}
			<!-- Fade-in: low at left edge, full at the start brace.
			     clip-path: lower-right wedge. -->
			<div
				class="absolute inset-y-0 left-0 w-full pointer-events-none origin-left"
				style="background-color: var(--scrim); clip-path: polygon(0 100%, 100% 0, 100% 100%); transform: translateX({startPercentage - fadeWidthPercentage}%) scaleX({fadeWidthPercentage / 100});"
				aria-hidden="true"
			></div>
			<!-- Fade-out: full at left edge, low at the end brace.
			     clip-path: upper-right wedge. -->
			<div
				class="absolute inset-y-0 left-0 w-full pointer-events-none origin-left"
				style="background-color: var(--scrim); clip-path: polygon(0 0, 100% 0, 100% 100%); transform: translateX({endPercentage - fadeWidthPercentage}%) scaleX({fadeWidthPercentage / 100});"
				aria-hidden="true"
			></div>
		{/if}

		<!-- Active loop region. Drops transitions during drag (otherwise
		     `left`/`width` animate on every move, causing visible lag).
		     Sits BELOW the canvas so the orange waveform reads at full
		     brightness over the green tint. -->
		<div
			class="loop-region absolute inset-y-0 rounded-md shadow-lg border-2 pointer-events-none"
			class:is-dragging={isDragging === 'range'}
			style="left: {startPercentage}%; width: {widthPercentage}%;"
			onkeydown={handleRangeKeydown}
			role="slider"
			tabindex={0}
			aria-label="Loop range (use arrow keys to move)"
			aria-valuemin={0}
			aria-valuemax={1}
			aria-valuenow={sampleStart}
		></div>

		<!-- Waveform render — stacked above the dim overlays and loop fill
		     so the orange peaks read at full brightness regardless of
		     where the brace sits. Pointer events disabled so the loop
		     region underneath still receives drags. -->
		<canvas
			bind:this={canvasRef}
			class="absolute inset-0 w-full h-full pointer-events-none rounded-lg"
		></canvas>

		<!-- Start handle: the brace line plus a grip tab. Focusable for
		     the arrow keys; touches go to the track's `hitTest`. -->
		<div
			class="absolute inset-y-0 w-12 -ml-6 flex items-center justify-center pointer-events-none"
			style="left: {startPercentage}%;"
			onkeydown={handleStartKeydown}
			role="slider"
			tabindex={0}
			aria-label="Loop start (use arrow keys to adjust)"
			aria-valuemin={0}
			aria-valuemax={displayEnd}
			aria-valuenow={displayStart}
		>
			<div
				class="loop-handle-line w-0.5 h-full pointer-events-none"
				class:is-dragging={isDragging === 'start'}
			></div>
			<!-- Grip tab, on the inside of the brace so the track's edge
			     never clips it. -->
			<div
				class="loop-handle-grip absolute top-1/2 -translate-y-1/2 left-1/2 w-2 h-10 pointer-events-none"
				class:is-dragging={isDragging === 'start'}
			></div>
		</div>

		<!-- End handle. Same pattern as start, tab on the left. -->
		<div
			class="absolute inset-y-0 w-12 -ml-6 flex items-center justify-center pointer-events-none"
			style="left: {endPercentage}%;"
			onkeydown={handleEndKeydown}
			role="slider"
			tabindex={0}
			aria-label="Loop end (use arrow keys to adjust)"
			aria-valuemin={displayStart}
			aria-valuemax={1}
			aria-valuenow={displayEnd}
		>
			<div
				class="loop-handle-line w-0.5 h-full pointer-events-none"
				class:is-dragging={isDragging === 'end'}
			></div>
			<!-- Grip tab, on the inside of the brace so the track's edge
			     never clips it. -->
			<div
				class="loop-handle-grip absolute top-1/2 -translate-y-1/2 right-1/2 w-2 h-10 pointer-events-none"
				class:is-dragging={isDragging === 'end'}
			></div>
		</div>
	</div>
</div>

<style>
	/* Brace frame chrome (GRATICULE) — the ink border + top-light that used
	   to sit inline on the track, lifted onto a class so the flat grammar
	   below can re-skin it by class rather than `!important`. `--loop-ink`
	   is set on the track from the `color` prop and inherits to the region
	   and handles. Values are unchanged. */
	.loop-track {
		border: 2px solid var(--loop-ink);
		box-shadow: var(--shadow-glass-sm), inset 0 1px 0 color-mix(in srgb, white, transparent 90%);
	}

	/* Loop region wash + bracket and the handle lines, in the same ink.
	   `is-dragging` on the region = the whole range is being dragged; on a
	   handle line = that brace is. */
	.loop-region {
		background-color: color-mix(in srgb, var(--loop-ink) 25%, transparent);
		border-color: color-mix(in srgb, var(--loop-ink) 50%, transparent);
	}
	.loop-region.is-dragging {
		background-color: color-mix(in srgb, var(--loop-ink) 60%, transparent);
	}
	.loop-handle-line {
		background-color: color-mix(in srgb, var(--loop-ink) 85%, transparent);
	}
	.loop-handle-line.is-dragging {
		background-color: var(--loop-ink);
	}
	.loop-handle-grip {
		background-color: color-mix(in srgb, var(--loop-ink) 85%, transparent);
		border-radius: 2px;
	}
	.loop-handle-grip.is-dragging {
		background-color: var(--loop-ink);
	}

	/* ---- Live skin (flat grammar) ------------------------------------
	   Simpler's sample display is a flat ControlBackground well in a 1px
	   dark frame — no ink border, no top-light, square corners. Live dims
	   the sample beyond Start/End rather than tinting the loop, so the
	   out-of-loop overlays become the background-alpha scrim and the loop
	   region itself is a bare 1px bracket in the ink (a faint ink wash only
	   while the whole range is being dragged); the handle lines are solid
	   ink. Fade ramps already read var(--scrim) inline (same value as the
	   old rgba(0,0,0,.45) under GRATICULE; background-alpha here). The
	   waveform + slice ticks are canvas paint via paintTokens() and the
	   skin-aware track ink, so nothing here touches them. */
	:global([data-grammar="flat"]) .loop-track {
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-well);
		box-shadow: none;
	}
	:global([data-grammar="flat"]) .loop-dim {
		background: var(--scrim);
	}
	:global([data-grammar="flat"]) .loop-region {
		border-radius: var(--radius-sm);
		border-width: 1px;
		box-shadow: none;
		background-color: transparent; /* ink wash */
		border-color: var(--loop-ink);  /* 50% ink */
	}
	:global([data-grammar="flat"]) .loop-region.is-dragging {
		background-color: color-mix(in srgb, var(--loop-ink) 18%, transparent);
	}
	:global([data-grammar="flat"]) .loop-handle-line,
	:global([data-grammar="flat"]) .loop-handle-line.is-dragging,
	:global([data-grammar="flat"]) .loop-handle-grip,
	:global([data-grammar="flat"]) .loop-handle-grip.is-dragging {
		background-color: var(--loop-ink); /* 85% ink */
	}
</style>
