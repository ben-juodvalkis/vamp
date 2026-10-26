<script lang="ts">
	/**
	 * A device's control (`deviceControls`) drawn at the values `get` reads:
	 * its XY, slider or tone pad. The one drawing behind a grid tile, a chain
	 * cell and a browser preset tile (2026-10-26). The caller owns the values
	 * and what a move does.
	 */
	import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import ToneCurvePad from '$lib/components/v6/device-panel/ToneCurvePad.svelte';
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import type { ControlGlyphName } from '$lib/components/v6/device-panel/ControlGlyph.svelte';
	import type { Control, Get, ParamRef, Writes } from '$lib/components/v6/device-panel/deviceControls';
	import { getContext } from 'svelte';
	import DevicePicture from './DevicePicture.svelte';
	import { PICTURE_CONTEXT } from './devicePictures';

	interface Props {
		control: Control;
		get: Get;
		color: DeviceColorScheme;
		/** Live's label for a parameter, for a pad that draws one (Echo's time). */
		display?: (ref: ParamRef) => string | undefined;
		onTap?: () => void;
		/** The parameter writes a gesture makes. */
		onMove: (writes: Writes) => void;
		/** Draw the title; off where a name is drawn over the control (a browser tile). */
		titled?: boolean;
		/** The level line under a soft fill, where a name is drawn over it. */
		soft?: boolean;
		isGhost?: boolean;
		icon?: ControlGlyphName;
		orientation?: 'vertical' | 'horizontal';
		/** A slider's label: small and level on a grid tile, the slider's own default in a central view. */
		labelSize?: 'small' | 'large';
		labelOrientation?: 'vertical' | 'horizontal' | 'auto';
	}

	let {
		control,
		get,
		color,
		display = () => undefined,
		onTap,
		onMove,
		titled = true,
		soft = false,
		isGhost = false,
		icon,
		orientation = 'vertical',
		labelSize = 'small',
		labelOrientation = 'horizontal'
	}: Props = $props();
	const title = $derived(titled ? control.title : '');
	/** The chain overview and the browser draw the device's picture; the FX grid does not. */
	const pictured = getContext<boolean>(PICTURE_CONTEXT) === true;
	const picture = $derived(pictured && control.kind !== 'eq' ? control.picture : undefined);
	const mark = $derived(icon ?? (pictured && control.kind !== 'eq' ? control.icon : undefined));
</script>

{#if control.kind === 'xy'}
	{@const at = control.read(get)}
	{@const curve = control.curve?.(get)}
	{#snippet xyPicture()}
		{#if picture}<DevicePicture kind={picture} x={at.x} y={at.y} ink={color.primary} />{/if}
	{/snippet}
	<DeviceXY
		xValue={at.x}
		yValue={at.y}
		{title}
		icon={mark}
		{isGhost}
		rateLabel={control.label?.(get, display)}
		background={picture ? xyPicture : undefined}
		showCurve={curve !== undefined && curve !== 'none'}
		curveType={curve}
		{color}
		{onTap}
		onInteraction={(x, y) => onMove(control.write(x, y, get))}
	/>
{:else if control.kind === 'slider'}
	{@const level = control.read(get)}
	<!-- Soft: the fill fades so a name reads over it, and a line marks the
	     level at full ink, so a value at 0 still shows a slider (Pedal's
	     Drive, 2026-10-26: a bare tile before). -->
	<div class="slider-face" class:soft style="--level: {level}; --level-ink: {color.primary};">
		{#if picture}
			<div class="slider-picture"><DevicePicture kind={picture} x={level} ink={color.primary} /></div>
		{/if}
		<DeviceSlider
			value={level}
			{title}
			icon={mark}
			{isGhost}
			{orientation}
			readout={control.readout === undefined ? undefined : display(control.readout)}
			centerOrigin={control.center !== undefined}
			centerValue={control.center}
			{labelOrientation}
			{labelSize}
			{color}
			{onTap}
			onInteraction={(t) => onMove(control.write(t, get))}
		/>
	</div>
{:else}
	{@const eq = control.read(get)}
	<ToneCurvePad
		{title}
		low={eq.low}
		mid={eq.mid}
		midFreq={eq.midFreq}
		high={eq.high}
		{isGhost}
		{color}
		{onTap}
		onLow={(v) => onMove(control.low(v))}
		onMid={(f, g) => onMove(control.mid(f, g))}
		onHigh={(v) => onMove(control.high(v))}
	/>
{/if}

<style>
	/* Fills its box as a bare slider does: a tile's box is not a flex container. */
	.slider-face {
		position: relative;
		display: flex;
		width: 100%;
		height: 100%;
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
	}
	.slider-face > :global(*) {
		flex: 1 1 auto;
		min-width: 0;
	}
	/* The picture over the slider's fill, faint, never taking a touch. */
	.slider-picture {
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		opacity: 0.55;
		mix-blend-mode: screen;
	}
	.slider-face.soft::after {
		content: '';
		position: absolute;
		inset-inline: 0;
		bottom: calc(var(--level) * (100% - 3px));
		height: 3px;
		background: var(--level-ink);
		pointer-events: none;
	}
	.slider-face.soft > :global(*) {
		opacity: 0.5;
	}
</style>
