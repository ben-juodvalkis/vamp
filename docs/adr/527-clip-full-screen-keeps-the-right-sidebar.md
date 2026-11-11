# ADR-527: The clip view's full screen keeps the right sidebar and takes the editor's toolbar

## Status
**Accepted** (2026-11-11). Interface only; no Live restart. Builds on ADR-526; amends ADR-511 for the clip view.

## Context

ADR-526 put the clip controls in one strip over the note editor at full
screen, but the full screen covered the right sidebar (the loop brace,
groove quantize, the mini session), which belong with editing a clip,
and the editor's own toolbar still took a column beside the roll. Ben
asked for the toolbar in the strip and the sidebar back (2026-11-11).

## Decision

- **The clip view's full screen stops short of the right sidebar**
  (`MiddlePanelV6`, `.keep-right`): the real sidebar shows beside it at
  its usual rows, working as it always does. No copy of its controls is
  drawn in the view. Boards (ADR-512, ADR-515) still cover the whole
  screen.
- **The note editor's Fold / grid / Triplet / Quantize move to the right
  end of the strip**, two by two, clear of the full-screen icon's corner;
  the roll takes back the 96px column they had. The toolbar stays the
  editor's own component, with its state, and is only placed there
  (`$lib/actions/portal`). An audio clip has no toolbar and the slot
  closes.

## Consequences

- The sidebar's rows are the stack's, so the loop brace sits level with
  where the chain was and the mini session with the strips, now behind
  the view.
- The roll is about 120px narrower than ADR-526 left it (the sidebar),
  and 96px wider for the toolbar's column, so near enough the same.

## Tags
`central-view`, `layout`, `clip-editor`
