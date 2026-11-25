import { describe, it, expect } from 'vitest';
import { createMomentaryMute } from '$lib/components/v6/tracks/TrackStrip/utils/momentaryMutePress';
import { MOMENTARY_HOLD_MS } from '$lib/components/v6/tracks/TrackStrip/utils/momentaryPress';
import type { PressInfo, PressReleaseInfo } from '$lib/actions/press';

function track(initial = false) {
	let muted = initial;
	const writes: boolean[] = [];
	const mute = createMomentaryMute({
		read: () => muted,
		set: (v) => {
			muted = v;
			writes.push(v);
		}
	});
	return { mute, writes, get muted() { return muted; } };
}

const info = {} as PressInfo;
const release = (r: Partial<PressReleaseInfo>) => ({ held: false, reason: 'up', elapsedMs: 0, ...r }) as PressReleaseInfo;

describe('createMomentaryMute — the row cannot scroll', () => {
	it('fires at finger-down with touch-action none and no slop', () => {
		const t = track();
		const o = t.mute.pressOptions(false);
		expect(o.fireOn).toBe('down');
		expect(o.touchAction).toBe('none');
		expect(o.slop).toBe(0);
		o.onPress!(info);
		expect(t.muted).toBe(true);
	});

	it('a quick release latches; a held release restores', () => {
		const t = track();
		const o = t.mute.pressOptions(false);
		o.onPress!(info);
		o.onRelease!(release({ elapsedMs: 90 }));
		expect(t.muted).toBe(true);
		o.onPress!(info); // unmute
		o.onRelease!(release({ elapsedMs: MOMENTARY_HOLD_MS + 10 }));
		expect(t.muted).toBe(true); // restored to what it was before the press
	});

	it('a cancel restores the captured state', () => {
		const t = track();
		const o = t.mute.pressOptions(false);
		o.onPress!(info);
		o.onRelease!(release({ reason: 'cancel', elapsedMs: 20 }));
		expect(t.muted).toBe(false);
	});
});

describe('createMomentaryMute — the row scrolls', () => {
	it('a tap toggles on release (pan-x)', () => {
		const t = track();
		const o = t.mute.pressOptions(true);
		expect(o.fireOn).toBe('up');
		expect(o.touchAction).toBe('pan-x');
		expect(o.holdMs).toBe(MOMENTARY_HOLD_MS);
		o.onPress!(info);
		o.onRelease!(release({}));
		expect(t.muted).toBe(true);
	});

	it('a hold toggles at the threshold and restores on release', () => {
		const t = track();
		const o = t.mute.pressOptions(true);
		o.onHold!(info);
		expect(t.muted).toBe(true);
		o.onRelease!(release({ held: true, elapsedMs: 900 }));
		expect(t.muted).toBe(false);
		expect(t.writes).toEqual([true, false]);
	});
});
