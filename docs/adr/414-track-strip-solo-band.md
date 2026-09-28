# ADR-414: Standalone Solo Button Below Track Strips — Down-Fire, Tap-Latch / Hold-Momentary

## Status
**Accepted**

## Context

Solo is a mixing gesture, not a looping one, but reaching for it
mid-performance meant leaving the strips (selecting the track, then
finding solo elsewhere). The strips already carry a mute affordance
with a deliberate contract — tapping the Name section toggles mute and
does **not** select the track — so solo wanted the same reach without
crowding strips for performers who never solo.

Performers also use solo two ways: **latched** (audition a track while
arranging) and **momentary** (dip everything else for a fill, then
release). A tap can only serve one of them, and for the momentary case
the state must flip the instant the finger lands — a performer timing
a drop can't wait for release.

The first cut placed Solo as a fourth section *inside* the strip's
Card, riding the strip-wide gesture machine (ADR-384: the whole strip
is a volume fader, taps dispatch by section). That forced a
disambiguation problem: a press on Solo might be the start of a volume
drag, so an instant down-fire blipped the state on every drag that
started there, and mitigations (an intent-gate delay sampling pointer
frames) only shrank the window without closing it. The same experiment
applied hold-momentary to the mute tap; in practice the strip wants
its simple tap contract back.

## Decision

**Solo is a standalone button below the strip's Card, fully outside
the gesture machine.** The strip component's root is now a column:
the Card (volume fader + section taps, unchanged) on top, and — when
`uiPrefsStore.showSoloButtons` is on — a real `<button>` beneath it.
The pref is a persisted localStorage display toggle, default **off**,
switched from SystemCentralView's Appearance card next to the theme
switch; pure display preference, no Live state. The button renders on
every non-master strip (group variant included — a Group Track solos
its subtree); Live's master has no solo.

**Because no press on the button can ever become a volume drag or a
row scroll, there is nothing to disambiguate** — the button sets
`touch-action: none` and owns its own pointer handlers. That dissolves
the blip/latency trade-off the in-Card design fought:

- **Pointer-down → solo toggles instantly.** True zero-delay: no
  intent gate, no threshold. Optimistic apply + the existing
  `/looping/v3/track/solo` wire via `setTrackSolo`; the pre-press
  state is captured at down. Pressing never selects the track.
- **Release < 300 ms → latch.** The down-toggle stands; release is a
  no-op.
- **Release ≥ 300 ms → momentary.** Release restores the captured
  pre-press state. Holding a soloed track is momentary *un*solo —
  symmetric, no special cases.
- Latch-vs-momentary is read from **elapsed time at release** — no
  timer runs, because nothing changes at the threshold itself.
- The restore writes the **captured** value, not a second toggle, so a
  surface echo or another client flipping solo mid-press can't leave
  the restore inverted. `pointercancel` (rare under
  `touch-action: none`) also restores — a net no-op for an intended
  tap, correct for an interrupted hold.
- Release is caught by window-scoped `pointerup`/`pointercancel`
  listeners bound for the press duration (the same rationale as the
  Card gesture: the release must be seen even off-element or across
  re-renders).

**Mute keeps its original contract**: a plain release-dispatched tap
on the Name section, latching only — the hold-momentary experiment on
mute is removed. Momentary lives only on the Solo button, where it
costs nothing.

**Ink.** The button wears the global `--act-solo` ink rather than the
track ink: solo is a mixer state, and a soloed strip must read
identically across every track color. The lit glyph is a white-hot mix
of the ink on dark; the light theme rides the full-strength ink
instead (light `--act-solo` is calibrated dark, L 0.55), because the
white-hot mix lightened the glyph into the light wash.

## Consequences

- Solo responds at true finger-down with zero added latency, and a
  volume drag or row scroll can never blip it — the failure mode is
  structurally gone rather than mitigated.
- Both performance idioms (latch, momentary) work from one button with
  no mode switch; the 300 ms threshold only asks that a latching tap
  be reasonably crisp.
- The button costs fixed vertical height (`--height-touch` + gap) on
  every strip when enabled, taken from the Card's thirds; off by
  default keeps the minimal strip.
- The strip's gesture machine returns to its simple three modes
  (drag / scroll / tap); all solo logic is ~40 self-contained lines
  beside it. The Card is no longer the component root — it sits inside
  a `.strip-col` flex column, which `--strip-radius` and the panel's
  grid cascade through unchanged.
- Drags starting on the button do nothing at all (`touch-action:
  none`): the band is not a fader surface and does not scroll the row.
- No component-level gesture tests exist (same as the volume fader) —
  verification is the manual checklist plus build/type gates.

## Tags
`tracks`, `solo`, `mute`, `gestures`, `ui-prefs`, `track-strip`
