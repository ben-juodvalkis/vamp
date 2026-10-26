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
	import FaceControl from './FaceControl.svelte';
	import { presetParams, type PresetParams } from '$lib/services/presetParams';
	import { presetControl, resolveParam, DEVICE_CONTROLS, type ParamRef, type Writes } from '$lib/components/v6/device-panel/deviceControls';
	import { DEVICE_PRESETS } from '$lib/config/devicePresets';
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
		beginDrag: (className: string, values: Writes) => PresetDrag | null;
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
		// A Max device's `.amxd` saves nothing the server reads: its control rests where it rests.
		if (/\.amxd$/i.test(path ?? '')) {
			saved = { className: '', params: {} };
			return;
		}
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

	const found = $derived(presetControl(saved, preset.name));
	$effect(() => {
		onFaced?.(found !== null);
	});
	const color = $derived(schemeFromInk(ink));
	/** The class the device arrives as: the file's, or for an `.amxd` the device type's. */
	const arrivesAs = $derived.by(() => {
		if (saved?.className) return saved.className;
		const key = Object.keys(DEVICE_CONTROLS).find((k) => DEVICE_PRESETS[k]?.defaultName === preset.name);
		return key ? (DEVICE_PRESETS[key].expectedClassName ?? '') : '';
	});

	// The values the control shows: the preset's, then the finger's while it drags.
	let dragged = $state<Map<string, [ParamRef, number]>>(new Map());
	const refKey = (ref: ParamRef) => (typeof ref === 'number' ? String(ref) : ref.name);
	const get = (ref: ParamRef) => dragged.get(refKey(ref))?.[1] ?? found?.values[resolveParam(ref)];

	let drag: PresetDrag | null = null;
	function move(writes: Writes) {
		if (!found) return;
		const next = new Map(dragged);
		for (const [ref, value] of writes) next.set(refKey(ref), [ref, value]);
		dragged = next;
		const all = [...next.values()];
		if (!drag) drag = beginDrag(arrivesAs, all);
		drag?.update(all);
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
		dragged = new Map();
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
		<FaceControl control={found.control} {get} {color} {onTap} onMove={move} titled={false} soft />
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
