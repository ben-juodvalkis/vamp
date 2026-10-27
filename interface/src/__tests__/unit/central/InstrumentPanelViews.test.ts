/**
 * Electric and Collision in Live's arrangement (ADR-487), mounted against
 * the real v3 store holding each device as the rig's Live lists it
 * (docs/reference/instruments/dumps, at Live's defaults).
 *
 * Pins what the shots cannot: that a control writes ITS parameter (by name,
 * so at the index Live gave that name), that the eyebrow opens the section's
 * page and the way back closes it, that Live's tabs swap the middle without
 * writing anything, and that touching a control in a switched-off section
 * turns the section on first.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { send } from '$lib/api/simpleClient';
import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { replaceTree, _resetForTests, type TrackRecord, type DeviceRecord, type ParamRecord } from '$lib/stores/v3/normalized.svelte';
import ElectricCentralView from '$lib/components/v6/central/views/ElectricCentralView.svelte';
import CollisionCentralView from '$lib/components/v6/central/views/CollisionCentralView.svelte';
import DriftCentralView from '$lib/components/v6/central/views/DriftCentralView.svelte';
import ELECTRIC from '../../../../../docs/reference/instruments/dumps/Electric.json';
import COLLISION from '../../../../../docs/reference/instruments/dumps/Collision.json';
import DRIFT from '../../../../../docs/reference/instruments/dumps/Drift.json';

const sendMock = vi.mocked(send);
const TRACK = 'tracks/0';
const DEVICE = `${TRACK}/devices/0`;

interface Dump {
	parameters: { index: number; name: string; min: number; max: number; value: number }[];
}

function track(dump: Dump, name: string, className: string): TrackRecord {
	const params = new SvelteMap<string, ParamRecord>();
	for (const p of dump.parameters) {
		const paramPath = `${DEVICE}/params/${p.index}`;
		params.set(paramPath, { paramPath, name: p.name, displayName: p.name, min: p.min, max: p.max, value: p.value, unit: '' });
	}
	const device: DeviceRecord = { devicePath: DEVICE, name, className, params, properties: new SvelteMap() };
	return {
		trackPath: TRACK,
		name,
		color: 0x9a7cf2,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: 'keys',
		devices: new SvelteMap<string, DeviceRecord>([[DEVICE, device]]),
		slots: new SvelteMap()
	};
}

const instrument = (name: string, className: string) => ({
	deviceIndex: 0,
	className,
	name,
	type: 'instrument' as const,
	devicePath: DEVICE
});

/** Each `/looping/v3/param/set` as [param index, value]. */
function paramSets(): [number, number][] {
	return sendMock.mock.calls
		.filter(([addr]) => addr === '/looping/v3/param/set')
		.map(([, args]) => {
			const [path, value] = args as [string, number];
			return [Number(path.split('/').pop()), value];
		});
}

const indexOf = (dump: Dump, name: string) => dump.parameters.find((p) => p.name === name)!.index;

function el(container: HTMLElement, selector: string): HTMLElement {
	const found = container.querySelector<HTMLElement>(selector);
	if (!found) throw new Error(`nothing matches ${selector}`);
	return found;
}

function option(container: HTMLElement, param: string, label: string): HTMLElement {
	const group = el(container, `.panel-choice[data-param="${param}"]`);
	const button = [...group.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.trim() === label);
	if (!button) throw new Error(`no ${label} in ${param}`);
	return button;
}

describe('ElectricCentralView — Live\'s four sections', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		replaceTree(7, [track(ELECTRIC as Dump, 'Electric', 'LoungeLizard')]);
		selectedTrackStore.handleTrackSelected(0);
	});
	afterEach(() => cleanup());

	it('arrives on the frame: Hammer, Fork, Damper / Pickup, Global', async () => {
		const { container } = render(ElectricCentralView, { props: { instrument: instrument('Electric', 'LoungeLizard') } });
		await tick();
		expect(el(container, '[data-panel-page]').dataset.panelPage).toBe('frame');
		const groups = [...container.querySelectorAll<HTMLElement>('[data-group]')].map((g) => g.dataset.group);
		expect(groups).toEqual(['Hammer', 'Fork', 'Damper / Pickup', 'Global']);
		// The Fork's two boxes are Live's Tine and Tone knobs: the volumes.
		const fork = [...el(container, '[data-group="Fork"]').querySelectorAll<HTMLElement>('[data-param]')].map((c) => c.dataset.param);
		expect(fork).toEqual(['F Tine Vol', 'F Tone Vol']);
	});

	it('writes the pickup model by its name', async () => {
		const { container } = render(ElectricCentralView, { props: { instrument: instrument('Electric', 'LoungeLizard') } });
		await tick();
		await fireEvent.click(option(container, 'Pickup Model', 'W'));
		expect(paramSets()).toEqual([[indexOf(ELECTRIC as Dump, 'Pickup Model'), 1]]);
	});

	it('opens a section\'s page from its eyebrow and goes back, writing nothing', async () => {
		const { container } = render(ElectricCentralView, { props: { instrument: instrument('Electric', 'LoungeLizard') } });
		await tick();
		await fireEvent.click(el(container, '[data-group="Hammer"] .eyebrow-link'));
		expect(el(container, '[data-panel-page]').dataset.panelPage).toBe('hammer');
		expect(container.querySelector('[data-param="M Force < Vel"]')).toBeTruthy();
		await fireEvent.click(el(container, '.panel-back'));
		expect(el(container, '[data-panel-page]').dataset.panelPage).toBe('frame');
		expect(paramSets()).toEqual([]);
	});
});

describe('CollisionCentralView — Live\'s tabs over the middle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		replaceTree(7, [track(COLLISION as Dump, 'Collision', 'Collision')]);
		selectedTrackStore.handleTrackSelected(0);
	});
	afterEach(() => cleanup());

	it('dots each resonator tab with its switch: Resonator 1 on, 2 off at Live\'s defaults', async () => {
		const { container } = render(CollisionCentralView, { props: { instrument: instrument('Collision', 'Collision') } });
		await tick();
		expect(el(container, '[data-tab="Res 1"] .tab-dot').classList.contains('on')).toBe(true);
		expect(el(container, '[data-tab="Res 2"] .tab-dot').classList.contains('on')).toBe(false);
	});

	it('swaps the middle to Resonator 2 on its tab, writing nothing', async () => {
		const { container } = render(CollisionCentralView, { props: { instrument: instrument('Collision', 'Collision') } });
		await tick();
		expect(container.querySelector('[data-param="Res 1 Decay"]')).toBeTruthy();
		await fireEvent.click(el(container, '[data-tab="Res 2"]'));
		expect(container.querySelector('[data-param="Res 1 Decay"]')).toBeNull();
		expect(container.querySelector('[data-param="Res 2 Decay"]')).toBeTruthy();
		expect(paramSets()).toEqual([]);
	});

	it('leads back from a page opened on a page to that page, then to the frame', async () => {
		const { container } = render(CollisionCentralView, { props: { instrument: instrument('Collision', 'Collision') } });
		await tick();
		await fireEvent.click(el(container, '[data-group="Resonator 1"] .eyebrow-link'));
		await fireEvent.click(el(container, '[data-group="Body"] .eyebrow-link'));
		expect(el(container, '[data-panel-page]').dataset.panelPage).toBe('res1-mod');
		await fireEvent.click(el(container, '.panel-back'));
		expect(el(container, '[data-panel-page]').dataset.panelPage).toBe('res1');
		await fireEvent.click(el(container, '.panel-back'));
		expect(el(container, '[data-panel-page]').dataset.panelPage).toBe('frame');
	});

	it('turns a switched-off resonator on before its first write', async () => {
		const { container } = render(CollisionCentralView, { props: { instrument: instrument('Collision', 'Collision') } });
		await tick();
		await fireEvent.click(el(container, '[data-tab="Res 2"]'));
		await fireEvent.click(el(container, '[data-group="Resonator 2"] .eyebrow-link'));
		expect(el(container, '[data-panel-page]').dataset.panelPage).toBe('res2');
		await fireEvent.click(option(container, 'Res 2 Type', 'Plate'));
		const dump = COLLISION as Dump;
		expect(paramSets()).toEqual([
			[indexOf(dump, 'Res 2 On/Off'), 1],
			[indexOf(dump, 'Res 2 Type'), 4]
		]);
	});
});

describe('DriftCentralView — its own face, Live\'s sections behind the eyebrows', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		replaceTree(7, [track(DRIFT as Dump, 'Drift', 'Drift')]);
		selectedTrackStore.handleTrackSelected(0);
	});
	afterEach(() => cleanup());

	const pageLink = (container: HTMLElement, page: string) => el(container, `.eyebrow-link[data-page="${page}"]`);

	it('opens each of Live\'s sections from the face and comes back to it', async () => {
		const { container } = render(DriftCentralView, { props: { instrument: instrument('Drift', 'Drift') } });
		await tick();
		for (const page of ['oscillators', 'filter', 'envelopes', 'lfo-mod', 'global']) {
			expect(el(container, '[data-panel-page]').dataset.panelPage).toBe('frame');
			await fireEvent.click(pageLink(container, page));
			expect(el(container, '[data-panel-page]').dataset.panelPage).toBe(page);
			await fireEvent.click(el(container, '.panel-back'));
		}
		expect(paramSets()).toEqual([]);
	});

	it('writes the cycling envelope\'s mode by its name', async () => {
		const { container } = render(DriftCentralView, { props: { instrument: instrument('Drift', 'Drift') } });
		await tick();
		await fireEvent.click(pageLink(container, 'envelopes'));
		await fireEvent.click(option(container, 'Cyc Env Mode', 'Sync'));
		expect(paramSets()).toEqual([[indexOf(DRIFT as Dump, 'Cyc Env Mode'), 3]]);
	});
});
