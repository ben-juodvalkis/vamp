/**
 * A device's parameters by Live name, for an instrument panel (ADR-487).
 *
 * Resolves a name to its path at the moment it is read or written, over the
 * device's live parameter list, so a list that changes shape (a section
 * switched on lists its parameters, every later index shifts) never leaves a
 * control on the wrong parameter. Values are raw, in the parameter's own
 * units: a value box takes the parameter's range, so nothing converts.
 */
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';

// The selected track's device, as `selectedTrackStore.devicesByPath` hands it.
type PanelDevice = NonNullable<(typeof selectedTrackStore.devicesByPath)[number]>;

export interface PanelParams {
	/** Whether the device lists the parameter now. */
	has(name: string): boolean;
	raw(name: string): number | undefined;
	range(name: string): { min: number; max: number } | undefined;
	/** Live's own string for the value, while the UI is writing it. */
	display(name: string): string | undefined;
	/** On when the switch reads on, or when there is no switch to read. */
	isOn(switchName: string | undefined): boolean;
	/** Writes a raw value, switching its section on first when it is off. */
	write(name: string, value: number, switchName?: string): void;
	/** The value as 0..1 over the parameter's own range, for a control that sweeps 0..1 (an XY pad). */
	unit(name: string): number | undefined;
	/** Writes 0..1 over the parameter's own range, as `write` does. */
	writeUnit(name: string, t: number, switchName?: string): void;
}

export function usePanelParams(getDevice: () => PanelDevice | undefined): PanelParams {
	const indexByName = $derived.by(() => {
		const device = getDevice();
		const map = new Map<string, number>();
		if (!device) return map;
		selectedTrackStore.paramNamesForDevice(device).forEach((name, i) => {
			if (!map.has(name)) map.set(name, i);
		});
		return map;
	});

	function pathOf(name: string): string | undefined {
		const device = getDevice();
		const i = indexByName.get(name);
		return device && i !== undefined ? selectedTrackStore.paramPath(device, i) : undefined;
	}

	function raw(name: string): number | undefined {
		const path = pathOf(name);
		return path ? selectedTrackStore.paramValueArmed(path) : undefined;
	}

	function isOn(switchName: string | undefined): boolean {
		if (!switchName) return true;
		const v = raw(switchName);
		return v === undefined || v >= 0.5;
	}

	function range(name: string) {
		const path = pathOf(name);
		return path ? selectedTrackStore.paramRange(path) : undefined;
	}

	function write(name: string, value: number, switchName?: string) {
		if (switchName && !isOn(switchName)) {
			const switchPath = pathOf(switchName);
			if (switchPath) selectedTrackStore.setParamValue(switchPath, 1);
		}
		const path = pathOf(name);
		if (path) selectedTrackStore.setParamValue(path, value);
	}

	return {
		has: (name) => indexByName.has(name),
		raw,
		range,
		display(name) {
			const path = pathOf(name);
			return path ? selectedTrackStore.paramDisplay(path) : undefined;
		},
		isOn,
		write,
		unit(name) {
			const v = raw(name);
			const r = range(name);
			if (v === undefined || !r || r.max <= r.min) return undefined;
			return Math.max(0, Math.min(1, (v - r.min) / (r.max - r.min)));
		},
		writeUnit(name, t, switchName) {
			const r = range(name);
			if (!r || r.max <= r.min) return;
			write(name, r.min + Math.max(0, Math.min(1, t)) * (r.max - r.min), switchName);
		}
	};
}
