<script lang="ts">
	/**
	 * The phone's Track tab (ADR-503): the selected track's effect chain,
	 * the whole tab. No central view: the phone keeps the track to its
	 * chain, so an instrument or clip opens nothing larger here.
	 */
	import DevicesPanelV6 from '$lib/components/v6/layout/DevicesPanelV6.svelte';
</script>

<div class="phone-track" data-debug="phone-track">
	<div class="chain" data-debug="phone-chain"><DevicesPanelV6 /></div>
</div>

<style>
	.phone-track {
		height: 100%;
		display: flex;
		flex-direction: column;
		padding-inline: var(--phone-inset);
	}
	.chain {
		flex: 1 1 0;
		min-height: 0;
		overflow: hidden;
	}
</style>
