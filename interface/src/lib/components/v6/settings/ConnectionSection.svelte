<script lang="ts">
	/**
	 * Settings → Connection: is Live's surface answering, the address to type
	 * on the iPad, and the features — each on, off, or unavailable and why.
	 * The features sit here because each is something outside the app the
	 * bridge talks to (the RME mixer, the Max patch, the pedal), so
	 * "unavailable" is a connection that did not happen.
	 *
	 * The protocol and the surface's instance are for a bug report, not for
	 * playing, so they ride small under the surface's row.
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

	// --- Features ---------------------------------------------------------
	// Every switch the bridge has named, in a fixed order with a plain name.
	// A switch the bridge never named is off (bridgeStatus's rule), and is
	// listed as off rather than hidden: the list is the answer to "what is
	// on here?", so an absent row would be a missing answer.
	const FEATURE_ROWS: { id: string; label: string; what: string }[] = [
		{ id: 'totalmix', label: 'TotalMix', what: 'RME TotalMix monitor faders' },
		{ id: 'maxUtilityPatch', label: 'Max Utility patch', what: 'Ableton Move knobs and pad hold, the piano-pedal looper' },
		{ id: 'expressionPedal', label: 'Expression pedal', what: 'The wah pedal and its toe switch' },
		{ id: 'menubar', label: 'Menu-bar app', what: 'The Mac menu-bar utility' },
		{ id: 'axHelper', label: 'AX helper', what: 'Reverse, Group, Save As and the held pad’s similar samples' },
		{ id: 'captureRecorder', label: 'Recorder', what: 'REC: the Vamp-Recorder device on Return A' }
	];
	const featureRows = $derived.by(() => {
		const named = new Set(FEATURE_ROWS.map((r) => r.id));
		const extra = Object.keys(bridgeStatus.features)
			.filter((id) => !named.has(id))
			.map((id) => ({ id, label: id, what: '' }));
		return [...FEATURE_ROWS, ...extra].map((row) => {
			const f = bridgeStatus.feature(row.id);
			const state: 'on' | 'off' | 'unavailable' = !f.enabled ? 'off' : f.available ? 'on' : 'unavailable';
			return { ...row, state, reason: state === 'unavailable' ? bridgeStatus.unavailableReason(row.id) : '' };
		});
	});
	const FEATURE_WORD = { on: 'On', off: 'Off', unavailable: 'Unavailable' };
</script>

<div class="set-section">
	<section class="set-group" data-debug="settings-live">
		<h2 class="set-group-title">Ableton Live</h2>
		<div class="set-list">
			<div class="set-row" data-surface={surface.state}>
				<span class="set-row-main">
					<span class="set-row-label">Vamp control surface</span>
					<span class="set-row-sub">{surface.line}</span>
					{#if heartbeatLine}<span class="set-row-sub">{heartbeatLine}</span>{/if}
					<span class="set-row-detail">
						This app speaks {UI_SUPPORTED_VERSIONS.join(', ')}{#if v3Store.surfaceInstanceId}&nbsp;· surface {v3Store.surfaceInstanceId.slice(0, 8)}{/if}
					</span>
				</span>
				<span class="set-status" data-state={surface.state}><span class="set-status-dot" aria-hidden="true"></span>{surface.word}</span>
			</div>
		</div>
	</section>

	<section class="set-group" data-debug="settings-ipad">
		<h2 class="set-group-title">iPad</h2>
		<IpadAddresses {addresses} state={addressState} />
	</section>

	<section class="set-group" data-debug="settings-features">
		<h2 class="set-group-title">Features</h2>
		<ul class="set-list">
			{#each featureRows as row (row.id)}
				<li class="set-row" data-feature={row.id} data-state={row.state}>
					<span class="set-row-main">
						<span class="set-row-label">{row.label}</span>
						{#if row.what}<span class="set-row-sub">{row.what}</span>{/if}
						{#if row.state === 'unavailable'}<span class="set-row-sub set-row-reason">{row.reason}</span>{/if}
					</span>
					<span class="set-status" data-state={row.state === 'unavailable' ? 'problem' : row.state}>
						<span class="set-status-dot" aria-hidden="true"></span>{FEATURE_WORD[row.state]}
					</span>
				</li>
			{/each}
		</ul>
	</section>
</div>
