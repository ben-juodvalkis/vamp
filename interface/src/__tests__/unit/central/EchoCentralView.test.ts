/**
 * EchoCentralView's Input/Output link (2026-10-02): dragging Input moves
 * Output the other way, dB for dB, from where Output stood; dragging Output
 * moves Output alone.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { send } from '$lib/api/simpleClient';
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { replaceTree, _resetForTests, type DeviceRecord, type ParamRecord } from '$lib/stores/v3/normalized.svelte';
import { ECHO, inputGainDb, outputGainDb } from '$lib/components/v6/device-panel/echoParams';
import EchoCentralView from '$lib/components/v6/central/views/EchoCentralView.svelte';

const sendMock = vi.mocked(send);
const TRACK = 'tracks/0';
const DEVICE = `${TRACK}/devices/0`;

function echo(values: Record<number, number>): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i <= 52; i++) {
		const paramPath = `${DEVICE}/params/${i}`;
		const max = i === ECHO.sixteenths ? 16 : 1;
		params.set(paramPath, { paramPath, name: `P${i}`, displayName: `P${i}`, min: 0, max, value: values[i] ?? 0.5, unit: '' });
	}
	return { devicePath: DEVICE, name: 'Echo', className: 'Echo', params, properties: new SvelteMap() as DeviceRecord['properties'] };
}

async function mount(values: Record<number, number>) {
	replaceTree(3, [{
		trackPath: TRACK, name: 'Voice', color: 0x36a2ff, mute: false, solo: false, arm: false,
		hasMidiInput: false, hasAudioInput: true, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: 'voice',
		devices: new SvelteMap([[DEVICE, echo(values)]]), slots: new SvelteMap()
	}]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
	const view = render(EchoCentralView);
	await tick();
	return view.container;
}

const pointer = (el: Element, type: string, x: number, y: number) => {
	const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
	Object.defineProperty(ev, 'pointerId', { value: 1 });
	el.dispatchEvent(ev);
};
const slider = (c: Element, name: string) => c.querySelector(`[role="slider"][aria-label^="${name}"]`)!;
/** The last value written to each param index. */
function written(): Map<number, number> {
	const out = new Map<number, number>();
	for (const [, args] of sendMock.mock.calls) {
		const a = args as unknown[];
		const path = a.find((x) => typeof x === 'string' && x.startsWith(`${DEVICE}/params/`)) as string | undefined;
		if (path) out.set(Number(path.split('/').pop()), a[a.indexOf(path) + 1] as number);
	}
	return out;
}

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
	HTMLElement.prototype.setPointerCapture = vi.fn();
	HTMLElement.prototype.releasePointerCapture = vi.fn();
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
		x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 400, width: 100, height: 400, toJSON: () => ({})
	} as DOMRect);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('EchoCentralView Input/Output', () => {
	it('dragging Input moves Output the other way, dB for dB, from where it stood', async () => {
		const c = await mount({ [ECHO.inputGain]: 0.5, [ECHO.outputGain]: 0.65 });
		const input = slider(c, 'Input');
		pointer(input, 'pointerdown', 50, 200);
		pointer(input, 'pointermove', 50, 180);
		pointer(input, 'pointermove', 50, 150);
		await new Promise((r) => setTimeout(r, 50));
		pointer(input, 'pointerup', 50, 150);
		const w = written();
		const inNow = w.get(ECHO.inputGain)!;
		// 50 px of a 400 px rail at half speed: 0.5 + 0.0625.
		expect(inNow).toBeCloseTo(0.5625, 6);
		const rise = inputGainDb(inNow) - inputGainDb(0.5);
		expect(outputGainDb(w.get(ECHO.outputGain)!)).toBeCloseTo(outputGainDb(0.65) - rise, 6);
	});

	it('dragging Output leaves Input alone', async () => {
		const c = await mount({ [ECHO.inputGain]: 0.5, [ECHO.outputGain]: 0.65 });
		const output = slider(c, 'Output');
		pointer(output, 'pointerdown', 50, 200);
		pointer(output, 'pointermove', 50, 150);
		await new Promise((r) => setTimeout(r, 50));
		pointer(output, 'pointerup', 50, 150);
		const w = written();
		expect(w.has(ECHO.outputGain)).toBe(true);
		expect(w.get(ECHO.outputGain)).toBeCloseTo(0.7125, 6); // half speed too
		expect(w.has(ECHO.inputGain)).toBe(false);
	});
});
