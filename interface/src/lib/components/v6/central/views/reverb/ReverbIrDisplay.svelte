<script lang="ts">
	/**
	 * The convolution pad's picture (`irDisplay.ts`): the loaded IR, L above
	 * the centre line and R below it (a mono IR mirrors), time across as
	 * Size stretches it. Faint, the file as it is; in the device's ink, the
	 * IR as Attack and Decay leave it, with their envelope dashed over it.
	 * Drawn under DeviceXY's handle, whose drag is Attack across and Decay up.
	 */
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import { percentLabel, timeLabel } from '$lib/components/v6/device-panel/hybridReverbParams';
	import { categoryLabel, irLabel, irShape, tickLabel, timeTicks } from './irDisplay';
	import type { IrStatus, IrWave } from './useReverbIr.svelte';

	interface Props {
		wave: IrWave | null;
		status: IrStatus;
		category: string;
		file: string;
		attack: number;
		decay: number;
		size: number;
		shaping: boolean;
		color: DeviceColorScheme;
		isGhost?: boolean;
	}

	let { wave, status, category, file, attack, decay, size, shaping, color, isGhost = false }: Props = $props();

	const X0 = 0.035;
	const X1 = 0.985;
	const MID = 0.46;
	const HALF = 0.32;

	let label = $derived(irLabel(file));
	let shape = $derived(
		wave ? irShape(wave.channels.map((c) => c.peaks), wave.seconds, size, attack, decay, shaping) : null
	);
	let ticks = $derived(shape && shape.span > 0 ? timeTicks(shape.span) : []);

	const X = (x: number) => (x * 1000).toFixed(1);
	const Y = (y: number) => ((1 - y) * 1000).toFixed(1);
	const xAt = (t: number, span: number) => X0 + ((X1 - X0) * t) / span;

	/** One half's outline: up from the centre line (+1) or down (-1). */
	function half(heights: number[], sign: 1 | -1, close: boolean): string {
		if (!shape) return '';
		const pts = heights.map((h, i) => `${X(xAt(shape!.times[i], shape!.span))} ${Y(MID + sign * HALF * h)}`);
		return close ? `M${X(X0)} ${Y(MID)}L${pts.join('L')}L${X(X1)} ${Y(MID)}Z` : `M${pts.join('L')}`;
	}
	/** The upper half is L (or mono); the lower is R, or mono again. */
	const lower = (s: number[][]) => s[1] ?? s[0];

	let missingText = $derived(
		status === 'missing'
			? category === 'User'
				? 'A User IR: no picture from here'
				: 'No picture for this IR'
			: ''
	);
</script>

<div class="ir-display" class:ghost={isGhost} style="--ink: {color.primary};" aria-hidden="true">
	{#if shape}
		<svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
			{#each ticks as t (t)}
				<line class="tick" x1={X(xAt(t, shape.span))} x2={X(xAt(t, shape.span))} y1={Y(0.085)} y2={Y(0.105)} />
			{/each}
			<line class="centre" x1={X(X0)} x2={X(X1)} y1={Y(MID)} y2={Y(MID)} />
			<path class="raw" d={half(shape.raw[0], 1, true)} />
			<path class="raw" d={half(lower(shape.raw), -1, true)} />
			<path class="shaped" d={half(shape.shaped[0], 1, true)} />
			<path class="shaped" d={half(lower(shape.shaped), -1, true)} />
			<path class="shaped-line" d={half(shape.shaped[0], 1, false)} />
			<path class="shaped-line" d={half(lower(shape.shaped), -1, false)} />
			{#if shape.envelope}
				<path class="envelope" d={half(shape.envelope, 1, false)} />
				<path class="envelope" d={half(shape.envelope, -1, false)} />
			{/if}
		</svg>
		{#each ticks as t (t)}
			<span class="tick-label" style="left: {xAt(t, shape.span) * 100}%;">{tickLabel(t)}</span>
		{/each}
		{#if wave && wave.channels.length > 1}
			<span class="side" style="bottom: {(MID + HALF) * 100}%;">L</span>
			<span class="side" style="bottom: {(MID - HALF) * 100}%;">R</span>
		{/if}
	{:else if missingText}
		<span class="missing">{missingText}</span>
	{/if}

	<div class="head">
		<span class="name">{label.name || 'IR'}</span>
		{#if category}
			<span class="category">{categoryLabel(category)}{label.stereo ? ' · Stereo' : ''}</span>
		{/if}
	</div>

	<div class="readouts">
		<span class="readout"><span class="readout-name">Attack</span> {timeLabel(attack)}</span>
		<span class="readout"><span class="readout-name">Decay</span> {timeLabel(decay)}</span>
		<span class="readout"><span class="readout-name">Size</span> {percentLabel(size * 100)}</span>
		{#if !shaping}<span class="readout-name">Envelope off</span>{/if}
	</div>
</div>

<style>
	.ir-display {
		position: absolute;
		inset: 0;
		pointer-events: none;
		user-select: none;
	}
	.ir-display.ghost svg {
		opacity: var(--opacity-ghost);
	}
	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.raw {
		fill: color-mix(in oklab, var(--ink) 10%, transparent);
		stroke: color-mix(in oklab, var(--ink) 35%, transparent);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.shaped {
		fill: color-mix(in oklab, var(--ink) 24%, transparent);
		stroke: none;
	}
	.shaped-line {
		fill: none;
		stroke: var(--ink);
		stroke-width: 1;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}
	.envelope {
		fill: none;
		stroke: var(--foreground);
		stroke-width: 1;
		stroke-dasharray: 4 5;
		stroke-opacity: 0.7;
		vector-effect: non-scaling-stroke;
	}
	.centre {
		stroke: var(--line-strong);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.tick {
		stroke: var(--fg-tertiary);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.tick-label {
		position: absolute;
		bottom: 0.125rem;
		transform: translateX(-50%);
		font-size: 0.6875rem;
		color: var(--fg-tertiary);
		white-space: nowrap;
	}
	.side {
		position: absolute;
		left: 0.5rem;
		transform: translateY(50%);
		font-size: 0.6875rem;
		color: var(--fg-tertiary);
	}
	.missing {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: 0.8125rem;
		color: var(--muted-foreground);
		white-space: nowrap;
	}

	.head {
		position: absolute;
		top: 0.5rem;
		left: 0.75rem;
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		white-space: nowrap;
	}
	.name {
		font-size: 0.875rem;
		font-weight: var(--font-weight-medium);
		color: var(--ink);
	}
	.category {
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}

	.readouts {
		position: absolute;
		top: 0.5rem;
		right: 0.75rem;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.125rem;
		font-size: 0.8125rem;
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
	/* Narrow — a drum pad's pane — the category gives way to the readouts. */
	@container (max-width: 330px) {
		.category {
			display: none;
		}
	}
</style>
