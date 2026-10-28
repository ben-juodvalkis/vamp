<script lang="ts">
	/**
	 * Allow / Ignore, on a trusted screen, for a device asking to pair
	 * (ADR-491). A banner over the interface rather than a dialog, so it never
	 * takes a performer's screen: the request runs out on its own after two
	 * minutes if nobody answers. Requests arrive as `/bridge/pairing`; those
	 * announced before this screen connected are read once it does.
	 */
	import { onMount } from 'svelte';
	import { pairingStore } from '$lib/stores/pairing.svelte';

	onMount(() => {
		const load = () => {
			if (!pairingStore.required) void pairingStore.loadWaiting();
		};
		window.addEventListener('bridge-resync', load);
		return () => window.removeEventListener('bridge-resync', load);
	});
</script>

{#if !pairingStore.required && pairingStore.requests.length > 0}
	<div class="pair-banners" role="status" aria-live="polite" data-debug="pairing-banners">
		{#each pairingStore.requests as request (request.id)}
			<div class="pair-banner" data-pairing-request={request.id}>
				<span class="pair-banner-text">
					<strong>{request.name}</strong>{#if request.address}&nbsp;({request.address}){/if} wants to connect to Vamp.
				</span>
				<button class="pair-banner-btn pair-banner-allow" onclick={() => pairingStore.decide(request.id, true)}>Allow</button>
				<button class="pair-banner-btn" onclick={() => pairingStore.decide(request.id, false)}>Ignore</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.pair-banners {
		position: fixed;
		top: calc(env(safe-area-inset-top, 0px) + 0.5rem);
		left: 50%;
		transform: translateX(-50%);
		z-index: 900;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: min(40rem, calc(100vw - 2rem));
	}
	.pair-banner {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.5rem 0.5rem 1rem;
		border: 1px solid var(--line-strong);
		border-radius: 2px;
		background: var(--surface-well);
	}
	.pair-banner-text {
		flex: 1;
		min-width: 0;
	}
	.pair-banner-btn {
		min-height: 44px;
		min-width: 5.5rem;
		font-weight: 600;
		color: inherit;
		background: transparent;
		border: 1px solid var(--line-strong);
		border-radius: 2px;
	}
	.pair-banner-allow {
		background: var(--phosphor);
		color: var(--flat-on-fg, #000);
		border-color: var(--phosphor);
	}
</style>
