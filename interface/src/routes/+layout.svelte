<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount, onDestroy } from 'svelte';
	import { themeManager } from '$lib/stores/theme';
	import { destroyAllServices, initializeAllServices } from '$lib/services/serviceCleanup';
	import { startPlacesLive, openSettingsOnFirstRun } from '$lib/services/placesLive';

	// Import client without auto-connect
	import { connectToLive } from '$lib/api/simpleClient';

	// Import debugging tools
	import { freezeDetector } from '$lib/utils/freeze-detector';
	import {
		startClientWatchdog,
		stopClientWatchdog,
		noteSchedulerTick,
		noteReactiveTick
	} from '$lib/utils/clientWatchdog';
	import PerfOverlay from '$lib/components/v6/debug/PerfOverlay.svelte';

	let { children } = $props();

	// ?perf=1 toggles a small floating overlay showing connection status
	// and JS heap. Off by default; opt-in via query param so production
	// users never see it. Computed once on mount; toggling requires a
	// reload, which is fine for a diagnostic tool.
	let showPerf = $state(false);

	// Reactivity probe. A plain interval bumps the counter; the effect
	// below echoes it back from inside the effect tree. If an error
	// ever escapes a Svelte effect the scheduler stops flushing
	// permanently (queued_root_effects is never drained and the root's
	// CLEAN bit is never restored), so the two counters diverge and the
	// watchdog reports `reactivity-stall` to bridge.log. This lives in
	// the layout, not the watchdog, because the effect has to sit in
	// the app's own component tree to wedge when the app does.
	let reactiveProbe = $state(0);
	let probeTimer: number | null = null;

	$effect(() => {
		// Read the probe to subscribe, then report that this effect ran.
		reactiveProbe;
		noteReactiveTick();
	});

	// Initialize theme store and WebSocket connection on mount
	onMount(async () => {
		// Theme manager auto-initializes in its constructor
		// Just ensure it's imported for initialization

		showPerf = new URLSearchParams(window.location.search).get('perf') === '1';

		// Start WebSocket connection and wait for it to establish
		await connectToLive();

		// Client-side watchdog: reports tab visibility changes, rAF stalls,
		// and network flips to bridge.log. Safe to start post-connect — if
		// the socket drops, send() queues and flushes on reconnect.
		startClientWatchdog();

		// Drive the reactivity probe. setInterval keeps running as long
		// as the event loop is alive, so a diverging counter isolates a
		// dead effect scheduler from a dead tab.
		probeTimer = window.setInterval(() => {
			reactiveProbe = noteSchedulerTick();
		}, 1000);

		// Now that WebSocket is connected, initialize stores and services that need it
		// Note: devicesStoreV6 removed - selectedTrackStore receives updates automatically via simpleClient routing
		console.log('[+layout] WebSocket connected - selectedTrackStore will receive updates automatically');

		// Initialize all services (including instrument display coordinator)
		console.log('[+layout] Initializing all services...');
		initializeAllServices();

		// The Places catalog's freshness stream from the Mac, and the
		// first-run verdict: with nothing saved there, Settings opens by
		// itself as the onboarding checklist (onboarding.plan.md §7).
		startPlacesLive();
		void openSettingsOnFirstRun();

		// ROW 13a (2026-04-21): clipStateStore.requestRefresh() deleted —
		// empty-track / filter state now $derives from v3Store.tracks,
		// which is seeded by the handshake-accept state/full emission.

		// Removed: Fire button long hold audio track prep
		// Audio track preparation now handled by Audio button in GestureBrowser sidebar

		// Setup debugging tools (auto-start in dev mode)
		if (import.meta.env.DEV) {
			console.log('[Debug] 🔧 Development mode - enabling freeze detection');
			
			// Add global debugging functions to window for manual inspection
			(globalThis as any).debugFreeze = () => {
				console.log(freezeDetector.generateReport());
				return freezeDetector.getMetrics();
			};
			
			console.log('[Debug] 💡 Use debugFreeze() in the console to inspect performance');
			
			// Add keyboard shortcut for quick debug (Ctrl+Shift+D)
			const handleKeyDown = (event: KeyboardEvent) => {
				if (event.ctrlKey && event.shiftKey && event.key === 'D') {
					event.preventDefault();
					console.log('=== QUICK DEBUG REPORT (Ctrl+Shift+D) ===');
					(globalThis as any).debugFreeze();
				}
			};
			
			window.addEventListener('keydown', handleKeyDown);

			// Cleanup keyboard listener (store reference for onDestroy)
			(globalThis as any).__debugKeydownCleanup = () => {
				window.removeEventListener('keydown', handleKeyDown);
			};
		}
	});
	
	// Cleanup on component destroy
	onDestroy(() => {
		if (probeTimer !== null) {
			clearInterval(probeTimer);
			probeTimer = null;
		}

		// Clean up all singleton services to prevent memory leaks
		destroyAllServices();

		// Stop client watchdog (rAF loop + listeners)
		stopClientWatchdog();

		// Clean up debugging tools
		if (import.meta.env.DEV) {
			freezeDetector.stop();
			// Clean up keyboard listener if it was registered
			(globalThis as any).__debugKeydownCleanup?.();
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<main class="py-4">
	{@render children?.()}
</main>

{#if showPerf}
	<PerfOverlay />
{/if}
