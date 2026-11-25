/**
 * The name band's mute press (ADR-427 addenda 1–3), as `use:press` options.
 *
 * Mute is Solo's gesture, on the same threshold: **tap latches, hold
 * releases back**. Holding a track muted for two bars and letting go is the
 * same performance move as holding a Solo, and a hold that means
 * "momentary" on one button and nothing on the button beside it is a
 * distinction the hand cannot keep. `shouldRestoreOnRelease` is the shared
 * rule; the restore writes the CAPTURED value rather than toggling again,
 * so a surface echo or another client flipping mute mid-press cannot invert
 * it.
 *
 * What differs between the two branches is only WHEN the toggle fires, and
 * that is decided by whether the strips row can actually scroll
 * (`rowScrolls`, measured by `TracksPanelV6`, which owns the scroller).
 *
 * The release-wait buys exactly one thing: a horizontal pan of the row that
 * BEGINS on a track name scrolls the row instead of muting. It is not a
 * confirm gate or a debounce. Measured on the mock stack with a 90ms tap it
 * cost 103ms from touch-down against Solo's 0ms, on the most-used control on
 * the surface, so it is spent only where it buys something: below 14 tracks
 * at 1366x1024 the row is not a scroller at all.
 *
 *   row cannot scroll → toggle at TRUE finger-down, `touch-action: none`.
 *     Solo's exact model. Release decides by elapsed time; no timer runs,
 *     because nothing happens at the threshold itself.
 *
 *   row can scroll → `touch-action: pan-x`, so the browser keeps the pan
 *     and cancels us when it claims one. A tap therefore toggles on RELEASE.
 *     The momentary hold still works: the toggle fires at the HOLD
 *     THRESHOLD instead. By 300ms with the finger still down and no cancel,
 *     the press is definitively not a pan, so firing then is safe where
 *     firing at down was not. Momentary starts 300ms in rather than
 *     instantly, the honest cost of sharing the axis; a tap is unchanged.
 *
 * Down-firing on a `pan-x` node is the one combination that must never
 * ship: every row pan starting on a name would mute and then unmute the
 * track, which on a playing track is an audible dropout mid-set.
 *
 * A press `use:press` tears down (the strip unmounting under the finger)
 * ends with reason `teardown`, which the rule restores.
 */

import type { PressOptions } from '$lib/actions/press';
import { shouldRestoreOnRelease, MOMENTARY_HOLD_MS } from './momentaryPress';

export interface MomentaryMuteConfig {
	/** The track's mute now. */
	read: () => boolean;
	/** Write a mute state. */
	set: (muted: boolean) => void;
}

export function createMomentaryMute(config: MomentaryMuteConfig) {
	let restoreTo: boolean | null = null;

	function toggle() {
		config.set(!config.read());
	}

	function begin() {
		restoreTo = config.read();
		toggle();
	}

	function end(restore: boolean) {
		if (restore && restoreTo !== null) config.set(restoreTo);
		restoreTo = null;
	}

	return {
		/** The options for `use:press` on the name band. */
		pressOptions(rowScrolls: boolean): PressOptions {
			return rowScrolls
				? {
						// Tap → toggle on release. Hold → toggle at the
						// threshold, restore on release.
						fireOn: 'up',
						touchAction: 'pan-x',
						holdMs: MOMENTARY_HOLD_MS,
						onPress: toggle,
						onHold: begin,
						// A press that reported a hold never reaches `onPress`
						// (the action suppresses it), so this is the whole
						// momentary path. Restore on EVERY ending: an
						// interrupted momentary must not stay latched.
						onRelease: ({ held }) => {
							if (held) end(true);
						}
					}
				: {
						// Zero delay, Solo's model exactly.
						fireOn: 'down',
						touchAction: 'none',
						// The name band owns the gesture outright, so travel
						// across it is still this press. Abandoning would read
						// as mute flickering under a hand that never left it.
						slop: 0,
						onPress: begin,
						onRelease: ({ reason, elapsedMs }) =>
							end(shouldRestoreOnRelease({ elapsedMs, reason }))
					};
		}
	};
}
