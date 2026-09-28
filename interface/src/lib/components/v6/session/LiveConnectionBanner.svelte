<script lang="ts">
	/**
	 * Live connection banner (2026-09-28).
	 *
	 * Without it the performance screen said nothing when Live, its Vamp
	 * surface or the bridge was missing: an empty track row and a faint
	 * sparkle, with the reason only in Settings → Connection. A stranger
	 * whose first launch did not connect had no way to know why.
	 *
	 * Persistent while the handshake is not accepted, in the recipe of
	 * `GroupModeBanner`. A refused handshake (a surface of another version:
	 * Live still runs the old one after an update) shows at once; anything
	 * else waits out `GRACE_MS` from the moment the connection went, so a
	 * reconnect that settles in a second or two never flashes it. The words
	 * are Settings → Connection's, and its button opens that section.
	 * Hidden while Settings is open, which says the same thing.
	 */
	import { onMount } from 'svelte';
	import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
	import { handshakeState } from '$lib/stores/v3/handshakeState.svelte';
	import { settingsStore } from '$lib/stores/v6/settingsStore.svelte';
	import { press } from '$lib/actions/press';

	const GRACE_MS = 4000;

	let now = $state(Date.now());
	// When the connection was last seen missing: mount, or the moment the
	// handshake left `accepted`. Null while connected.
	let lostAt = $state<number | null>(Date.now());

	onMount(() => {
		const tick = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(tick);
	});

	$effect(() => {
		if (handshakeState.phase === 'accepted') lostAt = null;
		else if (lostAt === null) lostAt = Date.now();
	});

	const message = $derived.by((): { title: string; line: string } | null => {
		if (handshakeState.phase === 'accepted' || settingsStore.open) return null;
		if (handshakeState.phase === 'failed') {
			return {
				title: 'Live runs a different Vamp',
				line: `${handshakeState.errorDetail ? `${handshakeState.errorDetail}. ` : ''}Quit and reopen Live so it loads this version.`
			};
		}
		if (lostAt === null || now - lostAt < GRACE_MS) return null;
		const surface = bridgeStatus.status.pythonSurface;
		if (surface === 'disconnected' || surface === 'error') {
			return { title: 'Live isn’t answering', line: 'Is Live open, with Vamp chosen as a Control Surface?' };
		}
		return { title: 'Waiting for Live', line: 'Is Vamp running on the Mac (npm run dev or npm run ipad), and Live open?' };
	});
</script>

{#if message}
	<div class="live-banner fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3" role="status" data-debug="live-banner">
		<div class="flex-1">
			<div class="live-banner-title font-bold text-sm">{message.title}</div>
			<div class="text-sm">{message.line}</div>
		</div>
		<button
			use:press={{ onPress: () => settingsStore.openSettings('connection'), touchAction: 'none' }}
			class="live-banner-open px-2 py-1 font-bold text-sm"
		>
			Settings
		</button>
	</div>
{/if}

<style>
	/* GroupModeBanner's slab in V3ErrorBanner's warning ink: this names a problem. */
	.live-banner {
		border-radius: 2px;
		background: var(--popover);
		border: 1px solid var(--act-warn-line);
		color: var(--foreground);
		max-width: min(40rem, calc(100vw - 2rem));
	}
	.live-banner-title {
		color: var(--act-warn);
	}
	.live-banner-open {
		color: var(--fg-tertiary);
	}
	.live-banner-open:active {
		color: var(--foreground);
	}
</style>
