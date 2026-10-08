/**
 * Instrument Service
 * Single source of truth for instrument type identification.
 *
 * ADR-428 / Milestone 1b (2026-09-07): every `DrumGroupDevice` is one
 * type, `drumrack`. The old split into `drumrack` vs
 * `drumrack-komplete-kontrol` was decided from macro *names* (FX1/FX2
 * on macros 1–2), which in practice meant "is this a pipeline kit" and
 * sent every other native kit (Simpler / Sampler pads) to a macro grid
 * whose sliders move nothing on an unmapped rack. The Drum Rack view now
 * picks its experience from the surface's `vm.members` census — plugin
 * pads keep the macro grid, native pads get the virtual macros — see
 * `services/drumVirtualMacros.ts`.
 */

import type { Device } from '$lib/types/device';
import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { isPatternRackMacroName } from '$lib/utils/macroLayoutUtils';
// PR-3.5.4 (2026-04-16): the legacy parameterOSCService round-trip is
// gone. `identifyInstrumentTypeAsync` now reads parameter names
// synchronously from `selectedTrackStore.paramNamesForDevice(device)`,
// which sits on top of the v3 normalized store. The method is still
// async-shaped because all callers (instrumentDisplayCoordinator)
// await it; that's fine — it just resolves immediately.

export interface InstrumentInfo {
  deviceIndex: number;
  className: string;
  name: string;
  type: 'instrument'; // Always instrument for this service
  /**
   * Phase 3.5 exit (2026-04-16): canonical v3 device path when the
   * instrument was resolved from a `DeviceRecord` (via
   * `selectedTrackStore.devicesByPath`). `identifyInstrumentTypeAsync`
   * prefers this over the legacy chain-index lookup when present.
   * Still optional because central views construct `InstrumentInfo`
   * from v2 Device shapes that carry only `.index` — those paths
   * migrate with the service in a later PR.
   */
  devicePath?: string;
}

export type InstrumentType =
  | 'drumrack'        // DrumGroupDevice — any pad type; the view picks its mode from vm.members
  | 'instrument-rack' // InstrumentGroupDevice (instrument rack)
  | 'instrument-rack-pattern' // Instrument or Audio Effect Rack with "Pattern XX" as first macro
  | 'operator'        // Operator
  | 'analog'          // Analog
  | 'wavetable'       // Wavetable
  | 'drift'           // Drift synth
  | 'collision'       // Collision physical modeling synth
  | 'electric'        // Electric (LoungeLizard) electric piano
  | 'meld'            // Meld (InstrumentMeld) synthesizer
  | 'sampler'         // Sampler
  | 'simpler'         // Simpler
  | 'omnisphere'      // AuPluginDevice with Omnisphere name
  | 'komplete-kontrol' // AuPluginDevice with Komplete Kontrol name
  | 'plugin'          // Generic plugin instrument
  | 'unknown';        // Unrecognized instrument

// Instrument device class names
const INSTRUMENT_CLASSES = [
  'DrumGroupDevice',      // Drum Rack
  'InstrumentGroupDevice', // Instrument Rack
  'Operator',             // Operator synth
  'Analog',               // Analog synth
  'InstrumentVector',     // Wavetable synth
  'Drift',                // Drift synth
  'Collision',            // Collision physical modeling synth
  'LoungeLizard',         // Electric (electric piano)
  'InstrumentMeld',       // Meld synthesizer
  'MultiSampler',         // Sampler (LOM class_name is MultiSampler, not Sampler)
  'OriginalSimpler',      // Simpler
  'AuPluginDevice',       // Audio Unit plugins
  'PluginDevice'          // VST plugins
];

class InstrumentService {
  /**
   * Find the first instrument in a device list
   * Returns null if no instrument found
   *
   * Phase 3.5 exit (2026-04-16): accepts either a v2 `Device[]` (carries
   * `.index` as the chain position) or a v3 `DeviceRecord[]` (chain
   * position = array index, path is authoritative). The DeviceRecord
   * overload populates `InstrumentInfo.devicePath` so
   * `identifyInstrumentTypeAsync` can look up parameter names by path
   * directly, bypassing the chain-index scan that still lingers on the
   * v2 Device overload.
   */
  findInstrumentInDeviceList(devices: Device[]): InstrumentInfo | null;
  findInstrumentInDeviceList(devices: DeviceRecord[]): InstrumentInfo | null;
  findInstrumentInDeviceList(devices: Device[] | DeviceRecord[]): InstrumentInfo | null {
    for (let i = 0; i < devices.length; i++) {
      const device = devices[i];
      if (!INSTRUMENT_CLASSES.includes(device.className)) continue;

      if ('devicePath' in device) {
        return {
          deviceIndex: i,
          className: device.className,
          name: device.name,
          type: 'instrument',
          devicePath: device.devicePath
        };
      }
      return {
        deviceIndex: device.index,
        className: device.className,
        name: device.name,
        type: 'instrument'
      };
    }
    return null;
  }

  /**
   * The pattern rack on an audio track: a top-level Audio Effect Rack whose
   * macro 1 reads "Pattern N" — in practice the Shaker track, whose rack
   * holds the Shaker Loop Chooser (macro 1 its pattern switch, which fires
   * the track's loop clips). An audio track has no instrument, so this is
   * the one rack it can open the Pattern Rack view for; the MIDI-track
   * Instrument Rack goes through {@link findInstrumentInDeviceList}.
   */
  findPatternRackInDeviceList(devices: DeviceRecord[]): InstrumentInfo | null {
    for (let i = 0; i < devices.length; i++) {
      const device = devices[i];
      if (device.className !== 'AudioEffectGroupDevice') continue;
      if (!isPatternRackMacroName([...device.params.values()][1]?.name)) continue;
      return {
        deviceIndex: i,
        className: device.className,
        name: device.name,
        type: 'instrument',
        devicePath: device.devicePath
      };
    }
    return null;
  }

  /**
   * Identify the specific type of instrument for UI rendering
   * Single source of truth for type mapping
   * NOTE: This is the synchronous fallback - use identifyInstrumentTypeAsync for nested detection
   */
  identifyInstrumentType(info: InstrumentInfo): InstrumentType {
    const { className, name } = info;

    // Native Ableton instruments
    if (className === 'DrumGroupDevice') return 'drumrack';
    if (className === 'Operator') return 'operator';
    if (className === 'Analog') return 'analog';
    if (className === 'InstrumentVector') return 'wavetable';
    if (className === 'Drift') return 'drift';
    if (className === 'Collision') return 'collision';
    if (className === 'LoungeLizard') return 'electric';
    if (className === 'InstrumentMeld') return 'meld';
    if (className === 'MultiSampler') return 'sampler';
    if (className === 'OriginalSimpler') return 'simpler';

    // Instrument rack
    if (className === 'InstrumentGroupDevice') return 'instrument-rack';

    // Plugin instruments - check name for specific plugins
    if (className === 'AuPluginDevice' || className === 'PluginDevice') {
      const lowerName = name?.toLowerCase() || '';
      if (lowerName.includes('omnisphere')) return 'omnisphere';
      if (lowerName.includes('komplete kontrol')) return 'komplete-kontrol';
      return 'plugin';
    }

    return 'unknown';
  }

  /**
   * Identify instrument type with parameter name detection (async)
   *
   * For InstrumentGroupDevice, reads the macro names to spot a pattern
   * rack (first macro "Pattern XX"). Drum racks are NOT split here any
   * more: every `DrumGroupDevice` is `drumrack`, and the Drum Rack view
   * decides between the virtual-macro controls and the macro grid from
   * the surface's `vm.members` census (pad classes, never macro names —
   * ADR-428 Milestone 1b).
   *
   * For all other instruments, uses synchronous className/name-based detection.
   *
   * @param info - Instrument information from device list
   * @param trackIndex - Current track index for parameter queries
   * @returns Promise resolving to specific InstrumentType
   */
  async identifyInstrumentTypeAsync(info: InstrumentInfo, trackIndex: number): Promise<InstrumentType> {
    const { className } = info;

    // For racks, check if first macro is "Pattern XX" (pattern selector). An
    // Audio Effect Rack only arrives here as an audio track's pattern rack
    // (`findPatternRackInDeviceList`).
    if (className === 'InstrumentGroupDevice' || className === 'AudioEffectGroupDevice') {
      const notPattern = className === 'InstrumentGroupDevice' ? 'instrument-rack' : 'unknown';
      const paramNames = await this.resolveParamNames(info);
      if (!paramNames) {
        return notPattern;
      }
      const macro1 = paramNames[1];

      // Check for "Pattern XX" where XX is an integer (e.g., "Pattern 8", "Pattern 16")
      if (macro1 && /^Pattern\s+\d+$/i.test(macro1)) {
        return 'instrument-rack-pattern';
      }

      return notPattern;
    }

    // For all other instruments, use synchronous detection
    return this.identifyInstrumentType(info);
  }

  /**
   * PR-4a-6b2 (2026-04-16): resolve parameter names for an
   * `InstrumentInfo`. Prefers the path-keyed lookup when `devicePath`
   * is set (Phase 3.5.x sources). Falls back to a path-keyed chain-
   * index read (`devicesByPath[deviceIndex]`) for older sources that
   * only carry a chain-order index — same v3 tree, no v2 devices scan.
   */
  private async resolveParamNames(info: InstrumentInfo): Promise<string[] | null> {
    if (info.devicePath) {
      const names = selectedTrackStore.paramNamesForDevice(info.devicePath);
      return names.length > 0 ? names : null;
    }
    const device = selectedTrackStore.devicesByPath[info.deviceIndex];
    if (!device) return null;
    return selectedTrackStore.paramNamesForDevice(device);
  }

  /**
   * Check if a device is an instrument
   */
  isInstrument(device: Device): boolean {
    return this.isInstrumentClass(device.className);
  }

  /**
   * Is this LOM class name an instrument's?
   *
   * The same question {@link isInstrument} asks, off a bare class name —
   * for callers holding a v3 `DeviceRecord` rather than a v2 `Device`
   * (the track strip's device band, which classifies devices on tracks
   * it is not selecting). One list, asked two ways.
   */
  isInstrumentClass(className: string): boolean {
    return INSTRUMENT_CLASSES.includes(className);
  }

  /**
   * Get all instruments from a device list
   */
  findAllInstruments(devices: Device[]): InstrumentInfo[] {
    return devices
      .filter(device => this.isInstrument(device))
      .map(device => ({
        deviceIndex: device.index,
        className: device.className,
        name: device.name,
        type: 'instrument' as const
      }));
  }

}

// Export singleton instance
export const instrumentService = new InstrumentService();