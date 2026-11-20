/**
 * SwapControl — the swap pill every instrument view shares (ADR-439): the
 * loaded name, dumb. Since ADR-552 there are no step arrows: given an
 * `onOpen` the whole pill is one button that opens the browser, and without
 * one it is a plain label. A disabled pill says why in place of the name.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import SwapControl from '$lib/components/v6/central/SwapControl.svelte';
import HostedSwapPill from '$lib/components/v6/central/HostedSwapPill.svelte';
import { SwapHost } from '$lib/components/v6/central/swapHost.svelte';
import SwapHostSwitch from './SwapHostSwitch.svelte';

type Props = ComponentProps<typeof SwapControl>;

function setup(over: Partial<Props> = {}) {
	const { container } = render(SwapControl, {
		props: { scopeLabel: 'Kit', label: 'Memphis Studio + Plymouth', ...over }
	});
	const door = () => container.querySelector<HTMLButtonElement>('[data-swap="open"]');
	const press = () => fireEvent.keyDown(door()!, { key: 'Enter' });
	const state = () => container.querySelector('.swap-control')?.getAttribute('data-swap-state');
	return { container, door, press, state };
}

afterEach(() => {
	cleanup();
});

describe('SwapControl', () => {
	it('draws no step arrows in either orientation', () => {
		for (const orientation of ['vertical', 'horizontal'] as const) {
			const { container } = setup({ orientation, onOpen: vi.fn() });
			expect(container.querySelector('[data-swap="prev"], [data-swap="next"], .swap-arrow')).toBeNull();
			expect(container.querySelectorAll('button')).toHaveLength(1);
			cleanup();
		}
	});

	it('shows the name and no other text', () => {
		const { container, state } = setup({ scopeLabel: 'Preset', label: 'Bell Keys' });
		expect(container.textContent?.trim()).toBe('Bell Keys');
		expect(state()).toBe('ready');
	});

	it('shows why in place of the name while disabled', () => {
		const detail = 'ax-helper-down: the Looping AX Helper is not running';
		const { container, state } = setup({ disabled: true, label: 'ax-helper-down', detail, error: 'ax-helper-down' });
		expect(state()).toBe('disabled');
		expect(container.textContent?.trim()).toBe('ax-helper-down');
		expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(`Kit: ${detail}`);
	});

	it("wears the mounted view's density", () => {
		const compact = setup({ density: 'compact' });
		expect(compact.container.querySelector('.swap-control')?.getAttribute('data-density')).toBe('compact');
		cleanup();
		const standard = setup();
		expect(standard.container.querySelector('.swap-control')?.hasAttribute('data-density')).toBe(false);
	});
});

describe('SwapHost', () => {
	const model = {
		scopeLabel: 'Preset',
		label: 'Bell Keys',
		detail: '',
		working: false,
		disabled: false,
		error: null
	};

	it('is claimed while any hosted pill holds it, and a release counts once', () => {
		const host = new SwapHost(() => ({ model, act: () => {}, open: null, ink: null }));
		expect(host.claimed).toBe(false);
		const a = host.claim();
		const b = host.claim();
		a();
		a();
		expect(host.claimed).toBe(true);
		b();
		expect(host.claimed).toBe(false);
	});

	it('is present only while the pill has a model', () => {
		let current: typeof model | null = model;
		const host = new SwapHost(() => ({ model: current, act: () => {}, open: null, ink: null }));
		expect(host.present).toBe(true);
		current = null;
		expect(host.present).toBe(false);
	});

	it('stays claimed when one view hands the pill straight to the next', async () => {
		// Drift to Omnisphere, a kit to Omnisphere (2026-09-16): the new view's
		// pill claims before the old one's teardown releases, in one flush, and
		// Svelte shows a teardown the values from before that flush. A release
		// that read the count back got the pre-claim 1 and wrote 0, so the
		// column stood beside the flat pill until the next view change.
		const { container, rerender } = render(SwapHostSwitch, { view: 'drift' });
		expect(container.querySelector('[data-testid="swap-column"]')).toBeNull();
		await rerender({ view: 'omnisphere' });
		expect(container.querySelector('[data-testid="swap-column"]')).toBeNull();
		expect(container.querySelectorAll('.swap-control')).toHaveLength(1);
		await rerender({ view: 'drift' });
		expect(container.querySelector('[data-testid="swap-column"]')).toBeNull();
		expect(container.querySelectorAll('.swap-control')).toHaveLength(1);
	});

	it('draws nothing outside CentralDisplay', () => {
		// A view mounted on its own (a test, a pad pane) has no host to claim.
		const { container } = render(HostedSwapPill);
		expect(container.querySelector('.swap-control')).toBeNull();
	});
});

/**
 * ADR-552 — the whole pill opens the browser (ADR-442 made the name alone the
 * door, with a step arrow either side of it). A tap, not a hold: opening a
 * browser is neither destructive nor irreversible.
 */
describe('SwapControl — the pill opens the browser', () => {
	it('is a plain label, not a button, without a door to open', () => {
		const { container, door } = setup();
		expect(door()).toBeNull();
		expect(container.querySelector('button')).toBeNull();
		expect(container.textContent?.trim()).toBe('Memphis Studio + Plymouth');
	});

	it('is the pill itself in both orientations, carrying the name', async () => {
		const onOpen = vi.fn();
		for (const orientation of ['vertical', 'horizontal'] as const) {
			const { door, press } = setup({ orientation, onOpen });
			expect(door()?.classList.contains('swap-pill')).toBe(true);
			expect(door()?.textContent).toBe('Memphis Studio + Plymouth');
			await press();
			cleanup();
		}
		expect(onOpen).toHaveBeenCalledTimes(2);
	});

	it('opens on a tap with no dwell — down and straight back up', () => {
		const onOpen = vi.fn();
		const { door } = setup({ onOpen });
		const pointer = (type: string) => {
			const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
			Object.defineProperty(ev, 'pointerId', { value: 1 });
			door()!.dispatchEvent(ev);
		};
		pointer('pointerdown');
		expect(onOpen).not.toHaveBeenCalled(); // fires on the release, as a click does
		pointer('pointerup');
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it('names the scope it would replace, and what is loaded', () => {
		const { door } = setup({ scopeLabel: 'Clip', label: 'Kick 01.wav', onOpen: vi.fn() });
		expect(door()?.getAttribute('aria-label')).toBe('Browse to replace clip: Kick 01.wav');
	});

	/**
	 * "No preset recorded", the AX helper down, a kit Live cannot rank: every
	 * one is a case where picking from the browser is the way out.
	 */
	it('stays live while the pill is disabled or working', async () => {
		const onOpen = vi.fn();
		for (const over of [{ disabled: true, label: 'No preset recorded' }, { working: true }]) {
			const { door, press } = setup({ ...over, onOpen });
			expect(door()?.disabled).toBe(false);
			await press();
			cleanup();
		}
		expect(onOpen).toHaveBeenCalledTimes(2);
	});
});
