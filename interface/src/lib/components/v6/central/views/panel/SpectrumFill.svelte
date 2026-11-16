<script lang="ts">
	/**
	 * A device's spectrum as Live shows it (ADR-541), drawn as a filled shape
	 * behind whatever graph hosts it: frequency across on the host's own log
	 * axis (`axis`, Hz at the left and right edges; 20 Hz–20 kHz by default,
	 * the Auto Filter's and `FilterCurve`'s), level up from `floorDb` to
	 * `topDb`. Holds the device's watch while mounted; draws nothing without
	 * a fresh reading or while the `liveMeters` switch is off. Absolutely
	 * placed: the host gives it a positioned box.
	 */
	import { useLiveMeter } from './useLiveMeter.svelte';
	import { bandHz, SPECTRUM_FLOOR_DB } from '$lib/stores/v6/liveMeterStore.svelte';

	interface Props {
		devicePath: string | undefined;
		ink: string;
		axis?: readonly [number, number];
		floorDb?: number;
		topDb?: number;
	}

	let { devicePath, ink, axis = [20, 20000], floorDb = SPECTRUM_FLOOR_DB, topDb = 0 }: Props = $props();
	const meter = useLiveMeter(() => devicePath);

	/** The spectrum's outline as an SVG path in a 0..100 box, closed along the floor. */
	const path = $derived.by(() => {
		const bands = meter.values;
		if (bands.length === 0) return '';
		const span = Math.log(axis[1] / axis[0]);
		const points = bands.map((db, i) => {
			const x = (Math.log(bandHz(i) / axis[0]) / span) * 100;
			const y = 100 - Math.min(1, Math.max(0, (db - floorDb) / (topDb - floorDb))) * 100;
			return `${x.toFixed(2)},${y.toFixed(2)}`;
		});
		const first = points[0].split(',')[0];
		const last = points[points.length - 1].split(',')[0];
		return `M${first},100L${points.join('L')}L${last},100Z`;
	});
</script>

{#if path}
	<svg class="spectrum" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-spectrum>
		<path d={path} style="fill: {ink};" />
	</svg>
{/if}

<style>
	.spectrum {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		opacity: 0.28;
	}
</style>
