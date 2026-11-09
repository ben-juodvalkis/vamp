# ADR-519: Full screen only where a view has a board for it

## Status
**Accepted** (2026-11-09). Interface only; no Live restart. Amends ADR-511. Simpler and Sampler gained boards in ADR-521.

## Context

ADR-511 put the full-screen icon on every central view but System. Since
then ADR-512 and ADR-515 gave nine views a face drawn for the full screen
(Analog, Collision, Drift, Electric, Meld, Operator, Wavetable, Roar,
Multiband). Every other view, expanded, is only itself made larger, which
Ben judged not worth the icon (2026-11-09).

## Decision

- The icon shows only on a view with a full-screen board, named in
  `viewRegistry.ts` (`hasFullScreenBoard`). A new board adds its view's
  key there.
- Arriving at any other view while expanded collapses back to the stack,
  as System did under ADR-511, since its corner offers no way out.

## Consequences

- Permute, the clip view, Simpler, Sampler, the Drum Rack and every effect
  but Roar and Multiband give their top-right corner back.
- An expanded board followed by a track change onto a view without one
  drops back to the stack.

## Tags
`central-view`, `layout`, `gesture`
