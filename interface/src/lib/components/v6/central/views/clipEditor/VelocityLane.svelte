<script lang="ts">
	/**
	 * Velocity lane (M5, plan decision 9): a strip under the roll, one bar
	 * per visible note (height ∝ velocity). A vertical drag on a bar sets
	 * that note's velocity. Pitch-drag (on the roll) and velocity-drag
	 * (here) stay spatially separate — no modifier needed. Aligned with the
	 * content's x via the pitch gutter offset.
	 */

	import { sendModifyNotes, type RichNote } from '$lib/services/clipRichNotesService';
	import { focusedNotesStore } from '$lib/stores/v6/focusedNotesStore.svelte';
	import { beatToX, nearestSpan, type BeatWindow } from '$lib/utils/clip/clipEditorGeometry';
	import { velocityFromY } from '$lib/utils/clip/clipPointerMath';
	import { createGestures } from './gestures';
	import { VELOCITY_MAX } from './noteStyle';

	interface Props {
		notes: RichNote[];
		beatWindow: BeatWindow;
		clipPath: string | null;
		left: number;
		width: number;
		height: number;
		noteColor: (velocity: number, pitch?: number) => string;
	}

	let { notes, beatWindow, clipPath, left, width, height, noteColor }: Props = $props();

	const beginGesture = createGestures();

	let bars = $derived.by(() => {
		const out: { noteId: number; pitch: number; x: number; w: number; velocity: number }[] = [];
		if (width <= 0) return out;
		for (const n of notes) {
			const noteEnd = n.startBeats + n.durationBeats;
			if (noteEnd <= beatWindow.startBeats || n.startBeats >= beatWindow.endBeats) continue;
			const x = beatToX(n.startBeats, beatWindow, width);
			const xEnd = beatToX(noteEnd, beatWindow, width);
			out.push({ noteId: n.noteId, pitch: n.pitch, x, w: Math.max(3, xEnd - x), velocity: n.velocity });
		}
		return out;
	});

	let laneRef = $state<HTMLElement | null>(null);
	let drag: { ids: number[] } | null = null;

	function velocityFromClientY(clientY: number): number {
		const rect = laneRef?.getBoundingClientRect();
		if (!rect) return 0;
		// Top of the lane = max velocity, bottom = 0.
		return velocityFromY(clientY, rect.top, height, height, VELOCITY_MAX);
	}

	// A touch anywhere in the lane takes the nearest bar within half a
	// fingertip: a short note's bar can be 3px wide.
	function handleLaneDown(event: PointerEvent) {
		const laneLeft = (event.currentTarget as HTMLElement).getBoundingClientRect().left;
		const i = nearestSpan(event.clientX - laneLeft, bars);
		if (i !== null) startDrag(event, bars[i].noteId);
	}

	function startDrag(event: PointerEvent, noteId: number) {
		if (clipPath === null) return;
		event.stopPropagation();
		if (event.cancelable) event.preventDefault();
		drag = { ids: [noteId] };
		apply(event.clientY);
		beginGesture((e) => apply(e.clientY), commit);
	}

	function apply(clientY: number) {
		if (drag === null) return;
		const vel = velocityFromClientY(clientY);
		for (const id of drag.ids) {
			if (id < 0) continue;
			focusedNotesStore.optimisticModify(id, { velocity: vel }); // optimistic
		}
	}

	function commit() {
		const d = drag;
		drag = null;
		if (d === null || clipPath === null) return;
		const specs = [];
		for (const id of d.ids) {
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="velocity-lane"
	bind:this={laneRef}
	style="left: {left}px; height: {height}px; width: {width}px;"
	onpointerdown={handleLaneDown}
>
	{#each bars as bar (bar.noteId)}
		<div
			class="vel-bar"
			style="left: {bar.x}px; width: {bar.w}px; height: {(bar.velocity / VELOCITY_MAX) * 100}%; background: {noteColor(bar.velocity, bar.pitch)};"
			role="slider"
			tabindex="-1"
			aria-label="Note velocity"
			aria-valuenow={Math.round(bar.velocity)}
			aria-valuemin={0}
			aria-valuemax={VELOCITY_MAX}
			onpointerdown={(e) => startDrag(e, bar.noteId)}
		></div>
	{/each}
</div>

<style>
	/* Bottom strip, bars grow upward from the baseline. */
	.velocity-lane {
		position: absolute;
		bottom: 0;
		touch-action: none;
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
</style>
