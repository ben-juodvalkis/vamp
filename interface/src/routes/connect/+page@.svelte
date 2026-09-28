<script lang="ts">
	import { onMount } from 'svelte';
	import { validateOctets } from '$lib/utils/connectValidation';

	let octets = $state('');
	let error = $state('');
	let lastUsed = $state('');
	let inputEl: HTMLInputElement;

	const STORAGE_KEY = 'looping-connect-octets';

	onMount(() => {
		// Restore last-used octets
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved) {
			lastUsed = saved;
		}

		// Apply dark theme
		document.documentElement.classList.add('dark');

		// Focus the input
		inputEl?.focus();
	});

	function connect() {
		const value = octets.trim();

		if (!value) {
			error = 'Enter the last two octets (e.g. 37.129)';
			return;
		}

		if (!validateOctets(value)) {
			error = 'Invalid format. Use two numbers 0-255 separated by a dot (e.g. 37.129)';
			return;
		}

		error = '';

		// Save for next time
		localStorage.setItem(STORAGE_KEY, value);

		// Use same port as current page
		const port = window.location.port;
		const url = port
			? `http://169.254.${value}:${port}`
			: `http://169.254.${value}`;
		window.location.href = url;
	}

	function useLastUsed() {
		octets = lastUsed;
		inputEl?.focus();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			connect();
		}
	}
</script>

<svelte:head>
	<title>Connect to Looping</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content="Connect" />
	<meta name="theme-color" content="#0f172a" />
	<link rel="apple-touch-icon" href="/pwa-512x512.png" />
</svelte:head>

<div class="connect-page">
	<div class="connect-container">
		<h1 class="title">Looping</h1>
		<p class="subtitle">Enter USB-C address to connect</p>

		<div class="input-row">
			<span class="prefix">169.254.</span>
			<input
				bind:this={inputEl}
				type="text"
				inputmode="decimal"
				autocomplete="off"
				autocorrect="off"
				autocapitalize="off"
				spellcheck="false"
				placeholder="37.129"
				bind:value={octets}
				onkeydown={handleKeydown}
				class="octet-input"
			/>
		</div>

		{#if error}
			<p class="error">{error}</p>
		{/if}

		<button class="connect-btn" onclick={connect}>
			Connect
		</button>

		{#if lastUsed && lastUsed !== octets.trim()}
			<button class="last-used-btn" onclick={useLastUsed}>
				Last used: 169.254.{lastUsed}
			</button>
		{/if}
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background: #0f172a;
		-webkit-user-select: none;
		user-select: none;
	}

	.connect-page {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #0f172a;
		color: #e2e8f0;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
		padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
	}

	.connect-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
		width: 100%;
		max-width: 400px;
		padding: 2rem;
	}

	.title {
		font-size: 2.5rem;
		font-weight: 700;
		color: #f8fafc;
		margin: 0;
		letter-spacing: -0.02em;
	}

	.subtitle {
		font-size: 1rem;
		color: #94a3b8;
		margin: 0;
	}

	.input-row {
		display: flex;
		align-items: center;
		gap: 0;
		width: 100%;
		background: #1e293b;
		border: 2px solid #334155;
		border-radius: 12px;
		overflow: hidden;
		font-size: 1.5rem;
	}

	.prefix {
		padding: 1rem 0 1rem 1rem;
		color: #64748b;
		font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.octet-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: #f8fafc;
		font-size: 1.5rem;
		font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
		padding: 1rem 1rem 1rem 0;
		min-width: 0;
	}

	.octet-input::placeholder {
		color: #475569;
	}

	.connect-btn {
		width: 100%;
		padding: 1rem;
		font-size: 1.25rem;
		font-weight: 600;
		color: #f8fafc;
		background: #3b82f6;
		border: none;
		border-radius: 12px;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		touch-action: manipulation;
	}

	.connect-btn:active {
		background: #2563eb;
		transform: scale(0.98);
	}

	.last-used-btn {
		padding: 0.75rem 1.5rem;
		font-size: 1rem;
		color: #94a3b8;
		background: #1e293b;
		border: 1px solid #334155;
		border-radius: 10px;
		cursor: pointer;
		font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
		-webkit-tap-highlight-color: transparent;
		touch-action: manipulation;
	}

	.last-used-btn:active {
		background: #334155;
	}

	.error {
		color: #f87171;
		font-size: 0.875rem;
		margin: 0;
		text-align: center;
	}
</style>
