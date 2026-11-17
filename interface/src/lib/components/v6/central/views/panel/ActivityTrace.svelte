<script lang="ts">
	/**
	 * A Compressor's activity view as Live shows it (ADR-543): the signal's
	 * level over time as a fill rising from the floor, the gain-reduction
	 * line over it and the threshold across, scrolling right to left as Live
	 * scrolls it. Heights are Live's own scale (`activityTrace`), so the
	 * drawing is Live's picture. Holds the device's watch while mounted;
	 * draws nothing while the `liveMeters` switch is off or there is no
	 * reading, and says which through `live`. Absolutely placed: the host
	 * gives it a positioned box.
	 */
	import { useLiveMeter } from './useLiveMeter.svelte';
	import { activityTrace } from '$lib/stores/v6/liveMeterStore.svelte';

	interface Props {
		devicePath: string | undefined;
		ink: string;
		live?: boolean;
	}

	let { devicePath, ink, live = $bindable(false) }: Props = $props();
	const meter = useLiveMeter(() => devicePath);
	const trace = $derived(meter.on ? activityTrace(meter.values) : null);

	$effect(() => {
		live = trace !== null;
	});

	const f = (v: number) => v.toFixed(2);
	/** Column i's x, at its centre, in the drawing's 0..100 box. */
	const xAt = (i: number, n: number) => ((i + 0.5) / n) * 100;
	const yAt = (h: number) => 100 - h * 100;

	const area = $derived.by(() => {
		if (!trace) return '';
		const n = trace.fill.length;
		let d = `M0,100L0,${f(yAt(trace.fill[0]))}`;
		trace.fill.forEach((h, i) => (d += `L${f(xAt(i, n))},${f(yAt(h))}`));
		return `${d}L100,${f(yAt(trace.fill[n - 1]))}L100,100Z`;
	});

	/** The line, broken where a column has none. */
	const line = $derived.by(() => {
		if (!trace) return '';
		const n = trace.line.length;
		let d = '';
		let pen = false;
		trace.line.forEach((h, i) => {
			if (h === null) return void (pen = false);
			d += `${pen ? 'L' : 'M'}${f(xAt(i, n))},${f(yAt(h))}`;
			pen = true;
		});
		return d;
	});
</script>

{#if trace}
	<svg class="activity" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-activity>
		<path class="fill" d={area} />
		{#if trace.threshold !== null}
			<line class="threshold" x1="0" x2="100" y1={yAt(trace.threshold)} y2={yAt(trace.threshold)} vector-effect="non-scaling-stroke" />
		{/if}
		<path class="line" d={line} style="stroke: {ink};" vector-effect="non-scaling-stroke" />
	</svg>
{/if}

<style>
	.activity {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.fill {
		fill: var(--foreground);
		opacity: 0.22;
	}
	.threshold {
		stroke: var(--foreground);
		stroke-width: 1px;
		stroke-dasharray: 3 3;
		opacity: 0.5;
	}
	.line {
		fill: none;
		stroke-width: 1.5px;
		stroke-linejoin: round;
	}
</style>
