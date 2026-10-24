<script lang="ts">
	/**
	 * The loop braces (M2): the loop window (drag to move the whole loop)
	 * and a draggable handle at each edge, in ClipLoopControlV6's style —
	 * each handle owns its own drag on document listeners, so it never
	 * shares state with the canvas pan/zoom pointer surface. Pixels → beats
	 * through the current zoomable `beatWindow`, so the handles track zoom
	 * and scroll. Snapped to bars; optimistic-apply + reconcile (ADR-358):
	 * `optimisticLoop` is bound so the waveform can ink the loop as it
	 * moves.
	 */

	import { clipPropertiesStore } from '$lib/stores/v6/clipPropertiesStore.svelte';
	import { setClipLoopStart, setClipLoopEnd } from '$lib/services/clipCommands';
	import { beatToX, clientDeltaToBeatDelta, type BeatWindow } from '$lib/utils/clip/clipEditorGeometry';
	import { applyLoopDrag, type DragHandle, type LoopRange } from '$lib/utils/clip/clipGesture';
	import { createGestures } from './gestures';

	interface Props {
		clipPath: string | null;
		looping: boolean;
		loopStart: number;
		loopEnd: number;
		totalBeats: number;
		beatsPerBar: number;
		beatWindow: BeatWindow;
		contentW: number;
		optimisticLoop: LoopRange | null;
	}

	let {
		clipPath,
		looping,
		loopStart,
		loopEnd,
		totalBeats,
		beatsPerBar,
		beatWindow,
		contentW,
		optimisticLoop = $bindable()
	}: Props = $props();

	const beginGesture = createGestures();

	let displayStart = $derived(optimisticLoop?.start ?? loopStart);
	let displayEnd = $derived(optimisticLoop?.end ?? loopEnd);
	let startX = $derived(beatToX(displayStart, beatWindow, contentW));
	let endX = $derived(beatToX(displayEnd, beatWindow, contentW));

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

	let dragging = $state<Exclude<DragHandle, null> | null>(null);
	let dragStartClientX = 0;
	let dragStartRange: LoopRange = { start: 0, end: 0 };
	let lastSent: LoopRange = { start: 0, end: 0 };

	function startDrag(event: PointerEvent, handle: Exclude<DragHandle, null>) {
		if (clipPath === null || contentW <= 0) return;
		if (event.cancelable) event.preventDefault();
		// Stop the canvas pan/zoom pointer surface from also reacting.
		event.stopPropagation();
		dragging = handle;
		dragStartClientX = event.clientX;
		dragStartRange = { start: displayStart, end: displayEnd };
		lastSent = { ...dragStartRange };
		optimisticLoop = { ...dragStartRange };
		beginGesture(onDragMove, onDragEnd);
	}

	function onDragMove(event: PointerEvent) {
		if (dragging === null || contentW <= 0) return;
		if (event.cancelable) event.preventDefault();
		const deltaBeats = clientDeltaToBeatDelta(event.clientX - dragStartClientX, contentW, beatWindow);
		const next = applyLoopDrag({
			range: dragStartRange,
			handle: dragging,
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
		commitLoop(next, lastSent);
		lastSent = next;
	}

	function onDragEnd() {
		if (optimisticLoop !== null) {
			// Commit the final value into the store before clearing the
			// optimistic overlay so the brace doesn't snap back to a stale
			// value while the surface echo is in flight.
			clipPropertiesStore.handleLoopStart(optimisticLoop.start);
			clipPropertiesStore.handleLoopEnd(optimisticLoop.end);
		}
		dragging = null;
	}

	function commitLoop(range: LoopRange, prev: LoopRange): void {
		if (clipPath === null) return;
		// Only emit edges that actually moved (avoids a redundant
		// start-marker side-effect write when only the end moved).
		if (Math.abs(range.start - prev.start) >= 1e-3) setClipLoopStart(clipPath, range.start);
		if (Math.abs(range.end - prev.end) >= 1e-3) setClipLoopEnd(clipPath, range.end);
	}
</script>

{#if looping || displayEnd > displayStart}
	<!-- Middle region: drag to move the whole loop -->
	<div
		class="loop-region"
		class:enabled={looping}
		class:dragging={dragging === 'move'}
		style="left: {startX}px; width: {Math.max(0, endX - startX)}px;"
		role="slider"
		tabindex="-1"
		aria-label="Move loop"
		aria-valuenow={Math.round(displayStart)}
		onpointerdown={(e) => startDrag(e, 'move')}
	></div>
	{#each [{ handle: 'start' as const, x: startX, value: displayStart, label: 'Loop start' }, { handle: 'end' as const, x: endX, value: displayEnd, label: 'Loop end' }] as edge (edge.handle)}
		<div
			class="brace-handle brace-{edge.handle}"
			class:dragging={dragging === edge.handle}
			style="left: {edge.x}px;"
			role="slider"
			tabindex="-1"
			aria-label={edge.label}
			aria-valuenow={Math.round(edge.value)}
			onpointerdown={(e) => startDrag(e, edge.handle)}
		>
			<div class="brace-line"></div>
		</div>
		<div
			class="brace-grip"
			style="left: {edge.x}px;"
			role="slider"
			tabindex="-1"
			aria-label={edge.label}
			aria-valuenow={Math.round(edge.value)}
			onpointerdown={(e) => startDrag(e, edge.handle)}
		></div>
	{/each}
{/if}

<style>
	/* Stacking within the editor's content layer: loop-region (1) <
	   draw-catcher (2) < brace-handle (3) < note (4) < brace-grip (6). */
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
	/* A fingertip wide, but UNDER the notes (z 3 < 4): a note at the loop
	   start would otherwise lose the half of itself the brace overlaps.
	   The grip at the top (z 6) keeps the brace grabbable when notes
	   cover the rest of its height. */
	.brace-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 44px;
		margin-left: -22px;
		display: flex;
		justify-content: center;
		cursor: ew-resize;
		touch-action: none;
		z-index: 3;
	}
	.brace-grip {
		position: absolute;
		top: 0;
		width: 44px;
		height: 44px;
		margin-left: -22px;
		cursor: ew-resize;
		touch-action: none;
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

	/* Flat grammar: the wash tokens (orange, app.css) still tint the
	   region — a solid fill would hide the notes under it — but the drag
	   state drops its inset ring; the edge handles already mark the brace. */
	:global([data-grammar="flat"]) .loop-region.dragging {
		background: var(--phosphor-wash);
		box-shadow: none;
	}
	:global([data-grammar="flat"]) .brace-line::before {
		border-radius: 0; /* square grip cap */
	}
</style>
