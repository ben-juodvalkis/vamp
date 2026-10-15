/**
 * GlitchCentralView's GlitchLoop (2026-10-15): Mix (Dry/Wet, 0–100),
 * Feedback (L and R together, 0–120) and an Up · Spread · Off pitch column
 * over Pitch L/R, all found by parameter NAME. The fixture is the
 * 153-parameter build measured on the rig (Clock 13, Pitch L/R 14/15,
 * Dry/Wet 19, Feedback L/R 23/24); one case shifts every index to show the
 * names, not the positions, decide.
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
import GlitchCentralView from '$lib/components/v6/central/views/GlitchCentralView.svelte';
import { send } from '$lib/api/simpleClient';

const TRACK = 'tracks/0';
const GL = `${TRACK}/devices/0`;

const AT = { pitchL: 14, pitchR: 15, dryWet: 19, feedbackL: 23, feedbackR: 24 };

function glitchLoop(dryWet = 0, feedback = 0, pitch: [number, number] = [0, 0], shift = 0): DeviceRecord {
	const named: Record<number, [string, number, number, number]> = {
		[AT.pitchL + shift]: ['Pitch L', pitch[0], -24, 24],
		[AT.pitchR + shift]: ['Pitch R', pitch[1], -24, 24],
		[AT.dryWet + shift]: ['Dry/Wet', dryWet, 0, 100],
		[AT.feedbackL + shift]: ['Feedback L', feedback, 0, 120],
		[AT.feedbackR + shift]: ['Feedback R', feedback, 0, 120]
	};
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i < 153 + shift; i++) {
		const paramPath = `${GL}/params/${i}`;
		const [name, value, min, max] = named[i] ?? [`P${i}`, 0, 0, 100];
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
const mixSlider = (container: HTMLElement) => sliderTitled(container, 'Mix');

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => cleanup());

const written = (i: number) =>
	vi.mocked(send).mock.calls
		.filter(([, args]) => Array.isArray(args) && args.includes(`${GL}/params/${i}`))
		.map(([, args]) => (args as unknown[])[1]);

function drag(el: HTMLElement) {
	HTMLElement.prototype.setPointerCapture = vi.fn();
	HTMLElement.prototype.releasePointerCapture = vi.fn();
	const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
		x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 400, width: 100, height: 400, toJSON: () => ({})
	} as DOMRect);
	const pointer = (type: string, y: number) => {
		const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 50, clientY: y });
		Object.defineProperty(ev, 'pointerId', { value: 1 });
		el.dispatchEvent(ev);
	};
	return (async () => {
		pointer('pointerdown', 200);
		pointer('pointermove', 150);
		await new Promise((r) => setTimeout(r, 50));
		pointer('pointerup', 150);
		rect.mockRestore();
	})();
}

describe('GlitchCentralView GlitchLoop', () => {
	it('shows Dry/Wet on the 0–100 Mix slider', async () => {
		seed(glitchLoop(30));
		const { container } = render(GlitchCentralView);
		await tick();
		const s = mixSlider(container);
		expect(s?.getAttribute('aria-valuenow')).toBe('30');
		expect(s?.getAttribute('aria-valuemax')).toBe('100');
	});

	it('finds Dry/Wet by name when the build has moved it', async () => {
		seed(glitchLoop(30, 0, [0, 0], 7));
		const { container } = render(GlitchCentralView);
		await tick();
		expect(mixSlider(container)?.getAttribute('aria-valuenow')).toBe('30');
		await drag(mixSlider(container)!);
		expect(written(AT.dryWet + 7).length).toBeGreaterThan(0);
		expect(written(AT.dryWet)).toEqual([]);
	});

	it('shows Feedback L on a 0–120 slider and writes both channels', async () => {
		seed(glitchLoop(0, 46));
		const { container } = render(GlitchCentralView);
		await tick();
		const s = sliderTitled(container, 'Feedback')!;
		expect(s.getAttribute('aria-valuenow')).toBe('46');
		expect(s.getAttribute('aria-valuemax')).toBe('120');
		await drag(s);
		expect(written(AT.feedbackL).length).toBeGreaterThan(0);
		expect(written(AT.feedbackR)).toEqual(written(AT.feedbackL));
	});

	const pitchButtons = (container: HTMLElement) =>
		Array.from(container.querySelectorAll<HTMLButtonElement>('.glitch-pitch button'));

	it('draws Up, Spread, Off top to bottom and lights the one the device matches', async () => {
		seed(glitchLoop(0, 0, [-12, 12]));
		const { container } = render(GlitchCentralView);
		await tick();
		expect(pitchButtons(container).map((b) => b.textContent?.trim())).toEqual(['Up', 'Spread', 'Off']);
		expect(pitchButtons(container).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
	});

	it('lights none when the pitch was set some other way', async () => {
		seed(glitchLoop(0, 0, [7, 0]));
		const { container } = render(GlitchCentralView);
		await tick();
		expect(pitchButtons(container).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
	});

	it('writes each mode to Pitch L and Pitch R', async () => {
		seed(glitchLoop(0));
		const { container } = render(GlitchCentralView);
		await tick();
		for (const b of pitchButtons(container)) await fireEvent.click(b);
		expect(written(AT.pitchL)).toEqual([12, -12, 0]);
		expect(written(AT.pitchR)).toEqual([12, 12, 0]);
	});
});
