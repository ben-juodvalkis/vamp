<script lang="ts">
	/**
	 * RecordingCount — while a track records, its strip's clip section
	 * counts the take as `bar.beat` (2026-10-19, the user's call; the count
	 * rode the sidebar's loop brace before, for the selected track only).
	 *
	 * Free data off the playhead channel (status 0/1/2 and position), no new
	 * wire. A take's own loop points mean nothing until it closes, so the
	 * bar is the furthest the playhead has reached this take: the maximum
	 * holds an overdub, whose position wraps, at its loop length rather than
	 * dropping back to 1 each pass. The beat is where the playhead is now,
	 * so an overdub's beat keeps counting round while its bar holds.
	 */
	import { untrack } from 'svelte';
	import { session } from '$lib/stores/session.svelte';
	import { playingClipsStore } from '$lib/stores/v6/playingClipsStore.svelte';
	import { recordingBars, recordingBeat } from '$lib/utils/clip/clipGesture';

	interface Props {
		trackPath: string;
	}

	let { trackPath }: Props = $props();

	let beatsPerBar = $derived(session.timeSignature.numerator || 4);
	let isRecording = $derived(playingClipsStore.liveStatus(trackPath) === 2);

	let recordedBeats = $state(0);
	let recordingPosition = $state(0);
	$effect(() => {
		if (!isRecording) {
			recordedBeats = 0;
			recordingPosition = 0;
			return;
		}
		const pos = playingClipsStore.position(trackPath);
		recordingPosition = pos;
		if (pos > untrack(() => recordedBeats)) recordedBeats = pos;
	});

	let label = $derived(
		`${recordingBars(recordedBeats, beatsPerBar)}.${recordingBeat(recordingPosition, beatsPerBar)}`
	);
</script>

{#if isRecording}
	<div class="recording-count" aria-label="Recording, bar {label}">
		<span class="num" style="--len-chars: {label.length};">{label}</span>
	</div>
{/if}

<style>
	/* Over the take's preview, centered; sized off the section's width so a
	   long count ("12.3") still fits a narrow strip. 0.6em is a mono
	   numeral's advance. */
	.recording-count {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		container-type: inline-size;
		z-index: 2;
	}
	.recording-count span {
		font-weight: 700;
		line-height: 1;
		font-size: min(1.5rem, calc((100cqw - 0.5rem) / (var(--len-chars) * 0.6)));
		color: var(--foreground);
	}
</style>
