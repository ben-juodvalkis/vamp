<script lang="ts">
	/**
	 * Settings → Connection: is Live's surface answering, the address to type
	 * on the iPad, and the devices that paired over Wi-Fi (ADR-491). The
	 * features moved to their own section, Integrations (ADR-534).
	 *
	 * Live's state leads, as one card with a large word: it is the question
	 * this section is opened to answer. The protocol and the surface's
	 * instance are for a bug report, not for playing, so they ride small
	 * under it.
	 */
	import { onMount } from 'svelte';
	import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
	import { handshakeState } from '$lib/stores/v3/handshakeState.svelte';
	import { v3Store } from '$lib/stores/v3/normalized.svelte';
	import { UI_SUPPORTED_VERSIONS } from '$lib/api/handlers/v3Handshake';
	import IpadAddresses from './IpadAddresses.svelte';
	import type { IpadAddress } from './ipadAddress';

	let { addresses, addressState }: { addresses: IpadAddress[]; addressState: 'loading' | 'ready' | 'failed' } = $props();

	// --- Live's surface ---------------------------------------------------
	// The socket's state is a plain function in simpleClient, not a rune, so
	// the surface's 1 Hz heartbeat and the bridge's connection_status stand
	// in for it: both are reactive, and both stop when the socket does.
	let lastHeartbeat = $state(0);
	let now = $state(Date.now());
	onMount(() => {
		const onBeat = () => (lastHeartbeat = Date.now());
		window.addEventListener('surface-heartbeat', onBeat);
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => {
			window.removeEventListener('surface-heartbeat', onBeat);
			clearInterval(tick);
		};
	});
	const surfaceStatus = $derived(bridgeStatus.status.pythonSurface);
	const surface = $derived.by((): { state: 'on' | 'waiting' | 'problem'; word: string; line: string } => {
		if (handshakeState.phase === 'accepted')
			return { state: 'on', word: 'Connected', line: `Speaking protocol ${handshakeState.negotiatedVersion}.` };
		if (handshakeState.phase === 'failed') return { state: 'problem', word: 'Refused', line: handshakeState.errorDetail };
		if (surfaceStatus === 'connected') return { state: 'waiting', word: 'Waiting', line: 'Live answered; the handshake is pending.' };
		if (surfaceStatus === 'disconnected' || surfaceStatus === 'error')
			return { state: 'problem', word: 'Not answering', line: 'Is Live running, with Vamp chosen as a Control Surface?' };
		return { state: 'waiting', word: 'Waiting', line: handshakeState.phase === 'pending' ? 'Connecting…' : 'Waiting for Live.' };
	});
	const heartbeatLine = $derived(
		lastHeartbeat === 0 ? '' : now - lastHeartbeat < 3000 ? 'Heartbeat live.' : `Last heartbeat ${Math.round((now - lastHeartbeat) / 1000)} s ago.`
	);

	// --- Paired devices (ADR-491) -------------------------------------------
	// Devices that paired once to drive Vamp off the cable. Forgetting one
	// applies on its next connection; an open session is never cut.
	type PairedDevice = { hash: string; name: string; address: string; lastUsed: number };
	let devices = $state<PairedDevice[]>([]);
	let devicesState = $state<'loading' | 'ready' | 'failed'>('loading');
	async function loadDevices() {
		try {
			const res = await fetch('/api/pair/devices', { cache: 'no-store' });
			if (!res.ok) throw new Error(String(res.status));
			devices = (await res.json()).devices ?? [];
			devicesState = 'ready';
		} catch {
			devicesState = 'failed';
		}
	}
	async function forget(query: string) {
		await fetch(`/api/pair/devices?${query}`, { method: 'DELETE' }).catch(() => {});
		await loadDevices();
	}
	onMount(() => void loadDevices());
	function lastSeen(ms: number): string {
		const days = Math.floor((Date.now() - ms) / 86_400_000);
		return days <= 0 ? 'Seen today' : days === 1 ? 'Seen yesterday' : `Seen ${days} days ago`;
	}
</script>

<div class="set-section">
	<p class="set-lead">Whether Live is answering, the address that opens Vamp on the iPad, and the devices allowed to play it.</p>

	<section class="set-group" data-debug="settings-live">
		<h3 class="set-group-title">Ableton Live</h3>
		<div class="set-list">
			<div class="set-row live-card" data-surface={surface.state}>
				<span class="live-mark" data-state={surface.state} aria-hidden="true"></span>
				<span class="set-row-main">
					<span class="live-word">{surface.word}</span>
					<span class="set-row-sub">Vamp control surface. {surface.line}{#if heartbeatLine}&nbsp;{heartbeatLine}{/if}</span>
					<span class="set-row-detail">
						This app speaks {UI_SUPPORTED_VERSIONS.join(', ')}{#if v3Store.surfaceInstanceId}&nbsp;· surface {v3Store.surfaceInstanceId.slice(0, 8)}{/if}
					</span>
				</span>
			</div>
		</div>
	</section>

	<section class="set-group" data-debug="settings-ipad">
		<h3 class="set-group-title">Open on the iPad</h3>
		<IpadAddresses {addresses} state={addressState} />
	</section>

	<section class="set-group" data-debug="settings-devices">
		<div class="set-group-head">
			<h3 class="set-group-title">Paired devices</h3>
			{#if devices.length > 1}
				<button class="set-btn set-btn-quiet set-btn-small" onclick={() => forget('all=1')}>Forget all</button>
			{/if}
		</div>
		<ul class="set-list">
			<li class="set-row">
				<span class="set-row-main">
					<span class="set-row-label">This Mac and Vamp for iPad</span>
					<span class="set-row-sub">Trusted as they are: no pairing on the USB cable.</span>
				</span>
				<span class="set-status" data-state="on"><span class="set-status-dot" aria-hidden="true"></span>Trusted</span>
			</li>
			{#each devices as device (device.hash)}
				<li class="set-row" data-paired-device={device.hash.slice(0, 12)}>
					<span class="set-row-main">
						<span class="set-row-label">{device.name}</span>
						<span class="set-row-sub">Paired from {device.address || 'an unknown address'} · {lastSeen(device.lastUsed)}</span>
					</span>
					<button class="set-btn set-btn-small" onclick={() => forget(`hash=${encodeURIComponent(device.hash)}`)}>Forget</button>
				</li>
			{/each}
			{#if devicesState === 'ready' && devices.length === 0}
				<li class="set-row">
					<span class="set-row-main">
						<span class="set-row-sub">No device has paired over Wi-Fi.</span>
					</span>
				</li>
			{:else if devicesState === 'failed'}
				<li class="set-row">
					<span class="set-row-main"><span class="set-row-sub">Couldn't read the paired devices.</span></span>
				</li>
			{/if}
		</ul>
		<p class="set-note">Any other browser pairs once, the first time it opens Vamp. Forget one and it asks again on its next connection; an open session is never cut.</p>
	</section>
</div>

<style>
	.live-card {
		gap: var(--spacing-lg);
		padding-block: var(--spacing-lg);
	}
	.live-mark {
		flex-shrink: 0;
		align-self: flex-start;
		width: 0.875rem;
		height: 0.875rem;
		margin-top: 0.4375rem;
		border-radius: 9999px;
		border: 2px solid var(--muted-foreground);
	}
	.live-mark[data-state='on'] {
		background: var(--act-play);
		border-color: var(--act-play);
	}
	.live-mark[data-state='waiting'] {
		border-style: dashed;
	}
	.live-mark[data-state='problem'] {
		background: var(--act-warn);
		border-color: var(--act-warn);
	}
	.live-word {
		font-size: 1.25rem;
		font-weight: 600;
		line-height: 1.3;
		color: var(--foreground);
	}
	.live-card[data-surface='problem'] .live-word {
		color: var(--act-warn);
	}
</style>
