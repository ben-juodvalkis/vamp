# ADR-511: The central view goes full screen from its corner

## Status
**Accepted** (2026-11-07), amended by ADR-519 (the icon only on views with a full-screen board). Interface only; no Live restart.

## Context

On the 12.9" iPad the central view is a band about 1000 x 327px, with the
effects chain above it and the track strips below (ADR-510's measurement).
The deep instruments (Wavetable, Operator, Meld, Drift, Analog) fit that
band by flipping halves (ADR-462), opening sections as pages (ADR-510) and
sizing knobs by the column. Ben asked to "temporarily explode a complex
central view ... to full screen so that I can do some deep sound design,
then zoom back down", and chose a small full-screen icon in the view's
corner that expands it to the whole screen, for now.

## Decision

- **A full-screen icon in the central frame's top-right corner**
  (`CentralDisplay`, `[data-central-expand]`): a 16px lucide Maximize glyph
  pushed into the corner of a 44px touch box, absolute and over the view,
  so it costs no view any room and sits in the inset, clear of a header
  line's last name. Expanded it shows Minimize, and the same press brings
  the view back. Escape does too.
- **Expanded, the view covers the whole screen** inside the page's margins
  (the status strip's band above, 16px sides, the bottom edge): the
  strips, the clip grid, the chain, both sidebars and the transport header
  are under it. The connection and error banners (z-50), the browser opened
  from the view (1000) and the Settings page (1002) stay over it.
- **The same element is lifted, not a second view mounted.** The central
  host (`MiddlePanelV6`) takes `position: fixed` while
  `centralDisplayStore.expanded`, so the view keeps its page, its half and
  its picker across the switch, and its row keeps its share of the stack,
  so nothing behind it reflows.
- **View state only.** Never stored and never on the wire: a reload comes
  back to the stack. It follows the selection like the band does: changing
  track in Live, or with a pedal, changes what the full screen shows.
- **Not on the System view.** The master track's view has its Settings gear
  in that corner and nothing to design; arriving at it while expanded
  collapses the view, since its corner would offer no way out.

## Consequences

- Every view gets the extra room with no work of its own, but a face laid
  on ADR-510's grid sizes its columns by width, so the room goes mostly to
  height: pads, wave and filter pictures and value boxes grow, knobs keep
  their size and spread out. A face drawn for the full screen (Wavetable's
  two oscillators and both filters at once, Operator's four operators side
  by side) is the next step, one instrument at a time: ADR-512 does it
  for the seven paged instruments.
- While expanded the strips, the clip grid and the chain are out of reach;
  the pedals still reach the surface (ADR-422). Collapsing on a track
  change was considered and left out for now.
- The icon's touch box takes the frame's top-right 44px square from a view
  that draws a control there.

## Tags
`central-view`, `layout`, `gesture`
