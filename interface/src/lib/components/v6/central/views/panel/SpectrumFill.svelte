<script lang="ts">
	/**
	 * A device's spectrum as Live shows it (ADR-542), drawn behind whatever
	 * graph hosts it: frequency across on the host's own log axis (`axis`, Hz
	 * at the left and right edges; 20 Hz–20 kHz by default, the Auto Filter's
	 * and `FilterCurve`'s), level up from `floorDb` to `topDb`. Holds the
	 * device's watch while mounted; draws nothing while the `liveMeters`
	 * switch is off. Absolutely placed: the host gives it a positioned box.
	 *
	 * The look (Ben, 2026-11-16: "any kind of smoothing or anything that
	 * might look nice?"): the bands move as a meter does, every frame, rising
	 * at once and falling back gently (`easeBands`), under one rounded outline
	 * (`smoothPath`), filled with the device's ink brighter at the top and
	 * edged with a thin line. With no reading the shape sinks to the floor and
	 * the frame loop stops once nothing moves.
	 */
	import { onDestroy } from 'svelte';
	import { useLiveMeter } from './useLiveMeter.svelte';
	import { easeBands, smoothPath, type Point } from './spectrumDraw';
	import { bandHz, SPECTRUM_BANDS, SPECTRUM_FLOOR_DB } from '$lib/stores/v6/liveMeterStore.svelte';

	interface Props {
		devicePath: string | undefined;
		ink: string;
		axis?: readonly [number, number];
		floorDb?: number;
		topDb?: number;
	}

	let { devicePath, ink, axis = [20, 20000], floorDb = SPECTRUM_FLOOR_DB, topDb = 0 }: Props = $props();
	const meter = useLiveMeter(() => devicePath);

	/** One gradient per drawing: several spectra share the page. */
	const gradientId = `spectrum-fill-${Math.random().toString(36).slice(2, 9)}`;

	let line = $state('');
	let area = $state('');

	const shown: number[] = [];
	let target: number[] = [];
	let frame: number | null = null;
	let last = 0;

	function draw(): void {
		if (shown.length === 0) {
			line = '';
			area = '';
			return;
		}
		const span = Math.log(axis[1] / axis[0]);
		const points: Point[] = shown.map((db, i) => ({
			x: (Math.log(bandHz(i) / axis[0]) / span) * 100,
			y: 100 - Math.min(1, Math.max(0, (db - floorDb) / (topDb - floorDb))) * 100
		}));
		line = smoothPath(points);
		const first = points[0].x.toFixed(2);
		const end = points[points.length - 1].x.toFixed(2);
		area = `M${first},100L${line.slice(1)}L${end},100Z`;
	}

	function tick(now: number): void {
		const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
		last = now;
		const moving = easeBands(shown, target, dt);
		draw();
		frame = moving ? requestAnimationFrame(tick) : null;
		if (!moving) last = 0;
	}

	function wake(): void {
		if (frame === null) frame = requestAnimationFrame(tick);
	}

	$effect(() => {
		const bands = meter.values;
		// No reading: sink to the floor, then stop drawing.
		target = bands.length > 0 ? [...bands] : shown.map(() => floorDb);
		if (bands.length > 0 && shown.length !== bands.length) {
			shown.length = 0;
			shown.push(...Array.from({ length: SPECTRUM_BANDS }, () => floorDb));
		}
		if (target.length > 0) wake();
	});

	onDestroy(() => {
		if (frame !== null) cancelAnimationFrame(frame);
	});
</script>

{#if meter.on && line}
	<svg class="spectrum" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-spectrum>
		<defs>
			<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color={ink} stop-opacity="0.42" />
				<stop offset="1" stop-color={ink} stop-opacity="0.06" />
			</linearGradient>
		</defs>
		<path class="area" d={area} fill="url(#{gradientId})" />
		<path class="edge" d={line} style="stroke: {ink};" vector-effect="non-scaling-stroke" />
	</svg>
{/if}

<style>
	.spectrum {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.edge {
		fill: none;
		stroke-width: 1px;
		stroke-opacity: 0.55;
		stroke-linejoin: round;
	}
</style>
