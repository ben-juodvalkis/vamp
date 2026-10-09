<script lang="ts">
	import { untrack } from 'svelte';
	import { logger } from '$lib/utils/logger';
	/**
	 * VerticalLoopControl - Vertical clip loop control for 120px sidebar
	 *
	 * Features:
	 * - Tracks detail_clip from session store
	 * - Direct OSC communication for clip properties
	 * - Draggable handles for loop start/end (vertical orientation)
	 * - Snaps to bars, or to half / quarter bars on a clip of 4 / 2 bars or less
	 * - Touch-friendly controls for iPad
	 * - Uses requestAnimationFrame-based throttling for smooth response
	 */
	import { session, requireFocusedClip } from '$lib/stores/session.svelte';
	import { clipPropertiesStore } from '$lib/stores/v6/clipPropertiesStore.svelte';
	import { setClipLoopStart, setClipLoopEnd } from '$lib/services/clipCommands';
	import { clipDisplayCoordinator } from '$lib/services/clipDisplayCoordinator.svelte';
	import { drag as dragAction, type DragInfo, type DragOptions } from '$lib/actions/drag';
	import { createSliderThrottle } from '$lib/utils/sliderThrottle';
	import { loopBraceGridBeats, recordingBars, snapToGrid } from '$lib/utils/clip/clipGesture';
	import { playingClipsStore } from '$lib/stores/v6/playingClipsStore.svelte';

	// Constants
	const MIN_LOOP_LENGTH_BEATS = 0.001;

	// Use store values with $derived for automatic reactivity
	let loopStart = $derived(clipPropertiesStore.loopStart);
	let loopEnd = $derived(clipPropertiesStore.loopEnd);
	let endMarker = $derived(clipPropertiesStore.endMarker);

	// PR-5e1: gate rendering on Python-surface focused clip path
	// rather than legacy M4L detailClipIndices (which requires the
	// liveAPI-v6.js outlet that currently crashes on
	// selectedClipChanged — tracked for Phase 6 removal).
	let hasClip = $derived(session.hasFocusedClipPath);

	// UI state
	let containerRef = $state<HTMLElement | null>(null);
	let isDragging = $state<'start' | 'end' | 'range' | null>(null);
	let dragStartValues = $state({ start: 0, end: 0 });
	let optimisticValues = $state<{ start: number; end: number } | null>(null);

	// Get time signature for quantization
	let beatsPerBar = $derived(session.timeSignature.numerator || 4);

	// Use optimistic values during drag, otherwise use actual values
	// Clamp to end_marker to prevent UI overflow during recording (when loop_end can be huge)
	let displayStart = $derived(Math.min(optimisticValues?.start ?? loopStart, endMarker));
	let displayEnd = $derived(Math.min(optimisticValues?.end ?? loopEnd, endMarker));

	// Calculate positions as percentages (inverted for vertical: 0 at bottom, max at top)
	// The track represents the full clip from 0 to endMarker
	let totalRange = $derived(endMarker);
	// Snap grid: a bar, finer on a short clip (`loopBraceGridBeats` has the rule)
	let gridBeats = $derived(loopBraceGridBeats(totalRange, beatsPerBar));
	// For vertical: startPercentage is distance from BOTTOM
	let startPercentage = $derived.by(() => {
		return totalRange > 0 ? (displayStart / totalRange) * 100 : 0;
	});
	let endPercentage = $derived.by(() => {
		return totalRange > 0 ? (displayEnd / totalRange) * 100 : 100;
	});

	// Format beat values as bars (integer when whole, decimal when fractional)
	function formatBeats(beats: number): string {
		const bars = beats / beatsPerBar;
		if (Number.isInteger(bars)) {
			return bars.toString();
		}
		return parseFloat(bars.toFixed(2)).toString();
	}

	// Record-mirror (§4.5): while the selected track records, the brace is one
	// solid red block and the readout counts the take's bars as they pass.
	// Free data off the playhead channel (status 0/1/2 and position), no new wire.
	let focusedTrackPath = $derived(
		session.selectedTrackIndex >= 0 ? `tracks/${session.selectedTrackIndex}` : null
	);
	let isRecording = $derived(
		focusedTrackPath ? playingClipsStore.liveStatus(focusedTrackPath) === 2 : false
	);

	// The furthest the playhead has reached this take. A take's own loop
	// points mean nothing until it closes, so the length comes from the
	// playhead; the maximum holds an overdub, whose position wraps, at its
	// loop length rather than dropping back to 1 each pass.
	let recordedBeats = $state(0);
	$effect(() => {
		if (!isRecording || !focusedTrackPath) {
			recordedBeats = 0;
			return;
		}
		const pos = playingClipsStore.position(focusedTrackPath);
		if (pos > untrack(() => recordedBeats)) recordedBeats = pos;
	});

	let lengthLabel = $derived(
		isRecording
			? String(recordingBars(recordedBeats, beatsPerBar))
			: formatBeats(displayEnd - displayStart)
	);

	// Check if the center of the component (50%) falls within the loop region
	// Used to adapt the text color for readability
	let centerIsInsideLoop = $derived(startPercentage <= 50 && endPercentage >= 50);

	let regionBg = $derived(
		isDragging === 'range'
			? 'color-mix(in oklab, var(--act-loop) 28%, transparent)'
			: 'var(--act-loop-wash)'
	);

	// Send loop parameter changes to the Python Control Surface.
	// The v3 set/loop_start handler also writes start_marker = loop_start
	// as a server-side side-effect (mirrors the legacy M4L behavior), so
	// the UI only needs to send loop_start.
	function setLoopStart(value: number) {
		const clipPath = requireFocusedClip();
		if (!clipPath) return;

		if (import.meta.env.DEV) {
			logger.debug(`Setting loop_start to ${value}`, { component: 'VerticalLoopControl' });
		}
		setClipLoopStart(clipPath, value);
	}

	function setLoopEnd(value: number) {
		const clipPath = requireFocusedClip();
		if (!clipPath) return;

		if (import.meta.env.DEV) {
			logger.debug(`Setting loop_end to ${value}`, { component: 'VerticalLoopControl' });
		}
		setClipLoopEnd(clipPath, value);
	}

	// Frame-synchronized throttle for smooth loop start updates
	const startThrottle = createSliderThrottle((value: number) => {
		setLoopStart(value);
	});

	// Frame-synchronized throttle for smooth loop end updates
	const endThrottle = createSliderThrottle((value: number) => {
		setLoopEnd(value);
	});

	/**
	 * The brace drags (ADR-427).
	 *
	 * All four entry points — the two handles, the region between them, and
	 * the dead zone outside it — are the same gesture with a different
	 * starting decision, so they share one applier and differ only in what
	 * `onStart` captures.
	 *
	 * They used to read `event.touches[0].clientY`, which is *the first
	 * finger on the glass*, not the finger that started this drag. Holding
	 * anything at all with the other hand did not merely make the brace
	 * ignore the second finger — it made the brace follow it. That is a
	 * wrong VALUE written to Live, silently, which is why this tier ranked
	 * above the dead controls even though it is touched less often.
	 *
	 * `commit: 'immediate'`, so the value tracks from touch-down with no
	 * threshold: this control has no tap/drag ambiguity to resolve by
	 * travel, and a 12px dead zone at the head of every gesture would snap
	 * a bar late. Tap-vs-drag is instead "did any move arrive at all",
	 * exactly as the `hasMoved` flag this replaces decided it.
	 */
	let dragMoved = false;

	/** Open the throttles this drag will write through. */
	function armThrottles(type: 'start' | 'end' | 'range') {
		if (type === 'start' || type === 'range') startThrottle.start();
		if (type === 'end' || type === 'range') endThrottle.start();
	}

	function beginDrag(type: 'start' | 'end' | 'range') {
		isDragging = type;
		dragMoved = false;
		dragStartValues = { start: loopStart, end: loopEnd };
		armThrottles(type);
	}

	/** `deltaY` is pixels travelled UP from the press point. */
	function applyDrag(deltaY: number) {
		if (!isDragging || !containerRef) return;
		dragMoved = true;

		const rect = containerRef.getBoundingClientRect();
		const deltaBeats = (deltaY / rect.height) * totalRange;

		let newStart = loopStart;
		let newEnd = loopEnd;

		if (isDragging === 'start') {
			// Drag bottom handle - constrained between 0 and current loop_end
			newStart = Math.max(0, Math.min(loopEnd - MIN_LOOP_LENGTH_BEATS, dragStartValues.start + deltaBeats));
		} else if (isDragging === 'end') {
			// Drag top handle - constrained between loop_start and end_marker
			newEnd = Math.max(loopStart + MIN_LOOP_LENGTH_BEATS, Math.min(endMarker, dragStartValues.end + deltaBeats));
		} else if (isDragging === 'range') {
			// Drag middle - move both handles together within 0 to end_marker
			const loopLength = dragStartValues.end - dragStartValues.start;
			newStart = Math.max(0, Math.min(endMarker - loopLength, dragStartValues.start + deltaBeats));
			newEnd = newStart + loopLength;
		}

		// Apply quantized snapping
		const quantizedStart = snapToGrid(newStart, gridBeats);
		const quantizedEnd = snapToGrid(newEnd, gridBeats);

		// Update optimistic values for immediate feedback
		optimisticValues = {
			start: quantizedStart,
			end: quantizedEnd
		};

		// Queue updates via throttle for frame-synchronized sending
		if (isDragging === 'start' || isDragging === 'range') {
			if (Math.abs(quantizedStart - loopStart) >= MIN_LOOP_LENGTH_BEATS) {
				startThrottle.push(quantizedStart);
			}
		}
		if (isDragging === 'end' || isDragging === 'range') {
			if (Math.abs(quantizedEnd - loopEnd) >= MIN_LOOP_LENGTH_BEATS) {
				endThrottle.push(quantizedEnd);
			}
		}
	}

	function finishDrag() {
		// Flush any pending values immediately
		startThrottle.flush();
		endThrottle.flush();

		// Commit optimistic values into the store before clearing so the
		// display doesn't snap back to the pre-echo value while waiting for
		// Ableton's confirmation. The echo will land and write the same value.
		if (optimisticValues) {
			clipPropertiesStore.handleLoopStart(optimisticValues.start);
			clipPropertiesStore.handleLoopEnd(optimisticValues.end);
		}

		// A press that never moved is a tap: show the clip controls.
		// Deliberately NOT on a cancelled or torn-down press — the browser
		// claiming the gesture, or the rail unmounting, is not a tap.
		if (!dragMoved) clipDisplayCoordinator.showCurrentClip();

		isDragging = null;
		optimisticValues = null;
	}

	/** A handle or the region: the type is fixed, the capture is the same. */
	function braceDrag(type: 'start' | 'end' | 'range'): DragOptions {
		return {
			commit: 'immediate',
			touchAction: 'none',
			stopPropagation: true,
			disabled: !hasClip || isRecording,
			onStart: () => beginDrag(type),
			onMove: ({ dy }: DragInfo) => applyDrag(dy),
			onEnd: ({ reason }) => {
				if (reason === 'up') finishDrag();
				else {
					// Cancelled or unmounted: drop the optimistic display
					// and the throttles without committing anything. The
					// performer never finished the gesture.
					startThrottle.cancel();
					endThrottle.cancel();
					isDragging = null;
					optimisticValues = null;
				}
			}
		};
	}

	/**
	 * The dead zone outside the loop region. Pressing below it controls the
	 * start handle, above it the end handle; movement is relative, so the
	 * handle moves by the drag distance rather than jumping to the finger.
	 */
	const deadZoneDrag: DragOptions = $derived({
		...braceDrag('start'),
		onStart: ({ downY }: DragInfo) => {
			if (!containerRef) return;
			const rect = containerRef.getBoundingClientRect();
			const tapBeat = ((rect.bottom - downY) / rect.height) * totalRange;
			// Which handle the press is asking for.
			const handleToMove: 'start' | 'end' =
				tapBeat < loopStart
					? 'start'
					: tapBeat > loopEnd
						? 'end'
						: // Inside the region shouldn't reach here (the region
							// has its own drag) — decide by distance if it does.
							tapBeat - loopStart < loopEnd - tapBeat
							? 'start'
							: 'end';
			beginDrag(handleToMove);
		}
	});

	const regionDrag: DragOptions = $derived(braceDrag('range'));
	const startHandleDrag: DragOptions = $derived(braceDrag('start'));
	const endHandleDrag: DragOptions = $derived(braceDrag('end'));
</script>

<div class="w-full h-full flex flex-col" style="gap: var(--spacing-xs);">
	<!-- Loop Range Track (Vertical) -->
	<div
		bind:this={containerRef}
		class="relative w-full flex-1 rounded-lg select-none transition-colors duration-100 loop-container"
		style="overflow: hidden; z-index: 10;"
		class:cursor-ns-resize={hasClip}
		class:cursor-not-allowed={!hasClip}
		class:opacity-30={!hasClip && !isRecording}
		class:recording={isRecording}
		use:dragAction={deadZoneDrag}
		role="application"
		aria-label="Loop range controls. Tap to show clip, or drag: above loop moves end, below moves start"
		aria-disabled={!hasClip}
	>
		{#if isRecording}
			<!-- Recording: the whole lane is the take, its bar count growing. -->
			<span
				class="absolute inset-0 flex items-center justify-center font-bold num pointer-events-none select-none z-[200] loop-length-display inside-loop"
				style="--len-chars: {lengthLabel.length};"
			>
				{lengthLabel}
			</span>
			<div class="absolute inset-0 loop-region recording" aria-hidden="true"></div>
		{:else if hasClip}
			<!-- Loop length display - centered on entire component, color adapts to background -->
			<span
				class="absolute inset-0 flex items-center justify-center font-bold num pointer-events-none select-none z-[200] loop-length-display"
				class:inside-loop={centerIsInsideLoop}
				class:outside-loop={!centerIsInsideLoop}
				style="--len-chars: {lengthLabel.length};"
			>
				{lengthLabel}
			</span>

			<!-- Active loop region (vertical: bottom = start, top = end) -->
			<div
				class="absolute inset-x-0 rounded-md border loop-region"
				class:cursor-grab={hasClip}
				class:cursor-grabbing={isDragging === 'range'}
				class:dragging={isDragging !== null}
				style="--loop-region-bg: {regionBg}; --loop-region-line: var(--act-loop-line); bottom: {startPercentage}%; height: {Math.max(0, endPercentage - startPercentage)}%; z-index: 50;"
				use:dragAction={regionDrag}
				role="button"
				tabindex="-1"
				aria-label="Drag to move loop range"
			></div>

			<!-- Start handle (bottom) - large touch target -->
			<div
				class="absolute inset-x-0 h-16 loop-handle"
				class:cursor-ns-resize={hasClip}
				class:dragging={isDragging !== null}
				style="bottom: {startPercentage}%; z-index: 100;"
				use:dragAction={startHandleDrag}
				role="slider"
				tabindex={0}
				aria-label="Loop start"
				aria-orientation="vertical"
				aria-valuemin={0}
				aria-valuemax={displayEnd}
				aria-valuenow={displayStart}
			>
				<!-- Visual handle bar at bottom edge -->
				<div
					class="absolute bottom-0 inset-x-1 rounded-t-lg loop-handle-bar"
					class:dragging={isDragging !== null}
					class:h-8={!isDragging || isDragging !== 'start'}
					class:h-10={isDragging === 'start'}
				>
					<!-- Grip lines indicator -->
					<div class="absolute inset-x-2 top-1/2 -translate-y-1/2 flex flex-col gap-1 items-center justify-center pointer-events-none">
						<div class="w-12 h-1 bg-black/30 rounded-full loop-grip"></div>
						<div class="w-8 h-1 bg-black/30 rounded-full loop-grip"></div>
					</div>
				</div>
			</div>

			<!-- End handle (top) - large touch target -->
			<div
				class="absolute inset-x-0 h-16 loop-handle"
				class:cursor-ns-resize={hasClip}
				class:dragging={isDragging !== null}
				style="bottom: {endPercentage}%; z-index: 100; transform: translateY(100%);"
				use:dragAction={endHandleDrag}
				role="slider"
				tabindex={0}
				aria-label="Loop end"
				aria-orientation="vertical"
				aria-valuemin={displayStart}
				aria-valuemax={endMarker}
				aria-valuenow={displayEnd}
			>
				<!-- Visual handle bar at top edge -->
				<div
					class="absolute top-0 inset-x-1 rounded-b-lg loop-handle-bar"
					class:dragging={isDragging !== null}
					class:h-8={!isDragging || isDragging !== 'end'}
					class:h-10={isDragging === 'end'}
				>
					<!-- Grip lines indicator -->
					<div class="absolute inset-x-2 top-1/2 -translate-y-1/2 flex flex-col gap-1 items-center justify-center pointer-events-none">
						<div class="w-8 h-1 bg-black/30 rounded-full loop-grip"></div>
						<div class="w-12 h-1 bg-black/30 rounded-full loop-grip"></div>
					</div>
				</div>
			</div>
		{:else}
			<!-- No clip selected state - empty label -->
		{/if}
	</div>
</div>

<style>
	/* Lane = recessed well + act-loop hairline (§4.5). */
	.loop-container {
		background: var(--surface-well);
		border: 1px solid var(--act-loop-line);
		/* The length readout sizes off this lane's width (`cqw`). */
		container-type: inline-size;
	}

	/* Loop length display — mono numeral; contrast-flip logic kept verbatim
	   (dark text inside the bright region, act-loop outside), NO glow/shadow.
	   Sized to fit the lane: 3.75rem numerals hold three characters in the
	   120px sidebar, and a quarter-bar loop reads four ("1.25"), which was
	   cut off at both ends — so a longer label shrinks by its character
	   count. 0.6em is a mono numeral's advance (SF Mono, Menlo). */
	.loop-length-display {
		font-size: min(3.75rem, calc((100cqw - 0.5rem) / (var(--len-chars) * 0.6)));
		line-height: 1;
		transition: color 0.15s ease-out;
	}

	.loop-length-display.inside-loop {
		color: var(--background);
	}

	.loop-length-display.outside-loop {
		color: var(--act-loop);
	}

	/* Recording: the lane is one solid red block, the count in dark ink. */
	.loop-container.recording {
		border-color: var(--act-rec);
	}
	.loop-region.recording {
		background-color: var(--act-rec);
		border: none;
	}
	.loop-container.recording .loop-length-display.inside-loop {
		color: var(--flat-on-fg, var(--background));
	}

	/* Transitions enabled by default, disabled during drag. The background-color
	   transition carries the record-mirror crossfade (act-loop → act-rec). */
	.loop-region {
		background-color: var(--loop-region-bg);
		border-color: var(--loop-region-line);
		transition: bottom 0.1s ease-out, height 0.1s ease-out,
			background-color var(--t-standard) var(--ease-settle),
			border-color var(--t-standard) var(--ease-settle);
	}

	.loop-handle {
		transition: bottom 0.1s ease-out;
	}

	.loop-handle-bar {
		background-color: var(--act-loop-handle);
		transition: height 0.1s ease-out;
	}

	/* Disable transitions during active dragging for instant response */
	.loop-region.dragging,
	.loop-handle.dragging,
	.loop-handle-bar.dragging {
		transition: none;
	}

	/* Flat grammar: Live's loop brace is a solid LoopColor grey bar on a
	   ControlBackground lane — no orange frame, no translucent region.
	   The region/handle colours are class-owned (--loop-region-* lifted off
	   the inline style), so these override by specificity alone. */
	:global([data-grammar="flat"]) .loop-container {
		border: 1px solid var(--line-strong);
		border-radius: 2px;
	}
	:global([data-grammar="flat"]) .loop-region {
		background-color: var(--secondary);   /* SurfaceHighlight */
		border: 1px solid #919191;            /* LoopColor */
		border-radius: 0;
	}
	:global([data-grammar="flat"]) .loop-container.recording {
		border-color: var(--act-rec);
	}
	:global([data-grammar="flat"]) .loop-region.recording {
		background-color: var(--act-rec);
		border: none;
	}
	:global([data-grammar="flat"]) .loop-container.recording .loop-length-display {
		color: var(--flat-on-fg);
	}
	:global([data-grammar="flat"]) .loop-handle-bar {
		background-color: var(--flat-handle);
		border-radius: 0;
	}
	:global([data-grammar="flat"]) .loop-length-display.inside-loop,
	:global([data-grammar="flat"]) .loop-length-display.outside-loop {
		color: var(--foreground);
	}
	/* Flat-grammar leftovers (cookbook §8.1): the grip lines on the handle
	   bars are Tailwind bg-black/30 pills — a black-alpha literal on a grey
	   grip; under flat they take the background-alpha scrim and go square
	   (Graticule keeps its 0.30 black — the scrim token is 0.45 there, so
	   this cannot be an all-skins tokenisation). The bar numeral drops from
	   font-bold (700) to medium, and the no-clip lane stops dimming by
	   opacity — an empty control lane IS Live's "nothing here" (its sibling
	   quantize lane never dims either). */
	:global([data-grammar="flat"]) .loop-grip {
		background-color: var(--scrim);
		border-radius: 0;
	}
	:global([data-grammar="flat"]) .loop-length-display {
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .loop-container.opacity-30 {
		opacity: 1;
	}
</style>
