/**
 * Tests for uiPrefsStore — persistent UI display toggles.
 *
 * These lock the default / toggle / persist contract of each display
 * pref the layout relies on.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { uiPrefsStore } from '$lib/stores/v6/uiPrefsStore.svelte';

describe('uiPrefsStore sessionMode', () => {
	beforeEach(() => {
		uiPrefsStore.sessionMode = false;
		localStorage.removeItem('uiPrefsStore.sessionMode');
	});

	it('defaults to off — the existing layout is the status quo', () => {
		// Session mode off must leave the UI identical to pre-ADR-415.
		expect(uiPrefsStore.sessionMode).toBe(false);
	});

	it('toggles off ↔ on', () => {
		uiPrefsStore.toggleSessionMode();
		expect(uiPrefsStore.sessionMode).toBe(true);
		uiPrefsStore.toggleSessionMode();
		expect(uiPrefsStore.sessionMode).toBe(false);
	});

	it('persists across reload', () => {
		uiPrefsStore.sessionMode = true;
		expect(localStorage.getItem('uiPrefsStore.sessionMode')).toBe('1');
		uiPrefsStore.sessionMode = false;
		expect(localStorage.getItem('uiPrefsStore.sessionMode')).toBe('0');
	});
});

// FX defaults ON: absent storage must read as the familiar three-section
// layout (ADR-416), so only an explicit '0' turns it off.
describe('uiPrefsStore showFxGrid', () => {
	beforeEach(() => {
		uiPrefsStore.showFxGrid = true;
		localStorage.removeItem('uiPrefsStore.showFxGrid');
	});

	it('defaults to shown', () => {
		expect(uiPrefsStore.showFxGrid).toBe(true);
	});

	it('toggles shown ↔ hidden', () => {
		uiPrefsStore.toggleFxGrid();
		expect(uiPrefsStore.showFxGrid).toBe(false);
		uiPrefsStore.toggleFxGrid();
		expect(uiPrefsStore.showFxGrid).toBe(true);
	});

	it('persists across reload', () => {
		uiPrefsStore.showFxGrid = false;
		expect(localStorage.getItem('uiPrefsStore.showFxGrid')).toBe('0');
		uiPrefsStore.showFxGrid = true;
		expect(localStorage.getItem('uiPrefsStore.showFxGrid')).toBe('1');
	});
});

// VIEW, FLIP, PADS and INST lost their switches (Ben, 2026-09-26): the
// central view, the flipped stack, the Drum Rack's pad column and the
// strips' device band are always on. An old install's stored '0' must not
// bring back a layout nothing can undo.
describe.each(['showCentralView', 'flipLayout', 'showDrumPads', 'showDeviceBand'] as const)('uiPrefsStore %s', (pref) => {
	it('is always on, whatever an older install stored', () => {
		localStorage.setItem(`uiPrefsStore.${pref}`, '0');
		expect(uiPrefsStore[pref]).toBe(true);
		localStorage.removeItem(`uiPrefsStore.${pref}`);
	});

	it('has no switch', () => {
		const store = uiPrefsStore as unknown as Record<string, unknown>;
		const toggle = `toggle${pref.replace(/^show/, '').replace(/^./, (c) => c.toUpperCase())}`;
		expect(store[toggle]).toBeUndefined();
		expect(Object.getOwnPropertyDescriptor(uiPrefsStore, pref)?.set).toBeUndefined();
	});
});

describe('uiPrefsStore section toggles', () => {
	// Sections are independent switches on a fixed stack, not a chooser
	// for one slot — every combination is legal, including both off.
	it('are mutually independent', () => {
		uiPrefsStore.sessionMode = true;
		uiPrefsStore.showFxGrid = false;
		expect(uiPrefsStore.sessionMode).toBe(true);
		expect(uiPrefsStore.showFxGrid).toBe(false);
		expect(uiPrefsStore.visibleSectionCount).toBe(3);

		uiPrefsStore.sessionMode = false;
		uiPrefsStore.showFxGrid = true;
		expect(uiPrefsStore.visibleSectionCount).toBe(3);
	});
});

describe('uiPrefsStore showTransportHeader', () => {
	beforeEach(() => {
		uiPrefsStore.showTransportHeader = false;
		localStorage.removeItem('uiPrefsStore.showTransportHeader');
	});

	it('defaults to hidden', () => {
		expect(uiPrefsStore.showTransportHeader).toBe(false);
	});

	it('toggles hidden ↔ shown', () => {
		uiPrefsStore.toggleTransportHeader();
		expect(uiPrefsStore.showTransportHeader).toBe(true);
		uiPrefsStore.toggleTransportHeader();
		expect(uiPrefsStore.showTransportHeader).toBe(false);
	});

	it('persists across reload', () => {
		uiPrefsStore.showTransportHeader = true;
		expect(localStorage.getItem('uiPrefsStore.showTransportHeader')).toBe('1');
	});

	it('is independent of session mode', () => {
		// Deliberately orthogonal: the header is useful without the clip
		// grid, and the grid is useful without the header.
		uiPrefsStore.showTransportHeader = true;
		expect(uiPrefsStore.sessionMode).toBe(false);
		uiPrefsStore.sessionMode = true;
		uiPrefsStore.showTransportHeader = false;
		expect(uiPrefsStore.sessionMode).toBe(true);
		uiPrefsStore.sessionMode = false;
	});
});

describe('uiPrefsStore miniSessionActive', () => {
	// The clip view's mini session column stands in for the full clip
	// grid when the full grid is off. It has no switch of its own — the
	// one it used to have could only ever buy a layout with no clips
	// visible anywhere — so the rule is exactly the complement of CLIPS.
	// The store owns it so `ClipCentralView` never re-derives it, and
	// `!sessionMode` is what keeps the mini and the full grid from both
	// driving the one shared scene window.
	beforeEach(() => {
		uiPrefsStore.sessionMode = false;
		uiPrefsStore.showFxGrid = true;
	});

	it('is on in the default layout — CLIPS off', () => {
		expect(uiPrefsStore.miniSessionActive).toBe(true);
	});

	it('is off when the full clip grid is showing', () => {
		// Otherwise the mini would repeat a column already drawn under
		// its own strip, and both would scroll the same window.
		uiPrefsStore.sessionMode = true;
		expect(uiPrefsStore.miniSessionActive).toBe(false);
	});

	it('comes back on the moment CLIPS goes off — nothing to remember', () => {
		// The clips are always somewhere: full grid, or in miniature.
		uiPrefsStore.sessionMode = true;
		expect(uiPrefsStore.miniSessionActive).toBe(false);
		uiPrefsStore.sessionMode = false;
		expect(uiPrefsStore.miniSessionActive).toBe(true);
	});

	it('is independent of the FX grid, which no longer hosts it', () => {
		uiPrefsStore.showFxGrid = false;
		expect(uiPrefsStore.miniSessionActive).toBe(true);
	});

	it('persists nothing of its own', () => {
		// The retired `showMiniSession` key must not come back to life:
		// a stored '0' from an older install would otherwise hide the
		// clips with no control left to bring them back.
		localStorage.setItem('uiPrefsStore.showMiniSession', '0');
		expect(uiPrefsStore.miniSessionActive).toBe(true);
		localStorage.removeItem('uiPrefsStore.showMiniSession');
	});
});
