/**
 * The central view's full-screen switch (ADR-511): the corner icon lifts the
 * view over the whole screen and brings it back, Escape brings it back, and
 * the master track's System view (whose gear owns the corner) neither shows
 * the icon nor stays expanded.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import MiddlePanelV6 from '$lib/components/v6/layout/MiddlePanelV6.svelte';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';

afterEach(() => {
	cleanup();
	centralDisplayStore.setExpanded(false);
	centralDisplayStore.clearView();
});

const host = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-debug="central-host"]')!;
const icon = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-central-expand]');

async function pressIcon(c: HTMLElement) {
	await fireEvent.keyDown(icon(c)!, { key: 'Enter' });
	await tick();
}

describe('central view full screen', () => {
	it('the corner icon expands the view and collapses it again', async () => {
		centralDisplayStore.setView('device', 'reverb');
		const { container } = render(MiddlePanelV6);
		await tick();

		expect(icon(container)?.getAttribute('aria-label')).toBe('Full screen');
		expect(host(container).classList.contains('central-expanded')).toBe(false);

		await pressIcon(container);
		expect(centralDisplayStore.expanded).toBe(true);
		expect(host(container).classList.contains('central-expanded')).toBe(true);
		expect(icon(container)?.getAttribute('aria-label')).toBe('Exit full screen');

		await pressIcon(container);
		expect(centralDisplayStore.expanded).toBe(false);
		expect(host(container).classList.contains('central-expanded')).toBe(false);
	});

	it('Escape collapses it', async () => {
		centralDisplayStore.setView('device', 'reverb');
		const { container } = render(MiddlePanelV6);
		await tick();
		await pressIcon(container);

		await fireEvent.keyDown(window, { key: 'Escape' });
		await tick();
		expect(centralDisplayStore.expanded).toBe(false);
	});

	it('the System view has no icon, and arriving at it collapses the view', async () => {
		centralDisplayStore.setView('device', 'reverb');
		const { container } = render(MiddlePanelV6);
		await tick();
		await pressIcon(container);

		centralDisplayStore.setView('system');
		await tick();
		expect(icon(container)).toBeNull();
		expect(centralDisplayStore.expanded).toBe(false);
	});
});
