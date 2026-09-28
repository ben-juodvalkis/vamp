<script lang="ts">
	/**
	 * The address to type in Safari on the iPad, best first (`ipadAddress.ts`
	 * decides the list). Shown in Settings → Connection and as the first-run
	 * checklist's last step. Each address selects whole on a tap, for copying.
	 */
	import { ADDRESS_KIND_LABEL, type IpadAddress } from './ipadAddress';

	let { addresses, state }: { addresses: IpadAddress[]; state: 'loading' | 'ready' | 'failed' } = $props();
</script>

<div class="set-list" data-debug="ipad-addresses">
	{#if addresses.length}
		{#each addresses as a, i (a.url)}
			<div class="set-row set-address-row" class:primary={i === 0} data-kind={a.kind}>
				<span class="set-row-main">
					<span class="set-address">{a.url}</span>
					<span class="set-row-sub">{ADDRESS_KIND_LABEL[a.kind]}</span>
				</span>
			</div>
		{/each}
	{:else}
		<div class="set-row">
			<span class="set-row-sub">
				{#if state === 'loading'}
					Finding this Mac’s address…
				{:else if state === 'failed'}
					Couldn’t read this Mac’s network addresses.
				{:else}
					This Mac has no address an iPad can reach. Connect the iPad with a USB-C cable, or join both to the same Wi-Fi.
				{/if}
			</span>
		</div>
	{/if}
</div>
<p class="set-note">Type it into Safari on the iPad, then Share → Add to Home Screen to run Looping full screen.</p>

<style>
	.set-address {
		font-size: 1rem;
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
		user-select: all;
		-webkit-user-select: all;
		overflow-wrap: anywhere;
	}
	.set-address-row.primary .set-address {
		font-size: 1.25rem;
		font-weight: var(--font-weight-medium);
	}
</style>
