# ADR-506: The Utility Back in the Chain, the Loop Brace in the Sidebar

## Status
**Accepted** (2026-11-05). Supersedes ADR-482's placement of the Utility in
the right sidebar. Amends ADR-484 (the ghost section). No Live restart:
interface only.

## Context
Since ADR-482 the right sidebar's row level with the FX chain was the
track's Utility (a Gain slider over the track's meter), ghost or live, and
the loop brace shared the next row with Quantize, half each. The user
(2026-11-05) wanted the Gain slider gone from the sidebar and the brace
back in that row.

## Decision
- The sidebar's row level with the FX chain is the clip loop brace
  (`RightControlsSidebar section="loop"`); the row level with the central
  view is Quantize alone (`section="quantize"`).
- The chain's ghost section always offers a ghost Utility, second to
  last, with + Effect last (`UTILITY_GHOST`): every tile one size, the
  recents filling the rest. A Utility on the chain is drawn as any other
  cell.
- The section's slots are fixed (four columns of four on a one-row chain,
  six of two on two rows), so Live's Compressor, Phaser and Pedal joined
  the default effects, last, to fill them.

## Consequences
- The Gain slider no longer sits beside every chain; reaching a gain stage
  is a tap on + Utility, or the Utility's own cell once loaded.
- The brace and Quantize each get a full row again.
