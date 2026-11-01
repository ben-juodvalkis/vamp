/**
 * The central display never shows a view of one of Vamp's own effects that is
 * neither on the chain nor in the effects folder (ADR-498): its controls would
 * be ghosts of a file that is not there.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import CentralDisplay from '$lib/components/v6/central/CentralDisplay.svelte';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import { _setEffectsFolderForTests } from '$lib/services/effectSources.svelte';

afterEach(() => {
	cleanup();
	_setEffectsFolderForTests(null);
	centralDisplayStore.clearView();
});

describe('CentralDisplay and the effects folder', () => {
	it('leaves the view of an effect that is not on the chain and not in the folder', async () => {
		centralDisplayStore.setView('device', 'toneShaper');
		render(CentralDisplay);
		await tick();
		expect(centralDisplayStore.view.type).toBe('default');
	});

	it('keeps it when the folder has the file', async () => {
		_setEffectsFolderForTests({ name: 'Shelf', source: 'place:Shelf', devices: { 'Tone Shaper': 'Tone/Tone Shaper.amxd' } });
		centralDisplayStore.setView('device', 'toneShaper');
		render(CentralDisplay);
		await tick();
		expect(centralDisplayStore.view).toMatchObject({ type: 'device', subType: 'toneShaper' });
	});

	it('never touches a native device\'s view', async () => {
		centralDisplayStore.setView('device', 'reverb');
		render(CentralDisplay);
		await tick();
		expect(centralDisplayStore.view).toMatchObject({ type: 'device', subType: 'reverb' });
	});
});
