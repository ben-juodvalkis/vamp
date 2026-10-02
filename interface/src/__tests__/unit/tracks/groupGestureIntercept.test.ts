/**
 * `interceptForGroupGesture` and the entry points that call it (2026-09-20).
 *
 * A group gesture changes what a track tap means everywhere a track can be
 * tapped, not just on its own strip — the session clip grid calls
 * `selectTrackByIndex` through a completely different path (`slotActions.ts`)
 * that never went through `TrackStrip`'s own guard, which is exactly how
 * this was found missing the first time it shipped. This pins that every
 * entry point bypasses its normal side effects (selection, the pedal aim,
 * a clip launch, a view switch) and toggles the tapped track into the
 * pending group instead, and that a quiet gesture leaves every entry point
 * to behave exactly as before.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const tap = vi.fn();
let active = false;
vi.mock('$lib/stores/v6/groupGestureStore.svelte', () => ({
	groupGestureStore: {
		get active() {
			return active;
		},
		tap: (...args: unknown[]) => tap(...args)
	}
}));

vi.mock('$lib/stores/v3/normalized.svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/stores/v3/normalized.svelte')>();
	return {
		...actual,
		v3Store: {
			...actual.v3Store,
			tracks: {
				get: (path: string) => (path === 'tracks/2' ? { name: 'Guitar', devices: new Map() } : undefined)
			}
		}
	};
});

vi.mock('$lib/api/simpleClient', () => ({
	send: vi.fn(),
	sendSelectClip: vi.fn(),
	sendClipLaunch: vi.fn(),
	sendClipStop: vi.fn(),
	sendClipFocus: vi.fn()
}));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { send, sendSelectClip, sendClipLaunch, sendClipStop, sendClipFocus } from '$lib/api/simpleClient';
import { session } from '$lib/stores/session.svelte';
import { selectTrackByIndex, interceptForGroupGesture } from '$lib/components/v6/tracks/composables/useTrackData.svelte.js';
import { selectSlot, actOnSlot, focusSlot } from '$lib/components/v6/tracks/composables/slotActions';

beforeEach(() => {
	active = false;
	vi.clearAllMocks();
});

describe('interceptForGroupGesture', () => {
	it('does nothing and reports false when no gesture is active', () => {
		expect(interceptForGroupGesture(2)).toBe(false);
		expect(tap).not.toHaveBeenCalled();
	});

	it('toggles the track into the group and reports true while active', () => {
		active = true;
		expect(interceptForGroupGesture(2)).toBe(true);
		expect(tap).toHaveBeenCalledWith('tracks/2', 'Guitar');
	});

	it('swallows a tap on the master track rather than tapping it', () => {
		active = true;
		expect(interceptForGroupGesture(-1, true)).toBe(true);
		expect(tap).not.toHaveBeenCalled();
	});
});

describe('selectTrackByIndex bypasses everything while grouping', () => {
	it('sends the real select wire when no gesture is active', async () => {
		await selectTrackByIndex(2);
		expect(send).toHaveBeenCalledWith('/looping/v3/track/select', ['tracks/2']);
	});

	it('taps instead of selecting while a gesture is active', async () => {
		active = true;
		await selectTrackByIndex(2);
		expect(send).not.toHaveBeenCalled();
		expect(tap).toHaveBeenCalledWith('tracks/2', 'Guitar');
	});
});

describe('the session clip grid bypasses its own side effects too', () => {
	it('selectSlot writes the scene and track normally when quiet', () => {
		selectSlot(2, 0);
		expect(sendSelectClip).toHaveBeenCalled();
		expect(send).toHaveBeenCalledWith('/looping/v3/track/select', ['tracks/2']);
	});

	it('selectSlot only taps the track while grouping — no scene write, no select', () => {
		active = true;
		selectSlot(2, 0);
		expect(sendSelectClip).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
		expect(tap).toHaveBeenCalledWith('tracks/2', 'Guitar');
	});

	it('actOnSlot never launches or stops a clip while grouping', () => {
		active = true;
		actOnSlot(2, 0, 'tracks/2/slots/0', 'empty');
		expect(sendClipLaunch).not.toHaveBeenCalled();
		expect(sendClipStop).not.toHaveBeenCalled();
		expect(tap).toHaveBeenCalledWith('tracks/2', 'Guitar');
	});

	it('actOnSlot still launches normally when quiet', () => {
		actOnSlot(2, 0, 'tracks/2/slots/0', 'empty');
		expect(sendClipLaunch).toHaveBeenCalledWith('tracks/2/slots/0');
	});

	it('actOnSlot re-fires a playing clip rather than stopping it', () => {
		actOnSlot(2, 0, 'tracks/2/slots/0', 'playing');
		expect(sendClipLaunch).toHaveBeenCalledWith('tracks/2/slots/0');
		expect(sendClipStop).not.toHaveBeenCalled();
	});

	it('focusSlot never switches the central view while grouping', () => {
		active = true;
		focusSlot(2, 'tracks/2/slots/0');
		expect(sendClipFocus).not.toHaveBeenCalled();
		expect(tap).toHaveBeenCalledWith('tracks/2', 'Guitar');
	});

	it('focusSlot still opens the clip view normally when quiet', () => {
		focusSlot(2, 'tracks/2/slots/0');
		expect(sendClipFocus).toHaveBeenCalledWith('tracks/2/slots/0');
	});
});

describe('reference guard: session.selectedTrackIndex is untouched while grouping', () => {
	it('a tapped track never becomes the selected track mid-gesture', async () => {
		const before = session.selectedTrackIndex;
		active = true;
		await selectTrackByIndex(2);
		selectSlot(2, 0);
		expect(session.selectedTrackIndex).toBe(before);
	});
});
