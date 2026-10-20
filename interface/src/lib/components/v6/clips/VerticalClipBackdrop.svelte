<script lang="ts">
	/**
	 * VerticalClipBackdrop — the focused clip's content behind the loop brace.
	 *
	 * The brace draws the whole clip, 0 at the bottom and `endMarker` at the
	 * top, so the backdrop shows the same span: the waveform for an audio
	 * clip, the note lanes for a MIDI one. It is `ClipPreview` — the renderer
	 * the strips and the session grid use — laid on its side: a box as wide
	 * as the brace is tall, rotated a quarter turn so time runs upward, and
	 * mirrored so higher notes sit to the right, as on a keyboard.
	 *
	 * Inert: no pointer events, no playhead (the brace draws its own, against
	 * the same 0..endMarker scale as the handles).
	 */
	import ClipPreview from '$lib/components/v6/tracks/TrackStrip/components/ClipPreview.svelte';
	import {
		invalidateSample,
		peekSample,
		requestSample,
		type ClipSample
	} from '$lib/services/clipSampleService';

	interface Props {
		clipPath: string;
		/** The brace's whole span, in the clip's own time. */
		endBeats: number;
		/** Track ink for the content. */
		color?: string;
		/** A take in progress has nothing stable to draw. */
		recording?: boolean;
	}

	let { clipPath, endBeats, color, recording = false }: Props = $props();

	let hostRef = $state<HTMLElement | null>(null);
	let boxW = $state(0);
	let boxH = $state(0);

	$effect(() => {
		const host = hostRef;
		if (!host || typeof ResizeObserver === 'undefined') return;
		const measure = () => {
			boxW = host.clientWidth;
			boxH = host.clientHeight;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(host);
		return () => ro.disconnect();
	});

	// Audio or MIDI, and an audio clip's file and where it sits in clip
	// time — the `clip/sample` reply, as the clip view's swap pill reads it
	// (the properties store's is-audio flag is never sent). The playing
	// slot's entry carries the same for one slot per track; the focused
	// clip need not be that one, so ask by path (cached by the service).
	let sample = $state<ClipSample | null>(null);

	$effect(() => {
		const path = clipPath;
		if (!path || recording) {
			sample = null;
			return;
		}
		const cached = peekSample(path);
		if (cached && (!cached.isAudioClip || cached.filePath)) {
			sample = cached;
			return;
		}
		// A take that just finished answers with no path until its file
		// flushes; an empty cached answer is never kept, but drop any stale
		// one before asking again.
		invalidateSample(path);
		let cancelled = false;
		requestSample(path)
			.then((result) => {
				if (!cancelled) sample = result;
			})
			.catch(() => {
				if (!cancelled) sample = null;
			});
		return () => {
			cancelled = true;
		};
	});

	let drawable = $derived(
		!recording && endBeats > 0 && boxW > 0 && boxH > 0 && sample !== null
	);
</script>

<div class="backdrop-host" bind:this={hostRef} aria-hidden="true">
	{#if drawable}
		<div class="backdrop-rotor" style="width: {boxH}px; height: {boxW}px;">
			{#if sample?.isAudioClip}
				{#if sample.filePath}
					<ClipPreview
						isAudio={true}
						filePath={sample.filePath}
						lengthBeats={endBeats}
						loopStartBeats={0}
						loopEndBeats={endBeats}
						fileStartBeats={sample.fileStartBeats}
						fileEndBeats={sample.fileEndBeats}
						showLoopBand={false}
						{color}
					/>
				{/if}
			{:else}
				<ClipPreview
					isAudio={false}
					{clipPath}
					lengthBeats={endBeats}
					loopStartBeats={0}
					loopEndBeats={endBeats}
					showPlayhead={false}
					{color}
				/>
			{/if}
		</div>
	{/if}
</div>

<style>
	.backdrop-host {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
		opacity: 0.5;
	}

	/* Laid out as a horizontal clip (time left→right, high notes on top),
	   then mirrored top-to-bottom and turned a quarter turn
	   counter-clockwise: time runs bottom→top, high notes on the right. */
	.backdrop-rotor {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%) rotate(-90deg) scaleY(-1);
		/* Rasterized once on its own layer, so the playhead sliding over it
		   never repaints the rotated content. */
		will-change: transform;
	}
</style>
