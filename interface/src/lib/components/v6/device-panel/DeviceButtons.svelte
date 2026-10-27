<script lang="ts">
	/**
	 * A device's control as a few buttons (`deviceControls`' `buttons` kind,
	 * 2026-10-27): Chord's +12 and -12. Each fires at finger-down and lights
	 * while its value is the device's; the caller decides what a press
	 * writes and where (a ghost's press loads the device with it).
	 */
	import { press } from '$lib/actions/press';
	import type { DeviceColorScheme } from '$lib/config/devicePresets';

	interface Props {
		buttons: ReadonlyArray<{ label: string; on: boolean }>;
		color: DeviceColorScheme;
		isGhost?: boolean;
		orientation?: 'vertical' | 'horizontal';
		onPress: (index: number) => void;
	}

	let { buttons, color, isGhost = false, orientation = 'vertical', onPress }: Props = $props();
</script>

<div class="device-buttons" class:horizontal={orientation === 'horizontal'} class:ghost={isGhost} style="--btn-ink: {color.primary};">
	{#each buttons as button, i (button.label)}
		<button
			type="button"
			class="device-button"
			class:on={button.on}
			aria-pressed={button.on}
			data-debug="device-button"
			use:press={{ onPress: () => onPress(i), fireOn: 'down', touchAction: 'none' }}
		>
			{button.label}
		</button>
	{/each}
</div>

<style>
	.device-buttons {
		display: flex;
		flex-direction: column;
		gap: 4px;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
	}
	.device-buttons.horizontal {
		flex-direction: row;
	}
	.device-button {
		flex: 1 1 0;
		min-width: 0;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--line-strong);
		border-radius: 2px;
		background: var(--surface-well);
		color: var(--btn-ink);
		font-size: 0.9375rem;
		font-weight: var(--font-weight-medium, 500);
		font-variant-numeric: tabular-nums;
	}
	.device-button.on {
		background: var(--btn-ink);
		border-color: var(--btn-ink);
		color: var(--flat-on-fg);
	}
	.device-buttons.ghost .device-button {
		opacity: var(--opacity-ghost);
	}
</style>
