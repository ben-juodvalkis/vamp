/**
 * OttControl — master's fx1 column (2026-09-11), and what a tap on it must
 * NOT do (code review, 2026-09-12).
 *
 * `ott` has no `device` view in the registry, so the router would resolve a
 * tap to the placeholder and swap `SystemCentralView` — the Sections card
 * lives there — out from under the very tile that only ever mounts on that
 * view. The same defect a830a7a fixed for `random`; the net that commit
 * added walks `FX_GRID_LAYOUT`, which `ott` is deliberately not in. So the
 * tile opts out of the tap route, and a drag still loads (ADR-167: a tile
 * loads on its first drag frame, never on a tap).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { send } from '$lib/api/simpleClient';
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import { _resetForTests } from '$lib/stores/v3/normalized.svelte';
import { CENTRAL_VIEW_REGISTRY, resolveViewComponent } from '$lib/components/v6/central/viewRegistry';
import { DEVICE_PRESETS } from '$lib/config/devicePresets';
import OttControl from '$lib/components/v6/device-panel/OttControl.svelte';

const sendMock = vi.mocked(send);
const SLIDER_HEIGHT = 200;

function pointer(el: HTMLElement, type: string, clientY: number) {
	const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY });
	Object.defineProperty(ev, 'pointerId', { value: 1 });
	el.dispatchEvent(ev);
}

function slider(container: HTMLElement): HTMLElement {
	const el = container.querySelector<HTMLElement>('[role="slider"]');
	if (!el) throw new Error('no OTT slider');
	return el;
}

describe('OttControl', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		selectedTrackStore.handleTrackSelected(-1); // master
		fxGrid.resetForTrackChange();
		HTMLElement.prototype.setPointerCapture = vi.fn();
		HTMLElement.prototype.releasePointerCapture = vi.fn();
		vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
			x: 0, y: 0, top: 0, left: 0, right: 100, bottom: SLIDER_HEIGHT,
			width: 100, height: SLIDER_HEIGHT, toJSON: () => ({})
		} as DOMRect);
	});
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it('has no view of its own, so a tap leaves the current view where it is', async () => {
		// The reason: an unregistered type resolves to the placeholder.
		expect(resolveViewComponent('device', 'ott')).toBe(CENTRAL_VIEW_REGISTRY.default);

		const { container } = render(OttControl);
		await tick();
		const before = { ...centralDisplayStore.view };
		const el = slider(container);
		pointer(el, 'pointerdown', 100);
		pointer(el, 'pointerup', 100); // a tap: no travel, well under the slider's 200 ms
		await tick();
		expect(centralDisplayStore.view).toEqual(before);
		expect(centralDisplayStore.isViewActive('device', 'ott')).toBe(false);
	});

	it('loads the Multiband Dynamics default on the first drag, not on a tap', async () => {
		const { container } = render(OttControl);
		await tick();
		const el = slider(container);
		pointer(el, 'pointerdown', 100);
		pointer(el, 'pointerup', 100);
		await tick();
		expect(sendMock.mock.calls.filter(([addr]) => addr === '/looping/v3/device/load')).toHaveLength(0);

		pointer(el, 'pointerdown', 100);
		pointer(el, 'pointermove', 60);
		pointer(el, 'pointerup', 60);
		await tick();
		const loads = sendMock.mock.calls.filter(([addr]) => addr === '/looping/v3/device/load');
		expect(loads).toHaveLength(1);
		expect((loads[0][1] as unknown[]).slice(2)).toEqual(['', 'native:MultibandDynamics', 'Multiband Dynamics']);
		expect(selectedTrackStore.getFxGridSlot('ott').state).toBe('loading');
	});
});
