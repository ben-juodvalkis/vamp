<script lang="ts">
	/**
	 * The phone's Track tab (ADR-503): the selected track's effect chain
	 * over its central view — the clip view after a clip's long press, an
	 * instrument's view after a tap on its chain cell, the master's view
	 * (and Settings' gear) with the master selected. The iPad's two panels,
	 * stacked in the order the flipped iPad stacks them.
	 */
	import DevicesPanelV6 from '$lib/components/v6/layout/DevicesPanelV6.svelte';
	import MiddlePanelV6 from '$lib/components/v6/layout/MiddlePanelV6.svelte';
</script>

<div class="phone-track" data-debug="phone-track">
	<div class="chain" data-debug="phone-chain"><DevicesPanelV6 /></div>
	<div class="central" data-debug="phone-central"><MiddlePanelV6 /></div>
</div>

<style>
	.phone-track {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--phone-gap);
		padding-inline: var(--phone-inset);
	}
	.chain {
		flex: 0 0 38%;
		min-height: 0;
		overflow: hidden;
	}
	.central {
		flex: 1 1 0;
		min-height: 0;
		overflow: hidden;
	}
</style>
