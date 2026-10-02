<script lang="ts">
	/**
	 * The convolution pad's picture (`irDisplay.ts`): the loaded IR rising
	 * from a baseline — the top half of its waveform, and for a stereo IR the
	 * louder of L and R at each moment — time across as Size stretches it,
	 * logarithmic past its first thirtieth (the pad's Attack rides the same
	 * axis). Faint, the file as it is; in the device's ink, the
	 * IR as Attack and Decay leave it, with their envelope dashed over it.
	 * Drawn under DeviceXY's handle, whose drag is Attack across and Decay up.
	 */
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import { IR_X0, IR_X1, axisTicks, irShape, louder, tickLabel, timeX } from './irDisplay';
	import type { IrStatus, IrWave } from './useReverbIr.svelte';

	interface Props {
		wave: IrWave | null;
		status: IrStatus;
		/** Live's category: a User IR names why there is no picture. */
		category: string;
		attack: number;
		decay: number;
		size: number;
		shaping: boolean;
		color: DeviceColorScheme;
		isGhost?: boolean;
		/**
		 * Seconds the axis spans: the view's, which the pad's handle shares —
		 * held while Size is dragged, so the IR stretches and shrinks under the
		 * finger. Unset, the axis fits the IR.
		 */
		axisSpan?: number | null;
	}

	let { wave, status, category, attack, decay, size, shaping, color, isGhost = false, axisSpan = null }: Props = $props();

	const X0 = IR_X0;
	const X1 = IR_X1;
	/** The baseline, above the time axis, and the height a full-scale IR reaches. */
	const BASE = 0.11;
	const RISE = 0.68;

	let shape = $derived(
		wave ? irShape(wave.channels.map((c) => c.peaks), wave.seconds, size, attack, decay, shaping) : null
	);
	let axis = $derived(axisSpan ?? shape?.span ?? 0);
	/** The picture's width, px: the ticks leave room for their labels in it. */
	let root = $state<HTMLDivElement | null>(null);
	let width = $state(0);
	let ticks = $derived(axis > 0 ? axisTicks(axis, width) : []);

	$effect(() => {
		const el = root;
		if (!el || typeof ResizeObserver === 'undefined') return;
		const measure = () => {
			const w = el.getBoundingClientRect().width;
			if (w > 0) width = w;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	});

	const X = (x: number) => (x * 1000).toFixed(1);
	const Y = (y: number) => ((1 - y) * 1000).toFixed(1);
	const xAt = (t: number, span: number) => timeX(t, span);

	/** An outline rising from the baseline; closed along it for a fill. */
	function outline(heights: number[], close: boolean): string {
		if (!shape) return '';
		const pts = heights.map((h, i) => `${X(xAt(shape!.times[i], axis))} ${Y(BASE + RISE * h)}`);
		return close ? `M${X(X0)} ${Y(BASE)}L${pts.join('L')}L${X(X1)} ${Y(BASE)}Z` : `M${pts.join('L')}`;
	}
	let raw = $derived(shape ? louder(shape.raw) : []);
	let shaped = $derived(shape ? louder(shape.shaped) : []);

	let missingText = $derived(
		status === 'missing'
			? category === 'User'
				? 'A User IR: no picture from here'
				: 'No picture for this IR'
			: ''
	);
</script>

<div class="ir-display" class:ghost={isGhost} style="--ink: {color.primary};" aria-hidden="true" bind:this={root}>
	{#if shape}
		<svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
			{#each ticks as t (t)}
				<line class="tick" x1={X(xAt(t, axis))} x2={X(xAt(t, axis))} y1={Y(BASE - 0.025)} y2={Y(BASE)} />
			{/each}
			<line class="centre" x1={X(X0)} x2={X(X1)} y1={Y(BASE)} y2={Y(BASE)} />
			<path class="raw" d={outline(raw, true)} />
			<path class="shaped" d={outline(shaped, true)} />
			<path class="shaped-line" d={outline(shaped, false)} />
			{#if shape.envelope}
				<path class="envelope" d={outline(shape.envelope, false)} />
			{/if}
		</svg>
		{#each ticks as t (t)}
			<span class="tick-label" style="left: {xAt(t, axis) * 100}%;">{tickLabel(t)}</span>
		{/each}
	{:else if missingText}
		<span class="missing">{missingText}</span>
	{/if}

	{#if !shaping}<span class="note">Envelope off</span>{/if}
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
	.missing {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: 0.8125rem;
		color: var(--muted-foreground);
		white-space: nowrap;
	}

	.note {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
</style>
