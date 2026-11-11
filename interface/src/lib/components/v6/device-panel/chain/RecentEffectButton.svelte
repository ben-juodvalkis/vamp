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
	import { addEffectToChain, nativeClassOf, type RecentEffect } from '$lib/services/recentEffects.svelte';
	import { press } from '$lib/actions/press';

	// Not `effect`: a variable of that name turns `$effect` into a store read.
	// `compact`: one line, the name alone, `label` in its place when given (the chain's palette bar);
	// `ink`: the device's family colour, drawn faintly so a chip says what kind of effect it is.
	let { recent, compact = false, label, ink }: { recent: RecentEffect; compact?: boolean; label?: string; ink?: string } = $props();

	let saved = $state<PresetParams | null>(null);
	$effect(() => {
		const path = recent.fullPath;
		saved = null;
		if (!/\.(adv|adg|amxd)$/i.test(path)) return;
		let cancelled = false;
		void presetParams(path).then((p) => !cancelled && (saved = p));
		return () => (cancelled = true);
	});

	// A default (a Live device by name, an amp rack by its Place) reads no
	// file: its class, and its control at rest.
	const nativeClass = $derived(nativeClassOf(recent));
	const className = $derived(saved?.className ?? nativeClass ?? '');
	const found = $derived.by(() => {
		if (saved) return presetControl(saved, recent.name);
		const control = recent.preset || nativeClass ? DEVICE_CONTROLS[recent.preset ?? deviceKeyForPreset(className, recent.name) ?? '']?.control : undefined;
		return control ? { control, values: {} as Record<number, number> } : null;
	});

	const CURVE_MAX_CUTOFF = 0.55;
	// A filter (the Auto Filter) draws its response curve at the saved
	// cutoff and resonance, as its tile does (the user, 2026-10-26).
	const curve = $derived.by(() => {
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
	const key = $derived(deviceKeyForPreset(className, recent.name));
	const mark = $derived.by(() => {
		// The Utility's cell is its meter: here, its gain mark.
		if (key === 'utility') return 'gain' as const;
		const control = key ? DEVICE_CONTROLS[key]?.control : undefined;
		return control && control.kind !== 'eq' && !control.picture ? (control.icon ?? null) : null;
	});
	/** Devices drawn generically, having no picture of their own (the user, 2026-10-26). */
	const generic = $derived(genericPicture(className, recent.name));

	const picture = $derived.by(() => {
		if (isWheels) return { kind: 'wheels' as const, x: 0, y: 0 };
		if (generic) return { kind: generic, x: 0, y: 0 };
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
	class:compact
	class:inked={!!ink}
	style:--chip-ink={ink}
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
	<!-- The name alone: the dashed ghost already says a tap adds it (the
	     user, 2026-11-05; "+ Echo" from 2026-10-26). -->
	<span class="recent-name">{label ?? recent.name}</span>
</button>

<style>
	/* A ghost, as the + Effect cell beside it is drawn (the user, the same
	   day): no fill of its own, a dashed line in the chain's ghost ink
	   (`--ghost-line`, ChainOverview), the picture faint and the name in
	   the tertiary ink, so it reads without pulling the eye from the chain;
	   full ink while pressed. */
	/* A tile: the picture over the name, centered (two to a row). */
	.recent-effect {
		min-height: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		padding: 6px 4px 5px;
		border: 1px dashed var(--ghost-line, color-mix(in oklab, var(--fg-tertiary) 45%, transparent));
		border-radius: var(--ghost-radius, 4px);
		background: transparent;
		color: var(--fg-tertiary);
		font: inherit;
		text-align: center;
		cursor: pointer;
		overflow: hidden;
		-webkit-tap-highlight-color: transparent;
		transition: background-color var(--t-fast) var(--ease-precise), color var(--t-fast) var(--ease-precise);
	}
	.recent-effect > .recent-picture {
		opacity: 0.6;
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
	/* Inked: the line and the name lean toward the family colour, a breath of
	   it behind; still a ghost beside the chain's own cells. */
	.recent-effect.inked {
		border-color: color-mix(in oklab, var(--chip-ink) 40%, transparent);
		background: color-mix(in oklab, var(--chip-ink) 6%, transparent);
		color: color-mix(in oklab, var(--chip-ink) 55%, var(--fg-tertiary));
	}
	.recent-effect.inked:active {
		background: color-mix(in oklab, var(--chip-ink) 22%, transparent);
		color: var(--foreground);
	}
	/* One line, the name alone. */
	.recent-effect.compact {
		padding: 2px 4px;
	}
	.recent-effect.compact > .recent-picture {
		display: none;
	}
	/* A long name (Drum Buss, Pitch Hack) wraps to two lines, between words. */
	.recent-effect.compact > .recent-name {
		font-size: 0.8125rem;
		line-height: 1.1;
		white-space: normal;
		overflow-wrap: normal;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}
	.recent-name {
		max-width: 100%;
		min-width: 0;
		flex: 0 0 auto;
		font-size: 0.71875rem;
		font-weight: 500;
		letter-spacing: 0.005em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
