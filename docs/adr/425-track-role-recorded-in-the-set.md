# ADR-425: Track Role Is Recorded in the Set, Not Reconstructed

## Status
**Accepted** (2026-08-31) — supersedes [ADR-424](424-drum-buss-role-gated-rail.md).

Supersedes 424 rather than amending it because 424's premise is now false
at the sentence level. It reads:

> the only trace of that role that persists is the ADR-399 auto-color

There is now a better trace, and 424's entire three-tier apparatus — built
to reconstruct the role from that lossy one — has been deleted. 424's
*decision about the rail itself* (where `DrumBussRail` mounts, that the
gate cannot be instrument type) still holds and is carried forward here.

## Context

The Drum Buss rail shows when the selected track's role is `drum` or
`perc`. The role comes from which browser rail the preset was loaded
from — a fact known at load time, in the browser, in
`applyAutoColorOnPrepareAck`.

Nothing wrote it down. So ADR-424 spent three tiers reconstructing it
afterwards from evidence that survived:

1. **Catalog membership** — a lazy 2.46 MB `drum.json` + `perc.json`
   fetch, matching the loaded device's name against every preset name
   under each rail.
2. **Colour reverse-lookup** — `roleFromTrackColor`, nearest-match of the
   track's Live colour against seven role colours within a radius of 48,
   the radius forced wide because Live quantizes LOM colour writes to its
   own swatch palette (measured: drum `#f36fb8` → `#e553a0`, perc
   `#ff8244` → `#ffa529`, Δ ≈ 44).
3. **Bare Drum Rack class name** — and only when 1 and 2 both returned
   `null`, because 592 Drum Racks in this library sit under `inst`,
   `synth` and `fx` rails.

Every tier was a workaround for the same missing write. Addendum 1 of 424
says as much about the colour channel: *"a lossy side effect doing double
duty as a role database."*

**What changed:** `Live.Track` turns out to expose `set_data` / `get_data`
— a persistent per-track key/value store that survives save/load. Probed
at runtime (the binary's string table is not a module map; `set_data`'s
docstring sits directly beside `Timer`'s, and `Timer` resolves under a
different module entirely). Confirmed on shipping **12.4.2 Suite**, not
beta-only.

Persistence was measured, not assumed — marker written, Set saved, `.als`
gunzipped:

```xml
<ViewData Value='{"push-instrument-selected-notes": [36], …,
                  "looping.role": "ZZPROBEMARKERZZ"}' />
```

**Push and Move firmware already write into that same dict.** It is a
production Ableton API and the namespace is *shared* — hence the
`looping.` prefix.

## Decision

**Record the role at load time; stop reconstructing it.**

1. **Protocol 3.7.0.** The T record grows 13 → 14 fields, appending
   `role`. `TrackMetadataComponent` owns the key
   (`looping.role`), the `/looping/v3/track/set_role` write and the
   `/looping/v3/track/role` echo.
2. **Nothing new is computed.** `resolveAutoColor` already derived the
   rail at load time from `(presetPath, vendorId)` and spent it as a
   colour. `resolveAutoRole` returns it instead, and
   `applyAutoRoleOnPrepareAck` sends `set_role` beside the existing
   colour write. The 2.46 MB catalog fetch existed to reconstruct
   downstream what was already known upstream.
3. **All three reconstruction tiers are deleted outright**, not kept as
   fallback: the catalog fetch, `roleFromTrackColor`,
   `ROLE_MATCH_MAX_DISTANCE_SQ`, and the Drum-Rack check they gated. The
   gate is two tiers — recorded role, then bare Drum Rack.
4. **`set_role` carries no generation token.** A role is recorded *by*
   the load that just happened, on the prepare-ack path where a
   generation advance is already in flight.

## Consequences

- **The 2.46 MB fetch is gone**, and with it the whole class of bugs
  where a preset's *name* was the identity (renames, duplicates,
  factory content outside the library).
- **Colour is just colour again.** It stopped being a database the moment
  it stopped being read as one. 424's radius-48 nearest-match and its
  table of Live's quantized snaps are now historical.
- **Tier 1 got safer, not more exposed.** The colour tier was *gating*
  the Drum Rack check — those 592 racks under other rails carry role
  colours, so tier 2 answered before tier 3 could see them. Deleting it
  looks like it removes that guard. It does not: those loads now *record*
  `inst`/`synth`/`fx`, so tier 0 answers first and answers correctly. The
  only case reaching the Drum Rack check is a kit dragged from Live's own
  browser onto a track with no recorded role — which is the case it was
  added for.
- **A load that does not say which rail it came from now records
  nothing.** `resolveAutoRole` returns null when
  `categoryFromPresetPath` cannot read the path *and* the vendorId is
  not one of the seven rails (a `recent` or otherwise special browse).
  Before this ADR the catalog tier absorbed that case by matching on
  the preset *name*; it is deleted, so the only remaining gate is the
  bare Drum Rack check — which by 424's own measurement misses 45% of
  the drum rail. This is a genuine coverage regression against the
  three-tier gate, accepted because there is no *correct* role to
  record when the load did not say, and a guess written into a store
  with no delete is worse than nothing. The repair is to load the
  preset from a rail once. ADR-424 addendum 1 records an unreadable
  path shape happening in a real session (the Plymouth Kit case), so
  this is not hypothetical.
- **Pre-3.7.0 tracks show no rail** until their instrument is reloaded
  through the app. Accepted explicitly: commit to the future rather than
  carry a reconstruction path forever for sets that predate the write.
- **The recorded role is believed outright** — nothing beneath it can
  disagree. This is why `resolveAutoRole` deliberately has **no brand
  fallback** where `resolveAutoColor` does: a colour guessed from a
  vendor is cosmetic and wrong-is-survivable, a role guessed from a
  vendor silently changes which controls exist. Do not "fix" that
  asymmetry.
- **Keys cannot be deleted.** There is no `delete_data`; writing `None`
  stores `None`, and `get_data` then returns it in place of your default.
  `_safe_str` in `_track_role` is load-bearing for this, not padding — a
  cleared key otherwise puts the literal string `"None"` on the wire as a
  role name.
- **The namespace is shared with Ableton's own firmware.** Anything added
  here must keep the `looping.` prefix. A bare key risks colliding with
  a future Push/Move field.
- **The UI advertises exactly one version** (`['3.7.0']`). Negotiating
  down would produce a handshake that succeeds and a tree that never
  arrives — ADR-418's exact failure mode. An older surface now returns a
  named `handshake-version-mismatch`. The *surface* keeps its full
  `SUPPORTED_VERSIONS` tail, because the Swift menu-bar client advertises
  `3.3.0` and never reads `state/full`; both were observed handshaking
  simultaneously on the live rig.

## Verification

On the real rig, loading a kit through the real UI:

```
handle_prepare … /Drum/Acoustic/Ableton/Acuff Kit.adg
_decide: REUSE_SELECTED track 1 for midi
TrackMetadataComponent: role tracks/1 = 'drum'
```

Then, with that Drum Rack track selected, setting its role to `fx` over
the wire made the Drum Buss rail **disappear**, and setting it back to
`drum` restored it — with no reload. That single test proves tier 0
outranks tier 1 *and* that the `/looping/v3/track/role` echo reaches the
browser live.

## Tags
`track-role`, `drum-buss`, `set-data`, `lom`, `protocol-3.7.0`,
`supersedes-424`, `persistence`
