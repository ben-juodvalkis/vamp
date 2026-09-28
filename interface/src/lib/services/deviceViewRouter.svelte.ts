/**
 * deviceViewRouter — where "open this effect's view" goes (issue #491,
 * 2026-09-10).
 *
 * Sixteen tile call sites used to switch the central display to a device
 * view directly. Under a pad scope that is exactly wrong: swapping the
 * top-level view unmounts the Drum Rack view and its pad column, the
 * held finger gets a pointer cancel, the scope clears and the grid snaps
 * back to the track mid-gesture. So while a pad is scoped on the
 * selected track's Drum Rack, opening an effect view means setting the
 * **pane** inside the Drum Rack view — and, if another top-level view is
 * up (a tile tapped under a standing latch while the clip view is
 * showing), bringing the Drum Rack view back first, because a pane
 * nobody can see is no answer. With no scope, the top-level view swaps
 * as it always did.
 *
 * `activeDrumRackScope` is the one place that says whether a pad is
 * scoped on the *selected track's* Drum Rack — the FX grid provides it
 * as the tiles' `fxScope`, the tiles read it to dim non-pad-able slots,
 * and this router reads it to route.
 */

import { currentInstrumentStore } from '$lib/stores/v6/currentInstrumentStore.svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import { drumPadScope } from '$lib/stores/v6/drumPadScope.svelte';
import { parseVmMembers, VM } from '$lib/services/drumVirtualMacros';
import { fxScopeFor, type FxScope } from '$lib/components/v6/central/fxScope';
import type { InstrumentInfo } from '$lib/services/instrumentService';

/**
 * The device path an instrument record stands for: the path the record
 * carries, else the device at its chain index on the selected track. The
 * one rule — the Drum Rack view and the FX grid's Pitch slider used to
 * read the index first while this router read the path first, so during
 * a rack-path transit the pane was written under one key and read under
 * another (code review, 2026-09-12).
 */
export function instrumentDevicePath(instrument: InstrumentInfo | null | undefined): string | undefined {
	if (!instrument) return undefined;
	return instrument.devicePath ?? selectedTrackStore.devicesByPath[instrument.deviceIndex]?.devicePath;
}

/** The selected track's Drum Rack — its device path and instrument info — or null. */
export function selectedDrumRack(): { rackPath: string; instrument: NonNullable<typeof currentInstrumentStore.current> } | null {
	const instrument = currentInstrumentStore.current;
	if (!instrument || currentInstrumentStore.type !== 'drumrack') return null;
	const rackPath = instrumentDevicePath(instrument);
	if (!rackPath) return null;
	return { rackPath, instrument };
}

/**
 * The pad scoped on the selected track's Drum Rack right now, as an
 * `FxScope`, or null. Reactive: reads the instrument store, the v3 tree,
 * the scope store and the census.
 */
export function activeDrumRackScope(): FxScope | null {
	const rack = selectedDrumRack();
	if (!rack) return null;
	const note = drumPadScope.scopeNote(rack.rackPath);
	if (note === null) return null;
	const members = parseVmMembers(selectedTrackStore.propertyValue(rack.rackPath, VM.members));
	return fxScopeFor(rack.rackPath, note, members?.pads.find((p) => p.note === note));
}

/**
 * The pane type for a pad's Permute (ADR-435 follow-up, 2026-09-14): the
 * Permute view's registry key, which `PadFxPane` resolves as the
 * top-level view it is rather than as a device view.
 */
export const PANE_PERMUTE = 'permute';

/**
 * The strip's Permute tap under a pad scope (ADR-435 follow-up,
 * 2026-09-14): with a pad held or latched on the selected track's Drum
 * Rack, the pad's Permute opens as the Drum Rack view's pane — the pad
 * column stays, the hold survives, exactly as an effect's view does from
 * a tile. Returns `false` with nothing scoped, and the caller swaps the
 * top-level Permute view as it always did.
 */
export function openScopedPermutePane(): boolean {
	const rack = selectedDrumRack();
	if (!rack || drumPadScope.scopeNote(rack.rackPath) === null) return false;
	openDeviceView(PANE_PERMUTE);
	return true;
}

/**
 * Open an effect's central view: the Drum Rack view's pane while a pad
 * is scoped, the top-level device view otherwise. `data` is what the
 * top-level view is handed (`{ device, color }`); the pane takes only
 * the type — the scoped pad supplies the instance.
 *
 * Cheap to call per drag frame: a pane already showing the type, or a
 * top-level view already up, is left alone.
 */
export function openDeviceView(deviceType: string, data?: unknown): void {
	const rack = selectedDrumRack();
	if (rack && drumPadScope.scopeNote(rack.rackPath) !== null) {
		if (drumPadScope.pane(rack.rackPath) !== deviceType) drumPadScope.setPane(rack.rackPath, deviceType);
		if (!centralDisplayStore.isViewActive('instrument', 'drumrack')) {
			centralDisplayStore.setView('instrument', 'drumrack', { instrument: rack.instrument });
		}
		return;
	}
	if (centralDisplayStore.isViewActive('device', deviceType)) return;
	centralDisplayStore.setView('device', deviceType, data);
}
