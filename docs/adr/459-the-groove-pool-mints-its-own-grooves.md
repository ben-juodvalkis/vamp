# ADR-459: The Groove Pool Mints Its Own Grooves; Live's Auto-Load Lands on a Zeroed One

## Status
**Accepted** (2026-09-29; recorded 2026-10-13). Commits `0d52d89`,
`69d223e` and `b5d84e0`, and the groove chooser (PR #3, `1b81c26`). The
AX press-off of Live's Auto Load box (`983eec5`, `426f7ca`) was built and
replaced the same day. It's recorded below as the rejected option. The
wire contract is `wire-protocol.md` §2.7, "Assign-on-first-write" and
"Pool entry names".

## Context
Each clip that takes a groove needs a Groove Pool entry of its own, or a
write to one clip moves every clip on that groove. Live's API can't
create, copy or delete a groove. `GroovePool` exposes only `grooves` and
a listener. So the rig's template carried hundreds of preloaded
`unassigned-*` grooves for the surface to rename and claim, and a set
without them had no grooves to give.

Two more measurements on the rig:

- **`browser.load_item` on an `.agr` appends a new pool entry on every
  call.** The same file three times gave three entries (Live
  12.4.15b2). The call is synchronous and touches no clip's groove.
- **Live ticks the Groove Pool's "Auto Load Groove" box** on a groove
  loaded into an empty pool, and every clip recorded after takes that
  groove. The first groove Vamp minted for one clip turned up on the
  next clip recorded on another track. The API can't reach the box.

Live 12.1 also puts a per-set default groove on every new MIDI clip, so
a Shuffle or Q write could land on a groove that every clip shares.

## Decision
**A claim takes a free groove, else mints one.** In order: an
`unassigned-*` entry, then a claim no Session or Arrangement clip links
any more, then a fresh entry loaded through the browser. A fresh entry is
the pattern's own Core Library file, or for the default
`Vamp Devices/Grooves/Vamp Groove.agr` (16ths at 66% swing, 1/16 grid,
every amount 0) through the "Vamp Devices" Place. Only when all three
fail is it `pool-exhausted`. Grooves can't be deleted, so minted ones are
reused, and the pool grows to the most clips holding a groove at once.

**A clip on a shared groove that isn't its own takes its own on the
first write**, starting from the shared groove's settings and file. A
preset only that clip links is written in place.

**The first groove loaded into an empty pool is Vamp Groove, zeroed.**
Live's Auto Load tick lands on it, so clips recorded after sound as
played. The surface reads a clip on it as having no groove, so a write
gives that clip a groove of its own and the zeroed one never changes. The
clip's own groove is loaded second. A later load leaves Live's tick where
it is (measured on the rig).

**Rejected: pressing Auto Load off through the AX helper.** It worked,
but the box exists only while Live's Browser is on screen. So it meant
flashing the Browser open in a set where Ben keeps it hidden. Live also
draws the pool's first row over 2 s after a load, which needed polling
for up to 5 s. The bridge handler and the `groove/added` /
`groove/browser` addresses were removed.

**Names say what a groove is; the hash says whose.** A claim is
`<track> <scene> · <pattern> #<pathHash>`, a free groove
`unassigned-<idx> · <pattern>`. Live's API can't read a groove's
pattern, so the name carries it, and a free groove is reused only for
its own pattern. Ownership is the hash alone. Legacy `Clip_<pathHash>`
and `Clip_<liveId>` claims are still owned.

**Any groove control on a grooveless clip puts it on the first ticked
groove tile at Amount 0 first**, the way touching Q does. So a slider's
first move never lands on Vamp Groove, where Amount does nothing.

## Consequences
- A set needs no preloaded grooves, so a fresh Live set works with
  grooves out of the box.
- The pool only grows. A long session leaves entries Live shows in its
  Groove Pool, labeled by track and scene, until the set is cleaned by
  hand.
- A labeled claim goes stale when a track is renamed. It's cosmetic,
  and the next claim refreshes it.

## Tags
`groove`, `groove-pool`, `live-api-limits`, `measured`, `surface`
