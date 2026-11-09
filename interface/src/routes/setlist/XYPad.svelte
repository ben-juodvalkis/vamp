<script lang="ts">
	import {
		MACRO_MAX,
		holdControl,
		moveControl,
		releaseControl,
		setlist,
		type SetlistPad
	} from '$lib/services/setlist.svelte';

	let { pad, color, labelColor }: { pad: SetlistPad; color: string; labelColor: string } = $props();

	const x = $derived((setlist.values[pad.xKey] ?? 0) / MACRO_MAX);
	const y = $derived((setlist.values[pad.yKey] ?? 0) / MACRO_MAX);
	// A long name shrinks to stay whole rather than losing its ends.
	const fontSize = $derived(`min(5.6vh, ${(1.75 * 21) / Math.max(pad.label.length, 1)}vw)`);

	let pointerId: number | null = null;
	let start = { pointerX: 0, pointerY: 0, x: 0, y: 0 };

	function down(event: PointerEvent) {
		if (pointerId !== null) return;
		pointerId = event.pointerId;
		start = {
			pointerX: event.clientX,
			pointerY: event.clientY,
			x: setlist.values[pad.xKey] ?? 0,
			y: setlist.values[pad.yKey] ?? 0
		};
		(event.currentTarget as HTMLElement).setPointerCapture(pointerId);
		holdControl(pad.xKey);
		holdControl(pad.yKey);
	}

	function move(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		const box = event.currentTarget as HTMLElement;
		moveControl(pad.xKey, start.x + ((event.clientX - start.pointerX) / box.clientWidth) * MACRO_MAX);
		moveControl(pad.yKey, start.y - ((event.clientY - start.pointerY) / box.clientHeight) * MACRO_MAX);
	}

	function up(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		pointerId = null;
		releaseControl(pad.xKey);
		releaseControl(pad.yKey);
	}
</script>

<div
	class="pad"
	style:--color={color}
	role="application"
	aria-label={pad.label}
	data-x={Math.round(x * MACRO_MAX)}
	data-y={Math.round(y * MACRO_MAX)}
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={up}
>
	<span class="label" style:color={labelColor} style:font-size={fontSize}>{pad.label}</span>
	<div class="handle" style:--x={x} style:--y={y}></div>
</div>

<style>
	.pad {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 0;
		background: color-mix(in srgb, var(--color) 24%, #000);
		border: 1px solid var(--color);
		border-radius: 10px;
		overflow: hidden;
		touch-action: none;
	}
	.label {
		white-space: nowrap;
		pointer-events: none;
	}
	.handle {
		--size: 3.2vh;
		position: absolute;
		width: var(--size);
		height: var(--size);
		/* Kept whole inside the pad at both ends of its travel. */
		left: calc(var(--x) * (100% - var(--size)));
		bottom: calc(var(--y) * (100% - var(--size)));
		background: var(--color);
		border-radius: 28%;
		pointer-events: none;
	}
</style>
