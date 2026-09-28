/**
 * The release rule for a momentary toggle — Solo (ADR-414) and, since
 * 2026-09-03, mute (ADR-427 addendum 3).
 *
 * The control toggles at true finger-down. The press then only decides what
 * the *release* means, and that decision is this function. It is pure so the
 * rule can be tested without a pointer or a mounted strip — the same reason
 * `slotCellState` is pure.
 *
 * One rule for both, deliberately: they are the two state toggles a
 * performer holds, they sit next to each other in the same band, and a
 * hold that means "momentary" on one and "nothing" on the other is a
 * distinction the hand cannot keep. The file was called `soloPress.ts`
 * while Solo was the only one.
 *
 * The ways a press can end are {@link PressReleaseReason}, the vocabulary
 * `use:press` reports (ADR-427). Solo now runs on that action rather than on
 * its own window listeners, so the rule and the machine that feeds it speak
 * the same words:
 *
 *   up        < MOMENTARY_HOLD_MS → latch, the down-toggle stands
 *             ≥ MOMENTARY_HOLD_MS → momentary, restore the captured state
 *   cancel    always restores — the browser took the gesture, so the
 *             performer never released. Safe for a latch meant as a tap
 *             (net no-op) and correct for an interrupted hold.
 *   teardown  always restores, for the same reason and a worse failure.
 *             The strip can unmount mid-press: `TracksPanelV6` keys its
 *             strips by track index, so folding a group, removing empty
 *             tracks, or any structural change that reorders the list
 *             destroys the component under the finger. Before this
 *             existed the teardown dropped the window listeners and
 *             returned, which left the down-toggle standing — a track
 *             soloed with no finger on it, everything else inaudible,
 *             and no gesture left that could undo it.
 *   slop      unreachable for Solo, which runs with `slop: 0` — the button
 *             sets `touch-action: none` and owns the gesture outright, so
 *             there is no pan to abandon to. Restores anyway: every reason
 *             that is not a clean release means the performer did not
 *             finish the press.
 */

import constants from '$config/constants.json';
import type { PressReleaseReason } from '$lib/actions/pressMachine';

/**
 * Release under this and the down-toggle latches; at or over it, the
 * release puts the captured pre-press state back.
 *
 * Named for Solo, which had it first, and kept as one number: every
 * control must agree or the hand cannot learn one threshold. Read from
 * `constants.ui.gestures.momentaryHoldMs` since 2026-09-12 so the Move pad
 * script (`owner/Max Patches/move_pad_hold.js`), which cannot read JSON, has a
 * named value to mirror rather than a literal that drifted here.
 */
export const MOMENTARY_HOLD_MS: number = constants.ui.gestures.momentaryHoldMs;

/**
 * The action's own vocabulary, re-exported: a reason the machine can
 * produce and this rule has not considered is a compile error rather than a
 * silent latch.
 */
export type MomentaryReleaseReason = PressReleaseReason;

export interface MomentaryRelease {
	/** ms between finger-down and this release. Ignored unless `up`. */
	elapsedMs: number;
	reason: MomentaryReleaseReason;
	/** Hold threshold; injectable so tests don't hard-code the constant. */
	holdMs?: number;
}

/**
 * Should the release write the captured pre-press solo state back?
 *
 * Restoring writes the *captured* value rather than toggling again, so a
 * surface echo or another client flipping solo mid-press cannot invert it.
 */
export function shouldRestoreOnRelease({
	elapsedMs,
	reason,
	holdMs = MOMENTARY_HOLD_MS
}: MomentaryRelease): boolean {
	if (reason !== 'up') return true;
	return elapsedMs >= holdMs;
}
