/**
 * Which device on a chain a grid tile (and its central view) controls.
 *
 * **Type first, name only where the type cannot tell.** Every native
 * device the grid drives has a Live class of its own (`AutoFilter2` is
 * the Filter tile's and nothing else's), so any Auto Filter is the
 * Filter tile's whatever its name — a preset dragged in from Live's
 * browser keeps the preset's name. The classes several tiles share — a
 * rack, a Max device, a plug-in — say nothing about what the device is,
 * so those still match on the tile's name as well.
 *
 * **Several of one type:** the performer's pick when it is still on the
 * chain (the chain overview sets it), else the first in chain order.
 */
import type { DevicePresetConfig } from '$lib/config/devicePresets';

/** Classes that are containers rather than devices: the name is what identifies them. */
const NAME_KEYED_CLASSES = new Set([
	'AudioEffectGroupDevice',
	'InstrumentGroupDevice',
	'MidiEffectGroupDevice',
	'DrumGroupDevice',
	'MxDeviceAudioEffect',
	'MxDeviceMidiEffect',
	'MxDeviceInstrument',
	'AuPluginDevice',
	'PluginDevice'
]);

export function isNameKeyedClass(className: string): boolean {
	return NAME_KEYED_CLASSES.has(className);
}

interface Candidate {
	devicePath: string;
	name: string;
	className: string;
}

type SlotConfig = Pick<DevicePresetConfig, 'expectedClassName' | 'defaultName'>;

/** Whether `device` is a device this tile can control. */
export function matchesSlot(device: Pick<Candidate, 'name' | 'className'>, config: SlotConfig): boolean {
	if (device.className !== config.expectedClassName) return false;
	return isNameKeyedClass(device.className) ? device.name === config.defaultName : true;
}

/** Every device on the chain this tile could control, in chain order. */
export function slotCandidates<D extends Candidate>(devices: readonly D[], config: SlotConfig): D[] {
	return devices.filter((d) => matchesSlot(d, config));
}

/** The one the tile controls: the pick when it is a candidate, else the first. */
export function pickSlotDevice<D extends Candidate>(devices: readonly D[], config: SlotConfig, pickedPath?: string | null): D | null {
	const candidates = slotCandidates(devices, config);
	return candidates.find((d) => d.devicePath === pickedPath) ?? candidates[0] ?? null;
}
