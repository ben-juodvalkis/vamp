<script lang="ts">
	/**
	 * One of the chain's Recent buttons (ADR-484): an effect added lately,
	 * drawn as a ghost like the + Effect cell, so it does not pull the eye, its device's picture at the
	 * values its file saves (as its browser tile draws them) beside its name.
	 * A tap adds it to this chain again.
	 */
	import DevicePicture from '$lib/components/v6/browser/DevicePicture.svelte';
	import { genericPicture } from '$lib/components/v6/browser/devicePictures';
	import FilterCurve from '$lib/components/v6/device-panel/FilterCurve.svelte';
	import ControlGlyph from '$lib/components/v6/device-panel/ControlGlyph.svelte';
	import constants from '$config/constants.json';
	import { presetParams, type PresetParams } from '$lib/services/presetParams';
	import { presetControl, resolveParam, deviceKeyForPreset, DEVICE_CONTROLS, type ParamRef } from '$lib/components/v6/device-panel/deviceControls';
	import { addEffectToChain, type RecentEffect } from '$lib/services/recentEffects.svelte';
	import { press } from '$lib/actions/press';

	// Not `effect`: a variable of that name turns `$effect` into a store read.
	let { recent }: { recent: RecentEffect } = $props();

	let saved = $state<PresetParams | null>(null);
	$effect(() => {
		const path = recent.fullPath;
		saved = null;
		if (!/\.(adv|adg|amxd)$/i.test(path)) return;
		let cancelled = false;
		void presetParams(path).then((p) => !cancelled && (saved = p));
		return () => (cancelled = true);
	});

	const CURVE_MAX_CUTOFF = 0.55;
	// A filter (the Auto Filter) draws its response curve at the saved
	// cutoff and resonance, as its tile does (the user, 2026-10-26).
	const curve = $derived.by(() => {
		const found = presetControl(saved, recent.name);
		if (!found || found.control.kind !== 'xy' || !found.control.curve) return null;
		const get = (ref: ParamRef) => found.values[resolveParam(ref)];
		const type = found.control.curve(get);
		if (type === 'none' || type === 'eq') return null;
		const at = found.control.read(get);
		// A cutoff saved wide open draws as a flat line, which reads as no
		// filter at all: past the middle it is drawn at the middle, so the
		// button still shows a filter's shape. Below, the true curve.
		return { type, cutoff: Math.min(at.x, CURVE_MAX_CUTOFF), resonance: at.y };
	});

	// MidiWheels has no control entry of its own (its chain cell is the two
	// wheels), so it is known by name and drawn as its wheels.
	const isWheels = $derived(recent.name === constants.devices.midiWheels.deviceName);
	// A control with a mark and no picture (the Wah, the amp racks) draws its mark.
	// By the device's type, so a rack whose file saves no readable macro still has it.
	const key = $derived(deviceKeyForPreset(saved?.className ?? '', recent.name));
	const mark = $derived.by(() => {
		// The Utility's cell is its meter: here, its gain mark.
		if (key === 'utility') return 'gain' as const;
		const control = key ? DEVICE_CONTROLS[key]?.control : undefined;
		return control && control.kind !== 'eq' && !control.picture ? (control.icon ?? null) : null;
	});
	/** Devices drawn generically, having no picture of their own (the user, 2026-10-26). */
	const generic = $derived(genericPicture(saved?.className, recent.name));

	const picture = $derived.by(() => {
		if (isWheels) return { kind: 'wheels' as const, x: 0, y: 0 };
		if (generic) return { kind: generic, x: 0, y: 0 };
		const found = presetControl(saved, recent.name);
		// An EQ (the tone pad) draws a generic EQ curve (the user, 2026-10-26).
		if (found?.control.kind === 'eq') return { kind: 'eqcurve' as const, x: 0, y: 0 };
		if (!found || !found.control.picture) return null;
		const get = (ref: ParamRef) => found.values[resolveParam(ref)];
		if (found.control.kind === 'xy') {
			const at = found.control.read(get);
			return { kind: found.control.picture, x: at.x, y: at.y, variant: found.control.pictureVariant?.(get) };
		}
		return { kind: found.control.picture, x: found.control.read(get), y: 0 };
	});
</script>

<button
	type="button"
	class="recent-effect"
	aria-label="Add {recent.name} again"
	data-debug="chain-recent"
	use:press={{ onPress: () => void addEffectToChain(recent), touchAction: 'none', stopPropagation: true }}
>
	<span class="recent-picture" aria-hidden="true">
		{#if curve}
			<FilterCurve cutoff={curve.cutoff} resonance={curve.resonance} curveType={curve.type} width={300} height={300} curveColor="var(--muted-foreground)" />
		{:else if picture}
			<DevicePicture kind={picture.kind} x={picture.x} y={picture.y} variant={'variant' in picture ? picture.variant : undefined} ink="var(--muted-foreground)" />
		{:else if mark}
			<span class="recent-mark"><ControlGlyph name={mark} /></span>
		{/if}
	</span>
	<!-- "+ Echo": what a tap does (the user, 2026-10-26). -->
	<span class="recent-name">+ {recent.name}</span>
</button>

<style>
	/* A ghost, as the + Effect cell beside it is drawn (the user, the same
	   day): no fill of its own, a dashed line, the picture and name in muted
	   ink at the ghost opacity; full ink while pressed. */
	/* A tile: the picture over the name, centered (two to a row). */
	.recent-effect {
		min-height: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		padding: 4px;
		border: 1px dashed var(--line-strong);
		border-radius: 2px;
		background: transparent;
		color: var(--muted-foreground);
		font: inherit;
		text-align: center;
		cursor: pointer;
		overflow: hidden;
		-webkit-tap-highlight-color: transparent;
	}
	.recent-effect > span {
		opacity: var(--opacity-ghost);
	}
	.recent-effect:active {
		background: var(--secondary);
		color: var(--foreground);
	}
	.recent-effect:active > span {
		opacity: 1;
	}
	.recent-picture {
		position: relative;
		flex: 1 1 0;
		align-self: stretch;
		min-height: 0;
		max-height: 34px;
	}
	.recent-picture > :global(*) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	/* The curve alone: its shaded fill reads as a block at this size. */
	.recent-picture :global(.response-fill),
	.recent-picture :global(.response-echo) {
		display: none;
	}
	.recent-picture :global(.response-curve) {
		stroke-width: 6;
	}
	.recent-mark {
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.recent-mark :global(svg) {
		height: 100%;
		width: auto;
	}
	.recent-name {
		max-width: 100%;
		min-width: 0;
		flex: 0 0 auto;
		font-size: 0.75rem;
		font-weight: var(--font-weight-medium);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
