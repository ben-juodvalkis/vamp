<script lang="ts">
	/**
	 * The address to type in Safari on the iPad, best first (`ipadAddress.ts`
	 * decides the list). Shown in Settings → Connection and as the first-run
	 * checklist's last step. Each address selects whole on a tap, and where
	 * the page may use the clipboard (the Mac's own window, on localhost) a
	 * Copy button puts it there, for Universal Clipboard to paste on the iPad.
	 */
	import { onMount } from 'svelte';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import { ADDRESS_KIND_LABEL, type IpadAddress } from './ipadAddress';

	// The prop is `state`; its local name is not, or `$state` reads as a store of it.
	let { addresses, state: addressState }: { addresses: IpadAddress[]; state: 'loading' | 'ready' | 'failed' } = $props();

	let canCopy = $state(false);
	let copied = $state('');
	onMount(() => {
		canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard?.writeText && window.isSecureContext;
	});
	async function copy(url: string) {
		try {
			await navigator.clipboard.writeText(url);
			copied = url;
			setTimeout(() => {
				if (copied === url) copied = '';
			}, 1600);
		} catch {
			copied = '';
		}
	}
</script>

<div class="set-list" data-debug="ipad-addresses">
	{#if addresses.length}
		{#each addresses as a, i (a.url)}
			<div class="set-row ipad-row" class:primary={i === 0} data-kind={a.kind}>
				<span class="set-row-main">
					<span class="ipad-address">{a.url}</span>
					<span class="set-row-sub">{ADDRESS_KIND_LABEL[a.kind]}{#if i === 0 && addresses.length > 1}&nbsp;· try this first{/if}</span>
				</span>
				{#if canCopy}
					<button class="set-btn set-btn-small" onclick={() => copy(a.url)} aria-label="Copy {a.url}">
						{#if copied === a.url}
							<Check class="set-btn-icon" aria-hidden="true" /><span>Copied</span>
						{:else}
							<Copy class="set-btn-icon" aria-hidden="true" /><span>Copy</span>
						{/if}
					</button>
				{/if}
			</div>
		{/each}
	{:else}
		<div class="set-row">
			<span class="set-row-sub">
				{#if addressState === 'loading'}
					Finding this Mac’s address…
				{:else if addressState === 'failed'}
					Couldn’t read this Mac’s network addresses.
				{:else}
					This Mac has no address an iPad can reach. Connect the iPad with a USB-C cable, or join both to the same Wi-Fi.
				{/if}
			</span>
		</div>
	{/if}
</div>
<p class="set-note">Type it into Safari on the iPad, then Share → Add to Home Screen to run Vamp full screen.</p>

<style>
	.ipad-address {
		font-size: 1rem;
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
		user-select: all;
		-webkit-user-select: all;
		overflow-wrap: anywhere;
	}
	.ipad-row.primary {
		padding-block: var(--spacing-lg);
	}
	.ipad-row.primary .ipad-address {
		font-size: 1.375rem;
		font-weight: 600;
	}
</style>
