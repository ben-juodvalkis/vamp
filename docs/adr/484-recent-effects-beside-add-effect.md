# ADR-484: Recent Effects Beside + Effect

## Status
**Accepted** (2026-10-26). Supersedes ADR-483 (a short chain's suggested
ghost devices). No Live restart: interface only.

## Context
ADR-483 stood ghost devices on a short chain (a Drum Buss, an Echo and an
Auto Filter, the Guitar and Bass racks), fully working tiles chosen by the
track's kind. The user preferred something quieter and more personal: the
effects actually used lately, a tap away, so one can be put on a chain
again without the browser.

## Decision
- Just before the chain overview's + Effect cell (to its left) stands a
  Recent column: up to four buttons drawn as ghosts the way the + cell is
  (no fill, a dashed line, muted ink at the ghost opacity), each an effect added lately, its device picture (at
  the values its file saves, as its browser tile draws it) and its name.
  Grey on purpose, so it does not pull the eye from the chain.
- A tap adds that preset to this chain again (the selected track's, or the
  scoped pad's) and opens its view once Live reports it: the browser's own
  load path, now `services/recentEffects.addEffectToChain`.
- What is recorded: every effect added from the browser's Effect segment
  (a tap or a drag), newest first, once each. The list is shared across
  tracks and kept in this browser's localStorage (a per-viewer
  convenience), up to twelve.
- The recents and + Effect are one ghost section two cells wide, + Effect
  its last column, full height: on a chain of one row the recents take
  three columns of four (twelve), on two rows five columns of two (ten)
  (`chainDrop.recentLayout`, the user's call the same day, after a
  one-cell block beside a one-cell + Effect). With no recents, + Effect is
  one cell as before. The list keeps thirty-two. The ones shown are the
  most recent that fit, drawn in alphabetical order (the user, the same
  day).
- It is smart about the chain: it shows the first ones that fit, skipping a
  MIDI effect on a track that is not a MIDI track and anything the chain
  already holds (by name: Live names a loaded preset's device after it).
  A tap from the column does not reorder it, so buttons do not move under
  the finger. With nothing to show, the column is not drawn.
- The suggested ghost devices are gone. The ghost Utility had already moved
  to the right sidebar's top row (ADR-482).

## Consequences
- A fresh install, or another browser, starts with an empty column until
  effects are added from the browser.
- The column counts as one cell in the chain's wrap (`CHAIN_WRAP_AFTER`).

## Tags
`fx-chain`, `chain-overview`, `recent`, `browser`, `effects`
