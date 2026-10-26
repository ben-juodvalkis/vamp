<script lang="ts" module>
	/** The device classes a preset tile can draw a face for. */
	export const FACED_PRESET_CLASSES = new Set(['AutoFilter2']);
</script>

<script lang="ts">
	/**
	 * A live face on a browser preset tile (2026-10-25, ADR-478): the preset's
	 * own control at its saved values — an Auto Filter's curve where the
	 * preset leaves it — drawn behind the tile's name. A tap loads the preset
	 * as it is; a drag loads it AND sets the values the finger chooses, as a
	 * ghost tile on the FX grid does, applied to the device this load lands
	 * (`services/presetDragLoad`).
	 *
	 * The saved values come from the Mac once the tile is near the screen
	 * (`services/presetParams`); until then, or for a class with no face,
	 * nothing is drawn and the tile is the plain button it always was.
	 */
	import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
	import { presetParams, type PresetParams } from '$lib/services/presetParams';
	import { autoFilterCurve, autoFilterFromPreset, AUTO_FILTER_PARAM } from '$lib/components/v6/device-panel/autoFilterParams';
	import { schemeFromInk } from '$lib/config/devicePresets';
	import type { Preset } from '$lib/services/adapters/browserAdapter';
	import type { PresetDrag } from '$lib/services/presetDragLoad.svelte';

	interface Props {
		preset: Preset;
		/** The tile's ink, a concrete color. */
		ink: string;
		/** A tap: load the preset as saved. */
		onTap: () => void;
		/** The first move of a drag: start the load, with the class it arrives as. */
		beginDrag: (className: string, values: Record<number, number>) => PresetDrag | null;
		/** The drag ended. */
		afterDrag?: () => void;
		/** Told whether a face is drawn, so the tile can hand it the gesture. */
		onFaced?: (faced: boolean) => void;
	}

	let { preset, ink, onTap, beginDrag, afterDrag, onFaced }: Props = $props();

	let host = $state<HTMLElement | null>(null);
	let saved = $state<PresetParams | null>(null);

	// Ask the Mac once the tile is near the screen; a grid of hundreds asks for
	// the handful in view.
	$effect(() => {
		const el = host;
		const path = preset.fullPath;
		saved = null;
		if (!el || !path?.toLowerCase().endsWith('.adv')) return;
		let cancelled = false;
		const load = () => presetParams(path).then((p) => !cancelled && (saved = p));
		if (typeof IntersectionObserver === 'undefined') {
			void load();
			return () => (cancelled = true);
		}
		const obs = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					obs.disconnect();
					void load();
				}
			},
			{ rootMargin: '150px' }
		);
		obs.observe(el);
		return () => {
			cancelled = true;
			obs.disconnect();
		};
	});

	const filter = $derived(saved?.className === 'AutoFilter2' ? autoFilterFromPreset(saved.params) : null);
	$effect(() => {
		onFaced?.(filter !== null);
	});
	const color = $derived(schemeFromInk(ink));

	let drag: PresetDrag | null = null;
	function move(x: number, y: number) {
		const values = { [AUTO_FILTER_PARAM.frequency]: x, [AUTO_FILTER_PARAM.resonance]: y };
		if (!drag) drag = beginDrag('AutoFilter2', values);
		drag?.update(values);
	}
	function release() {
		if (!drag) return;
		drag.end();
		drag = null;
		afterDrag?.();
	}
</script>

<!-- The tile's own click is a load too: a press here is the face's alone. -->
<div class="preset-face" class:live={filter !== null} bind:this={host} role="presentation" onclick={(e) => e.stopPropagation()}>
	{#if filter}
		<DeviceXY
			xValue={filter.frequency}
			yValue={filter.resonance}
			showCurve
			curveType={autoFilterCurve(filter.type)}
			{color}
			{onTap}
			onInteraction={move}
			onRelease={release}
		/>
	{/if}
</div>

<style>
	.preset-face {
		position: absolute;
		inset: 0;
		z-index: 0;
		display: flex;
	}
	/* Nothing to drive yet: the tile underneath takes the press. */
	.preset-face:not(.live) {
		pointer-events: none;
	}
	.preset-face > :global(*) {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
	}
</style>
