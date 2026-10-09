/**
 * ChorusCentralView's GlitchLoop: its Max Mix (param 29, 0–100, the ceiling
 * on the device's Dry/Wet since 2026-10-09), Feedback L (param 9, 0–120) and an
 * Up · Spread · Off pitch column over Pitch L/R (params 5/6), in Pitch Hack's
 * old place.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { replaceTree, _resetForTests, type TrackRecord, type DeviceRecord, type ParamRecord } from '$lib/stores/v3/normalized.svelte';
import ChorusCentralView from '$lib/components/v6/central/views/ChorusCentralView.svelte';
import { send } from '$lib/api/simpleClient';

const TRACK = 'tracks/0';
const GL = `${TRACK}/devices/0`;

function glitchLoop(mixMax: number, feedback = 0, pitch: [number, number] = [0, 0], dryWet = 50): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i < 106; i++) {
		const paramPath = `${GL}/params/${i}`;
		const [name, value, min, max] =
			i === 5 ? ['Pitch L', pitch[0], -24, 24]
			: i === 6 ? ['Pitch R', pitch[1], -24, 24]
			: i === 7 ? ['Dry/Wet', dryWet, 0, 100]
			: i === 9 ? ['Feedback L', feedback, 0, 120]
			: i === 29 ? ['Max Mix', mixMax, 0, 100]
			: [`P${i}`, 0, 0, 100];
		params.set(paramPath, { paramPath, name, displayName: name, min, max, value, unit: '' });
	}
	return { devicePath: GL, name: 'GlitchLoop', className: 'MxDeviceAudioEffect', params, properties: new SvelteMap() };
}

function seed(device: DeviceRecord) {
	const t: TrackRecord = {
		trackPath: TRACK, name: 'Keys', color: 0xff8040, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: '',
		devices: new SvelteMap([[device.devicePath, device]]), slots: new SvelteMap()
	};
	replaceTree(3, [t]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
}

const sliderTitled = (container: HTMLElement, title: string) =>
	Array.from(container.querySelectorAll<HTMLElement>('[role="slider"]')).find((s) =>
		s.getAttribute('aria-label')?.startsWith(`${title}:`)
	);
const glitchSlider = (container: HTMLElement) => sliderTitled(container, 'GlitchLoop');

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => cleanup());

describe('ChorusCentralView GlitchLoop', () => {
	it('shows GlitchLoop Max Mix (param 29), not Dry/Wet, on a 0–100 slider', async () => {
		seed(glitchLoop(30, 0, [0, 0], 80));
		const { container } = render(ChorusCentralView);
		await tick();
		const s = glitchSlider(container);
		expect(s).toBeDefined();
		expect(s?.getAttribute('aria-valuenow')).toBe('30');
		expect(s?.getAttribute('aria-valuemax')).toBe('100');
	});

	it('dragging the GlitchLoop slider writes Max Mix (29) and leaves Dry/Wet (7) alone', async () => {
		seed(glitchLoop(30));
		const { container } = render(ChorusCentralView);
		await tick();
		HTMLElement.prototype.setPointerCapture = vi.fn();
		HTMLElement.prototype.releasePointerCapture = vi.fn();
		const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
			x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 400, width: 100, height: 400, toJSON: () => ({})
		} as DOMRect);
		const s = glitchSlider(container)!;
		const pointer = (type: string, y: number) => {
			const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 50, clientY: y });
			Object.defineProperty(ev, 'pointerId', { value: 1 });
			s.dispatchEvent(ev);
		};
		pointer('pointerdown', 200);
		pointer('pointermove', 150);
		await new Promise((r) => setTimeout(r, 50));
		pointer('pointerup', 150);
		rect.mockRestore();
		const paths = vi.mocked(send).mock.calls.flatMap(([, args]) =>
			Array.isArray(args) ? args.filter((x) => typeof x === 'string' && x.startsWith(`${GL}/params/`)) : []
		);
		expect(paths).toContain(`${GL}/params/29`);
		expect(paths).not.toContain(`${GL}/params/7`);
	});

	it('shows GlitchLoop Feedback L (param 9) on a 0–120 slider', async () => {
		seed(glitchLoop(30, 46));
		const { container } = render(ChorusCentralView);
		await tick();
		const s = sliderTitled(container, 'Feedback');
		expect(s).toBeDefined();
		expect(s?.getAttribute('aria-valuenow')).toBe('46');
		expect(s?.getAttribute('aria-valuemax')).toBe('120');
	});

	it('has no Size slider since 2026-10-08', async () => {
		seed(glitchLoop(0));
		const { container } = render(ChorusCentralView);
		await tick();
		expect(sliderTitled(container, 'Size')).toBeUndefined();
	});

	const pitchButtons = (container: HTMLElement) =>
		Array.from(container.querySelectorAll<HTMLButtonElement>('.glitch-pitch button'));

	it('draws Up, Spread, Off top to bottom and lights the one the device matches', async () => {
		seed(glitchLoop(0, 0, [-12, 12]));
		const { container } = render(ChorusCentralView);
		await tick();
		expect(pitchButtons(container).map((b) => b.textContent?.trim())).toEqual(['Up', 'Spread', 'Off']);
		expect(pitchButtons(container).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
	});

	it('lights none when the pitch was set some other way', async () => {
		seed(glitchLoop(0, 0, [7, 0]));
		const { container } = render(ChorusCentralView);
		await tick();
		expect(pitchButtons(container).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
	});

	it('writes each mode to Pitch L (5) and Pitch R (6)', async () => {
		seed(glitchLoop(0));
		const { container } = render(ChorusCentralView);
		await tick();
		const written = (i: number) =>
			vi.mocked(send).mock.calls
				.filter(([, args]) => Array.isArray(args) && args.includes(`${GL}/params/${i}`))
				.map(([, args]) => (args as unknown[])[1]);
		for (const b of pitchButtons(container)) await fireEvent.click(b);
		expect(written(5)).toEqual([12, -12, 0]);
		expect(written(6)).toEqual([12, 12, 0]);
	});
});
