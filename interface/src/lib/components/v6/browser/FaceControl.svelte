<script lang="ts">
	/**
	 * A device's face (`presetFaces`): its XY, slider or tone pad, drawn at the
	 * values handed in. One drawing for both places a face shows (2026-10-26):
	 * a browser preset tile, at the values its file saves, and a chain cell
	 * for a device the FX grid has no tile for, at the values Live reports.
	 * The caller owns the values and what a move does.
	 */
	import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import ToneCurvePad from '$lib/components/v6/device-panel/ToneCurvePad.svelte';
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import type { Face, LomValues } from './presetFaces';

	interface Props {
		face: Face;
		values: LomValues;
		color: DeviceColorScheme;
		onTap?: () => void;
		/** The parameter writes a gesture makes, by LOM index. */
		onMove: (writes: LomValues) => void;
		/** A slider's title; empty where a name is drawn over it (a browser tile). */
		title?: string;
	}

	let { face, values, color, onTap, onMove, title = '' }: Props = $props();
</script>

{#if face.kind === 'xy'}
	{@const at = face.read(values)}
	<DeviceXY
		xValue={at.x}
		yValue={at.y}
		showCurve={face.curve !== undefined}
		curveType={face.curve?.(values)}
		{color}
		{onTap}
		onInteraction={(x, y) => onMove(face.write(x, y, values))}
	/>
{:else if face.kind === 'slider'}
	<!-- The fill stays soft so a name reads over it; a line marks the level
	     at full ink, so a value at 0 still shows a slider (Pedal's Drive,
	     2026-10-26: a bare tile before). -->
	{@const level = face.read(values)}
	<div class="slider-face" style="--level: {level}; --level-ink: {color.primary};">
		<DeviceSlider
			value={level}
			{title}
			orientation="vertical"
			labelOrientation="horizontal"
			labelSize="small"
			{color}
			{onTap}
			onInteraction={(t) => onMove(face.write(t, values))}
		/>
	</div>
{:else}
	{@const eq = face.read(values)}
	<ToneCurvePad
		title=""
		low={eq.low}
		mid={eq.mid}
		midFreq={eq.midFreq}
		high={eq.high}
		{color}
		{onTap}
		onLow={(v) => onMove({ 2: v })}
		onMid={(f, g) => onMove({ 4: f, 3: g })}
		onHigh={(v) => onMove({ 5: v })}
	/>
{/if}

<style>
	.slider-face {
		position: relative;
		display: flex;
	}
	.slider-face::after {
		content: '';
		position: absolute;
		inset-inline: 0;
		bottom: calc(var(--level) * (100% - 3px));
		height: 3px;
		background: var(--level-ink);
		pointer-events: none;
	}
	.slider-face > :global(*) {
		opacity: 0.5;
		flex: 1 1 auto;
		min-width: 0;
	}
</style>
