<script lang="ts">
	/**
	 * A Compressor's activity view as Live shows it (ADR-543): the signal's
	 * level over time as a fill rising from the floor, the gain-reduction
	 * line over it and the threshold across, scrolling right to left. Heights
	 * are Live's own scale (`activityTrace`), so the drawing is Live's
	 * picture; it scrolls at Live's speed but smoothly (`ActivityScroll`:
	 * Live steps), and shows as many columns as the box has room for at 2 px
	 * a column, the newest, so a narrow cell shows the last second or so
	 * rather than squeezing every hit into a spike. Holds the device's watch
	 * while mounted; draws nothing while the `liveMeters` switch is off or
	 * there is no reading, and says which through `live`. Absolutely placed:
	 * the host gives it a positioned box.
	 */
	import { onDestroy } from 'svelte';
	import { useLiveMeter } from './useLiveMeter.svelte';
	import { activityTrace } from '$lib/stores/v6/liveMeterStore.svelte';
	import { ActivityScroll, fillGaps } from './activityScroll';

	interface Props {
		devicePath: string | undefined;
		ink: string;
		live?: boolean;
	}

	let { devicePath, ink, live = $bindable(false) }: Props = $props();
	const meter = useLiveMeter(() => devicePath);
	const trace = $derived(meter.on ? activityTrace(meter.values) : null);

	let width = $state(0);
	/** Columns drawn: the box's width at 2 px a column, at most Live's whole display. */
	const shown = $derived(Math.max(24, Math.min(trace?.fill.length ?? 128, Math.round(width / 2))));

	let area = $state('');
	let line = $state('');
	let threshold = $state<number | null>(null);

	let scroll = new ActivityScroll();
	let frame: number | null = null;
	let last = 0;

	const f = (v: number) => v.toFixed(2);
	const yAt = (h: number) => 100 - h * 100;

	function draw(): void {
		const left = scroll.head - shown;
		const first = Math.floor(left);
		const xAt = (c: number) => ((c + 0.5 - left) / shown) * 100;
		let fillPath = '';
		let linePath = '';
		let lastX = 0;
		for (let c = first; c <= Math.ceil(scroll.head); c++) {
			const h = scroll.at(scroll.fill, c);
			const l = scroll.at(scroll.line, c);
			if (h === undefined || l === undefined) continue;
			const x = f(xAt(c));
			if (!fillPath) {
				fillPath = `M${x},100`;
				linePath = `M${x},${f(yAt(l))}`;
			} else linePath += `L${x},${f(yAt(l))}`;
			fillPath += `L${x},${f(yAt(h))}`;
			lastX = xAt(c);
		}
		area = fillPath ? `${fillPath}L${f(lastX)},100Z` : '';
		line = fillPath ? linePath : '';
	}

	function tick(now: number): void {
		const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
		last = now;
		scroll.advance(dt);
		draw();
		frame = requestAnimationFrame(tick);
	}

	$effect(() => {
		const t = trace;
		live = t !== null;
		if (!t) {
			if (frame !== null) cancelAnimationFrame(frame);
			frame = null;
			last = 0;
			scroll = new ActivityScroll();
			area = '';
			line = '';
			return;
		}
		// The threshold moves only when it moves by more than a pixel of Live's.
		if (t.threshold === null || threshold === null || Math.abs(t.threshold - threshold) > 0.01) threshold = t.threshold;
		scroll.push(t.fill, fillGaps(t.line), performance.now());
		if (frame === null) frame = requestAnimationFrame(tick);
	});

	onDestroy(() => {
		if (frame !== null) cancelAnimationFrame(frame);
	});
</script>

<div class="activity-box" bind:clientWidth={width}>
	{#if trace && area}
		<svg class="activity" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-activity>
			<path class="fill" d={area} />
			{#if threshold !== null}
				<line class="threshold" x1="0" x2="100" y1={yAt(threshold)} y2={yAt(threshold)} vector-effect="non-scaling-stroke" />
			{/if}
			<path class="line" d={line} style="stroke: {ink};" vector-effect="non-scaling-stroke" />
		</svg>
	{/if}
</div>

<style>
	.activity-box {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}
	.activity {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
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
