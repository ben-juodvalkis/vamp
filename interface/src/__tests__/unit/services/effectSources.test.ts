/**
 * Vamp's own effects load from the user's effects folder, by name or alias
 * (ADR-498); native devices and utilities need no folder.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { effectSource, effectAvailable, effectsFolderName, _setEffectsFolderForTests } from '$lib/services/effectSources.svelte';
import { DEVICE_PRESETS } from '$lib/config/devicePresets';

afterEach(() => _setEffectsFolderForTests(null));

describe('effect sources', () => {
	it('finds an effect by its name in the effects folder', () => {
		_setEffectsFolderForTests({ name: 'Shelf', source: 'place:Shelf', devices: { Guitar: 'Guitar/Guitar.adg' } });
		expect(effectSource(DEVICE_PRESETS.guitar)).toEqual({ source: 'place:Shelf', rel: 'Guitar/Guitar.adg' });
		expect(effectsFolderName()).toBe('Shelf');
	});

	it('finds one by an alias: the shelf calls the Tone Shaper "Tone Shaper", the Octave "Pitch Shift"', () => {
		_setEffectsFolderForTests({ name: 'Shelf', source: 'place:Shelf', devices: { 'Tone Shaper': 'Tone/Tone Shaper.amxd', 'Pitch Shift': 'Utility/Pitch Shift.amxd' } });
		expect(effectSource(DEVICE_PRESETS.toneShaper)?.rel).toBe('Tone/Tone Shaper.amxd');
		expect(effectSource(DEVICE_PRESETS.octave)?.rel).toBe('Utility/Pitch Shift.amxd');
	});

	it('has none in Live\'s Audio Effects, so an effect is unavailable and a native device or utility is not', () => {
		_setEffectsFolderForTests({ name: 'Audio Effects', source: undefined, devices: undefined });
		expect(effectSource(DEVICE_PRESETS.guitar)).toBeNull();
		expect(effectAvailable('guitar')).toBe(false);
		expect(effectAvailable('reverb')).toBe(true);
		expect(effectAvailable('sequencer')).toBe(true);
		expect(effectsFolderName()).toBe('');
	});
});
