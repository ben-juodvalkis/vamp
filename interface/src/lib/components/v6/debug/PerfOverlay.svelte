<script lang="ts">
	/**
	 * Floating perf overlay. Mounted only when ``?perf=1`` is on the URL.
	 *
	 * Shows:
	 *   - Connection status snapshot (open / queued / last inbound age).
	 *   - JS heap usage (Chromium only — `performance.memory`).
	 *
	 * It used to head this with a "top reactive sources" table fed by
	 * ``reactive-monitor``. That table was permanently empty: reporting into
	 * the monitor required wrapping a derivation in ``monitoredDerived`` /
	 * ``monitoredEffect``, and no production module ever did. Deleted
	 * 2026-09-11 — an always-idle row is worse than no row, because "idle"
	 * is also exactly what a wedged scheduler looks like.
	 *
	 * Costs ~one timer tick (1 Hz). Only activates with the query param,
	 * so production users don't pay for it.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { getConnectionStatus } from '$lib/api/simpleClient';

	let heapMb = $state<string | null>(null);
	let connection = $state<{ connected: boolean; method: string; url?: string }>({
		connected: false,
		method: ''
	});

	let timer: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		timer = setInterval(() => {
			connection = getConnectionStatus();
			const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
			if (mem) {
				heapMb = (mem.usedJSHeapSize / 1024 / 1024).toFixed(1);
			}
		}, 1000);
	});

	onDestroy(() => {
		if (timer) clearInterval(timer);
	});
</script>

<div class="perf-overlay">
	<div class="perf-header">
		<span class="perf-title">PERF</span>
		<span class="perf-meta">
			ws: {connection.connected ? 'OK' : 'down'}{heapMb ? ` · ${heapMb}MB` : ''}
		</span>
	</div>
</div>

<style>
	.perf-overlay {
		position: fixed;
		top: 8px;
		right: 8px;
		z-index: 9999;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 11px;
		line-height: 14px;
		background: rgba(0, 0, 0, 0.78);
		color: #d6d6d6;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 6px 8px;
		min-width: 220px;
		max-width: 320px;
		pointer-events: none;
	}
	.perf-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 4px;
		padding-bottom: 4px;
		border-bottom: 1px solid #333;
	}
	.perf-title {
		color: #4ade80;
		font-weight: 600;
		letter-spacing: 0.08em;
	}
	.perf-meta {
		color: #888;
	}
</style>
