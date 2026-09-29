/**
 * The central view registry had no test, and it is the single point where a
 * device or instrument gets matched to the UI that writes its parameters.
 * Getting that wrong is not cosmetic: a view bound to the wrong device sends
 * real parameter writes into Live at whatever indices its controls use.
 *
 * That is exactly what audit finding #3 was. Instruments with no matching
 * registry entry — Analog, any third-party plugin, anything identified as
 * 'unknown' — fell through to the DrumRack view, whose pads write params
 * 1, 2, 3, 4, 9, 10 and 11 on whatever device is selected.
 *
 * Item 5 fixed that, but only on one of the two fallback branches;
 * `resolveViewComponent` has a second, earlier one for a missing `subType`
 * that kept its own copy of `instrument['drumrack']`. Nothing caught it
 * because nothing tested this file. These tests pin both branches.
 *
 * Pure and DOM-free: the registry's values are lazy `import()` thunks, so a
 * component can be identified by which module it points at without mounting
 * anything.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
	CENTRAL_VIEW_REGISTRY,
	resolveViewComponent,
	getRegisteredDeviceTypes,
	getRegisteredInstrumentTypes,
	isViewRegistered
} from '$lib/components/v6/central/viewRegistry';

const VIEWS_DIR = resolve(
	__dirname,
	'../../../lib/components/v6/central/views'
);

/**
 * The view filename each registry thunk imports, read out of the thunk's own
 * source. The thunks are `() => import('./views/X.svelte')`, so the module
 * specifier is recoverable without executing (and therefore compiling) them.
 */
function registryTargets(): Array<[string, string]> {
	return allEntries().map(([label, thunk]) => {
		const src = thunk.toString();
		// Not anchored to './views/': vite rewrites the specifier, so under
		// vitest the thunk reads `__vite_ssr_dynamic_import__("/src/lib/.../views/X.svelte")`
		// while the shipped build keeps the relative form. Match the tail only.
		const m = /views\/([A-Za-z0-9_.-]+\.svelte)/.exec(src);
		if (!m) throw new Error(`cannot read a views/ import out of ${label}: ${src}`);
		return [label, m[1]] as [string, string];
	});
}

/** Every lazy thunk in the registry, flattened with a readable label. */
function allEntries(): Array<[string, () => Promise<unknown>]> {
	const out: Array<[string, () => Promise<unknown>]> = [];
	for (const [sub, thunk] of Object.entries(CENTRAL_VIEW_REGISTRY.device)) {
		out.push([`device:${sub}`, thunk]);
	}
	for (const [sub, thunk] of Object.entries(CENTRAL_VIEW_REGISTRY.instrument)) {
		out.push([`instrument:${sub}`, thunk]);
	}
	for (const top of ['default', 'system', 'clip', 'permute'] as const) {
		out.push([top, CENTRAL_VIEW_REGISTRY[top]]);
	}
	return out;
}

describe('viewRegistry — fallbacks', () => {
	it('sends an unknown instrument subtype to default, never DrumRack', () => {
		// 'analog' and 'unknown' are the real values finding #3 was about:
		// identifyInstrumentType bottoms out at 'plugin' / 'unknown'.
		for (const sub of ['analog', 'plugin', 'unknown', 'not-a-real-instrument']) {
			expect(resolveViewComponent('instrument', sub)).toBe(
				CENTRAL_VIEW_REGISTRY.default
			);
			expect(resolveViewComponent('instrument', sub)).not.toBe(
				CENTRAL_VIEW_REGISTRY.instrument['drumrack']
			);
		}
	});

	it('sends an instrument with NO subtype to default, never DrumRack', () => {
		// The branch item 5's fix missed. `subType` is optional in the
		// signature, so this is reachable through the function's own contract.
		for (const missing of [undefined, '']) {
			expect(resolveViewComponent('instrument', missing)).toBe(
				CENTRAL_VIEW_REGISTRY.default
			);
			expect(resolveViewComponent('instrument', missing)).not.toBe(
				CENTRAL_VIEW_REGISTRY.instrument['drumrack']
			);
		}
	});

	it('sends an unknown or missing device subtype to default', () => {
		expect(resolveViewComponent('device', 'not-a-real-device')).toBe(
			CENTRAL_VIEW_REGISTRY.default
		);
		expect(resolveViewComponent('device', undefined)).toBe(
			CENTRAL_VIEW_REGISTRY.default
		);
	});

	it('never returns null — CentralDisplay treats null as a hard error', () => {
		const probes: Array<[Parameters<typeof resolveViewComponent>[0], string | undefined]> = [
			['device', undefined], ['device', 'zzz'],
			['instrument', undefined], ['instrument', 'zzz'],
			['default', undefined], ['system', undefined],
			['clip', undefined], ['permute', undefined]
		];
		for (const [type, sub] of probes) {
			expect(resolveViewComponent(type, sub)).not.toBeNull();
		}
	});
});

describe('viewRegistry — the Drum Rack is one view (ADR-428, Milestone 1b)', () => {
	it('registers every DrumGroupDevice under one subtype', () => {
		expect(isViewRegistered('instrument', 'drumrack')).toBe(true);
		expect(registryTargets()).toContainEqual(['instrument:drumrack', 'DrumRackCentralView.svelte']);
	});

	it('sends the retired drumrack-komplete-kontrol subtype to default, never to a macro grid', () => {
		// The type no longer exists: `identifyInstrumentTypeAsync` returns
		// `drumrack` for every Drum Rack and the view picks the macro grid
		// itself from the surface's `vm.members` census. Anything that still
		// says the old name gets the unknown-subtype treatment.
		expect(isViewRegistered('instrument', 'drumrack-komplete-kontrol')).toBe(false);
		expect(resolveViewComponent('instrument', 'drumrack-komplete-kontrol')).toBe(
			CENTRAL_VIEW_REGISTRY.default
		);
	});

	it('keeps the macro grid on disk as a mode of the Drum Rack view, outside the registry', () => {
		// Renamed from DrumRackKompleteKontrolCentralView: it is mounted by
		// DrumRackCentralView, not resolved by subtype, so it must NOT carry
		// the *CentralView suffix the reachability rule below enforces.
		const onDisk = new Set(readdirSync(VIEWS_DIR));
		expect(onDisk.has('DrumRackMacroGrid.svelte')).toBe(true);
		expect(onDisk.has('DrumRackKompleteKontrolCentralView.svelte')).toBe(false);
		expect(registryTargets().map(([, file]) => file)).not.toContain('DrumRackMacroGrid.svelte');
	});
});

describe('viewRegistry — the Rand Oct tile (issue #491)', () => {
	it("opens the Arpeggiator view for the tile's own type, random", () => {
		// The tile used to name the Arpeggiator view itself; since every tile
		// opens its own type through the router, `random` has to resolve
		// here — with no entry it fell through to the placeholder view.
		const targets = new Map(registryTargets());
		expect(targets.get('device:random')).toBe('ArpeggiatorCentralView.svelte');
		expect(targets.get('device:random')).toBe(targets.get('device:arpeggiator'));
		expect(resolveViewComponent('device', 'random')).not.toBe(CENTRAL_VIEW_REGISTRY.default);
	});
});

describe('viewRegistry — resolution', () => {
	it('returns the registered thunk for a known subtype', () => {
		expect(resolveViewComponent('instrument', 'simpler')).toBe(
			CENTRAL_VIEW_REGISTRY.instrument['simpler']
		);
		expect(resolveViewComponent('device', 'echo')).toBe(
			CENTRAL_VIEW_REGISTRY.device['echo']
		);
	});

	it('resolves each top-level view to itself', () => {
		for (const top of ['default', 'system', 'clip', 'permute'] as const) {
			expect(resolveViewComponent(top)).toBe(CENTRAL_VIEW_REGISTRY[top]);
		}
	});

	it('isViewRegistered agrees with the registry contents', () => {
		expect(isViewRegistered('instrument', 'simpler')).toBe(true);
		expect(isViewRegistered('instrument', 'analog')).toBe(false);
		expect(isViewRegistered('instrument')).toBe(false);
		expect(isViewRegistered('system')).toBe(true);
	});

	it('the getRegistered* helpers match the registry keys', () => {
		expect(getRegisteredDeviceTypes().sort()).toEqual(
			Object.keys(CENTRAL_VIEW_REGISTRY.device).sort()
		);
		expect(getRegisteredInstrumentTypes().sort()).toEqual(
			Object.keys(CENTRAL_VIEW_REGISTRY.instrument).sort()
		);
	});
});

describe('viewRegistry — reachability', () => {
	it('every registry entry points at a view file that exists', () => {
		// Deliberately a disk check, not an `await thunk()`. Importing all 35
		// components compiles them, which is neither pure nor DOM-free (the
		// audit asked for both) and takes longer than vitest's timeout. That
		// they *compile* is what `npm run build` is for; what no other gate
		// covers is whether the registry still points at files that are there.
		const onDisk = new Set(readdirSync(VIEWS_DIR));
		for (const [label, file] of registryTargets()) {
			expect(onDisk.has(file), `${label} -> views/${file} does not exist`).toBe(true);
		}
	});

	it('every *CentralView.svelte on disk is reachable from the registry', () => {
		// The guard against a view that quietly stops being mounted.
		// EchoCentralView sat here for months: the registry's 'echo' key was
		// repointed from it to DelayCentralView with no commit removing the
		// file, so 244 lines kept absorbing edits — and it bound indices 29–32
		// that exist on Echo but not on the Delay the slot actually loads.
		//
		// ClipEditorView is deliberately outside this rule: it is not a
		// *CentralView and is mounted directly rather than through the registry.
		const onDisk = readdirSync(VIEWS_DIR)
			.filter((f) => f.endsWith('CentralView.svelte'))
			.sort();

		const registered = new Set(registryTargets().map(([, file]) => file));

		const orphans = onDisk.filter((f) => !registered.has(f));
		expect(orphans, `view file(s) present but unreachable: ${orphans.join(', ')}`)
			.toEqual([]);
	});

	it('finds a real set of views, so the reachability check cannot pass vacuously', () => {
		const onDisk = readdirSync(VIEWS_DIR).filter((f) => f.endsWith('CentralView.svelte'));
		expect(onDisk.length).toBeGreaterThan(20);
	});
});
