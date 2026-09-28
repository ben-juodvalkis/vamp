# ADR-424: Drum Buss as a Role-Gated Rail on Instrument Views

> **Superseded in part by ADR-431 (2026-09-10):** the rail itself is gone —
> the Drum XY is an FX-grid tile and Boom + Comp are `DrumBussCentralView`.
> The role signal this ADR measured and defended (`trackRole.svelte.ts`)
> survives for the grid-by-track-kind work that follows.


## Status
**Superseded** by [ADR-425](425-track-role-recorded-in-the-set.md)
(2026-08-31).

Accepted 2026-08-28 — role source amended same day (addendum 1); third
gate tier added 2026-08-29 (addendum 2).

> **What survives:** the decision about the rail itself — that
> `DrumBussRail` mounts on the right edge of every instrument view, and
> that the gate cannot be the instrument *type*. ADR-425 carries that
> forward unchanged.
>
> **What does not:** the premise below that "the only trace of that role
> that persists is the ADR-399 auto-color", and the whole three-tier
> reconstruction it justified. `Live.Track.set_data` records the role
> directly since protocol 3.7.0; the catalog fetch,
> `roleFromTrackColor` and `ROLE_MATCH_MAX_DISTANCE_SQ` are deleted.
> The measurements below (Live's colour quantization, the 45%/592
> Drum-Rack counts) remain accurate and are why the class-name check is
> still only a last resort.

## Context

The Drum Buss controls (Comp toggle + Boom XY + Drum XY) were column 1 of
`PedalCentralView` — reachable only by tapping the **Pedal** FX tile, on
*every* track, drum or not. Drum Buss has no FX-grid tile of its own; the
pedal view was its sole home, which buried a drum-shaping tool behind a
distortion pedal's view and offered it in places it means nothing.

The wish: the controls should appear wherever an instrument loaded from
the **Drum** or **Perc** browser rails is on screen — with whatever
instrument view that preset produced (Drum Rack, a Komplete Kontrol kit,
a Simpler one-shot, Collision…), which is why the gate cannot be the
instrument *type*. The trigger is the preset's performance role, and the
only trace of that role that persists is the ADR-399 auto-color: it rides
the T record, survives reloads, and every client agrees on it.

## Decision

1. **`DrumBussRail`** (new, `components/v6/central/`) carries the exact
   controls the pedal view's drum column had — same
   `useFxGridSlot('drum')` machinery, ghost until the track carries a
   Drum Buss, first touch loads `Drum Buss.adv` onto it.
2. **`CentralDisplay` mounts the rail once, for every instrument view** —
   a 240px column on the **right edge** (user's call), the view taking
   `minmax(0, 1fr)` beside it. Mounting at the host means zero edits
   across 14 instrument views and one place for the gate.
3. **The gate is `roleFromTrackColor`** (in `trackColoring.ts`): reverse
   lookup of the selected track's Live color against the seven
   `constants.json:vendors.types` role colors, nearest-match within a
   radius. Rail shows when the role is `drum` or `perc` and the current
   view is an instrument view.
4. The pedal view drops to three columns (Digital · Redux · pedal-type
   tabs); the `'drum'` device-view alias leaves the registry (it had no
   callers).

## Measurement: Live quantizes LOM color writes

The first cut matched colors with a radius of 24 and failed on the live
rig: **Live snaps any color written via the LOM to its own swatch
palette.** Measured on Live 12 (2026-08-28), same set, real loads:

| role wrote | Live stored | Δ (RGB euclid) |
|---|---|---|
| drum `#f36fb8` | `#e553a0` | ≈ 39.4 |
| perc `#ff8244` | `#ffa529` | ≈ 44.2 |
| synth `#8e90ff` | `#92a7ff` | ≈ 23.3 |
| fx `#d57ce3` | `#b677c6` | ≈ 42.7 |

So the store (and every reload) holds the *snapped* int, never the one
`applyAutoColorOnPrepareAck` wrote — the write path only looks exact
during the optimistic window, which is why the rail appeared on load and
vanished on the next state refresh. The radius is **48**: perc's measured
snap sits at 44.2 (the first cut of 45 cleared it by less than one unit),
and 48 restores margin while staying under both ceilings — the nearest
non-role neighbor (Ableton brand yellow `#f2cc0d` ↔ key, Δ ≈ 51.8) and
the closest role pair (drum ↔ fx, Δ ≈ 54). Every measured snapped int is
pinned in `trackColoring.test.ts`.

## Addendum 1 (same day): catalog membership is the role source; color is the fallback

The color channel failed its first real session twice — Live's palette
quantization (above), then a load whose path shape the resolver couldn't
read, which skipped the recolor entirely and left a drum kit railless
(the Plymouth Kit case; the resolver now scans paths deepest-folder-first,
with those paths pinned as tests). Both were fixed, but they exposed the
channel for what it is: a lossy side effect doing double duty as a role
database.

The gate now answers the question directly. Live names a loaded device
after the preset file's basename, and the generated type catalogs list
every preset name under a rail — so **`trackRole.svelte.ts` looks the
instrument's device name up in `drum.json` + `perc.json`** (lazy-fetched
once, on the first instrument view; ~2.4MB of same-origin static JSON the
browser rail fetches anyway). Name membership survives everything color
cannot: hand-recolored tracks, kits loaded from Live's own browser,
tracks colored before the fixes. `roleFromTrackColor` remains as the
fallback for instruments the catalogs don't know — Simpler sample loads,
factory content outside the library. Verified live: Plymouth Kit → drum
and Colombia → perc by name, on the real set.

## Addendum 2 (2026-08-29): Drum Rack class as tier 3, and why it is not tier 1

The obvious simplification — drop the whole role apparatus and just show the
rail when a **Drum Rack** is on the track — was measured against this
machine's actual catalogs before being rejected. Root device class read out
of every preset file on the two rails (gunzipped `.adg`/`.adv` XML, not
inferred from extension):

| Rail | Presets | Drum Racks | Not Drum Racks |
|---|---|---|---|
| Drum | 3,787 | 2,116 | **1,671** — 1,658 Omnisphere `.aupreset`, 13 Instrument Racks |
| Perc | 751 | 367 | **384** — 366 `MultiSampler`, 18 Instrument Racks |
| **Total** | **4,538** | **2,483 (54.7%)** | **2,055 (45.3%)** |

A class-name gate would therefore lose the rail on **45% of the two rails** —
including the entire Omni drum library and every `Ableton/Perc/Mini` one-shot.
It also fires where it should not: **592 Drum Racks live under other rails** —
295 in `inst` (the 8dio vocal-breath racks), 250 in `synth` (NI Rise & Hit
risers, swooshes, subs), 47 in `fx` (the Voices Rack folder). Note that both
worked examples in addendum 1 (Plymouth Kit, Colombia) happen to be Drum
Racks, so a live spot-check would have passed and hidden all of this — the
count is the evidence, not the demo.

What the class name *is* good for is the case neither existing tier covers: a
kit dragged in from Live's own browser (not in the catalogs) onto a track that
was never auto-colored (no role in the color channel). So it becomes **tier
3**, in `resolveRolePrecedence` (trackRole.svelte.ts), and runs **only when
tiers 1 and 2 both return `null`** — not when tier 2 returns a non-drum role.
That condition is what keeps the 592 out: they all carry their own role color,
so tier 2 answers first and tier 3 never sees them. Widening it to "colorRole
isn't drum/perc" would hand every one of them a Drum Buss.

Tier 3 keys on the LOM `class_name` (`DrumGroupDevice`) rather than the
identified `InstrumentType`, so it covers `drumrack` and
`drumrack-komplete-kontrol` in one check without inheriting the macro-mapping
heuristic that separates them.

## Consequences

- Drum Buss is **gone from the pedal view** — and with it, from
  non-drum/perc tracks entirely. Boom-driving a bass or synth track now
  requires a drum/perc-role track (catalog kit, or a role-colored track).
- A drum/perc **audio** track never shows the rail: audio tracks show the
  clip view, and the rail rides instrument views only. In a looper
  workflow where percussion is captured to audio loops, that may be the
  next extension (rail on the clip view of drum/perc tracks) — deferred
  until asked for.
- A kit loaded outside the browser now DOES get the rail as long as its
  preset name is in the drum/perc catalogs (addendum 1's name gate); an
  uncatalogued Drum Rack on an uncolored track gets it from tier 3
  (addendum 2). Only uncatalogued *non*-Drum-Rack instruments on uncolored
  tracks still miss the rail entirely.
- A hand-picked Live swatch within 48 of a role color reads as that role
  via the fallback (e.g. Live's stock blue `#10a4ee` ↔ bass at Δ ≈ 15).
  For this feature only drum/perc matter, and the nearest stock swatch to
  those is the drum snap itself — acceptable, and arguably what
  hand-picking that pink means.
- The instrument view appears on *new-track selection* (coordinator
  auto-switch), post-load reveal, and Live-side selection — the strip's
  Clip/Permute taps deliberately show those views instead, so the rail is
  not reachable from a strip tap alone. Unchanged behavior, but now it
  gates a control surface, worth knowing.
