# ADR-525: The clip view goes full screen

## Status
**Accepted** (2026-11-11). Interface only; no Live restart. Amends ADR-519.

## Context

ADR-519 kept the full-screen icon (ADR-511) only on views with a board
drawn for the full screen, and took it off the clip view. Ben asked for it
back there (2026-11-11), the way the instruments have it: the note editor
is the one view that gains from plain size, since its lanes, notes and
velocity bars grow with the height.

## Decision

- The clip view shows the corner icon, in both its halves (the clip
  controls and the note editor), and expands as itself: no board of its
  own. `viewRegistry.ts` names it in `FULL_SCREEN_VIEWS`, beside the
  boards; `hasFullScreenBoard` answers yes for either.
- Everything else of ADR-511 holds: Escape and the same icon bring it
  back, never stored, and a jump to a view without the icon collapses it.

## Consequences

- At full screen the note editor's lanes are about four times their
  height in the stack. The clip controls only stretch.
- The pencil toggle already sat left of the corner's 44px square, so
  nothing moved.

## Tags
`central-view`, `layout`, `gesture`, `clip-editor`
