# ADR-470: Dup Trk and Delete Clip Are Taps

## Status
**Accepted** (2026-10-24). No Live restart (interface only).

## Context
In the clip view, Dup Trk and Delete clip were the only two buttons in the
app gated by a hold: 800 ms with a fill rising behind the glyph and the
label swapped for "Hold...", released early to cancel. Every other button
acts on a tap, so these two looked like tap buttons and did nothing when
tapped. The bright button frame that came in the same day says "tap
this" on every button, these two included.

## Decision
**Both act on a tap**, with `onclick`, like the rest of the clip view's
buttons. The hold timers, the rising fill and the "Hold..." label are
gone. Dup Trk still locks (`isDuplicatingTrack`, the "..." label) while
the duplicate runs, so a second tap cannot start a second one.

## Consequences
- A stray tap deletes the focused clip or duplicates the track. Whether
  Live's undo restores a clip deleted this way was not measured; the
  surface's track create leaves no undo step (rig fact), so an unwanted
  duplicate is deleted in Live.
- The Group button keeps its hold: there it is a modifier held while
  other strips are tapped, not a gate.

## Tags
`clip-view`, `gesture`, `buttons`
