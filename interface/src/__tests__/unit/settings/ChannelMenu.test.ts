/**
 * Settings → Recording's channel dropdown (ADR-534): drawn by the page so
 * every row carries its input's live level, which a system <select> cannot.
 * It opens on its button, picks and closes, and closes on Escape without
 * closing Settings under it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import ChannelMenu from '$lib/components/v6/settings/ChannelMenu.svelte';

const levels = [0.5, 0, 0.25, 1];
const props = (over: Record<string, unknown> = {}) => ({
	options: ['1', '2', '3', '4'],
	value: '3',
	label: (ch: string) => `Input ${ch}`,
	levelsOf: (ch: string) => ch.split('/').map((n) => levels[Number(n) - 1] ?? 0),
	meters: true,
	onpick: vi.fn(),
	...over
});

afterEach(cleanup);

describe('ChannelMenu', () => {
	it('shows the picked channel and its level, closed', () => {
		const { getByRole, container } = render(ChannelMenu, props());
		expect(getByRole('button', { name: 'Input channel: Input 3' })).toBeTruthy();
		expect(container.querySelector('[role="listbox"]')).toBeNull();
		const fill = container.querySelector<HTMLElement>('.cm-trigger .cm-meter-fill')!;
		expect(fill.style.width).toBe('25%');
	});

	it('opens to every channel with its own live level, the picked one selected', async () => {
		const { getByRole, getAllByRole } = render(ChannelMenu, props());
		await fireEvent.click(getByRole('button', { name: /Input channel/ }));
		const rows = getAllByRole('option');
		expect(rows.map((r) => r.textContent?.trim())).toEqual(['Input 1', 'Input 2', 'Input 3', 'Input 4']);
		expect(rows.map((r) => r.querySelector<HTMLElement>('.cm-meter-fill')?.style.width)).toEqual(['50%', '0%', '25%', '100%']);
		expect(rows[2].getAttribute('aria-selected')).toBe('true');
	});

	it('picks a channel and closes', async () => {
		const p = props();
		const { getByRole, queryByRole } = render(ChannelMenu, p);
		await fireEvent.click(getByRole('button', { name: /Input channel/ }));
		await fireEvent.click(getByRole('option', { name: 'Input 1' }));
		expect(p.onpick).toHaveBeenCalledWith('1');
		expect(queryByRole('listbox')).toBeNull();
	});

	it('closes on Escape, and keeps the Escape from reaching the page', async () => {
		const onPageKey = vi.fn();
		window.addEventListener('keydown', onPageKey);
		const { getByRole, queryByRole } = render(ChannelMenu, props());
		await fireEvent.click(getByRole('button', { name: /Input channel/ }));
		await fireEvent.keyDown(getByRole('listbox'), { key: 'Escape' });
		expect(queryByRole('listbox')).toBeNull();
		expect(onPageKey).not.toHaveBeenCalled();
		window.removeEventListener('keydown', onPageKey);
	});

	it('draws no meters for Live’s own input, which Vamp does not meter', async () => {
		const { getByRole, container } = render(ChannelMenu, props({ meters: false }));
		await fireEvent.click(getByRole('button', { name: /Input channel/ }));
		expect(container.querySelector('.cm-meter')).toBeNull();
	});
});
