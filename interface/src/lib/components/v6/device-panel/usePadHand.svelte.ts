/**
 * usePadHand — Live's blue hand follows the Drum Rack view's pad scope
 * (2026-10-25). Scoping a pad (a tap that latches, or a hold) appoints the
 * pad's instrument, the device the view's controls now drive; letting the
 * scope go appoints the rack again, the kit. Only on a change, so a hand
 * moved elsewhere in Live is not pulled back while the scope sits still,
 * and not under a track hold (selecting there would select that track).
 *
 * `$effect`s are created here, so call it during component init.
 */
import { fxChainStore } from '$lib/stores/v6/fxChainStore.svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { trackHoldScope } from '$lib/stores/v6/trackHoldScope.svelte';
import { activeDrumRackScope, selectedDrumRack } from '$lib/services/deviceViewRouter.svelte';
import { VM_PAD_FX, padInstrumentPath, parseVmPadFx } from '$lib/services/drumVirtualMacros';

export function usePadHand(): void {
	const rackPath = $derived(selectedDrumRack()?.rackPath ?? null);
	const scope = $derived(trackHoldScope.active ? null : activeDrumRackScope());
	const padPath = $derived(scope?.padPath ?? null);
	const target = $derived.by(() => {
		if (!rackPath) return null;
		if (!scope) return rackPath;
		const padFx = parseVmPadFx(selectedTrackStore.propertyValue(scope.rackPath, VM_PAD_FX));
		return padInstrumentPath(padFx, scope.padPath, scope.note);
	});

	let lastRack: string | null = null;
	let lastPad: string | null = null;
	$effect(() => {
		const rack = rackPath;
		const pad = padPath;
		const to = target;
		if (trackHoldScope.active) return;
		// A new rack in view (a track change) is not a gesture: just note it.
		if (rack !== lastRack) {
			lastRack = rack;
			lastPad = pad;
			return;
		}
		if (pad === lastPad || !to) return;
		lastPad = pad;
		fxChainStore.appoint(to);
	});
}
