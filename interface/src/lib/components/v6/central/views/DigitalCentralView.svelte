<script lang="ts">
	import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';

	// Props are accepted for API compatibility; `color` overrides the
	// slot's color when supplied.
	interface Props {
		device?: any;
		color?: DeviceColorScheme;
	}
	let { color }: Props = $props();

	const fx = useFxGridSlot('digital');

	// Bug fix: parameter writes used to call setParamValue directly,
	// which silently dropped writes while the slot was ghost or loading.
	// Routing through fx.sendParam queues pending params and triggers
	// load on first ghost write — matching every other view's behaviour.
	let param3Value = $derived((fx.paramValue(3) ?? 64) / 127);
	let param4Value = $derived((fx.paramValue(4) ?? 0) / 127);

	// GRATICULE §5.5: calibrate the device ink at injection (hue preserved).
	let effectiveColor = $derived.by(() => {
		const c = color ?? fx.color;
		return {
			primary: trackInk(c.primary, paintModeReactive()),
			secondary: c.secondary,
			accent: trackInk(c.accent, paintModeReactive())
		};
	});

	// LFO X/Y readouts via Live's GUI formatter (ADR-352). Either axis
	// may be hot — we surface whichever has a fresh display string,
	// preferring X (the rate-ish axis on most LFO XYs). Falls back to
	// the bare "LFO" when neither is hot. Same inline title pattern as
	// AutoFilter LFO.
	let lfoXDisplay = $derived(fx.paramDisplay(3));
	let lfoYDisplay = $derived(fx.paramDisplay(4));
	let lfoTitle = $derived(
		lfoXDisplay
			? `LFO · ${lfoXDisplay}`
			: lfoYDisplay
				? `LFO · ${lfoYDisplay}`
				: 'LFO'
	);
</script>

<div class="h-full w-full flex flex-col items-center justify-center p-(--central-inset) relative">
	<DeviceXY
		xValue={param3Value}
		yValue={param4Value}
		title={lfoTitle}
		icon="lfo"
		isGhost={fx.isGhost}
		showCurve={false}
		color={effectiveColor}
		onTap={() => fx.loadIfGhost()}
		onInteraction={(x, y) => {
			fx.sendParam(3, Math.round(x * 127));
			fx.sendParam(4, Math.round(y * 127));
		}}
	/>

</div>
