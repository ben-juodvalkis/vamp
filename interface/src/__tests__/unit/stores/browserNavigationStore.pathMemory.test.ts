/**
 * Tests for the browser's per-button drill-down path memory.
 *
 * Tapping a rail button from a CLOSED browser resumes that button's last
 * location; tapping while the browser is open still restarts at the Place's
 * root. The store side of that is this memory map — keyed per rail *button* and
 * per half of the switch, because a Place's presets and its samples are two
 * trees under one vendorId, and a preset path means nothing among the samples.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
	browserNavigationStore,
	rememberedPathKey
} from '$lib/stores/v6/browserNavigationStore.svelte';

const drumMidi = rememberedPathKey('drum', false);
const drumAudio = rememberedPathKey('drum', true);
const bassMidi = rememberedPathKey('bass', false);

describe('rememberedPathKey', () => {
	it('separates the same button across the two sources', () => {
		expect(drumMidi).not.toBe(drumAudio);
	});

	it('separates the two buttons within one source', () => {
		expect(drumMidi).not.toBe(bassMidi);
	});

	it('is stable for the same button + source', () => {
		expect(rememberedPathKey('drum', false)).toBe(drumMidi);
		// Simpler and Audio are the same source axis (same samples, same folders —
		// only the load target differs), so they share one memory by construction.
		expect(rememberedPathKey('drum', true)).toBe(drumAudio);
	});
});

describe('browserNavigationStore path memory', () => {
	beforeEach(() => {
		// Shared singleton — clear the map between tests.
		browserNavigationStore.clearVendorNavigationState();
	});

	it('returns an empty path for a button never navigated', () => {
		expect(browserNavigationStore.getRememberedPath(drumMidi)).toEqual([]);
	});

	it('round-trips a remembered path', () => {
		browserNavigationStore.rememberPath(drumMidi, ['Kits', '808']);
		expect(browserNavigationStore.getRememberedPath(drumMidi)).toEqual(['Kits', '808']);
	});

	it('keeps each button + source independent', () => {
		browserNavigationStore.rememberPath(drumMidi, ['Kits', '808']);
		browserNavigationStore.rememberPath(drumAudio, ['Loops']);
		browserNavigationStore.rememberPath(bassMidi, ['Sub']);

		expect(browserNavigationStore.getRememberedPath(drumMidi)).toEqual(['Kits', '808']);
		expect(browserNavigationStore.getRememberedPath(drumAudio)).toEqual(['Loops']);
		expect(browserNavigationStore.getRememberedPath(bassMidi)).toEqual(['Sub']);
	});

	it('stores a copy, so later mutation of the caller array cannot rewrite it', () => {
		const path = ['Kits'];
		browserNavigationStore.rememberPath(drumMidi, path);
		path.push('808');
		expect(browserNavigationStore.getRememberedPath(drumMidi)).toEqual(['Kits']);
	});

	it('hands back a copy, so drilling from a restored path cannot rewrite it', () => {
		browserNavigationStore.rememberPath(drumMidi, ['Kits']);
		// This is exactly what the browser does: the restored array becomes a
		// vendor state's `currentPath`, which navigation then mutates.
		const restored = browserNavigationStore.getRememberedPath(drumMidi);
		restored.push('808');
		expect(browserNavigationStore.getRememberedPath(drumMidi)).toEqual(['Kits']);
	});

	it('overwrites on the next navigation (last location wins)', () => {
		browserNavigationStore.rememberPath(drumMidi, ['Kits', '808']);
		browserNavigationStore.rememberPath(drumMidi, ['Kits']);
		expect(browserNavigationStore.getRememberedPath(drumMidi)).toEqual(['Kits']);
		// Jumping back to the root is a navigation too — it must clear the depth,
		// not leave the old one to be resurrected on the next open.
		browserNavigationStore.rememberPath(drumMidi, []);
		expect(browserNavigationStore.getRememberedPath(drumMidi)).toEqual([]);
	});

	it('forgets a single stale path without touching the others', () => {
		browserNavigationStore.rememberPath(drumMidi, ['Kits', '808']);
		browserNavigationStore.rememberPath(bassMidi, ['Sub']);

		// What the browser does when a restored level turns up empty (the catalog
		// moved under it).
		browserNavigationStore.forgetPath(drumMidi);

		expect(browserNavigationStore.getRememberedPath(drumMidi)).toEqual([]);
		expect(browserNavigationStore.getRememberedPath(bassMidi)).toEqual(['Sub']);
	});

	it('clears every memory when navigation state is cleared', () => {
		browserNavigationStore.rememberPath(drumMidi, ['Kits']);
		browserNavigationStore.rememberPath(drumAudio, ['Loops']);

		browserNavigationStore.clearVendorNavigationState();

		expect(browserNavigationStore.getRememberedPath(drumMidi)).toEqual([]);
		expect(browserNavigationStore.getRememberedPath(drumAudio)).toEqual([]);
	});

	it('clears every memory when all vendor states are reset', () => {
		browserNavigationStore.rememberPath(drumMidi, ['Kits']);

		browserNavigationStore.resetAllVendorStates();

		expect(browserNavigationStore.getRememberedPath(drumMidi)).toEqual([]);
	});
});
