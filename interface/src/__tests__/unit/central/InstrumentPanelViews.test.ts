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
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import DriftCentralView from '$lib/components/v6/central/views/DriftCentralView.svelte';
import MeldCentralView from '$lib/components/v6/central/views/MeldCentralView.svelte';
import AnalogCentralView from '$lib/components/v6/central/views/AnalogCentralView.svelte';
import ELECTRIC from '../../../../../docs/reference/instruments/dumps/Electric.json';
import COLLISION from '../../../../../docs/reference/instruments/dumps/Collision.json';
import DRIFT from '../../../../../docs/reference/instruments/dumps/Drift.json';
import MELD from '../../../../../docs/reference/instruments/dumps/Meld.json';
import ANALOG from '../../../../../docs/reference/instruments/dumps/Analog.json';

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

/** A long pick on a page (ADR-510): open its picker, then tap the value. */
async function pick(container: HTMLElement, param: string, label: string) {
	await fireEvent.click(el(container, `.panel-pick[data-param="${param}"] .picker-button`));
	const button = [...container.querySelectorAll<HTMLElement>('.picker-option')].find((b) => b.textContent?.trim() === label);
	if (!button) throw new Error(`no ${label} in ${param}`);
	await fireEvent.click(button);
}

describe('ElectricCentralView — Live\'s four sections', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		replaceTree(7, [track(ELECTRIC as Dump, 'Electric', 'LoungeLizard')]);
		selectedTrackStore.handleTrackSelected(0);
	});
	afterEach(() => cleanup());

	it('arrives on the frame: Hammer, Fork, Damper, Pickup, Global (Live’s five sections, 2026-11-08)', async () => {
		const { container } = render(ElectricCentralView, { props: { instrument: instrument('Electric', 'LoungeLizard') } });
		await tick();
		expect(el(container, '[data-panel-page]').dataset.panelPage).toBe('frame');
		const groups = [...container.querySelectorAll<HTMLElement>('[data-group]')].map((g) => g.dataset.group);
		expect(groups).toEqual(['Hammer', 'Fork', 'Damper', 'Pickup', 'Global']);
		// The Fork's first two knobs are Live's Tine and Tone: the volumes; then the tine's colour and decay.
		const fork = [...el(container, '[data-group="Fork"]').querySelectorAll<HTMLElement>('[data-param]')].map((c) => c.dataset.param);
		expect(fork).toEqual(['F Tine Vol', 'F Tone Vol', 'F Tine Color', 'F Tine Decay']);
	});

	it('writes the pickup model by its name', async () => {
		const { container } = render(ElectricCentralView, { props: { instrument: instrument('Electric', 'LoungeLizard') } });
		await tick();
		await fireEvent.click(option(container, 'Pickup Model', 'W'));
		expect(paramSets()).toEqual([[indexOf(ELECTRIC as Dump, 'Pickup Model'), 1]]);
	});

	it('opens no page from its eyebrows (ADR-513); its page\'s controls are on the board', async () => {
		const { container } = render(ElectricCentralView, { props: { instrument: instrument('Electric', 'LoungeLizard') } });
		await tick();
		expect(container.querySelector('.eyebrow-link')).toBeNull();
		expect(container.querySelector('[data-param="M Force < Vel"]')).toBeNull();
		cleanup();
		centralDisplayStore.setExpanded(true);
		try {
			const board = render(ElectricCentralView, { props: { instrument: instrument('Electric', 'LoungeLizard') } });
			await tick();
			expect(board.container.querySelector('[data-param="M Force < Vel"]')).toBeTruthy();
			expect(paramSets()).toEqual([]);
		} finally {
			centralDisplayStore.setExpanded(false);
		}
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

	it('opens no page from its eyebrows (ADR-513)', async () => {
		const { container } = render(CollisionCentralView, { props: { instrument: instrument('Collision', 'Collision') } });
		await tick();
		expect(container.querySelector('.eyebrow-link')).toBeNull();
		expect(el(container, '[data-panel-page]').dataset.panelPage).toBe('frame');
	});

	it('at full screen turns a switched-off resonator on before its first write', async () => {
		centralDisplayStore.setExpanded(true);
		try {
			const { container } = render(CollisionCentralView, { props: { instrument: instrument('Collision', 'Collision') } });
			await tick();
			await pick(container, 'Res 2 Type', 'Plate');
			const dump = COLLISION as Dump;
			expect(paramSets()).toEqual([
				[indexOf(dump, 'Res 2 On/Off'), 1],
				[indexOf(dump, 'Res 2 Type'), 4]
			]);
		} finally {
			centralDisplayStore.setExpanded(false);
		}
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

	// The normal view is one page (2026-11-07); the pages are the full-screen board's tiles.
	it('opens no page from the face: a section\'s name is its name', async () => {
		const { container } = render(DriftCentralView, { props: { instrument: instrument('Drift', 'Drift') } });
		await tick();
		expect(container.querySelector('.eyebrow-link')).toBeNull();
		expect(container.querySelector('[data-drift-page]')).toBeNull();
	});

	it('writes the cycling envelope\'s mode by its name at full screen, once Env 2 cycles', async () => {
		const cycling = {
			...(DRIFT as Dump),
			parameters: (DRIFT as Dump).parameters.map((p) => (p.name === 'Env 2 Cyc On' ? { ...p, value: 1 } : p))
		};
		replaceTree(8, [track(cycling, 'Drift', 'Drift')]);
		selectedTrackStore.handleTrackSelected(0);
		centralDisplayStore.setExpanded(true);
		try {
			const { container } = render(DriftCentralView, { props: { instrument: instrument('Drift', 'Drift') } });
			await tick();
			await fireEvent.click(option(el(container, '[data-board-tile="envelopes"]'), 'Cyc Env Mode', 'Sync'));
			expect(paramSets()).toEqual([[indexOf(DRIFT as Dump, 'Cyc Env Mode'), 3]]);
		} finally {
			centralDisplayStore.setExpanded(false);
		}
	});
});

describe.each([
	['Meld', MeldCentralView, MELD, 'InstrumentMeld', ['Engine A', 'Filter A'], ['Engine B', 'Filter B']],
	['Analog', AnalogCentralView, ANALOG, 'UltraAnalog', ['Osc 1', 'Filter 1'], ['Osc 2', 'Filter 2']]
] as const)('%sCentralView — the section names follow the shown half', (name, View, dump, className, first, second) => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetForTests();
		replaceTree(7, [track(dump as Dump, name, className)]);
		selectedTrackStore.handleTrackSelected(0);
	});
	afterEach(() => cleanup());

	const names = (container: HTMLElement) =>
		[...container.querySelectorAll<HTMLElement>('.panel-eyebrow')].map((l) => l.textContent?.trim() ?? '');

	it('follows the half switch in its section names, and opens no page', async () => {
		const { container } = render(View, { props: { instrument: instrument(name, className) } });
		await tick();
		expect(container.querySelector('.eyebrow-link')).toBeNull();
		expect(names(container)).toEqual(expect.arrayContaining([...first]));
		// Meld's half is picked by touching Engine B's level box, Analog's by its badge.
		HTMLElement.prototype.setPointerCapture ??= () => {};
		if (name === 'Meld') await fireEvent.pointerDown(el(container, '[data-engine-level="B"] [role="slider"]'), { pointerId: 1 });
		else await fireEvent.click(el(container, '.osc-badge'));
		expect(names(container)).toEqual(expect.arrayContaining([...second]));
		expect(paramSets()).toEqual([]);
	});
});
