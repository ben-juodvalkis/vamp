/**
 * A device's gain reduction as Live shows it (ADR-541), for a component to
 * draw: holds the device's watch while the component lives and the
 * `reductionMeter` switch is on, and says whether the latest reading is
 * fresh. Shared by the Glue view's bar and its chain cell's needle.
 */
import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte';
import { reductionMeterStore, STALE_MS } from '$lib/stores/v6/reductionMeterStore.svelte';

export const REDUCTION_MAX_DB = 20;

export function useReduction(devicePath: () => string | undefined) {
	const on = $derived(bridgeStatus.isFeatureOn('reductionMeter'));
	let now = $state(Date.now());

	$effect(() => {
		const path = devicePath();
		if (!on || !path) return;
		const release = reductionMeterStore.hold(path);
		const clock = setInterval(() => (now = Date.now()), 500);
		return () => {
			clearInterval(clock);
			release();
		};
	});

	const reading = $derived.by(() => {
		const path = devicePath();
		return path ? reductionMeterStore.readingFor(path) : null;
	});
	const fresh = $derived(reading !== null && now - reading.at < STALE_MS);
	const ok = $derived(fresh && reading?.status === 'ok');

	return {
		/** The switch is on: draw the meter at all. */
		get on() { return on; },
		/** A fresh `ok` reading. */
		get ok() { return ok; },
		/** dB, 0 unless `ok`. */
		get db() { return ok && reading ? reading.db : 0; },
		/** The latest status while fresh, else ''. */
		get status() { return fresh ? (reading?.status ?? '') : ''; }
	};
}
