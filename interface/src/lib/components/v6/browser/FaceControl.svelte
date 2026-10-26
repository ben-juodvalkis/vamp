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
	/** The chain overview and the browser draw the device's picture; the FX grid does not. */
	const pictured = getContext<boolean>(PICTURE_CONTEXT) === true;
	const picture = $derived(pictured && control.kind !== 'eq' ? control.picture : undefined);
	// Over a picture the title would sit on it (user, 2026-10-26: "the label
	// doesn't clash with the icon"); where pictures draw, the device is named
	// above the control already (the chain cell's head, the tile's name band).
	const title = $derived(titled && !picture ? control.title : '');
	const mark = $derived(icon ?? (pictured && control.kind !== 'eq' ? control.icon : undefined));
	/** The slider's filled region as a clip-path, as `DeviceSlider` clips its inverse label: from the floor, or from `center`. */
	function fillClip(level: number, center?: number): string {
		const lo = (center === undefined ? 0 : Math.min(center, level)) * 100;
		const hi = (center === undefined ? level : Math.max(center, level)) * 100;
		if (hi - lo <= 0) return 'inset(0 0 100% 0)';
		return orientation === 'vertical' ? `inset(${100 - hi}% 0 ${lo}% 0)` : `inset(0 ${100 - hi}% 0 ${lo}%)`;
	}
</script>

{#if control.kind === 'xy'}
	{@const at = control.read(get)}
	{@const curve = control.curve?.(get)}
	{#snippet xyPicture()}
		{#if picture}<DevicePicture kind={picture} x={at.x} y={at.y} variant={control.pictureVariant?.(get)} ink={color.primary} />{/if}
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
			<!-- Two layers, as the slider draws its label: the device's ink on
			     the well, and a copy clipped to the fill in the on-fill ink, so
			     the picture reads wherever the fill has risen over it (the
			     user, 2026-10-26). -->
			<div class="slider-picture"><DevicePicture kind={picture} x={level} ink={color.primary} /></div>
			<div class="slider-picture slider-picture--inverse" style="clip-path: {fillClip(level, control.center)};">
				<DevicePicture kind={picture} x={level} ink="var(--flat-on-fg)" />
			</div>
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
		opacity: 0.45;
	}
	.slider-face.soft .slider-picture {
		opacity: 0.8;
	}
	.slider-picture--inverse,
	.slider-face.soft .slider-picture--inverse {
		opacity: 0.9;
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
