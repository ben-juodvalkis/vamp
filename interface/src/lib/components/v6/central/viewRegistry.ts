/**
 * Central View Registry
 *
 * Centralized registry for all central display view components with lazy loading.
 * This replaces the large switch statement and manual imports in CentralDisplay.svelte.
 *
 * Benefits:
 * - Reduced initial bundle size (components loaded on demand)
 * - Easier extensibility (add new views by updating registry)
 * - Type-safe view resolution
 * - Cleaner, more maintainable code
 */

import type { CentralViewType } from '$lib/stores/v6/centralDisplayStore.svelte';
import type { Component } from 'svelte';
import { logger } from '$lib/utils/logger';

/**
 * Type for a lazy-loaded Svelte component
 *
 * Using Component<any> because central views have heterogeneous prop requirements:
 * - Effect views (arpeggiator, echo, etc.) are SELF-CONTAINED - they query their
 *   own slot state from selectedTrackStore and take NO props
 * - Instrument views (omnisphere, drumrack, etc.) RECEIVE PROPS from CentralDisplay
 *   for preset info, browser state, etc.
 *
 * This trade-off allows a unified registry while supporting both patterns.
 * The alternative would be separate registries with different type signatures.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LazyComponent = () => Promise<{ default: Component<any> }>;

/**
 * Registry structure for device-specific views
 */
interface DeviceViewRegistry {
	[subType: string]: LazyComponent;
}

/**
 * Registry structure for instrument-specific views
 */
interface InstrumentViewRegistry {
	[subType: string]: LazyComponent;
}

/**
 * Main view registry structure
 */
interface ViewRegistry {
	device: DeviceViewRegistry;
	instrument: InstrumentViewRegistry;
	default: LazyComponent;
	system: LazyComponent;
	clip: LazyComponent;
	permute: LazyComponent;
	groove: LazyComponent;
}

/**
 * Central view component registry
 *
 * Each entry is a lazy-loaded component that will only be fetched
 * when the corresponding view is first displayed.
 */
export const CENTRAL_VIEW_REGISTRY: ViewRegistry = {
	// Device views - organized alphabetically for maintainability
	// 'drum' is the Drum Buss (ADR-431): the Drum XY is a grid tile, this
	// view holds Boom and the Comp switch. The Saturator has no view of its
	// own any more — its XY and faders live inside the Pedal view.
	device: {
		'arpeggiator': () => import('./views/ArpeggiatorCentralView.svelte'),
		'audio-effect-rack': () => import('./views/AudioEffectRackCentralView.svelte'),
		// The Bass tile (audio tracks' fx1 column, 2026-09-14): its type is
		// `bass`, its view the Guitar rack's. An Octave band (`octave`)
		// opens the Chorus view, whose Octave panel is that slot. Aliased here the way `random` aliases the Arpeggiator's
		// and `squash` the Utility's; without an entry the tap resolved to
		// the placeholder view.
		'bass': () => import('./views/GuitarCentralView.svelte'),
		'chorus': () => import('./views/ChorusCentralView.svelte'),
		'compressor': () => import('./views/SquashCentralView.svelte'), // Compressor controls live in the Squash (dynamics) view
		'digital': () => import('./views/DigitalCentralView.svelte'),
		'drum': () => import('./views/DrumBussCentralView.svelte'),
		'echo': () => import('./views/EchoCentralView.svelte'), // the Echo tile, which replaced the Delay XY (2026-09-14)
		'eq': () => import('./views/EQCentralView.svelte'),
		'filter': () => import('./views/AutoFilterCentralView.svelte'),
		'guitar': () => import('./views/GuitarCentralView.svelte'),
		'octave': () => import('./views/ChorusCentralView.svelte'),
		'pedal': () => import('./views/PedalCentralView.svelte'),
		// The Rand Oct tile: its type is `random`, its view the Arpeggiator's
		// (the MIDI-effects family — arpeggiator, velocity and chord slots).
		// The tile used to name that view itself; since every tile opens its
		// own type through the router (issue #491) the alias lives here, the
		// way `squash` and `compressor` alias the Utility view.
		'random': () => import('./views/ArpeggiatorCentralView.svelte'),
		'redux': () => import('./views/ReduxCentralView.svelte'),
		'reverb': () => import('./views/ReverbCentralView.svelte'),
		'tremolo': () => import('./views/AutoPanCentralView.svelte'), // Auto Pan Legacy in the Tremolo slot (2026-10-01)
		'utility': () => import('./views/UtilityCentralView.svelte'), // the Gain tile's view — the Gate, since the compressor moved to Squash (2026-09-11)
		'squash': () => import('./views/SquashCentralView.svelte'), // the dynamics view; the Squash tile itself is the grid column above it
		'variation': () => import('./views/VariationCentralView.svelte'),
	},

	// Instrument views - organized alphabetically
	instrument: {
		'collision': () => import('./views/CollisionCentralView.svelte'),
		'drift': () => import('./views/DriftCentralView.svelte'),
		// One entry for every DrumGroupDevice (ADR-428, Milestone 1b). The view
		// picks its own mode from the surface's `vm.members` census: the
		// virtual-macro controls for native pads, the macro grid
		// (`views/DrumRackMacroGrid.svelte`, mounted by the view rather than
		// through this registry) for plugin-hosted pads. The retired
		// 'drumrack-komplete-kontrol' subtype falls through to `default`
		// like any other unknown subtype.
		'drumrack': () => import('./views/DrumRackCentralView.svelte'),
		'electric': () => import('./views/ElectricCentralView.svelte'),
		'instrument-rack': () => import('./views/InstrumentRackCentralView.svelte'),
		'instrument-rack-pattern': () => import('./views/InstrumentRackPatternCentralView.svelte'),
		'komplete-kontrol': () => import('./views/KompleteKontrolCentralView.svelte'),
		'meld': () => import('./views/MeldCentralView.svelte'),
		'omnisphere': () => import('./views/OmnisphereCentralView.svelte'),
		'operator': () => import('./views/OperatorCentralView.svelte'),
		'sampler': () => import('./views/SamplerCentralView.svelte'),
		'simpler': () => import('./views/SimplerCentralView.svelte'),
		'wavetable': () => import('./views/WavetableCentralView.svelte'),
	},

	// Top-level views (not categorized by subType)
	default: () => import('./views/DefaultCentralView.svelte'),
	system: () => import('./views/SystemCentralView.svelte'),
	clip: () => import('./views/ClipCentralView.svelte'),
	permute: () => import('./views/PermuteCentralView.svelte'),
	// Opened by touching Q in the right sidebar (2026-09-29): the ticked
	// grooves as tiles, and the focused clip's Random, Velocity and Amount.
	groove: () => import('./views/GrooveCentralView.svelte'),
};

/**
 * Resolve a view component from the registry
 *
 * @param type - The view type (e.g., 'device', 'instrument', 'default')
 * @param subType - Optional subtype for categorized views (e.g., 'autofilter', 'drumrack')
 * @returns A lazy-loaded component promise or null if not found
 */
export function resolveViewComponent(
	type: CentralViewType,
	subType?: string
): LazyComponent | null {
	// Handle categorized views (device, instrument)
	if (type === 'device' || type === 'instrument') {
		if (!subType) {
			// No subtype provided - return default fallback.
			//
			// This branch used to send instruments to the DrumRack view, the
			// same defect the subtype-not-found branch below carried: those
			// pads write params 1,2,3,4,9,10,11, so they land on whatever
			// happens to sit at those indices on the real device. The fix for
			// that (audit item 5) corrected only the other branch and left
			// this copy behind. Currently unreachable from the app -
			// `identifyInstrumentType` bottoms out at 'plugin'/'unknown',
			// never at empty - but `subType` is optional in this function's
			// own signature, so the guard belongs here too.
			return CENTRAL_VIEW_REGISTRY.default;
		}

		const categoryRegistry = CENTRAL_VIEW_REGISTRY[type];
		const component = categoryRegistry[subType];

		if (component) {
			return component;
		}

		// Subtype not found - return default fallback.
		//
		// Both branches return `default`. Instruments used to fall through
		// to the DrumRack view, whose pads write params 1,2,3,4,9,10,11 —
		// so selecting an Analog synth or any third-party plugin showed
		// drum-rack macro controls that wrote into whatever parameters
		// happened to sit at those indices on the real device.
		logger.warn(`Unknown ${type} subType: ${subType}, falling back to default`, { component: 'viewRegistry' });
		return CENTRAL_VIEW_REGISTRY.default;
	}

	// Handle top-level views (default, system, clip, permute, groove)
	if (type === 'default' || type === 'system' || type === 'clip' || type === 'permute' || type === 'groove') {
		return CENTRAL_VIEW_REGISTRY[type];
	}

	// Unknown view type - return default
	logger.warn(`Unknown view type: ${type}, falling back to default`, { component: 'viewRegistry' });
	return CENTRAL_VIEW_REGISTRY.default;
}

/**
 * Get all registered device subtypes
 */
export function getRegisteredDeviceTypes(): string[] {
	return Object.keys(CENTRAL_VIEW_REGISTRY.device);
}

/**
 * Get all registered instrument subtypes
 */
export function getRegisteredInstrumentTypes(): string[] {
	return Object.keys(CENTRAL_VIEW_REGISTRY.instrument);
}

/**
 * Check if a specific view is registered
 */
export function isViewRegistered(type: CentralViewType, subType?: string): boolean {
	if (type === 'device' || type === 'instrument') {
		if (!subType) return false;
		return subType in CENTRAL_VIEW_REGISTRY[type];
	}

	return type in CENTRAL_VIEW_REGISTRY;
}
