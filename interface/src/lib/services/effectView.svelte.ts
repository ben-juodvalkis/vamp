/**
 * An effect's central view: the one a tap on its chain cell opens, and the
 * one a browser load opens once the device lands (user, 2026-10-26:
 * "loading a device should show its central view").
 *
 * A device of a type with a registered view opens it, as that type's pick
 * (the device its tile and view then control); Permute opens the Permute
 * view; a rack the app does not know opens the rack view; anything else
 * the generic chain view. Under a pad scope only a registered view opens,
 * in the Drum Rack view's pane (the router routes it).
 */
import { DEVICE_PRESETS } from '$lib/config/devicePresets';
import { matchesSlot } from '$lib/utils/deviceSlotMatch';
import { fxChainStore, RACK_PICK } from '$lib/stores/v6/fxChainStore.svelte';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { openDeviceView } from './deviceViewRouter.svelte';
import { isViewRegistered } from '$lib/components/v6/central/viewRegistry';
import { CHAIN_DEVICE_VIEW } from '$lib/components/v6/central/views/chainDeviceView';
import { logger } from '$lib/utils/logger';

interface EffectDevice {
	devicePath: string;
	className: string;
	name: string;
}

/** The `DEVICE_PRESETS` type a device is, by class and name (`deviceSlotMatch`), or null. */
export function effectTypeOf(device: Pick<EffectDevice, 'className' | 'name'>): string | null {
	for (const [key, config] of Object.entries(DEVICE_PRESETS)) {
		if (config.expectedClassName && matchesSlot(device, config)) return key;
	}
	return null;
}

/**
 * Show an effect's view. `pickScope` is the chain the pick belongs to (the
 * track's path, or a scoped pad's); `padScoped` when that is a pad's.
 */
export function openEffectView(device: EffectDevice, opts: { pickScope: string; padScoped: boolean }): void {
	const type = effectTypeOf(device);
	fxChainStore.appoint(device.devicePath, { force: true });
	if (opts.padScoped) {
		if (type && isViewRegistered('device', type)) {
			fxChainStore.pick(opts.pickScope, type, device.devicePath);
			openDeviceView(type);
		}
		return;
	}
	if (type === 'sequencer') {
		centralDisplayStore.setView('permute', undefined, null, 'Permute');
	} else if (type && isViewRegistered('device', type)) {
		fxChainStore.pick(opts.pickScope, type, device.devicePath);
		openDeviceView(type);
	} else if (device.className === 'AudioEffectGroupDevice') {
		fxChainStore.pick(opts.pickScope, RACK_PICK, device.devicePath);
		openDeviceView('audio-effect-rack');
	} else {
		fxChainStore.pick(opts.pickScope, CHAIN_DEVICE_VIEW, device.devicePath);
		openDeviceView(CHAIN_DEVICE_VIEW);
	}
}

const LAND_TIMEOUT_MS = 5000;

/**
 * Before a browser load: watch for the device it lands, one more named
 * `name` (Live names a loaded preset's device after its file) on the
 * track's chain or the pad's than now, and show its view. A load that
 * never lands is given up after five seconds. Returns a cancel.
 */
export function openViewWhenLanded(opts: { trackPath: string; padPath: string; name: string }): () => void {
	const chain = () => (opts.padPath ? selectedTrackStore.padDevices(opts.padPath) : selectedTrackStore.devicesByPath);
	const before = chain().filter((d) => d.name === opts.name).length;
	let done = false;
	const stop = $effect.root(() => {
		$effect(() => {
			if (done) return;
			const matches = chain().filter((d) => d.name === opts.name);
			const device = matches.length > before ? matches[matches.length - 1] : null;
			if (!device) return;
			done = true;
			openEffectView(device, { pickScope: opts.padPath || opts.trackPath, padScoped: !!opts.padPath });
			queueMicrotask(cancel);
		});
	});
	const timer = setTimeout(() => {
		if (!done) logger.warn('Effect load: the device never landed', { component: 'effectView', name: opts.name });
		cancel();
	}, LAND_TIMEOUT_MS);
	let cancelled = false;
	function cancel() {
		if (cancelled) return;
		cancelled = true;
		clearTimeout(timer);
		stop();
	}
	return cancel;
}
