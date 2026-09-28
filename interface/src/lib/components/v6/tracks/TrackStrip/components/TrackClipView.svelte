<script lang="ts">
	/**
	 * TrackClipView — ADR-360.
	 *
	 * The track strip's clip third: the playing (or display-fallback)
	 * clip, with a live playhead.
	 *
	 * Since ADR-415 this is a thin **adapter**, not a renderer. Drawing
	 * lives in `ClipPreview`, which the session clip grid's cells use
	 * too — one implementation of "draw a clip", two places that need
	 * one. All this component does is turn a `playingClipsStore` entry
	 * into that renderer's primitives.
	 *
	 * Parent (TrackStrip) gates rendering on `hasClip`, so the ghost
	 * branch is a defensive null-render for transient store gaps.
	 *
	 * No playhead on a stopped clip (the display fallback for a track with
	 * nothing launched): Live draws none, and a line at the window's left
	 * edge claimed a position that isn't one. A clip Live holds as playing
	 * while the transport is stopped keeps its line, frozen where Live
	 * will resume it.
	 *
	 * Playhead position is read from the store's high-frequency
	 * position-only channel, painted as-is from the surface's 30 Hz
	 * `playhead` emit. No client-side rAF interpolation; transport stop
	 * freezes the playhead naturally because emits stop firing. Reading
	 * position separately from `entry` keeps the gestural entry
	 * reference stable across audio-rate updates, so ClipPreview's
	 * canvas effect doesn't re-run at 30 Hz.
	 */

	import {
		playingClipsStore,
		playheadFraction,
		type PlayingClipEntry
	} from '$lib/stores/v6/playingClipsStore.svelte';
	import ClipPreview from './ClipPreview.svelte';

	interface Props {
		trackPath: string;
		color?: string;
		dimmed?: boolean;
	}

	let { trackPath, color, dimmed = false }: Props = $props();

	const STRIP_BINS = 256;

	let entry = $derived<PlayingClipEntry | undefined>(playingClipsStore.get(trackPath));
	let isGhost = $derived(!entry || entry.slotIdx < 0);
	// Status reads the *live* position-channel value when present so
	// recording → playing flips reach the UI promptly without forcing a
	// whole entry rewrite. Falls back to the entry's seed status.
	let liveStatus = $derived(playingClipsStore.liveStatus(trackPath));
	let isRecording = $derived(liveStatus === 2);

	let livePosition = $derived(playingClipsStore.position(trackPath));
	let fraction = $derived(entry ? playheadFraction(entry, livePosition) : 0);
</script>

<div
	class="track-clip-view w-full touch-manipulation"
	class:ghost={isGhost}
	class:recording={isRecording}
	class:dimmed
	title={isGhost ? 'No clip playing' : 'Clip'}
>
	{#if !isGhost && entry}
		<ClipPreview
			isAudio={entry.isAudioClip}
			filePath={entry.filePath}
			clipPath={entry.clipPath}
			lengthBeats={entry.lengthBeats}
			loopStartBeats={entry.loopStartBeats}
			loopEndBeats={entry.loopEndBeats}
			looping={entry.looping}
			fileStartBeats={entry.fileStartBeats}
			fileEndBeats={entry.fileEndBeats}
			status={liveStatus}
			{fraction}
			showPlayhead={liveStatus !== 0}
			bins={STRIP_BINS}
			{color}
			{dimmed}
		/>
	{/if}
</div>

<style>
	.track-clip-view {
		position: relative;
		display: block;
		height: 100%;
		width: 100%;
		border-radius: 0;
		padding: 0;
		overflow: hidden;
	}

	/* Playhead is the shared global .strip-playhead (phosphor-white, capless
	   1px, untransitioned left), drawn inside ClipPreview. Record state lives
	   in the strip corner brackets (§4.3). */
</style>
