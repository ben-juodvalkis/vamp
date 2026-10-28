<script lang="ts">
	/**
	 * Pair this device (ADR-491). Covers the interface whenever this device is
	 * not paired: on load (`/api/pair/state`) or when the bridge login is
	 * refused (`pairing-required`). The device asks once; the Mac shows a
	 * 6-digit code in Live's status bar and an Allow banner on the trusted
	 * screens; the code typed here, or Allow there, pairs it. The poll that
	 * finds it approved sets its cookie, and the page reloads into Vamp.
	 *
	 * Vamp for iPad over the cable never sees this: the Mac trusts it.
	 */
	import { onMount } from 'svelte';
	import { pairingStore } from '$lib/stores/pairing.svelte';

	type Phase = 'idle' | 'asking' | 'limited' | 'waiting' | 'approved' | 'refused' | 'expired';

	let phase = $state<Phase>('idle');
	let name = $state('');
	let code = $state('');
	let note = $state('');
	let requestId = '';
	let poll: ReturnType<typeof setInterval> | null = null;

	/** "iPad Safari", "Mac Chrome": the browser's guess, editable. */
	function guessName(): string {
		const ua = navigator.userAgent;
		const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
		const device = /iPad/.test(ua) || touchMac ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'PC' : 'Device';
		const browser = /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : '';
		return browser ? `${device} ${browser}` : device;
	}

	function stopPoll() {
		if (poll) clearInterval(poll);
		poll = null;
	}

	function settle(state: string) {
		if (state === 'approved') {
			stopPoll();
			phase = 'approved';
			setTimeout(() => location.reload(), 500);
		} else if (state === 'refused' || state === 'expired' || state === 'unknown') {
			stopPoll();
			phase = state === 'refused' ? 'refused' : 'expired';
		}
	}

	async function check() {
		try {
			const res = await fetch(`/api/pair/status?id=${encodeURIComponent(requestId)}`, { cache: 'no-store' });
			settle((await res.json())?.state ?? '');
		} catch {
			/* the Mac's server restarting: the next poll asks again */
		}
	}

	async function ask() {
		phase = 'asking';
		note = '';
		try {
			const res = await fetch('/api/pair/request', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name })
			});
			const body = await res.json();
			if (body?.trusted) return location.reload();
			if (res.status === 429) {
				phase = 'limited';
				note = `Asked too often. Try again in ${Math.ceil((body?.retryInMs ?? 10000) / 1000)} s.`;
				return;
			}
			requestId = body.id;
			code = '';
			phase = 'waiting';
			stopPoll();
			poll = setInterval(check, 1000);
		} catch {
			phase = 'idle';
			note = 'The Mac did not answer. Is Vamp running there?';
		}
	}

	async function sendCode() {
		note = '';
		try {
			const res = await fetch('/api/pair/code', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: requestId, code })
			});
			const body = await res.json();
			if (body?.state === 'wrong') {
				note = `Not that code. ${body.triesLeft} ${body.triesLeft === 1 ? 'try' : 'tries'} left.`;
				code = '';
			} else {
				settle(body?.state ?? '');
			}
		} catch {
			note = 'The Mac did not answer.';
		}
	}

	onMount(() => {
		name = guessName();
		const onRequired = () => pairingStore.markRequired();
		window.addEventListener('pairing-required', onRequired);
		fetch('/api/pair/state', { cache: 'no-store' })
			.then((r) => r.json())
			.then((s) => {
				if (s?.pairing && !s?.trusted) pairingStore.markRequired();
			})
			.catch(() => {});
		return () => {
			window.removeEventListener('pairing-required', onRequired);
			stopPoll();
		};
	});

	const codeReady = $derived(code.replace(/\D/g, '').length === 6);
</script>

{#if pairingStore.required}
	<div class="pair-screen" role="dialog" aria-modal="true" aria-labelledby="pair-title" data-debug="pairing-screen">
		<div class="pair-card">
			<h1 id="pair-title" class="pair-title">Pair this device</h1>

			{#if phase === 'idle' || phase === 'asking' || phase === 'limited'}
				<p class="pair-text">
					This device isn't paired with the Mac running Vamp yet. It takes about ten seconds, once.
				</p>
				<label class="pair-field">
					<span class="pair-label">Name</span>
					<input class="pair-input" bind:value={name} maxlength="40" autocomplete="off" />
				</label>
				<button class="pair-btn pair-btn-primary" onclick={ask} disabled={phase === 'asking'}>Ask the Mac</button>
				{#if note}<p class="pair-note" role="alert">{note}</p>{/if}
				<p class="pair-note">Vamp for iPad on the USB cable needs no pairing.</p>
			{:else if phase === 'waiting'}
				<p class="pair-text">
					The code is in Live's status bar on the Mac. Type it here, or tap <strong>Allow</strong> on a screen
					that's already connected.
				</p>
				<label class="pair-field">
					<span class="pair-label">Code</span>
					<input
						class="pair-input pair-code"
						bind:value={code}
						inputmode="numeric"
						autocomplete="one-time-code"
						maxlength="7"
						placeholder="000000"
						onkeydown={(e) => e.key === 'Enter' && codeReady && sendCode()}
					/>
				</label>
				<button class="pair-btn pair-btn-primary" onclick={sendCode} disabled={!codeReady}>Pair</button>
				{#if note}<p class="pair-note" role="alert">{note}</p>{/if}
				<p class="pair-note">Waiting for the Mac…</p>
			{:else if phase === 'approved'}
				<p class="pair-text">Paired. Connecting…</p>
			{:else}
				<p class="pair-text">
					{phase === 'refused'
						? 'The Mac said no, or the code was wrong too many times.'
						: 'That request ran out before anyone answered it.'}
				</p>
				<button class="pair-btn pair-btn-primary" onclick={() => ((phase = 'idle'), (note = ''))}>Ask again</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.pair-screen {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: var(--background, #111);
	}
	.pair-card {
		width: min(28rem, 100%);
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 1.5rem;
		border: 1px solid var(--line-strong);
		border-radius: 2px;
		background: var(--surface-well);
	}
	.pair-title {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0;
	}
	.pair-text {
		margin: 0;
		line-height: 1.45;
	}
	.pair-note {
		margin: 0;
		font-size: 0.875rem;
		opacity: 0.75;
	}
	.pair-field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.pair-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		opacity: 0.7;
	}
	.pair-input {
		min-height: 44px;
		padding: 0 0.75rem;
		font-size: 1rem;
		color: inherit;
		background: var(--background, #000);
		border: 1px solid var(--line-strong);
		border-radius: 2px;
	}
	.pair-code {
		font-size: 1.5rem;
		letter-spacing: 0.3em;
		font-variant-numeric: tabular-nums;
	}
	.pair-btn {
		min-height: 44px;
		font-size: 1rem;
		font-weight: 600;
		color: inherit;
		background: transparent;
		border: 1px solid var(--line-strong);
		border-radius: 2px;
	}
	.pair-btn-primary {
		background: var(--phosphor);
		color: var(--flat-on-fg, #000);
		border-color: var(--phosphor);
	}
	.pair-btn:disabled {
		opacity: 0.4;
	}
</style>
