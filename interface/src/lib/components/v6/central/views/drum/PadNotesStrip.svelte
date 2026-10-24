<script lang="ts">
	/**
	 * PadNotesStrip — the scoped pad's notes in the track's playing clip, a
	 * strip of steps under the Drum Rack view's controls (2026-10-24, the
	 * user's call). While a pad is held or latched, its notes across the
	 * clip's window (the view's `useClipPads`: the playing MIDI clip and
	 * `clipViewWindow`) are bars, each as tall as its velocity, in the pad's
	 * colour; a drag up or down on one moves its velocity (relative, so a
	 * touch never jumps it) and the release writes it to Live.
	 *
	 * The notes are the clip's id-carrying ones (`requestRichNotes`), read
	 * and written by clip path, which the surface takes for any clip, not
	 * only Live's focused one, so the strip needs no focus. Re-read on the
	 * clip's `notes/changed`. Nothing playing on the track: nothing to edit,
	 * and the strip says so.
	 */

	import { drag, type DragInfo } from '$lib/actions';
	import { requestRichNotes, sendModifyNotes, type RichNote } from '$lib/services/clipRichNotesService';
	import { subscribeNotesChanged } from '$lib/services/clipNotesService';
	import { logger } from '$lib/utils/logger';
	import type { TimeRange } from '$lib/utils/waveformPaint';
	import { dragVelocity, stripBarAt, stripBars, stripSteps, STRIP_VELOCITY_MAX } from './padNotesStrip';

	interface Props {
		/** The track's playing MIDI clip; '' while nothing plays. */
		clipPath: string;
		/** The time the clip shows; null while nothing plays. */
		clipWindow: TimeRange | null;
		/** The scoped pad's note. */
		note: number;
		/** The pad's ink. */
		ink: string;
	}

	let { clipPath, clipWindow, note, ink }: Props = $props();

	const win = $derived(clipPath && clipWindow && clipWindow.end > clipWindow.start ? clipWindow : null);

	let notes = $state<RichNote[]>([]);
	// The note under the finger and its velocity while it moves: drawn
	// from here, and kept off a re-read until the release lands.
	let dragging = $state<{ noteId: number; start: number; velocity: number } | null>(null);

	$effect(() => {
		const cp = clipPath;
		if (!cp) {
			notes = [];
			return;
		}
		let cancelled = false;
		const load = () => {
			requestRichNotes(cp)
				.then((result) => {
					if (!cancelled) notes = result;
				})
				.catch((error: Error) => {
					if (!cancelled) logger.debug('PadNotesStrip: notes fetch failed', { clipPath: cp, error: error.message });
				});
		};
		load();
		const release = subscribeNotesChanged(cp, load);
		return () => {
			cancelled = true;
			release();
		};
	});

	const padNotes = $derived(notes.filter((n) => n.pitch === note));
	const bars = $derived(
		win
			? stripBars(
					padNotes.map((n) => ({
						noteId: n.noteId,
						startBeats: n.startBeats,
						velocity: dragging?.noteId === n.noteId ? dragging.velocity : n.velocity
					})),
					win
				)
			: []
	);
	const steps = $derived(win ? stripSteps(win) : []);

	let box: HTMLElement | null = $state(null);

	function onDown(info: DragInfo) {
		const rect = box?.getBoundingClientRect();
		if (!rect || rect.width <= 0) return;
		const i = stripBarAt(bars, (info.downX - rect.left) / rect.width);
		if (i === null) return;
		const n = padNotes.find((p) => p.noteId === bars[i].noteId);
		if (n) dragging = { noteId: n.noteId, start: n.velocity, velocity: n.velocity };
	}

	function onMove(info: DragInfo) {
		if (!dragging) return;
		dragging = { ...dragging, velocity: dragVelocity(dragging.start, info.dy, info.height) };
	}

	function onEnd() {
		const d = dragging;
		dragging = null;
		if (!d || !clipPath || d.velocity === d.start) return;
		const n = notes.find((p) => p.noteId === d.noteId);
		if (!n) return;
		// Keep the new value on screen until the re-read brings it back.
		notes = notes.map((p) => (p.noteId === d.noteId ? { ...p, velocity: d.velocity } : p));
		sendModifyNotes(clipPath, [{ ...n, velocity: d.velocity }]);
	}
</script>

<div
	class="pad-notes-strip"
	style="--strip-ink: {ink};"
	bind:this={box}
	use:drag={{ commit: 'y', onDown, onStart: onMove, onMove, onEnd, onTap: () => (dragging = null) }}
	data-pad-notes={note}
	role="group"
	aria-label="The pad's notes in the playing clip; drag a step up or down for its velocity"
>
	{#if !win}
		<span class="strip-msg">No clip playing</span>
	{:else}
		{#each steps as s}
			<div class="strip-step" class:beat={s.beat} style="left: {s.at * 100}%;"></div>
		{/each}
		{#each bars as bar (bar.noteId)}
			<div
				class="strip-bar"
				class:active={dragging?.noteId === bar.noteId}
				style="left: {bar.left * 100}%; width: {bar.width * 100}%; height: {(bar.velocity / STRIP_VELOCITY_MAX) * 100}%;"
			></div>
		{/each}
		{#if bars.length === 0}
			<span class="strip-msg">No notes on this pad</span>
		{/if}
		{#if dragging}
			<span class="strip-readout">Velocity {dragging.velocity}</span>
		{/if}
	{/if}
</div>

<style>
	.pad-notes-strip {
		position: relative;
		min-width: 0;
		min-height: 0;
		height: 100%;
		overflow: hidden;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: var(--surface-well);
		cursor: ns-resize;
	}
	.strip-step {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: color-mix(in oklab, var(--line-strong) 60%, transparent);
		pointer-events: none;
	}
	.strip-step.beat {
		background: var(--line-strong);
	}
	/* A step, as tall as its velocity, in the pad's colour. */
	.strip-bar {
		position: absolute;
		bottom: 0;
		box-sizing: border-box;
		border: 1px solid var(--surface-well);
		background: var(--strip-ink);
		pointer-events: none;
	}
	.strip-bar.active {
		outline: 2px solid var(--foreground);
		outline-offset: -2px;
	}
	.strip-msg {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.8125rem;
		color: var(--muted-foreground);
		pointer-events: none;
	}
	.strip-readout {
		position: absolute;
		top: 4px;
		right: 6px;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
		pointer-events: none;
	}
</style>
