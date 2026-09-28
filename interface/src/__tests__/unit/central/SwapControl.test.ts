/**
 * SwapControl — the swap pill every instrument view shares (ADR-439): the
 * loaded name over two halves, dumb. The left half steps back, the right half
 * forward; a disabled or working pill is inert, and a disabled one says why in
 * place of the name. Given an `onOpen` the name itself becomes a button that
 * opens the browser (ADR-442), and there is nothing else either way.
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
	const handlers = { onPrev: vi.fn(), onNext: vi.fn() };

	const { container } = render(SwapControl, {
		props: { scopeLabel: 'Kit', label: 'Memphis Studio + Plymouth', ...handlers, ...over }
	});
	const half = (which: string) => container.querySelector<HTMLButtonElement>(`[data-swap="${which}"]`)!;
	const press = (which: string) => fireEvent.keyDown(half(which), { key: 'Enter' });
	const state = () => container.querySelector('.swap-control')?.getAttribute('data-swap-state');
	return { container, handlers, half, press, state };
}

afterEach(() => {
	cleanup();
});

describe('SwapControl', () => {
	it('steps forward from its top half and back from its bottom, and has nothing else to press', async () => {
		// Top is NEXT since 2026-09-15 (the user's call): up is onward, and a
		// freshly loaded kit has Previous disabled in Live, so a top half that
		// stepped back refused the first press every time.
		const { container, handlers, half, press } = setup();
		expect([...container.querySelectorAll('button')].map((b) => b.dataset.swap)).toEqual(['next', 'prev']);
		expect(half('prev').getAttribute('aria-label')).toBe('Previous kit');
		expect(half('next').getAttribute('aria-label')).toBe('Next kit');
		await press('next');
		await press('prev');
		expect(handlers.onNext).toHaveBeenCalledTimes(1);
		expect(handlers.onPrev).toHaveBeenCalledTimes(1);
	});

	it('shows the name and no other text', () => {
		const { container, state } = setup({ scopeLabel: 'Preset', label: 'Bell Keys' });
		expect(container.textContent?.trim()).toBe('Bell Keys');
		expect(state()).toBe('ready');
	});

	it('is inert while disabled and shows why in place of the name', async () => {
		const detail = 'ax-helper-down: the Looping AX Helper is not running';
		const { container, handlers, half, press, state } = setup({
			disabled: true,
			label: 'ax-helper-down',
			detail,
			error: 'ax-helper-down'
		});
		for (const which of ['prev', 'next']) {
			expect(half(which).disabled).toBe(true);
			await press(which);
		}
		expect(handlers.onPrev).not.toHaveBeenCalled();
		expect(handlers.onNext).not.toHaveBeenCalled();
		expect(state()).toBe('disabled');
		expect(container.textContent?.trim()).toBe('ax-helper-down');
		expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(`Swap kit: ${detail}`);
	});

	it('is inert while a swap is working, and keeps the name', async () => {
		const { container, handlers, press, state } = setup({ working: true });
		await press('next');
		expect(handlers.onNext).not.toHaveBeenCalled();
		expect(state()).toBe('working');
		expect(container.textContent?.trim()).toBe('Memphis Studio + Plymouth');
	});

	it('still steps after a failed swap', async () => {
		const { handlers, press, state } = setup({
			label: 'ax-control-disabled',
			error: "ax-control-disabled: pad.swap_next is disabled in Live's UI"
		});
		expect(state()).toBe('error');
		await press('prev');
		expect(handlers.onPrev).toHaveBeenCalledTimes(1);
	});

	it("wears the mounted view's density", () => {
		const compact = setup({ density: 'compact' });
		expect(compact.container.querySelector('.swap-control')?.getAttribute('data-density')).toBe('compact');
		cleanup();
		const standard = setup();
		expect(standard.container.querySelector('.swap-control')?.hasAttribute('data-density')).toBe(false);
	});

	it('lying flat, reads back then onward, left to right', async () => {
		// Horizontal since 2026-09-16, placed inside a view by HostedSwapPill:
		// the left half steps back, the right half forward, and the DOM follows
		// the drawing.
		const { container, handlers, press } = setup({ orientation: 'horizontal' });
		expect(container.querySelector('.swap-control')?.getAttribute('data-orientation')).toBe('horizontal');
		expect([...container.querySelectorAll('button')].map((b) => b.dataset.swap)).toEqual(['prev', 'next']);
		await press('prev');
		expect(handlers.onPrev).toHaveBeenCalledTimes(1);
		expect(handlers.onNext).not.toHaveBeenCalled();
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
 * ADR-442 — the name opens the browser. The pill steps to the neighbor; a tap
 * on the name goes and picks one, and a tap either side of it still steps.
 * It replaced the clip rail's 800ms Replace Inst hold, and then a hot-swap
 * square beside the pill, and is a tap: a hold is a gate, and opening a
 * browser is neither destructive nor irreversible.
 */
describe('SwapControl — the name opens the browser', () => {
	it('is a plain label, not a button, without a door to open', () => {
		const { container } = setup();
		expect(container.querySelector('[data-swap="open"]')).toBeNull();
		expect(container.querySelector('.swap-name')?.tagName).toBe('SPAN');
		expect(container.textContent?.trim()).toBe('Memphis Studio + Plymouth');
	});

	it('opens from the name in both orientations, after the halves so it sits over them', async () => {
		const onOpen = vi.fn();
		for (const orientation of ['vertical', 'horizontal'] as const) {
			const { container, press } = setup({ orientation, onOpen });
			const buttons = [...container.querySelectorAll('button')];
			// Last in the DOM, so it paints over the two halves it straddles:
			// a press on the name opens, a press beside it reaches a half.
			expect(buttons.map((b) => b.dataset.swap).at(-1)).toBe('open');
			expect(buttons.at(-1)?.classList.contains('swap-name')).toBe(true);
			expect(buttons.at(-1)?.textContent).toBe('Memphis Studio + Plymouth');
			await press('open');
			cleanup();
		}
		expect(onOpen).toHaveBeenCalledTimes(2);
	});

	it('leaves both halves stepping beside it', async () => {
		const onOpen = vi.fn();
		const { handlers, press } = setup({ orientation: 'horizontal', onOpen });
		await press('prev');
		await press('next');
		expect(handlers.onPrev).toHaveBeenCalledTimes(1);
		expect(handlers.onNext).toHaveBeenCalledTimes(1);
		expect(onOpen).not.toHaveBeenCalled();
	});

	/**
	 * The property this door exists to have. It replaced ClipCentralView's
	 * column-9 Replace Inst, which was an 800ms hold-to-confirm, and the whole
	 * point of the move is that here it is a plain tap: down and up under one
	 * pointer, no dwell, nothing to wait out. A `use:press` with no
	 * `onLongPress` has no hold threshold at all — this pins that it stays
	 * that way.
	 */
	it('opens on a tap with no dwell — down and straight back up', () => {
		const onOpen = vi.fn();
		const { container } = setup({ onOpen });
		const name = container.querySelector<HTMLElement>('[data-swap="open"]')!;
		const pointer = (type: string) => {
			const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
			Object.defineProperty(ev, 'pointerId', { value: 1 });
			name.dispatchEvent(ev);
		};
		pointer('pointerdown');
		expect(onOpen).not.toHaveBeenCalled(); // fires on the release, as a click does
		pointer('pointerup');
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it('names the scope it would replace, and what is loaded', () => {
		const { container } = setup({ scopeLabel: 'Clip', label: 'Kick 01.wav', onOpen: vi.fn() });
		expect(container.querySelector('[data-swap="open"]')?.getAttribute('aria-label')).toBe(
			'Browse to replace clip: Kick 01.wav'
		);
	});

	/**
	 * The pill goes disabled for reasons that say nothing about the browser —
	 * no preset recorded, the AX helper down, a kit Live cannot rank. Every one
	 * of those is a case where picking from the browser is the way OUT, so the
	 * name must not go inert with the halves — even while it shows the reason.
	 */
	it('stays live while the pill itself cannot step', async () => {
		const onOpen = vi.fn();
		const { container, press, state, half } = setup({
			disabled: true,
			label: 'No preset recorded',
			onOpen
		});
		expect(state()).toBe('disabled');
		expect(half('prev').disabled).toBe(true);
		expect(container.querySelector<HTMLButtonElement>('[data-swap="open"]')?.disabled).toBe(false);
		await press('open');
		expect(onOpen).toHaveBeenCalledTimes(1);
	});
});
