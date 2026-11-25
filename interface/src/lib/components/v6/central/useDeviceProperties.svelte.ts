/**
 * A device's LiveAPI properties (PR-3.5.7): subscribe a fixed list for as
 * long as the caller is mounted and the device path is known, and read
 * each with a fallback for the cold read still in flight.
 *
 * The subscription is the store's refcounted one: another consumer of the
 * same property (a tile and its view) shares the wire subscribe, and the
 * last release unsubscribes. Call it during component initialisation.
 *
 * ```ts
 * const props = useDeviceProperties(() => device?.devicePath, ['sample.gain']);
 * let gain = $derived(props.get('sample.gain', 1.0));
 * ```
 */
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';

type PropertyValue = ReturnType<typeof selectedTrackStore.propertyValue>;

export interface DeviceProperties {
	/** The property's value, `undefined` with no device or before it answers. */
	raw(name: string): PropertyValue;
	/** The property's value, or `fallback` with no device or before it answers. */
	get(name: string, fallback: number): number;
	get(name: string, fallback: string): string;
}

export function useDeviceProperties(
	getPath: () => string | undefined,
	names: readonly string[]
): DeviceProperties {
	$effect(() => {
		const path = getPath();
		if (!path) return;
		const releases = names.map((name) => selectedTrackStore.subscribeProperty(path, name));
		return () => releases.forEach((release) => release());
	});

	function raw(name: string): PropertyValue {
		const path = getPath();
		return path ? selectedTrackStore.propertyValue(path, name) : undefined;
	}

	function get(name: string, fallback: number): number;
	function get(name: string, fallback: string): string;
	function get(name: string, fallback: number | string): number | string {
		return (raw(name) as number | string | undefined) ?? fallback;
	}

	return { raw, get };
}
