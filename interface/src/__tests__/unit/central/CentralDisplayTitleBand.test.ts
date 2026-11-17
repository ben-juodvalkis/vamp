/**
 * The central view's title band (ADR-544): whose view this is and what it
 * is, read from the same records the strips and the chain draw from.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import CentralDisplay from '$lib/components/v6/central/CentralDisplay.svelte';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import { v3Store } from '$lib/stores/v3/normalized.svelte';
import { session } from '$lib/stores/session.svelte';

afterEach(() => {
	cleanup();
	centralDisplayStore.clearView();
});

const band = (c: HTMLElement) => ({
	track: c.querySelector('[data-central-head] .cv-track')?.textContent,
	device: c.querySelector('[data-central-head] .cv-device')?.textContent
});

describe('the central view names its track and its device', () => {
	it('says the selected track and the view', async () => {
		const name = v3Store.tracks.get('tracks/' + session.selectedTrackIndex)?.name ?? '';
		centralDisplayStore.setView('permute', undefined, null, 'Permute');
		const { container } = render(CentralDisplay);
		await tick();
		expect(band(container)).toEqual({ track: name, device: 'Permute' });
		centralDisplayStore.setView('clip', undefined, null, 'Clip');
		await tick();
		expect(band(container).device).toBe('Clip');
	});

	it('names a device by what Live calls it', async () => {
		centralDisplayStore.setView('device', 'reverb');
		const { container } = render(CentralDisplay);
		await tick();
		expect(band(container).device).toBe('Reverb');
	});

	it('names an instrument by its own name', async () => {
		centralDisplayStore.setView('instrument', 'drift', { instrument: { name: 'Aurora Lead' } });
		const { container } = render(CentralDisplay);
		await tick();
		expect(band(container).device).toBe('Aurora Lead');
	});

	it('keeps the view in a body under the band, which the tour\'s layout check measures from', async () => {
		centralDisplayStore.setView('permute', undefined, null, 'Permute');
		const { container } = render(CentralDisplay);
		await tick();
		const frame = container.querySelector('.central-frame')!;
		expect(frame.querySelector(':scope > [data-central-head]')).not.toBeNull();
		expect(frame.querySelector(':scope > [data-central-body]')).not.toBeNull();
	});
});
