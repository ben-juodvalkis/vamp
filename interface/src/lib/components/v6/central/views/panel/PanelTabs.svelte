<script lang="ts">
	/**
	 * Live's tab strip over the one region of a panel it swaps (ADR-487):
	 * Collision's Resonator 1 · Resonator 2 · LFO · MIDI. One touch row, the
	 * tabs sharing its width, so six fit where a column of six would fall
	 * under the touch floor. A tab whose section can be switched off wears
	 * Sampler's dot: filled while on, hollow while off.
	 */
	import type { DeviceColorScheme } from '$lib/config/devicePresets';
	import type { PanelTab } from './panelTypes';
	import type { PanelParams } from './usePanelParams.svelte';

	interface Props {
		tabs: readonly PanelTab[];
		selected: number;
		params: PanelParams;
		color: DeviceColorScheme;
		onSelect: (index: number) => void;
	}

	let { tabs, selected, params, color, onSelect }: Props = $props();
</script>

<div class="device-segmented panel-tabs" style="--btn-tint: {color.primary}; grid-template-columns: repeat({tabs.length}, minmax(0, 1fr));" role="tablist">
	{#each tabs as tab, i (tab.title)}
		<button
			class="device-segment panel-tab"
			class:active={selected === i}
			role="tab"
			aria-selected={selected === i}
			data-tab={tab.title}
			onclick={() => onSelect(i)}
		>
			<span>{tab.title}</span>
			{#if tab.switchParam && params.has(tab.switchParam)}
				<span class="tab-dot" class:on={params.isOn(tab.switchParam)} aria-label={params.isOn(tab.switchParam) ? 'on' : 'off'}></span>
			{/if}
		</button>
	{/each}
</div>

<style>
	.panel-tabs {
		display: grid;
		flex: 0 0 var(--height-touch);
		min-width: 0;
	}
	.panel-tab {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-width: 0;
		padding: 0 4px;
		font-size: 0.875rem;
		white-space: nowrap;
	}
	.panel-tab + .panel-tab {
		border-top: 0;
		border-left: 1px solid var(--line-faint);
	}
	.tab-dot {
		width: 7px;
		height: 7px;
		flex: none;
		border-radius: 50%;
		border: 1px solid currentColor;
	}
	.tab-dot.on {
		background: currentColor;
	}
	:global([data-grammar='flat']) .panel-tabs .device-segment + .device-segment {
		border-top: 0;
		border-left: 1px solid var(--line-strong);
	}
	:global([data-grammar='flat']) .panel-tabs .device-segment.active {
		background: var(--btn-tint);
		color: var(--flat-on-fg);
	}
	:global([data-grammar='flat']) .panel-tabs .device-segment:not(.active) {
		color: color-mix(in srgb, var(--btn-tint) 72%, var(--foreground));
	}
</style>
