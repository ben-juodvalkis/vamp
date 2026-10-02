<script lang="ts">
	/**
	 * The Reverb view's picture of the tail (`tailPortrait.ts`) on an XY pad:
	 * the pad's X is where the tail ends (Decay), its Y is Dry/Wet — the
	 * Reverb tile's two axes, so a drag here does what a drag on the tile
	 * does, and the picture shows it happen.
	 */
	import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import { BASE_BOTTOM, SAMPLE_X, STACK_TOP, TIME_TICKS, timeToX, tailPortrait, type Ridge, type TailInput } from './tailPortrait';

	interface Props {
		input: TailInput;
		/** Name and value pairs, top-right: Decay, Dry/Wet. */
		readouts: { name: string; value: string }[];
		crossoverLabel?: string;
		color: DeviceColorScheme;
		isGhost?: boolean;
		onMove: (x: number, y: number) => void;
		onTap?: () => void;
	}

	let { input, readouts, crossoverLabel, color, isGhost = false, onMove, onTap }: Props = $props();

	let portrait = $derived(tailPortrait(input));

	// The picture is drawn in a 1000 × 1000 box stretched to the pad, y down;
	// strokes stay 1 px through `vector-effect`.
	const X = (x: number) => (x * 1000).toFixed(1);
	const Y = (y: number) => ((1 - y) * 1000).toFixed(1);

	function contour(r: Ridge): string {
		return 'M' + r.ys.map((y, j) => `${X(SAMPLE_X[j])} ${Y(y)}`).join('L');
	}
	/** Only where the band sounds: its silent baseline is drawn faint, apart. */
	function sounding(r: Ridge): string {
		const lit = (j: number) => j >= 0 && j < r.ys.length && r.ys[j] > r.base + 0.002;
		let d = '';
		let open = false;
		for (let j = 0; j < r.ys.length; j++) {
			if (lit(j) || lit(j - 1) || lit(j + 1)) {
				d += `${open ? 'L' : 'M'}${X(SAMPLE_X[j])} ${Y(r.ys[j])}`;
				open = true;
			} else open = false;
		}
		return d;
	}
	function body(r: Ridge): string {
		return `${contour(r)}L1000 ${Y(r.base)}L0 ${Y(r.base)}Z`;
	}
	/** Back ridges recede: the highs at 45 % ink, the front ridge at full. */
	const depth = (k: number, n: number) => 0.45 + (0.55 * k) / Math.max(1, n - 1);
</script>

<div class="reverb-portrait" class:ghost={isGhost} style="--ink: {color.primary};" data-reverb-portrait={input.algo}>
	<DeviceXY xValue={portrait.tailEndX} yValue={input.wet} {color} {isGhost} onInteraction={onMove} {onTap}>
		{#snippet background()}
			<div class="picture" aria-hidden="true">
				<svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
					{#each TIME_TICKS as tick (tick.seconds)}
						<line class="tick" x1={X(timeToX(tick.seconds))} x2={X(timeToX(tick.seconds))} y1={Y(0.075)} y2={Y(0.095)} />
					{/each}
					{#each portrait.ridges as ridge, k (ridge.hz)}
						<path class="ridge-body" d={body(ridge)} />
						<path class="ridge-rest" d={contour(ridge)} />
						<path class="ridge-line" d={sounding(ridge)} style="stroke-opacity: {depth(k, portrait.ridges.length)};" />
					{/each}
					{#if portrait.crossover}
						<line class="crossover" x1="0" x2="1000" y1={Y(portrait.crossover.y)} y2={Y(portrait.crossover.y)} />
					{/if}
					{#if portrait.climb}
						<polyline class="climb" points={portrait.climb.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')} />
					{/if}
					<!-- Where the Decay ends: the handle rides this line. -->
					<line class="decay-mark" x1={X(portrait.tailEndX)} x2={X(portrait.tailEndX)} y1={Y(0.075)} y2={Y(STACK_TOP)} />
					<!-- The dry hit, in the neutral ink: the sound before the reverb. -->
					{#if portrait.dry > 0.005}
						<line class="dry" x1={X(timeToX(0))} x2={X(timeToX(0))} y1={Y(BASE_BOTTOM)} y2={Y(BASE_BOTTOM + portrait.dry)} />
					{/if}
				</svg>

				<div class="readouts">
					{#each readouts as r (r.name)}
						<span class="readout"><span class="readout-name">{r.name}</span> {r.value}</span>
					{/each}
				</div>

				{#if portrait.climb}
					{#each portrait.climb as p, n (n)}
						<span class="climb-dot" style="left: {p.x * 100}%; bottom: {p.y * 100}%;"></span>
					{/each}
				{/if}

				{#if portrait.dry > 0.005}
					<span class="dry-label" style="left: max({timeToX(0) * 100}%, 0.75rem); bottom: {(BASE_BOTTOM + portrait.dry) * 100}%;">Dry</span>
				{/if}

				{#if portrait.crossover && crossoverLabel}
					<span class="crossover-label" style="bottom: {portrait.crossover.y * 100}%;">{crossoverLabel}</span>
				{/if}

				{#each TIME_TICKS as tick (tick.seconds)}
					<span class="tick-label" style="left: {timeToX(tick.seconds) * 100}%;">{tick.label}</span>
				{/each}
			</div>
		{/snippet}
	</DeviceXY>
</div>

<style>
	.reverb-portrait {
		height: 100%;
		min-width: 0;
		min-height: 0;
	}

	.picture {
		position: absolute;
		inset: 0;
		pointer-events: none;
		user-select: none;
	}
	.reverb-portrait.ghost svg {
		opacity: var(--opacity-ghost);
	}

	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.ridge-body {
		/* Opaque, so each ridge hides the ones behind it; ink-tinted, so the
		   tail reads as one mass at a glance. */
		fill: color-mix(in oklab, var(--ink) 16%, var(--surface-well));
		stroke: none;
	}
	.ridge-line {
		fill: none;
		stroke: var(--ink);
		stroke-width: 1;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}
	.ridge-rest {
		fill: none;
		stroke: var(--ink);
		stroke-opacity: 0.18;
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.crossover {
		stroke: var(--ink);
		stroke-width: 1;
		stroke-dasharray: 6 8;
		stroke-opacity: 0.7;
		vector-effect: non-scaling-stroke;
	}
	.decay-mark {
		stroke: var(--ink);
		stroke-width: 1;
		stroke-dasharray: 3 5;
		vector-effect: non-scaling-stroke;
	}
	.dry {
		stroke: var(--foreground);
		stroke-width: 2;
		vector-effect: non-scaling-stroke;
	}
	.climb {
		fill: none;
		stroke: var(--foreground);
		stroke-width: 1;
		stroke-dasharray: 2 4;
		vector-effect: non-scaling-stroke;
	}
	.climb-dot {
		position: absolute;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--foreground);
		transform: translate(-50%, 50%);
	}
	.dry-label {
		position: absolute;
		transform: translate(-50%, -0.2rem);
		font-size: 0.6875rem;
		color: var(--muted-foreground);
	}
	.tick {
		stroke: var(--fg-tertiary);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}

	.readouts {
		position: absolute;
		top: 0.5rem;
		right: 0.75rem;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.125rem;
		font-size: 0.9375rem;
		font-weight: var(--font-weight-medium);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
		white-space: nowrap;
	}
	.readout-name {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--muted-foreground);
	}

	.crossover-label {
		position: absolute;
		right: 0.75rem;
		transform: translateY(-0.2rem);
		font-size: 0.6875rem;
		color: var(--ink);
		white-space: nowrap;
	}

	.tick-label {
		position: absolute;
		bottom: 0.125rem;
		transform: translateX(-50%);
		font-size: 0.6875rem;
		color: var(--fg-tertiary);
		white-space: nowrap;
	}
	/* Narrow — a drum pad's pane — the tabs take the top-left corner's
	   whole width, so the readout steps down beneath them. */
	@container (max-width: 330px) {
		.readouts {
			top: 2.75rem;
		}
	}
</style>
