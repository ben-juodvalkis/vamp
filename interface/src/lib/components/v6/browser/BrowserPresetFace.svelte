<script lang="ts">
	/**
	 * A live face on a browser preset tile (2026-10-25, ADR-478): the preset's
	 * own control — the XY, slider or tone pad its FX-grid tile is — at the
	 * values its file saves, drawn behind the tile's name (`presetFaces`). A
	 * tap loads the preset as it is; a drag loads it AND sets the values the
	 * finger chooses, as a ghost grid tile does, applied to the device this
	 * load lands (`services/presetDragLoad`).
	 *
	 * The saved values come from the Mac once the tile is near the screen
	 * (`services/presetParams`); until then, or for a class with no face,
	 * nothing is drawn and the tile is the plain button it always was.
	 */
	import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import ToneCurvePad from '$lib/components/v6/device-panel/ToneCurvePad.svelte';
	import { presetParams, type PresetParams } from '$lib/services/presetParams';
	import { presetFace, type LomValues } from './presetFaces';
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
		beginDrag: (className: string, values: LomValues) => PresetDrag | null;
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
		if (!el || !/\.ad[vg]$/i.test(path ?? '')) return;
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

	const found = $derived(presetFace(saved));
	$effect(() => {
		onFaced?.(found !== null);
	});
	const color = $derived(schemeFromInk(ink));

	// The values the face shows: the preset's, then the finger's while it drags.
	let dragged = $state<LomValues | null>(null);
	const shown = $derived(found ? { ...found.values, ...(dragged ?? {}) } : {});

	let drag: PresetDrag | null = null;
	function move(writes: LomValues) {
		if (!found || !saved) return;
		dragged = { ...(dragged ?? {}), ...writes };
		if (!drag) drag = beginDrag(saved.className, dragged);
		drag?.update(dragged);
	}
	function release() {
		if (!drag) return;
		drag.end();
		drag = null;
		afterDrag?.();
	}
	// The tile is the preset again once a drag has been handed off.
	$effect(() => {
		void preset.fullPath;
		dragged = null;
	});
</script>

<!-- The tile's own click is a load too: a press here is the face's alone. -->
<div
	class="preset-face"
	class:live={found !== null}
	bind:this={host}
	role="presentation"
	onclick={(e) => e.stopPropagation()}
	onpointerup={release}
	onpointercancel={release}
>
	{#if found}
		{@const face = found.face}
		{#if face.kind === 'xy'}
			{@const at = face.read(shown)}
			<DeviceXY
				xValue={at.x}
				yValue={at.y}
				showCurve={face.curve !== undefined}
				curveType={face.curve?.(shown)}
				{color}
				{onTap}
				onInteraction={(x, y) => move(face.write(x, y, shown))}
			/>
		{:else if face.kind === 'slider'}
			<!-- The tile's name is the label; the fill stays soft so it reads over it. -->
			<div class="slider-face">
			<DeviceSlider
				value={face.read(shown)}
				title=""
				orientation="vertical"
				labelOrientation="horizontal"
				labelSize="small"
				{color}
				{onTap}
				onInteraction={(t) => move(face.write(t, shown))}
			/>
			</div>
		{:else}
			{@const eq = face.read(shown)}
			<ToneCurvePad
				title=""
				low={eq.low}
				mid={eq.mid}
				midFreq={eq.midFreq}
				high={eq.high}
				{color}
				{onTap}
				onLow={(v) => move({ 2: v })}
				onMid={(f, g) => move({ 4: f, 3: g })}
				onHigh={(v) => move({ 5: v })}
			/>
		{/if}
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
	.slider-face {
		display: flex;
		opacity: 0.5;
	}
	.slider-face > :global(*) {
		flex: 1 1 auto;
		min-width: 0;
	}
</style>
