<script lang="ts">
	/**
	 * ClipPreview — the shared clip-content renderer (ADR-360, ADR-415).
	 *
	 * Draws one clip: an audio waveform or MIDI note lanes, sliced to
	 * the active loop window, with an optional playhead. It is the
	 * single implementation behind BOTH the track strip's clip third
	 * (`TrackClipView`) and every cell of the session clip grid
	 * (`SlotCell`) — the two differ only in where their data comes
	 * from, not in how a clip is drawn.
	 *
	 * **Source-agnostic on purpose.** It takes plain primitives, never a
	 * `PlayingClipEntry`. The strip has such an entry; a grid cell for a
	 * slot that has never played does not — its sample path comes from
	 * `clipSampleService` and its length from the C record. Taking
	 * primitives is what lets one renderer serve both, and it is also
	 * what keeps the canvas effect off the 30 Hz playhead path: an entry
	 * reference changes every tick, whereas these fields change only on
	 * slot/loop edits, so Svelte's `===` memoization has something
	 * stable to hold.
	 *
	 * `fraction` is the one prop that DOES change at 30 Hz. It drives a
	 * single `left:` write on the playhead element and nothing else.
	 * Pass `showPlayhead={false}` (the default for a non-playing cell)
	 * to omit it entirely.
	 */

	import { getPeaks, type PeakData } from '$lib/services/clipWaveformService';
	import TrackClipMidiView from './TrackClipMidiView.svelte';
	import { paintTokens } from '$lib/utils/paintTokens';
	import { clipViewWindow, paintPeaks, peakSpan } from '$lib/utils/waveformPaint';
	import { reportBoundaryError } from '$lib/utils/clientWatchdog';

	interface Props {
		/** Audio → waveform; otherwise MIDI note lanes. */
		isAudio: boolean;
		/** Sample path, audio only. Empty renders nothing (a recording
		 *  still flushing to disk reports no path yet). */
		filePath?: string;
		/** Clip path, MIDI only — notes are pulled by path. */
		clipPath?: string;
		lengthBeats: number;
		loopStartBeats?: number;
		loopEndBeats?: number;
		looping?: boolean;
		/**
		 * Where the audio file sits in the clip's own time — the span its
		 * peaks cover (`playing_slot` / `clip/sample`). `0, 0` = unknown,
		 * and the file is then assumed to span `[0, lengthBeats]`.
		 */
		fileStartBeats?: number;
		fileEndBeats?: number;
		/** 0 idle / 1 playing / 2 recording. */
		status?: number;
		/** Playhead position, 0..1. Changes at 30 Hz — nothing else does. */
		fraction?: number;
		showPlayhead?: boolean;
		/** Waveform resolution. The strip uses 256; a grid cell is far
		 *  narrower, so it asks for fewer and shares the peaks cache. */
		bins?: number;
		/** Draw the loop-window wash behind the content. */
		showLoopBand?: boolean;
		color?: string;
		dimmed?: boolean;
	}

	let {
		isAudio,
		filePath = '',
		clipPath = '',
		lengthBeats,
		loopStartBeats = 0,
		loopEndBeats = 0,
		looping = false,
		fileStartBeats = 0,
		fileEndBeats = 0,
		status = 0,
		fraction = 0,
		showPlayhead = false,
		bins = 256,
		showLoopBand = true,
		color,
		dimmed = false
	}: Props = $props();

	let peakData = $state<PeakData | null>(null);
	let canvasRef = $state<HTMLCanvasElement | null>(null);
	let containerRef = $state<HTMLElement | null>(null);

	let isRecording = $derived(status === 2);
	let wavFilePath = $derived(filePath);
	let wavLengthBeats = $derived(lengthBeats);
	let wavLoopStart = $derived(loopStartBeats);
	let wavLoopEnd = $derived(loopEndBeats);
	let wavLooping = $derived(looping);
	let wavFileStart = $derived(fileStartBeats);
	let wavFileEnd = $derived(fileEndBeats);
	// Audio path: fetch peaks when the file_path changes, and refetch
	// (cache-bypass) when length or the file's end changes for the same
	// path — that's the signal that an in-progress recording finalized
	// into a longer file, so the cached partial peaks need to be
	// replaced. Reads primitives only so 30 Hz playhead rewrites don't
	// re-trigger the fetch.
	let peaksFetchKey = $derived(`${wavFilePath}::${wavLengthBeats}::${wavFileEnd}`);
	// Plain `let`, deliberately NOT `$state`: this is a previous-value
	// memo read and written inside the one effect that uses it. As
	// `$state` it made that effect a dependency of itself, so every key
	// change ran the body twice (the first run's teardown cancelling the
	// first fetch). Same pattern as `editorWasActive` in +page.svelte.
	let lastPeaksFetchKey: string | null = null;
	$effect(() => {
		if (!isAudio) {
			peakData = null;
			lastPeaksFetchKey = null;
			return;
		}
		const path = wavFilePath;
		if (!path) {
			peakData = null;
			lastPeaksFetchKey = null;
			return;
		}
		const key = peaksFetchKey;
		// Force-refresh when only the length or file end changed (same
		// path) — cached partial peaks from an in-progress recording
		// would otherwise stick.
		const force =
			lastPeaksFetchKey !== null &&
			lastPeaksFetchKey !== key &&
			lastPeaksFetchKey.startsWith(path + '::');
		lastPeaksFetchKey = key;

		let cancelled = false;
		getPeaks(path, bins, { force }).then((data) => {
			if (cancelled) return;
			peakData = data;
		});
		return () => {
			cancelled = true;
		};
	});

	// Box size, as a tracked signal.
	//
	// The draw effect below reads `clientWidth`/`clientHeight`, which are
	// plain DOM reads — nothing invalidates on a resize. That was fine
	// when the strip's fixed third was the only consumer, but a grid cell
	// is sized from `--session-row-h`, which the panel remeasures whenever
	// the transport header, layout mode, window or scene count changes.
	// Without this the canvas keeps its old backing store and CSS stretches
	// the stale raster; worse, a cell that first measured 0 (inserted
	// before layout) would bail once and stay blank for its whole life.
	let boxW = $state(0);
	let boxH = $state(0);

	$effect(() => {
		const container = containerRef;
		if (!container || typeof ResizeObserver === 'undefined') return;
		const measure = () => {
			boxW = container.clientWidth;
			boxH = container.clientHeight;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(container);
		return () => ro.disconnect();
	});

	// Canvas draw: peaks placed by time under the visible window.
	// Reads only stable primitives + `peakData` + styling props; never
	// reads `entry` directly. Re-runs only on slot/loop/looping/style
	// changes and on resize, not at the 30 Hz playhead rate.
	$effect(() => {
		const canvas = canvasRef;
		const container = containerRef;
		if (!canvas || !container || !isAudio) return;

		// Track the stable inputs explicitly so Svelte's reactivity
		// graph re-runs only when these change.
		const lengthBeats = wavLengthBeats;
		const loopStart = wavLoopStart;
		const loopEnd = wavLoopEnd;
		const fileStart = wavFileStart;
		const fileEnd = wavFileEnd;
		const recordingStyle = isRecording;
		const dimmedStyle = dimmed;
		const colorStyle = color;
		const data = peakData;

		const dpr = window.devicePixelRatio || 1;
		// Track the observed size so a resize re-runs this effect; fall
		// back to a live read for the first frame, before the observer
		// has reported.
		const w = boxW || container.clientWidth;
		const h = boxH || container.clientHeight;
		if (w === 0 || h === 0) return;
		const targetW = Math.round(w * dpr);
		const targetH = Math.round(h * dpr);
		if (canvas.width !== targetW) canvas.width = targetW;
		if (canvas.height !== targetH) canvas.height = targetH;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		if (!data || !data.peaks.length) return;

		// GRATICULE canvas inks (§2.11 / §4.3): plain module getter, never a
		// reactive store read inside this 30Hz-adjacent draw effect. fillStyle
		// stays a canvas-compatible string (hex), never var().
		const pt = paintTokens();
		const ink = recordingStyle
			? pt.RECORDING_RED
			: dimmedStyle
				? pt.DIM_GREY
				: (colorStyle ?? pt.EDITOR_ACCENT);
		paintPeaks(ctx, data.peaks, canvas.width, canvas.height, {
			span: peakSpan(fileStart, fileEnd, lengthBeats),
			view: clipViewWindow({
				loopStartBeats: loopStart,
				loopEndBeats: loopEnd,
				lengthBeats,
				fileStartBeats: fileStart,
				fileEndBeats: fileEnd
			}),
			amplitude: 'perceptual',
			headroom: 0.9,
			ink: () => ink
		});
	});

</script>

<div
	class="clip-preview"
	class:recording={isRecording}
	class:dimmed
	bind:this={containerRef}
>
	<!-- Containment, not decoration (ADR-419). An error thrown while
	     rendering a clip preview escapes Svelte's `flush_effects` and
	     leaves the effect scheduler wedged: `queued_root_effects`,
	     `current_batch` and the root effect's CLEAN bit are never
	     restored, so every later `schedule_effect()` bails against a
	     queue nothing drains. Reactivity then dies APP-WIDE — meters,
	     playheads, every panel — while DOM handlers keep firing, so the
	     UI looks frozen but faders still reach Live. A duplicate `{#each}`
	     key in one drum clip did exactly that.
	     This boundary keeps such a failure to the one strip that caused
	     it. A dead preview is a cosmetic loss; a dead scheduler ends the
	     performance. -->
	<svelte:boundary onerror={(error) => reportBoundaryError('ClipPreview', error)}>
		{#if isAudio}
			{#if wavLooping && showLoopBand}
				<!-- Loop band (§4.5) — static ink-wash behind the waveform,
				     gestural rate only (recomputed on loop edits, never 30Hz). -->
				<div class="loop-band" aria-hidden="true"></div>
			{/if}
			<canvas bind:this={canvasRef} class="waveform"></canvas>
		{:else if clipPath}
			<TrackClipMidiView
				{clipPath}
				lengthBeats={wavLengthBeats}
				loopStartBeats={wavLoopStart}
				loopEndBeats={wavLoopEnd}
				looping={wavLooping}
				{status}
				{fraction}
				{showPlayhead}
				{color}
				{dimmed}
			/>
		{/if}

		{#snippet failed()}
			<!-- Render nothing. The strip keeps its size, colour and
			     controls; only the preview graphic is missing. -->
			<div class="preview-failed" aria-hidden="true"></div>
		{/snippet}
	</svelte:boundary>
	{#if showPlayhead && isAudio}
		<div class="strip-playhead" style="left: {fraction * 100}%;" aria-hidden="true"></div>
	{/if}
</div>

<style>
	.preview-failed {
		width: 100%;
		height: 100%;
	}

	.clip-preview {
		position: relative;
		display: block;
		height: 100%;
		width: 100%;
		overflow: hidden;
	}

	.waveform {
		width: 100%;
		height: 100%;
		display: block;
		border-radius: var(--radius-sm);
		background: transparent;
	}

	/* Loop band (§4.5) — faint track-ink wash + 1px ink edges framing the
	   loop window. Static; sits behind the transparent waveform canvas. */
	.loop-band {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: color-mix(in oklab, var(--track-color) 8%, transparent);
		border-left: 1px solid color-mix(in oklab, var(--track-color) 55%, transparent);
		border-right: 1px solid color-mix(in oklab, var(--track-color) 55%, transparent);
		border-radius: var(--radius-sm);
	}

	/* ---- Flat grammar (Live / Hybrid skins, ui-architecture §8.1) ------
	   No colour washes: the loop band keeps its two 1px ink edges (the
	   window read) but drops the 8% track-ink fill behind the waveform.
	   The canvas itself already paints through paintTokens() (skin-aware). */
	:global([data-grammar="flat"]) .loop-band {
		background: transparent;
		border-radius: 2px;
	}
</style>
