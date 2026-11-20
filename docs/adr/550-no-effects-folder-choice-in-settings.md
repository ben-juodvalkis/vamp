# ADR-550: No Effects Folder Choice in Settings, No Off-Rail Effects Screen

## Status
**Accepted** (2026-11-20). Supersedes the Settings half of
[ADR-498](498-effects-come-from-the-users-effects-folder.md) and follows
[ADR-548](548-the-palette-opens-from-its-plus.md), which took the + out of the
chain's palette. The interface takes it on its next load; nothing changes in
the surface.

## Context
The + at the end of the chain opened the browser on the effects folder
(`catalog.effectsPlace`): a Place cataloged even while unticked, kept off the
rail and reachable only through that +. Settings → Library offered the choice
of that folder under "+ Effect opens". With the + gone (ADR-548), the screen
had no door, and the Settings row named a button that no longer exists.

## Decision
- **Settings → Library has no Effects folder card.** The folder is still where
  Vamp finds its own effects by name (ADR-498's second point is unchanged), and
  it is still what `logs/effects.json` or `catalog.effectsPlace` say; there is
  just no control for it on the page. The server's `PUT /api/places/effects`
  stays, with no caller in the interface.
- **The browser no longer carries the effects Place off the rail.** Effects are
  browsed from the rail: a ticked Place's Effect segment, as before. A ticked
  effects Place keeps its one-screen layout of folders. A rack chain's own +
  (ADR-529) opens the effects Place when it is on the rail, else the open Place
  with effect presets, else the first that has some.

## Consequences
- Changing the effects folder needs the file (`logs/effects.json`) or the
  config until a better way to load an effect onto a chain is designed.
- An unticked effects Place cannot be browsed at all; tick it in Settings to
  get it back as a rail button.

## Tags
`effects`, `settings`, `browser`, `chain`
