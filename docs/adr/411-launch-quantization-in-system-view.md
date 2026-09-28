# ADR-411: Global Launch Quantization on the Session Attr Family

## Status
**Accepted**

## Context

Live's global launch quantization (`song.clip_trigger_quantization`) is
the grid clip launch — and therefore loop record start and stop — snaps
to. For a live looper it is a performance control: the difference
between "1 Bar" and "None" changes when a recording actually begins, and
reaching for it means leaving the iPad and going to Live's transport bar.

Nothing in the codebase touched it. Grepping `quantiz` turned up only
the *clip groove* quantize amount (the right-sidebar vertical slider)
and the client-side note-quantize in the clip editor — different
concepts that happen to share a word.

Two candidate LOM enums exist and are easy to conflate:

| LOM attr | Live UI name | Range | Effect |
|---|---|---|---|
| `song.clip_trigger_quantization` | Global / launch quantization | 0–13 | When launch + loop record fire |
| `song.midi_recording_quantization` | Record Quantization | 0–8 | Snaps notes as MIDI is recorded |

This ADR covers the first only. The second remains unimplemented.

Naming note: `Clip.launch_quantization` is a *different*, per-clip
property. The wire label therefore keeps the LOM name
(`clip_trigger_quantization`) rather than the friendlier
"launch_quantization", which would collide at a glance with the clip
attr. UI-facing strings use "Launch Q" — the performer's word — while
the wire stays unambiguous.

## Decision

**Carry it on the existing PR-5d session attr table, not a new
component.** `SessionComponent._PR5D_ATTRS` already drives listener
attach, init-emit, handshake-accept re-emit, and disconnect bookkeeping
from one row per attribute. Adding a row plus an `int_trigger_quant`
wire type (validate-and-reject over 0..13, mirroring the existing
`int_sig_den` set-membership precedent) gets all of that for free. The
address is `/looping/v3/session/clip_trigger_quantization`, bidirectional
like the rest of the family. Bridge routing needed no change — the
existing `/looping/v3/*` glob in `backendScope.pythonSurface` covers it.

**Reject out-of-range rather than clamping.** Consistent with every
other setter in the component: a malformed wire value must not silently
park the set on 1/32.

**Add a listener-less fallback (`_ECHO_ON_WRITE`), pre-emptively.** The
table's normal contract is "trust the listener echo, and skip seeding
attrs whose listener failed to attach". Live 12 has a documented habit of
exposing attributes that are observable on paper and listener-less in
practice — `Groove.base` and `Track.fold_state` (ADR-410) both bit this
project, and the repo's own `lom-reference.md` did not even list
`fold_state`. Under the normal contract that quirk degrades to a
permanently blind UI control: no seed, no echo, nothing to diagnose but
silence. Attrs named in `_ECHO_ON_WRITE` opt out — they seed regardless
of attach, and their write handler emits its own echo when no listener
holds the address.

The fallback turned out to be unnecessary: the surface boots logging
`SessionComponent PR-5d bound 13/13 song attributes`, so the listener
does attach on Live 12.4.5b8 and the fallback is inert. It is kept
anyway. It costs one membership check on the write path, and the
alternative — discovering the quirk in production — costs a Live restart
per diagnosis cycle on a machine where Live caches Remote Script
bytecode until a full restart.

**UI: a full-width tap-to-set chip row in `SystemCentralView`, as a
second grid row.** Three placements were considered:

1. A fourth `sys-drag-digit` inside the Transport card, dragged like
   tempo and time-sig. Rejected: 14 discrete values are miserable to drag
   through mid-set, and the value you want is usually a jump away
   (1 Bar → None), not a neighbour.
2. Its own column. Rejected: squeezes the Transport card horizontally,
   and 14 chips in a narrow column means a cramped 3×5 grid.
3. **Chosen:** a row-2 card spanning all three columns. The grid becomes
   `grid-template-rows: 1fr auto`, so row 1 keeps its `1fr` and the 5rem
   tempo/time-sig type is untouched.

Chips use `repeat(auto-fit, minmax(3.25rem, 1fr))` so they wrap rather
than shrink below a usable touch target. Measured on the real iPad
viewport (1366×1024): 14 chips at 62×44 px on one line, central display
content 327 px inside a 331 px pane — no overflow, no scroll.

Labels live in `$lib/data/launchQuantization.ts` alongside `scales.ts`,
shared by the store's range guard and the picker so the two can't drift.

## Consequences

**Positive**

- The control that decides when a loop record starts is now one tap away
  on the iPad instead of a trip to Live's transport bar.
- Bidirectional: changing the dropdown in Live moves the chips, and vice
  versa. Seeded on handshake accept, so a UI connecting after Live boot
  sees the real value rather than a default.
- The `_ECHO_ON_WRITE` mechanism is now available by name for the next
  attribute that turns out to be listener-less — the third instance of a
  recurring Live 12 quirk finally has a documented home.
- `_emit_all_pr5d` was factored into a reusable `_emit_attr`; no
  behaviour change for the other twelve attrs.

**Negative / accepted**

- The store defaults to `4` (1 Bar, Live's own default) rather than a
  null "unknown" state. A cold-start UI briefly shows 1 Bar as selected
  before the seed arrives. Showing "None" instead would be worse — it's
  the one value with audibly different launch behaviour — and a null
  state would mean a picker with nothing lit. Accepted.
- Fourteen chips is a lot of UI for one setting. It is justified by the
  control being performance-critical and jump-addressed; a control used
  less often would not earn the row.
- The system view is now two rows. Any future card added to row 1 has
  less vertical room than before.

**Verification**

- Python: 1738 passed, incl. new coverage for in-range/out-of-range
  writes, external change, and the listener-less seed + echo path
  (fixture monkeypatches `add_clip_trigger_quantization_listener` away).
- TypeScript: 1443 passed; production build green.
- Live: surface booted `PR-5d bound 13/13`; listener attached.

## Tags
`launch-quantization`, `clip-trigger-quantization`, `session-component`,
`system-view`, `lom-listener-quirk`, `wire-protocol`
