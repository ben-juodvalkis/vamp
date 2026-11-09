/**
 * `#settings[/<section>]` opens Settings (ADR-520): Vamp for Mac's
 * "Settings…" (⌘,) sets it on its window's page.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { settingsStore, openSettingsFromHash } from '$lib/stores/v6/settingsStore.svelte';

describe('openSettingsFromHash', () => {
	beforeEach(() => {
		settingsStore.closeSettings();
		settingsStore.section = 'general';
	});

	it('opens Settings where it was left on #settings', () => {
		settingsStore.section = 'places';
		expect(openSettingsFromHash('#settings')).toBe(true);
		expect(settingsStore.open).toBe(true);
		expect(settingsStore.section).toBe('places');
	});

	it('opens on the section named', () => {
		expect(openSettingsFromHash('#settings/connection')).toBe(true);
		expect(settingsStore.section).toBe('connection');
	});

	it('opens where it was left for a section that does not exist', () => {
		expect(openSettingsFromHash('#settings/nope')).toBe(true);
		expect(settingsStore.open).toBe(true);
		expect(settingsStore.section).toBe('general');
	});

	it('leaves any other hash alone', () => {
		expect(openSettingsFromHash('')).toBe(false);
		expect(openSettingsFromHash('#other')).toBe(false);
		expect(openSettingsFromHash('#settingsx')).toBe(false);
		expect(settingsStore.open).toBe(false);
	});
});
