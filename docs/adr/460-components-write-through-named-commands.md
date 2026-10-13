# ADR-460: Components Write Through Named Commands; the Layout Is a File; the Blocks Have a Catalog

## Status
**Accepted** (2026-10-03; recorded 2026-10-13). GitHub issue #7, all three
parts: `543f3ac`, `b92a58a` and `6441a2e`. Interface only: no wire
change, no protocol bump.

## Context
Issue #7 asked whether the interface could become a kit of UI building
blocks, so a user's Claude could assemble a custom layout. The answer
was not now. The audience is developers with a local checkout. The views
a user would most want to change are the device-specific ones, which
can't be broken into blocks. And a public component API taxes every
commit for a solo developer.

Three pieces of the idea pay off regardless, for this repo's agents and
for Ben's own layouts:

- 22 files under `components/` imported the OSC client and called `send`
  directly, and two carried their own `sendParam`. A write made that way
  is invisible to the shot tool's mock surface and to tests until it
  misbehaves on the rig. It also puts a second copy of an address where
  the wire contract can't see it.
- `routes/+page.svelte` held the whole main screen inline: ADR-416's
  section stack, ADR-421's flip, the sidebar mirror and the status strip.
- About 218 KB of CLAUDE.md prose under `interface/src/lib` is right for
  maintaining a component and wrong for choosing one.

## Decision
**1. No component imports `api/simpleClient`.** Every write goes through
a named function in `interface/src/lib/services/`: `sessionCommands`,
`clipCommands`, `trackCommands`, `deviceParams` (the one `sendParam`;
`pending` holds a write while a slot is loading) and `connection` (the
one read a component takes from the client). The addresses, arguments
and order are unchanged. Writes a component sent together in one turn
stay one synchronous call, so the outbound batcher still sends them as
one frame. `scripts/check-write-boundary.mjs` (`npm run check:writes`)
fails on any import of the client under `components/`. It uses
`check-touch-dialects`' lexer, so a comment naming the import isn't a
hit. `writeBoundary.test.ts` runs it inside vitest, which is how both
gates run it. Services, stores and `api/` may import the client.

**2. The main screen is `lib/layouts/default/Layout.svelte`; the route
only mounts it.** The move was byte for byte. Every view `shot:list`
names was shot before and after: 0 of 5,595,136 pixels differ in all
eight. A second layout is a copy of the folder, not an edit of the
route.

**3. `components/v6/blocks/index.ts` exports the reusable controls**, 18
of them, each with one paragraph: what it reads, what it writes (the
service command it calls) and the constraint a caller would get wrong.
It covers the press and drag actions, the slider throttle, DeviceSlider,
DeviceXY, the FX tile shell, the MIDI wheel, ClipPreview and the
waveform painter, the clip rows, RecordButton, SectionDivider,
DeviceEmptyState, the hosted swap pill and the meter. Two owner-only
blocks are marked so: TotalMixStrip and Permute's MiniSequencer. No
device view is exported. `npm run blocks:catalog` generates
`docs/reference/blocks.md` from the barrel and fails on an export with no
paragraph. The output is committed.

**Non-goals, kept:** no npm package, no monorepo, no public API promise,
no layout chooser in Settings, no skill.

## Consequences
- Every write a view makes has a name the mock surface and the tests can
  see. A new view that needs a new write adds a command to `services/`
  first.
- The catalog has to be regenerated when the barrel changes. The
  generator fails on a missing paragraph, but not on a paragraph that has
  gone stale.
- A second layout is possible without touching the route. None exists
  yet.
- Issue #7 is still open on GitHub, though all three of its parts have
  landed.

## Tags
`interface`, `services`, `write-boundary`, `layout`, `blocks`, `gate`
