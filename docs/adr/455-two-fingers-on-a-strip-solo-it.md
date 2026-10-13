# ADR-455: Two Fingers on a Strip Solo It; the Solo Button Is Gone

## Status
**Accepted** (2026-10-01; recorded 2026-10-13). Supersedes ADR-414 (the
standalone Solo button). Keeps ADR-414's release rule: tap latches, hold
is momentary. Commits `3158818` and `743525c`.

## Context
ADR-414 moved Solo out of the strip's Card to a button below it, because
a press on an in-Card Solo might have been the start of a volume drag. A
down-fire then blipped solo on every drag that began there. The button
sat outside the gesture machine, so it had nothing to disambiguate. It
cost a band of height on every strip, so it sat behind a
`showSoloButtons` pref that was off by default. With the pref off, a
strip had no way to solo at all.

Ben asked for solo on the strip itself: two fingers on a track, behaving
the way the Solo button already did.

## Decision
**Two fingers on a strip's fader solo the track.** `useStripGestures`
offers a chord (`onChordStart`) when a second finger lands on the Card
while the first is still a *candidate tap*: not yet a drag, a row scroll
or a slip. Solo toggles the moment the chord is claimed. The first
finger's press is dropped without a tap, so the select it would have been
never happens. The chord owns every finger on the Card until the last one
lifts (`onChordEnd`), so a third finger joins it and doesn't start a
fader.

**This avoids ADR-414's blip without leaving the strip.** The chord is
only offered while nothing has happened yet. A finger already moving the
fader is never interrupted, and the second finger is then ignored. So a
drag can't flip solo, and solo can't break into a drag.

**The release rule is the Solo button's.** Under `MOMENTARY_HOLD_MS`
(300 ms, `constants.json` `momentaryHoldMs`) the toggle latches. At or
over it, release restores the pre-press state captured when the chord
began. Holding a soloed track is a momentary *un*solo. A cancel or an
unmount restores too. The rule lives in
`TrackStrip/utils/momentaryPress.ts` (was `soloPress.ts`), shared with
mute (ADR-427 addendum 3).

**With the Group button held, two fingers add the track to the group**
instead of soloing.

**A soloed strip wears it.** With no button, the strip is the only place
solo can show. An `--act-solo` wash and inner ring cover the Card and the
name, following Live's solo state however it was set. Grouping is coded
green (`--act-group`): the Group button, the wash on gathered strips and
the Group Mode banner, replacing the flat skin's orange.

**Removed:** the Solo button, its `showSoloButtons` pref, and the Solo row
in the System view's Sections card, which is now Header · FX · Clips. A
stored pref from an old install is never read.

## Consequences
- Every strip can solo with no pref and no extra height. The name band
  gets the whole header third at every strip width.
- Solo now fires when the second finger lands, not at the first finger's
  touch-down as the button did.
- Solo is a hidden gesture. Nothing on screen says two fingers solo, so a
  new user learns it from the docs or not at all.
- Tests: `useStripGestures` chord cases, `TrackStrip.twoFingerSolo`, and
  multitouch scenarios that drive real two-finger touch in Chromium
  (tap-solo, momentary, solo while muting, two solos at once).
- ADR-421's and ADR-427's mentions of "the Solo button" describe the
  layout as it was. The `--strip-band-h` band they line up with is still
  the name band and the TotalMix strip.

## Tags
`tracks`, `solo`, `gestures`, `multitouch`, `track-strip`, `group`
