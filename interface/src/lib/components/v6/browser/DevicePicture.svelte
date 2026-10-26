<script lang="ts">
	/**
	 * A device's picture behind its control (`devicePictures`): its strokes
	 * stretched over the control's box in the device's ink, under the label
	 * and the handle, never taking a touch.
	 */
	import { pictureStrokes, type PictureKind } from './devicePictures';

	interface Props {
		kind: PictureKind;
		x: number;
		y?: number;
		ink: string;
	}

	let { kind, x, y = 0, ink }: Props = $props();
	const strokes = $derived(pictureStrokes(kind, x, y));
	/** Shapes that must keep their proportions (a pedal, a drum, an amp stack); the rest stretch to the cell, Echo's arcs with it as Live draws them. */
	const KEEP_ASPECT = new Set<PictureKind>(['stompbox', 'drum', 'stack']);
</script>

<svg
	class="device-picture"
	viewBox="0 0 100 100"
	preserveAspectRatio={KEEP_ASPECT.has(kind) ? 'xMidYMid meet' : 'none'}
	aria-hidden="true"
	style="--picture-ink: {ink};"
>
	{#each strokes as s, i (i)}
		<path d={s.d} style="opacity: {s.o};" class:fill={s.fill} vector-effect="non-scaling-stroke" />
	{/each}
</svg>

<style>
	.device-picture {
		position: absolute;
		inset: 12%;
		width: 76%;
		height: 76%;
		pointer-events: none;
		z-index: 0;
		opacity: 0.8;
	}
	path {
		fill: none;
		stroke: var(--picture-ink);
		stroke-width: 1.5px;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	path.fill {
		fill: var(--picture-ink);
		stroke: none;
	}
</style>
