/**
 * What a device's panel shows in Live (ADR-541), for a component to draw:
 * holds the device's watch while the component lives and the `liveMeters`
 * switch is on, and says whether the latest reading is fresh. Shared by the
 * Glue's bar and needle and every spectrum.
 */
import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
import { liveMeterStore, STALE_MS } from '$lib/stores/v6/liveMeterStore.svelte';

export const REDUCTION_MAX_DB = 20;

export function useLiveMeter(devicePath: () => string | undefined) {
	const on = $derived(bridgeStatus.isFeatureOn('liveMeters'));
	let now = $state(Date.now());

	$effect(() => {
		const path = devicePath();
		if (!on || !path) return;
		const release = liveMeterStore.hold(path);
		const clock = setInterval(() => (now = Date.now()), 500);
		return () => {
			clearInterval(clock);
			release();
		};
	});

	const reading = $derived.by(() => {
		const path = devicePath();
		return path ? liveMeterStore.readingFor(path) : null;
	});
	const fresh = $derived(reading !== null && now - reading.at < STALE_MS);
	const ok = $derived(fresh && reading?.status === 'ok' && reading.values.length > 0);

	return {
		/** The switch is on: draw the meter at all. */
		get on() { return on; },
		/** A fresh `ok` reading. */
		get ok() { return ok; },
		/** The reading's values while `ok`, else []. */
		get values() { return ok && reading ? reading.values : []; },
		/** A needle's dB, 0 unless `ok`. */
		get db() { return ok && reading ? (reading.values[0] ?? 0) : 0; },
		/** The latest status while fresh, else ''. */
		get status() { return fresh ? (reading?.status ?? '') : ''; }
	};
}
