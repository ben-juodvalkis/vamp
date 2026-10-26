/**
 * A drag on a browser preset tile (2026-10-25, ADR-478): load the preset onto
 * the chain and set the values the finger chose, as a ghost grid tile does —
 * except the values belong to the device THIS load lands, never to one of its
 * type already on the chain (the grid's pending values go to whichever device
 * its tile controls).
 *
 * The landed device is found by what Live names it: a loaded preset's device
 * takes the preset's file name (measured: Disco Filter.adv arrived as an
 * `AutoFilter2` named "Disco Filter"). One more device of that class and
 * name on the chain than before the load is the one; the last in chain order
 * when there are several. Until it lands the values wait; once it has, each
 * move writes straight through. A load that never lands is given up after
 * `LAND_TIMEOUT_MS`.
 */
import { resolveParam, type Writes } from '$lib/components/v6/device-panel/deviceControls';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { fxChainStore } from '$lib/stores/v6/fxChainStore.svelte';
import { addPresetToChain } from './deviceMoveService';
import { openEffectView } from './effectView.svelte';
import { logger } from '$lib/utils/logger';

const LAND_TIMEOUT_MS = 5000;

interface Candidate {
	devicePath: string;
	className: string;
	name: string;
}

/** The device a load landed, given how many matched before it: the last match, once there is one more. */
export function landedDevice<D extends Candidate>(chain: readonly D[], className: string, name: string, before: number): D | null {
	const matches = chain.filter((d) => d.className === className && d.name === name);
	return matches.length > before ? matches[matches.length - 1] : null;
}

export interface PresetDrag {
	/** The values the finger is on now: every parameter it has moved, a Max device's by name. */
	update(values: Writes): void;
	/** The finger lifted: keep waiting for the device if it has not landed, then stop. */
	end(): void;
}

export function startPresetDrag(opts: {
	trackPath: string;
	/** A scoped drum pad's path, or '' for the track's chain. */
	padPath: string;
	presetPath: string;
	source: string;
	rel: string;
	/** The class and name the device arrives as. */
	className: string;
	name: string;
	values: Writes;
}): PresetDrag {
	const chain = () => (opts.padPath ? selectedTrackStore.padDevices(opts.padPath) : selectedTrackStore.devicesByPath);
	const before = chain().filter((d) => d.className === opts.className && d.name === opts.name).length;
	let pending = opts.values;
	const written: Record<number, number> = {};
	let landedPath: string | null = null;
	let ended = false;

	const flush = () => {
		if (!landedPath) return;
		// Names resolve on the device that landed (a Max device's indices shift build to build).
		const names = selectedTrackStore.paramNamesForDevice(landedPath);
		for (const [ref, value] of pending) {
			const index = resolveParam(ref, names);
			if (written[index] === value) continue;
			void selectedTrackStore.setParamValue(`${landedPath}/params/${index}`, value);
			written[index] = value;
		}
	};

	const stop = $effect.root(() => {
		$effect(() => {
			if (landedPath) return;
			const device = landedDevice(chain(), opts.className, opts.name, before);
			if (!device) return;
			landedPath = device.devicePath;
			// Its view follows the load, as a tap's does (`openViewWhenLanded`).
			openEffectView(device, { pickScope: opts.padPath || opts.trackPath, padScoped: !!opts.padPath });
			flush();
			if (ended) dispose();
		});
	});
	const timer = setTimeout(() => {
		if (!landedPath) logger.warn('Preset drag: the device never landed', { component: 'presetDragLoad', preset: opts.presetPath });
		dispose();
	}, LAND_TIMEOUT_MS);
	let disposed = false;
	function dispose() {
		if (disposed) return;
		disposed = true;
		clearTimeout(timer);
		stop();
	}

	void addPresetToChain(opts.trackPath, opts.padPath, opts.presetPath, opts.source, opts.rel).catch((err) => {
		logger.warn('Preset drag: load failed', { component: 'presetDragLoad', err: String(err) });
		dispose();
	});

	return {
		update(values) {
			pending = values;
			flush();
		},
		end() {
			ended = true;
			if (landedPath) dispose();
		}
	};
}
