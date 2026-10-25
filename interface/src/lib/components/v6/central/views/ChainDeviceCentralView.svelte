<script lang="ts">
	/**
	 * The generic device view: what the chain overview opens for a device
	 * the app has no view for — a plug-in, a Max device it does not know.
	 * One slider per parameter Live reports (Device On aside), up to
	 * twelve, under the device's name. A plug-in reports the parameters
	 * configured for it in Live, which is the set a performer chose.
	 *
	 * Shows the device the overview opened it on (its pick), so the blue
	 * hand moving elsewhere in Live does not swap it out from under you.
	 */
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { fxChainStore } from '$lib/stores/v6/fxChainStore.svelte';
	import DeviceSlider from '$lib/components/v6/device-panel/DeviceSlider.svelte';
	import { familyScheme } from '$lib/config/devicePresets';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import { glyphForName } from '$lib/config/controlGlyphMap';
	import DeviceEmptyState from '../DeviceEmptyState.svelte';
	import { CHAIN_DEVICE_VIEW } from './chainDeviceView';

	const MAX_SLIDERS = 12;

	const device = $derived.by(() => {
		const picked = fxChainStore.pickFor(selectedTrackStore.selectedTrackPath, CHAIN_DEVICE_VIEW);
		return selectedTrackStore.devicesByPath.find((d) => d.devicePath === picked);
	});
	const scheme = familyScheme('utility');
	const color = $derived({
		primary: trackInk(scheme.primary, paintModeReactive()),
		secondary: scheme.secondary,
		accent: trackInk(scheme.accent, paintModeReactive())
	});

	const params = $derived.by(() => {
		if (!device) return [];
		const names = selectedTrackStore.paramNamesForDevice(device as never);
		const out: { index: number; name: string; value: number; min: number; max: number }[] = [];
		for (let i = 1; i < names.length && out.length < MAX_SLIDERS; i++) {
			const path = selectedTrackStore.paramPath(device, i);
			const range = selectedTrackStore.paramRange(path) ?? { min: 0, max: 1 };
			const value = selectedTrackStore.paramValueArmed(path) ?? range.min;
			out.push({ index: i, name: names[i], value, ...range });
		}
		return out;
	});

	function write(index: number, min: number, max: number, t: number) {
		if (!device) return;
		selectedTrackStore.setParamValue(selectedTrackStore.paramPath(device, index), min + t * (max - min));
	}
</script>

{#if device}
	<div class="chain-device-view" data-density="compact">
		<div class="eyebrow">{device.name}</div>
		<div class="sliders">
			{#each params as p (p.index)}
				<div class="slot">
					<DeviceSlider
						value={(p.value - p.min) / (p.max - p.min || 1)}
						title={p.name}
						icon={glyphForName(p.name)}
						orientation="vertical"
						labelOrientation="horizontal"
						{color}
						onInteraction={(t) => write(p.index, p.min, p.max, t)}
					/>
				</div>
			{/each}
		</div>
	</div>
{:else}
	<DeviceEmptyState glyph="◌" message="Tap a device in the chain" color={color.primary} />
{/if}

<style>
	.chain-device-view {
		padding: var(--central-inset);
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--central-gap);
	}
	.eyebrow {
		text-align: center;
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
	.sliders {
		flex: 1;
		display: flex;
		gap: var(--central-gap);
		min-height: 0;
	}
	.slot {
		flex: 1 1 0;
		min-width: 40px;
		display: flex;
		min-height: 0;
	}
</style>
