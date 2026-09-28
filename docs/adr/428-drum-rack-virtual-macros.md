# ADR-428: Drum Rack Virtual Macros — the Surface Owns the Whole-Kit Gesture

## Status
**Accepted** (2026-09-07). Issue #489 Milestone 1. Branch
`feat/drum-virtual-macros-m1`.

## Context

The Drum Rack central view has seven controls — FX XY (fx1 / fx2), the
3×3 FX type, Time XY (attack / decay), Start and Trnsp — and until this
ADR each one wrote a rack **macro by index** (1, 2, 3, 4, 9, 10, 11).
Live's macro mapping did the rest: one macro mapped to the same
parameter on every DrumCell, with the mapping's own range. That is why
"tune just this snare" was impossible — a macro-held parameter is
disabled for direct editing — and it is why the census in issue #489
Addendum 2 matters: of 3,287 Drum Racks the catalogs point at, 2,503
are the pipeline family (macros 1–2 named `FX1` / `FX2`, macro 4 an
unnamed transpose) and every one of them carries 700-odd `KeyMidi`
mappings that lock the cells.

The decision recorded in that addendum: **drum-rack kits will carry no
Live macro mappings at all**; the surface owns every whole-kit gesture
as a *virtual macro* and, later, every per-pad offset. The batch
unmapping of the library happens in the Ableton Device Creator repo,
after this layer exists. So Milestone 1 has to work on kits that are
still mapped **and** on kits that are not, with no visible change to
the view, and the user validates it by ear against both.

### What was measured, and what it rules out

All on Live 12.4.15b1 with the surface's `/looping/probe/lom_*` probes
(Addendum 2, plus the M1 session on 2026-09-07):

| Fact | Consequence |
|---|---|
| Every continuous DrumCell parameter reads/writes in **normalized 0..1**; `Transpose` is `-48..48`; enums are ints. `OriginalSimpler` (33 params) and `MultiSampler` (108) expose `Transpose -48..48` and `Ve Attack` / `Ve Decay` `0..1` the same way. | A fan-out can be written in LOM value space. |
| Sweeping macro FX2 0 → 127 moves all five mapped cell params 0 / .25 / .5 / .75 / 1 — **Live interpolates linearly in LOM value space**. | `value = min + t·(max−min)` through each member's own LOM `min` / `max` reproduces the macro exactly. The curve table the issue feared is void. |
| A macro-held parameter reads `is_enabled = False`; a write raises `RuntimeError: Value cannot be set, the parameter is disabled`. `RackDevice.macros_mapped` (16 bools, observable) says which macros hold anything. | "Held by macro" needs no per-cell probing, and the fan-out must never write a disabled member. |
| `FX On` under macro FX1: macro 1.0 → off, 1.2 → on (measured, M1 session; the kit file's `MidiCCOnOffThresholds` are Min 1 / Max 0). | A two-state member switches **above 1.0 of 127**, not at half travel — the one place `min + t·(max−min)` would be wrong. |
| 24 cell writes in one handler cost 0.4–2.1 ms. **Live records one undo step per parameter write**: a plain 12-cell fan-out in one handler leaves twelve steps, and one `song.undo` puts back one cell (M1 session — this *corrects* Phase 0's note that a handler's writes coalesce). With `begin_undo_step` / `end_undo_step` around the writes the pass is one step ("Undo Custom Action"); two consecutive groups stay two steps. Three separate handler calls writing the *same* macro (63.5 → 70 → 75 → 80) did collapse into one step ("Undo Change Transpose"). | A fan-out needs explicit grouping, and a gesture that spans passes needs the group held open across them. Same-parameter merging covers only the legacy-macro path. |
| Macro 4 at 80 moves every cell's Transpose to exactly **12.0** — Live quantizes the pitch fan-out to whole semitones. | Pitch is held and written as an **integer** on both paths, so mapped and unmapped kits land on identical cell values. |
| Live's own macro fan-out lands **after** the macro write returns (a read on the next drain pass can still see the old cell values; a read 1 s later never does). | Rig checks on a mapped kit must wait before reading cells. Irrelevant to the unmapped path, whose writes are synchronous. |
| The interface sends at most 60 Hz per control; the surface drains at 92.8 Hz. | Steady state has no backlog; the coalescing below is for the moments Live stalls the drain. |

## Decision

### A virtual macro is a musical function bound by parameter name

`DrumVirtualMacroComponent` (new, `surface/components/`)
holds a table of seven functions. Each has a value kind, the legacy
macro index the view used to write, and a binding per pad-instrument
**class**, keyed by parameter **name** — never index:

| function | kind | legacy macro | DrumCell | OriginalSimpler | MultiSampler |
|---|---|---|---|---|---|
| `pitch` | whole semitones, −48..48, centre 0 | 4 | Transpose | Transpose | Transpose |
| `fx1` | t ∈ 0..1 | 1 | FX On, Pitch Env Amt, Sub Amt, Noise Amt, Loop Offset, Stretch Factor, Punch Amt, 8-Bit Rate, FM Amt, RM Amt | — | — |
| `fx2` | t | 2 | Pitch Env Decay, Sub Freq, Noise Color, Loop Length, Grain Size, Punch Release, 8-Bit Flt Decay, FM Freq, RM Freq | — | — |
| `fxType` | int 0..8 | 3 | FX Type | — | — |
| `attack` | t | 9 | Attack | Ve Attack | Ve Attack |
| `decay` | t | 10 | Decay | Ve Decay | Ve Decay |
| `start` | t | 11 | Start | S Start | — |
| `gain` | t | — | Volume (0..1) | Volume (−36..36 dB) | Volume (−36..36 dB) |
| `filterFreq` | t | — | Filter On, Filter Freq | F On, Filter Freq | F On, Filter Freq |
| `filterRes` | t | — | Filter Res | Filter Res (0..**1.25**) | Filter Res |

**`gain` (2026-09-08).** How loud a pad is. Every bound class names it
`Volume`; the ranges differ and were read off the running rig, not a
doc — DrumCell's is normalized `0..1` (index 18 on `Octagonal House`),
the Sampler's and the Simpler's are dB on `−36..36` (index 15 on
`Bright Room`, index 20 on the Acuff kit). The `t` fan-out spans each
member's own `min..max`, so one slider means "how loud" whatever the
pad measures it in, and a kit of mixed classes moves together.

A **nested-rack** pad has no `Volume` to bind — the Samplers are inside
the rack, macro-held — so there the member is the pad's own **chain
volume** (`drum_pads[N].chains[0].mixer_device.volume`, named
`Chain Volume`, `0..1` with 0.85 = 0 dB, measured on `Bright Room`).
It is added in `_rebuild_members` rather than the bindings table
because it is not a parameter-name lookup, and it is the one fixed
function such a kit always answers besides `pitch`. Plugin-hosted pads
get no gain member: their level is not ours to reach, and the macro
grid is that kit's only handle. Like every `t` function, gain carries
the per-pad deviations — the kit value moves and each pad keeps its
offset, so a kit's balance survives a drag.

The fx1 / fx2 membership was verified against the `KeyMidi` table of
` 606 + 808.adg` (macro index 0 → 10 parameters, 1 → 9) with this
file → LOM name map: `Effect_On` → FX On, `Effect_PitchEnvelopeAmount`
→ Pitch Env Amt, `Effect_SubOscAmount` → Sub Amt, `Effect_NoiseAmount`
→ Noise Amt, `Effect_LoopOffset` → Loop Offset, `Effect_StretchFactor`
→ Stretch Factor, `Effect_PunchAmount` → Punch Amt,
`Effect_EightBitResamplingRate` → 8-Bit Rate, `Effect_FmAmount` → FM
Amt, `Effect_RingModAmount` → RM Amt; `Effect_PitchEnvelopeDecay` →
Pitch Env Decay, `Effect_SubOscFrequency` → Sub Freq,
`Effect_NoiseFrequency` → Noise Color, `Effect_LoopLength` → Loop
Length, `Effect_StretchGrainSize` → Grain Size, `Effect_PunchTime` →
Punch Release, `Effect_EightBitFilterDecay` → 8-Bit Flt Decay,
`Effect_FmFrequency` → FM Freq, `Effect_RingModFrequency` → RM Freq.

**Membership is resolved per pad at first use**: walk `pad.chains[0]
.devices`, take the first instrument-class device, look its class up
in the table. Effects on either side of it are skipped (a MIDI effect
may precede the instrument; Eq8 follows it on the Jazz kit). A pad
whose instrument has no binding for a function — Operator, a nested
Instrument Rack (non-member for now by decision), anything unknown — is
simply not a member of that function. Unknown never degrades to a
wrong write.

### Write rule

- `t` kinds: `value = min + t·(max−min)` through the member's own LOM
  range. A **quantized two-state** member (FX On) is set to `max` when
  `t > 1/127`, else `min` — the measured macro threshold.
- `fxType`: the int, clamped to the member's range.
- `pitch`: `clamp(round(semitones), −48, 48)`. The model already carries
  `offsets[note]` (`pitch = global + offsets[note]`, clamped); Milestone
  1 ships them empty and has no UI for them.
- Members with `is_enabled = False` are skipped. A write Live refuses
  anyway marks that member disabled, flags the rack for re-resolution,
  and is logged once.

### Transitional rule: a mapped kit still writes its macro

While `rack.macros_mapped[legacy − 1]` is true, the function writes the
legacy macro instead, in macro units (`macro.min + t·(macro.max −
macro.min)`; `t = (st + 48)/96` for pitch, `idx/8` for fxType). The
view therefore works before and after the library's batch-unmap.

**Gated on the pipeline family** — macros 1 and 2 literally named
`FX1` / `FX2`, the same test `identifyInstrumentTypeAsync` uses to
route to this view. The legacy indices only *mean* these functions on
that family: `32 Pad Kit Jazz` has macro 1 = Transpose, so "fx1 → macro
1" there would transpose the kit. On any other rack the fan-out runs
and macro-held members are skipped, which on a fully mapped foreign kit
is a logged no-op. This guard narrows the rule in the issue; it never
withholds a correct write on the family the rule was written for.

### Wire: computed rows on the existing property channel

No new addresses. `PropertyComponent`'s allowlist gains seven rows
`("DrumGroupDevice", "vm.fx1" … "vm.pitch")`, generated from the
function table, each flagged `computed="drum_vm"` — a new
`PropertySpec` variant with no LOM attribute behind it:

- **subscribe** asks the provider to bind (it resolves members, seeds
  the value, and attaches `drum_pads` / `chains` / `macros_mapped`
  listeners on the rack) and cold-reads the held value.
- **set** hands the provider the value; the provider coerces and
  clamps, stores it, and queues the apply. `handle_set` then **emits the
  `property/value` echo itself**, carrying what was stored (an int for
  fxType / pitch). This is the one exception to the channel's no-echo
  rule, which assumes a LOM listener will fire — nothing fires for a
  virtual value.
- **unsubscribe** of the last function releases the rack's state.
  `on_structural_invalidate` releases it when the device at the path
  is replaced; a different rack arriving at the same path is also
  detected on the next read or write (`same_lom_handle`) and re-seeded.

Seeding: from the legacy macro when mapped; otherwise from the first
**continuous** member of the first member pad (`(v − min)/(max − min)`,
the exact inverse of the write rule), the int of the first member for
fxType, the rounded Transpose for pitch. A rack with no member and no
mapped macro reads `None`, which the view shows as the control at rest.
A change listener marks the state dirty and schedules a re-seed +
re-emit 150 ms later (chains populate after the device-add fires);
values the surface already holds are kept, only missing ones are
seeded.

### One fan-out per drain pass, one undo step per gesture

`OSCTransport` gains `add_drain_hook`: callables run once at the end of
every `poll()` that dispatched at least one message. The provider's
`flush` is that hook. `property/set` stores and queues; `flush` applies
the **latest** value once per `(device, function)`. A burst of queued
sets for one control — the shape of every XY lag — collapses to one
apply per pass. Writes still happen from the OSC handler context, never
inside a LOM listener callback (the repo rule); the listeners here only
mark state and schedule reads.

Because Live records every cell write as its own undo step, `flush`
opens `song.begin_undo_step()` on the first apply of a gesture and the
step is closed by `end_undo_step()` once **300 ms** pass with nothing to
apply (re-armed on every pass; the scheduler rounds to 100 ms ticks).
A drag of any length is one Edit → Undo; a pause longer than the idle
window starts a second step. The wire carries no gesture-end message,
so the idle window is the boundary, and anything else that changes the
Set inside it rides in the same step — accepted, and documented. The
step is also closed on disconnect.

### Interface

`DrumRackCentralView.svelte` swaps the seven `paramPath(device, N)`
reads and writes for `propertyValue(devicePath, 'vm.…')` /
`setPropertyValue`, subscribing all seven in one `$effect` (the
`SimplerCentralView` pattern). XY pads and Start stay 0..1, FX type is
the 0..8 button index, Trnsp is a `DeviceSlider` with `min −48`, `max
48`, `centerValue 0` sending whole semitones. The view is unit-free:
no `/127`, no `63.5`.

Out of scope, by decision: the FX-grid Pitch slider and the ±12 clip
buttons (a later milestone), the kit map (M0), Permute (nothing in the
permute repo changes).

### Harness

`scripts/shot/mock-surface.mjs` answers `property/subscribe` from the
scene's `properties` or `PROPERTY_DEFAULTS` and echoes `property/set`
as `property/value`; the Drum-Rack fixture in `scene.mjs` carries class
`DrumGroupDevice`, role `drum`, and the family's real macro names
(`FX1, FX2, Macro 3, Macro 4, Kick, Snare, Hihat, Perc, Macro 9…`).

## Consequences

### Positive
- The view no longer knows macro indices, macro units or the 63.5
  centre. Every writer that follows (FX-grid pitch, ±12 buttons, the
  Move knob, Permute's pitch lane) re-points at one property.
- Mapped and unmapped kits land on the **same cell values** for the
  same gesture, so the library can be unmapped kit by kit with the
  instrument in use.
- Per-pad offsets have a home in the model before they have a UI.
- One undo step per gesture (explicitly grouped — measured on the rig:
  one `song.undo` reverts a whole 20-set burst and a whole multi-tick
  drag), one apply per drain pass, no listener-side writes — the same
  cost envelope as the macro it replaces (a 24-pad FX1 gesture is 240
  writes ≈ 1–5 ms per apply).

### Negative
- The surface now holds a value Live does not: a cell edited by hand in
  Live drifts from the held `t` until the next gesture or re-seed. No
  per-cell listeners in M1 (the kit map milestone can add them for the
  selected pad).
- The gesture undo step is bounded by an idle window, not by the
  gesture: a change made in Live within 300 ms of the last tick joins
  the step, and a pause mid-drag splits one.
- The family guard on the transitional rule is a heuristic on two macro
  names. It is the same heuristic the UI has used to pick this view
  since the Komplete Kontrol split, and it retires with the mappings.
- A `computed` `PropertySpec` is a second kind of row in an allowlist
  that was purely declarative. Its contract (subscribe / unsubscribe /
  read / write) is documented on the spec and tested; nothing else
  should grow a third kind without a reason as concrete as this one.
- `data/CLAUDE.md`'s "add the property to `device-configs.json` too" does
  not apply and is stale in general: `device_property_loader.py` has no
  consumer but its own test (verified 2026-09-07), and `state/full`
  carries no property values.

## Validation
- Surface: `uv run --with pytest --with ruff python -m pytest -q` —
  2,101 passed, 4 skipped (48 new: member resolution by class, mapped /
  unmapped / partial / non-family routing, disabled skip, refused-write
  re-resolve, the switch threshold, enum ints, range scaling, seed on
  load, echo after set, missing provider, teardown, flush coalescing,
  change-listener re-seed, drain hook).
- Interface: `npm run build`, `npm run test:run` (1,959 passed), `npm run
  shot -- default --click '.device-control .device-slider'` renders the
  view off the mock's property answers.
- Rig (Live 12.4.15b1, `~/Desktop/test Project/test.als`, 2026-09-07,
  full Live restart after the surface change; `DrumVirtualMacroComponent:
  ready (7 functions…)` in Log.txt, no WARN from the component):
  - **Unmapped copy** of ` 606 + 808` on `tracks/6` (24 pads, zero
    `KeyMidi` blocks): after `vm.pitch 12`, `vm.fx1 0.5`, `vm.fx2 0.25`,
    `vm.fxType 3`, `vm.attack 0.25`, `vm.decay 0.75`, `vm.start 0.1`,
    every member on all 24 cells read the expected value — Transpose 12,
    the ten fx1 members 0.5 with FX On 1, the nine fx2 members 0.25, FX
    Type 3, Attack 0.25, Decay 0.75, Start 0.1 — and the rack's macros
    stayed at 0 / 63.5 / 0 / 63.5 / 85 / 127 / 0.
  - **Undo**: each gesture is one "Undo Custom Action" — one `song.undo`
    reverted only the last gesture (Start back to 0, Decay still 0.75);
    three ticks 60 ms apart then one undo → all 24 cells back to 12; a
    burst of 20 sets in one drain pass then one undo → all 24 back to
    0.25. (Before grouping, one undo put back exactly one cell.)
  - **Mapped kit** on `tracks/1`: `vm.pitch 12` → macro 4 = 79.375 and
    the cells' Transpose 12; `vm.fx2 0.25` → FX2 = 31.75 and the fx2
    members 0.25; restored to 63.5 / 63.5.
  - **Real interface** (browser at `localhost:3000` through the bridge):
    cold reads seeded from the kit (FX pad 0.5/0, Time 0.669/1.0, Start
    0, Trnsp 0 on −48..48, Stretch); a diagonal Time drag, an upward
    Trnsp drag and a Punch tap left the store at (0.17, 0.50), 24, Punch
    and all 24 cells at (Attack 0.173, Decay 0.501, Transpose 24, FX Type
    3) — the same values, no queued leftovers.

## Addendum — Milestone 1b (2026-09-07): the same UX on every native pad type

Milestone 1 made the seven controls work on the pipeline family's
DrumCell kits, mapped or unmapped. The user's rule for what comes next:
**the existing Drum Rack UX must work on unmapped drum racks of every
native pad type — DrumCell, Simpler, Sampler, mixed — before any new
experience is added.** Three things stood in the way, all on the UI
side of a surface whose bindings already covered Simpler and Sampler:

1. **Routing by macro name.** `identifyInstrumentTypeAsync` sent every
   rack whose macros 1–2 were not literally `FX1` / `FX2` to a second
   type, `drumrack-komplete-kontrol`, and its view — a grid of sliders
   writing rack macros **by index**. `32 Pad Kit Jazz` (macro 1 =
   Transpose) and every `50s Autumn`-style Sampler kit landed there, and
   on an unmapped copy those sliders move nothing.
2. **No notion of non-member or held.** A Simpler pad has no FX section,
   a Sampler no Start; on the still-mapped Jazz kit every pad's
   Transpose is macro-held. The controls rendered live and silently did
   nothing.
3. **Two pitch writers still on the name scan.** The FX-grid Pitch slider
   and the ±12 clip buttons resolved the rack's transpose macro by name
   (`Pitch` / `Transpose` / `Custom E` …) — inert on the family (whose
   macro is "Macro 4") and on every unmapped kit, and the clip-transpose
   fallback would note-shift a Drum Rack, which triggers other pads.

### Decision

**The surface publishes a census; the UI decides from it.** One new
computed row beside the seven functions, same provider, read-only:

```json
vm.members = {"padCount": 32,
              "padClasses": {"OriginalSimpler": 31, "MultiSampler": 1},
              "hasMacroMappings": true,
              "family": false,
              "functions": {"pitch": {"members": 32, "held": 32},
                            "start": {"members": 31, "held": 0}, …}}
```

- `padCount` counts pads carrying a chain; `padClasses` is a histogram
  of the **first instrument's class on each populated pad, bound or
  not** — a Komplete Kontrol kit reads `AuPluginDevice`, a pad holding a
  nested rack `InstrumentGroupDevice`, an effect-only chain counts in
  `padCount` and nowhere else. `functions.<fn>` counts member
  *parameters* (fx1 is ten per DrumCell pad) and how many are held
  (`is_enabled == False`). `_resolve` walks each pad once for the census
  and the bindings together.
- Cold-read on subscribe; **re-emitted with the functions on every
  re-seed** (`drum_pads` / `chains` / `macros_mapped` fire, kit swap,
  device replaced) — so unmapping a kit in Live un-dims the UI with no
  round trip from the interface. A `set` rejects `property-read-only`.
  A few hundred bytes against the 9,216 B datagram cap.

**One Drum Rack view, one instrument type.** Every `DrumGroupDevice` is
`drumrack`; the `drumrack-komplete-kontrol` type and registry entry are
gone. `DrumRackCentralView` reads the census and picks its own mode:

- pads hosted by a plugin (`AuPluginDevice` / `PluginDevice` in
  `padClasses`) → the macro grid, now `views/DrumRackMacroGrid.svelte`
  — the old Komplete Kontrol view, mounted by the Drum Rack view instead
  of the registry (hence the dropped `*CentralView` suffix, which the
  registry's reachability test enforces). Those pads have no bindings;
  the rack's own macros are the only handle on them.
- every native pad type → the seven controls, with three states per
  function from `drumVirtualMacros.ts`: **live** (an enabled member
  exists), **held** (members exist, all macro-held — read-only, ink and
  value kept, inert, a small "macro" badge), **none** (no member —
  ghost-dimmed, inert). An XY pad is as capable as its more capable
  axis. No census yet is **unknown** and renders exactly as Milestone 1.
  **Partially held** — the rig turned this up: Live's Transpose macro on
  `32 Pad Kit Jazz` maps the 31 Simplers and leaves the Sampler pad
  free, so pitch reads `31/32` — stays live (the surface moves the free
  members) and wears the same badge with the count, `31/32 macro`, so a
  drag that moves one pad of 32 is announced rather than mysterious.
  `50s Autumn` as shipped is the fully held case (pitch and attack
  `32/32`, read-only).
  Writes go out only for live / unknown functions: the surface would
  skip a held function's members anyway, but it would also store and
  echo the value, and a Trnsp showing +12 while nothing moved is the
  failure this milestone removes.
- **No name-based macro fallback for a held function**, by decision. A
  still-mapped non-family kit shows Trnsp held until the kit is unmapped
  (the batch-unmap is the next step). If it is ever wanted it is one
  line — write the rack macro whose name matches the function — and it
  is not added unasked.

The mode is decided from pad classes and never from macro names — the
heuristic that misrouted the Jazz kit is retired rather than refined.

**Kit profiles (user's decision, 2026-09-07, after the rig run).** The
view lays itself out by the kit's *dominant* pad class, read off the
census histogram (ties break on the class name):

| dominant class | profile | what shows |
|---|---|---|
| `DrumCell` (or no census yet, or an empty rack) | `full` | the seven controls above |
| `OriginalSimpler` | `simpler` | the Simpler row (below, 2026-09-07): the Time pad (Ve Attack across, Ve Release up) and Trnsp, fanned out to every pad's Simpler by name |
| any other native class (Operator …) | `pitch-only` | a card naming the pad class, with the pad count or, on a mixed kit, the histogram — and the Trnsp slider where it always sits |
| `MultiSampler` | `sampler` | the Sampler row (below, 2026-09-07): Osc, Pitch-envelope and Time pads, Decay / Sustain / Spread sliders and Trnsp, every control fanned out to each pad's Sampler by name |
| `InstrumentGroupDevice` with named macros | `rack-macros` | one control per pad-rack macro name, laid out like the Instrument Rack view (below, 2026-09-07); with no named macro at all, `pitch-only` and the "Instrument Rack" card |
| `AuPluginDevice` / `PluginDevice` present | `macro-grid` | the rack's own macros |

### Rack macros — kits of nested Instrument Racks (2026-09-07)

The case the consequence below called "a candidate for either a binding
or a routing refinement when such a kit turns up" turned up the same
day: `Ethnic Drums` on the rig — 32 pads, every one an
`InstrumentGroupDevice` around two Sampler chains. Measured through the
LOM probe and the bridge's census:

- every pad rack carries the macros `Attack, Release, Transpose, Osc,
  Pitch Attack, Pitch Amount, Room`, `has_macro_mappings True`, macros
  1–6 mapped into its Samplers;
- the Drum Rack's **own** macros wear the same names minus Transpose
  but `has_macro_mappings False`, every `macros_mapped` False, values
  0 — Live itself cannot drive them, so routing such a kit to the macro
  grid would show dead sliders;
- the census read `padClasses {InstrumentGroupDevice: 32}` and zero
  members for all seven functions, so the view showed the "Instrument
  Rack · 32 pads" card and a ghosted Trnsp. The user expected the
  named macros as sliders, the way a rack on the track gets them.

**Decision: the pad racks' macros are the kit's controls, by name.**
The surface resolves each nested rack's named macros (`parameters`
minus `Device On` / `Chain Selector`, by name never position; default
`Macro N` / `.` / `-` names dropped; sixteen slots) into one function
per name, `macro.<name>`, kind `t`, one member per pad rack carrying the
name, and lists them in the census as `macros` — a list in rack order
(the first pad's rack sets the order), one row per name with the same
`members` / `held` counts as a function. On the wire each is
`vm.macro.<name>` (wire-protocol §2.6): seeded from the first pad,
written through each macro's own 0..127 so the rack fans it on to both
chains, a macro that is itself macro-held skipped and counted, the
same coalescing, undo step and re-seed as the seven, **no legacy
macro ever** (the guard matters: index 0 would otherwise read
`macros_mapped[-1]` and route to Device On). It is the channel's one
open-ended name family: `PropertyComponent.spec_for` synthesises the
computed row for any `vm.macro.<name>` on a `DrumGroupDevice` and
nothing else; a name the kit lacks reads nil and a write to it stores,
echoes and moves nothing — the member-less rule.

The view's `rack-macros` profile renders the census's names the way
`InstrumentRackCentralView` renders a rack on the track — the same
`buildMacroLayout` rule on names instead of indices: two consecutive
names sharing a first word pair into an XY pad ("Pitch Attack" +
"Pitch Amount" → Pitch), every other name a slider — each writing
`vm.macro.<name>` as `t`, subscribed per kit from the census (and
released when the names change). States and badges are the functions'
own: a name held on every pad is read-only with the "macro" badge, one
held on some stays live with the count, and a name only some pads
carry wears a second badge, "20/32 pads", so a drag that moves part of
the kit is announced. The Drum Rack's own top-level macros are not used.

**Pitch binds through the transpose macro (same day).** With the seven
functions member-less on such a kit, the Permute pitch step was silent
too — Log.txt: `sequencer shift 12 skipped: rack has no pitch value
yet`, and the user noticed at once. The kit's own transpose is its pad
racks' "Transpose" macro, and the project convention (user, 2026-09-07)
fixes a pitch macro at −48..+48 semitones over its 0..127 — which the
kit file confirms: the Sampler's `TransposeKey` carries a `KeyMidi` on
macro 3 with `MidiControllerRange` −48..48 (the LOM never exposes a
mapping's range, so the convention, not a runtime calibration, is what
makes the octave exact: 12 st = 15.875 macro units). So a pad rack macro
named Transpose / Pitch / Tune / Trnsp (exact, case-insensitive, first
in that order) is the pad's `pitch` member — a *semitone macro* member,
read and written in semitones through the macro's range, taking part in
the per-pad offsets, the kit-move reconcile, the shift and the undo step
like any Transpose; the macro's own value is what is read back
(synchronous — Live's fan-out to the Samplers lands a moment later, and
nothing reads the Samplers). The census names it as `pitchMacro`, and
the view shows **Trnsp in that macro's place** in the row, in semitones,
so one knob serves the Trnsp slider, the FX-grid Pitch, the ±12 buttons
and the sequencer's octave; `vm.macro.Transpose` still exists as the raw
0..1 view of the same knob and is not drawn. A kit whose racks carry no
such name keeps pitch member-less and shows no Trnsp.

### Sampler kits get the Sampler row (2026-09-07)

Asked the same evening, in two steps. The regular, non-drum
`SamplerCentralView` had been one Time pad (amp Attack across, Release
up, written by index 59 / 66) beside the pitch and mod wheels, so the
first cut gave a Sampler kit exactly that. What the user meant was
Live's own Sampler panel — its Pitch/Osc tab: the oscillator, the
pitch envelope, the full amp envelope, Spread. So the row was built
from the Sampler's own parameters and both views now draw it:
**`SamplerControlsRow`** — four columns like the Drum Rack view:
**Osc** XY (O Coarse across, O Volume up), **Pitch** XY (Pe Attack across, Pe < Env up — centre is no envelope), **Time** XY (Ve Release across, Ve Attack up) with **Decay** and **Sustain** beside it, **Spread** and
**Trnsp**. Ranges measured on the rig's `50s Autumn Brushes` pads (108
parameters, every section on): O Volume 0..1, O Coarse −2..48, Pe < Env
−48..48, Spread 0..100, the envelope times 0..1.

Seven fixed functions were added for it, Sampler-bound by name, no
legacy index: **`release`** (`Ve Release`, Simpler too), **`sustain`**,
**`oscAmount`** (`Osc On` + `O Volume`), **`oscCoarse`**,
**`pitchEnvAmount`** (`Pe On` + `Pe < Env`), **`pitchEnvAttack`** (`Pe Attack`),
**`spread`**. A section's switch is the function's first member. The
oscillator's follows its amount — on above 1/127 of travel, off at the
floor, the DrumCell `FX On` rule — but the pitch envelope's amount is
bipolar (its floor is −48 st, centre is none), so that switch only ever
turns on (`switch_off_at_floor=False`). A real
Sampler lists all 108 parameters with fixed indices; the 43-parameter
variant the M1b notes recorded lists only a section's switch until the
section is first enabled, and `_grow_sections` re-reads the rack after
a switch member turns on so the amount lands in the same pass (a no-op
on a full list). The `sampler` profile is a `MultiSampler`-dominant kit
— the Jazz kit's one Sampler pad does not outvote its Simplers — and
draws the row from the functions with the usual states and badges (on
the shipped Autumn kit the Release macro holds every pad's `Ve
Release`, so the Time pad stays live for attack and wears "32/64
macro"); no wheels on a kit. The single-Sampler view draws the same row
from its own parameters **by name** (`SAMPLER_ROW_PARAM_NAMES`), mapped
through each parameter's LOM range (`selectedTrackStore.paramRange`),
writing a section's switch with its amount, with the wheels beside it —
its index-based Time pad is gone. Simpler kits keep `pitch-only` for
now.

### Simpler kits get the Time pad and Trnsp (2026-09-07)

Measured on `Acuff Kit` (16 Simpler pads, unmapped, Classic mode, real
samples): the regular Simpler view's bottom row is Loop, Pitch, Time
(Attack × Release), Fade (the loop crossfade), Gain (a per-sample
property) and Reverse, above a per-sample top half (Classic / Slice, the
waveform brace, Warp). The user's call: **enough of those for now is the
Time pad and Trnsp** — `attack` / `release` (Ve Attack, Ve Release; on
this kit's Simplers at indices 21 and 24) and `pitch` (Transpose, 11,
±48), all bound long since — so the `simpler` profile draws
`SimplerControlsRow`: the Time pad (Attack across, Release up — the
regular view's own axes) filling the row beside a slider-width Trnsp. `sustain` and `spread` gained their
Simpler bindings on the way (Ve Sustain, Spread — measured present), so
the census counts them on Simpler pads too; nothing draws them there yet.
`pitch-only` (the class card) remains for any other native class.

Also measured: the regular `SimplerCentralView` addressed its parameters
by index (Attack 26, Release 29 …), which on these Simplers — filter
section listed, pitch envelope not — are `Ve Loop` and `Trigger Mode`.
It now resolves every parameter by name off the device's own list, the
table's index being the fallback, and its Pitch slider is ±48 like every
other pitch control (was ±12).

Also fixed on the way: a re-seed that finds a function's members gone
(a Sampler kit whose pads then received racks) kept the old kit's
value, so `vm.decay` cold-read 0.65 and `vm.pitch` 0 on a kit with
nothing to move — measured on the rig before the change. A value with
no source (no member, no mapped legacy macro) now drops to nil.

Verified: surface (`pytest`, 189) — census order and counts, seed,
fan-out through the macro range, held skipped and counted, the legacy
guard on a mapped family kit, nil for a name the kit lacks, the
sixteen-slot cap, the re-seed drops, the channel row on a Drum Rack
only; pitch through the transpose macro — semitone reads and writes
(63.5 ↔ 0, 79.375 ↔ +12, the rails), offsets seeded from the racks'
tuning, the sequencer shift riding the macro and restoring, a held
macro refusing the shift, the name priority list, the raw macro row and
the pitch function as two views of one knob; interface
(`npm run test:run`) — census parsing with duplicates and malformed
rows, `pitchMacro`, the profile decision (nested minority stays
`pitch-only`, plugin pads still win), states and both badges, the
layout with the pitch macro left out, and the rendered view: slots in
rack order with Trnsp last, subscriptions opened from the census and
released on a kit change, a held name's badge, Room's coverage badge, a
slider drag writing `vm.macro.Attack` as `t`, a held name writing
nothing, Trnsp writing `vm.pitch` in whole semitones. Harness: a third
fixture kit, **Ethnic** (track 9), photographs the profile.

Simpler and Sampler kits have different parameters from DrumCell, so
their FX slots meant nothing there; rather than leave three dimmed
controls, the view shows the one function every native kit shares and
names the kit, and the other slots are filled in later once the
functions worth having on those kits are chosen (candidates measured:
the Filter section — `Filter Freq` / `Res` / `Type`, the same names on
Simpler and Sampler, which appears in the LOM only once `F On` is 1 —
Release, Loop). **A Simpler in Live's "Multisample Mode" is a Simpler
here**: it exposes exactly a Simpler's parameters (its `sample` reads
`None`), so it wears the "Simpler" label and needs no profile of its own.
The surface bindings for attack / decay / start on those classes stay in
place and validated; only the view leaves them out for now.

**The two other pitch writers move to `vm.pitch`.** The FX-grid slider's
mapping kind is `drum-pitch` (−48..48 about 0, the Trnsp rail), ghosted
and inert when the census says held or none; the ±12 buttons read
`vm.pitch` back, add an octave, clamp and write it — refusing with a
warning when held / none / not yet cold-read — and a Drum Rack is
**never** note-shifted on any path. The `transpose` slider kind (the
runtime name scan) had no remaining consumer and is deleted;
`findTransposeParameter` survives for instrument racks only. The clip
view holds the `vm.pitch` / `vm.members` subscriptions while a Drum Rack
is the instrument, so the buttons have a value to add to even with the
instrument view off screen, and disables them when pitch cannot move.

### Consequences

- **Every native kit gets the same seven controls**, honestly labelled:
  what cannot move on this kit is dimmed, what a Live macro still owns
  is marked so, and a control that moves is one the surface is fanning
  out. The macro grid survives only where nothing else can reach the
  pads.
- **The Komplete Kontrol kit's FX-grid Pitch slider and ±12 buttons go
  inert**: its `Custom E` macro used to be found by the name scan, and no
  plugin-pad binding exists. The macro grid still drives that macro. A
  **transitional limitation** by the user's decision (2026-09-07):
  Komplete Kontrol is being removed from the rig altogether, so no
  plugin-pad binding and no name-based fallback will be written for it;
  the limitation, the macro-grid mode and the `komplete-kontrol`
  instrument type all go away with that migration.
- A kit whose pads are all nested Instrument Racks was, at Milestone 1b,
  a non-member kit that rendered every control dimmed — "a candidate
  for either a binding or a routing refinement when such a kit turns
  up". It turned up the same day: see *Rack macros* above.
- The harness gains per-device property answers and a `selected_track`
  echo, so two fixture kits (an unmapped DrumCell kit on **Drums**, a
  still-mapped Simpler kit on **Jazz**, track 8) photograph the live,
  dimmed and held states without Live.
- The first component render test in the suite
  (`DrumRackCentralView.test.ts`) needed `svelte` itself aliased to its
  client build under vitest, the way `svelte/reactivity` already was —
  the package's `default` export is the server build, whose `mount()`
  throws. Exact-match alias, so subpaths are untouched.
- **The surface's OSC codec did not know nil.** Milestone 1 documented a
  no-member function as "cold-reads `nil`"; on the rig the first Sampler
  kit showed that `encode_message` raised on `None` and the emit never
  left the surface (`pythonSurface encode failed … unsupported arg type
  NoneType`, one ERROR line per non-member function per subscribe). The
  606 kit never exposed it because every function has members there.
  `osc_codec.py` now encodes `None` as OSC nil (typetag `N`, no payload)
  and decodes it back; the bridge's `osc.js` already turns `N` into
  `null`, which the UI reads as "at rest". The same path served every
  earlier "container missing → emit `None`" cold read (a Simpler with no
  sample), which had been failing the same way.

### Validation (Milestone 1b)

- Surface: `uv run --with pytest --with ruff python -m pytest -q` —
  census on DrumCell-only, mixed Simpler + Sampler (with an Eq8 after
  one Simpler), plugin-pad and nested-rack fakes; held counts following
  a `macros_mapped` fire; re-emit when pads populate; size bound;
  read-only on the channel.
- Interface: `npm run build`, `npm run test:run` — census parsing and
  the state / mode rules, one type for every Drum Rack, the retired
  subtype falling to `default`, the macro grid outside the registry,
  the ±12 buttons writing `vm.pitch` (clamped, refused when held / none
  / cold), the clip path never note-shifting a rack, the instrument rack
  keeping its macro units, and the rendered view: mode switch both ways,
  the Jazz kit's dimmed / held / live slots, a live tap writing
  `vm.fxType` and a Simpler kit's tap writing nothing.
- Rig (Live 12.4.15b1, `~/Desktop/test Project/test.als`, 2026-09-07,
  full Live restart after the surface change — `DrumVirtualMacroComponent:
  ready (… census=vm.members …)` in Log.txt, no WARN from the component).
  Writes went through the bridge as the interface's do (`property/set`
  over the authenticated WebSocket), read-backs through the LOM probe,
  every gesture undone afterwards:
  - **Census**, all seven racks: Jazz kits (0–3) `padClasses
    {OriginalSimpler: 31, MultiSampler: 1}`, fx1 / fx2 / fxType `0`,
    start `31/0`, attack / decay `32/0`; mapped (0, 2) pitch `32/31`,
    unmapped (1, 3) `32/0`. Autumn kits (4, 5) `{MultiSampler: 32}`,
    start `0`, mapped (4) pitch and attack `32/32`, decay `32/0`;
    unmapped (5) all `/0`. `606 + 808 unmapped` (6) `{DrumCell: 24}`,
    `family: true`, fx1 `240/0`, fx2 `216/0`, everything else `24/0`.
  - **Unmapped Jazz (1, 3)**: `vm.pitch 12` → `Transpose` 12 on pads 36,
    50, 67; `vm.attack .3` + `vm.decay .7` → `Ve Attack` .3 / `Ve Decay`
    .7; `vm.start .25` → `S Start` .25; `vm.fx1` / `fx2` / `fxType` →
    nothing changed anywhere; the rack's macros never moved. One
    `song.undo` put back only the Start gesture; three put back the
    baseline.
  - **Unmapped Autumn (5)**: `vm.pitch 12` → `Transpose` (param 34) 12;
    attack / decay → `Ve Attack` (59) / `Ve Decay` (62); `vm.start` and
    `vm.fx1` → nothing; two undos → baseline.
  - **Unmapped 606 + 808 (6)**: pitch −10 → 12 on every pad checked,
    `vm.fx2 .25` → FM Freq / Sub Freq .25, `vm.fxType 3`, `vm.start .1`;
    three undos → −10 / 5 / .443 / 0, the baseline.
  - **Mapped kits** (written on the user's word, every gesture undone):
    Jazz (0, 2) — the Sampler sits on one pad and its `Transpose` is the
    only enabled one; `vm.pitch 12` moved that pad alone (the 31 held
    Simplers stayed at 0, macro 1 stayed put), `vm.attack .3` +
    `vm.decay .7` moved `Ve Attack` / `Ve Decay` on Simplers and Sampler
    alike, `vm.start .25` moved `S Start`; three undos restored the
    baseline. Autumn (4) — `vm.pitch 12` and `vm.attack .3` moved nothing
    (every member held), `vm.decay .7` moved `Ve Decay`; two undos
    restored the baseline. No component warning in Log.txt. A detail
    that justifies resolving members by name: the Jazz kit's one
    `MultiSampler` exposes **43** parameters (`Transpose` at index 11,
    `Ve Attack` 21, `Ve Decay` 24) where the Autumn kit's expose 108
    (34 / 59 / 62). Measured cause (2026-09-07): **Sampler's LOM
    `parameters` list is dynamic — a section that is switched off
    contributes only its On switch.** Switching the Jazz Sampler's
    `F On` to 1 grew the list from 43 to 70 (the filter and
    filter-envelope parameters appeared); `song.undo` put it back to
    43. The Autumn Sampler has Osc, Pitch env and Filter on (23 + 16 +
    17 parameters), the Jazz one has every optional section off. So
    indices shift whenever the user toggles a Sampler section; the
    `Transpose` / `Ve Attack` / `Ve Decay` members sit in the always-on
    Pitch and Volume sections, and the surface holds them as
    `DeviceParameter` objects resolved by name, so a section toggle
    does not move a binding. In the kit file Simpler and Sampler share
    one schema and differ by `Globals/IsSimpler` (`true` on the 31
    `OriginalSimpler` pads, `false` on the `MultiSampler` pad), and the
    Simpler pads themselves carry 8–12 velocity-layered
    `MultiSamplePart`s — Live's "Multisample Mode" Simpler (the label
    that replaces the waveform on Ableton-made presets Simpler users
    can play but not edit), whose LOM signature is a `sample` attribute
    that reads `None`; the one Sampler pad is a Sampler in the file, in
    the LOM (`class_display_name` "Sampler", no `sample` /
    `playback_mode` attributes) and in Live's device view.
  - **After the codec fix** (second restart, 12:28): a subscribe on the
    unmapped Autumn kit cold-reads `vm.fx1 = null`, `vm.start = null`,
    `vm.pitch = 0` through the bridge, and Log.txt shows zero `encode
    failed` lines and no component warning.
  - **Real interface** (`npm run dev`, browser at 1366×1024): track 2
    (unmapped Jazz) FX type + FX pad `none`, Time / Start / Trnsp
    `live`; track 1 (mapped Jazz) Trnsp `live` badged `31/32 macro`;
    track 5 (mapped Autumn) Trnsp `held` badged `macro`, Time `live`
    badged `32/64 macro`, Start `none`; track 6 (unmapped Autumn) FX +
    Start `none`; track 7 (606 + 808) everything `live`. The FX-grid
    Pitch slider sits on −48..48 and read the 606 kit's actual −10.

## Addendum (2026-09-07): offsets seeded, a shifted rack not released

- The per-pad `offsets` Milestone 1 shipped empty are now seeded from
  the kit and reconciled before every fan-out — ADR-429 §"Per-pad
  offsets are seeded from the kit", including the kit-move rule and the
  stale-read window the review fixes added the same day.
- "**unsubscribe** of the last function releases the rack's state"
  (§Wire above) holds only while no sequencer shift is held on it: a
  rack the Permute engine has shifted keeps its state — offsets, shift,
  listeners — until the term is zeroed, and that state follows the rack
  across a path move (`rebind`) instead of being released with the old
  path.

## Addendum (2026-09-08): per-pad deviations, kept honest by the members' own listeners

Milestone 1's recorded negative was that *the surface now holds a value
Live does not: a cell edited by hand in Live drifts from the held `t`
until the next gesture or re-seed*, with "no per-cell listeners in M1
(the kit map milestone can add them for the selected pad)". This closes
it, for every function but the three noted below, and does so in the
shape the per-pad milestone needs rather than as a display patch.

**The model is `pitch`'s, generalised.** Pitch has carried per-pad
offsets since the offsets addendum: `pitch = global + offsets[note] +
shift`, seeded from the kit and reconciled before every fan-out, which
is what keeps a kit whose snare is tuned +3 from being flattened by the
Trnsp slider. The other thirteen functions carried one number for the
whole kit. They now carry a `_MemberEdit` per continuous member —
`dev`, `written`, `prev`, `written_at`, the same four fields
`_PadPitch` holds — keyed by `(pad note, parameter name)` on
`_RackState.edits`, so it survives a re-resolve exactly as the offsets
do. A member is written `clamp(global + dev)` in the function's own
`t` space, and a pad the clamp pins at a rail keeps its deviation for
the way back.

**Reconciled by push, not poll.** Pitch reads every member back before
each fan-out; at 60 Hz that is affordable for one parameter a pad and
not for ten (a 32-pad kit's `fx1` is 320 members). So the continuous
members carry a `add_value_listener` each, and the reconcile runs only
when something actually moved. The callback marks the function and
schedules — it reads and writes nothing, per the repo rule — and
`_absorb_edits` does the reading `EDIT_ABSORB_DELAY_MS` (150 ms) later.
Our own fan-out fires those listeners too and is ignored twice over:
`_fanning_out` covers Live dispatching synchronously, and the `written`
baseline covers it if Live ever defers.

**The classification is `_reconcile_pitch`'s rules in `t` space.** A
delta at least two pads share, and the most common one across the pads
read, is a **kit move** — Live's Edit → Undo of our own gesture, a
macro, a hand move of the whole kit — and is adopted into the held
value and re-emitted, so the control on screen follows Live instead of
going stale. What remains per pad is that pad's own edit and moves its
deviation. A read equal to the pre-write value inside
`STALE_READ_WINDOW_MS` is our write still landing, neither a vote nor
an edit (the DrumCell lag measured for ADR-429). The deferral is
load-bearing for the kit-move half: fired inline, each pad would be
seen alone and read as an edit.

**Three functions carry no deviation, by decision.** A two-state switch
(`FX On`, a Sampler section's `On`) has no room for one and keeps
following its amount by the measured macro threshold. `fxType` is a
choice, not an amount — a per-pad FX type is a real thing to want, but
as an absolute value, and modelling it as an offset would be wrong; it
waits for the per-pad milestone. `pitch` keeps its own poll: it is the
sequencer's write path and is rig-validated as it stands, and running
both mechanisms on one function would have them fight. Unwatched
members keep Milestone 1's behaviour, and `MAX_MEMBER_LISTENERS` (1024,
against ~700 for the worst real kit) leaves a whole function unwatched
rather than half of one if a kit ever passes it — logged once.

### Consequences

- **A kit control now moves the kit and keeps its shape.** This is an
  audible change to existing behaviour, not only a fix: a kit whose
  pads ship at different decays used to be flattened by the first touch
  of Decay and now keeps its spread. It is the behaviour Trnsp has had
  since the offsets addendum, so the row is consistent rather than
  newly special.
- **`vm.<fn>` still reads the kit value** and a single pad's hand edit
  does not move it or emit — the control is not yanked to whichever pad
  the user last touched in Live. Only a kit-wide move re-emits.
- **This is the substrate for per-pad control from the interface.**
  "Set pad 38's decay" is `dev = target − global` on that pad's
  records, and a selection of pads is the same write repeated; the
  records are keyed by pad note for that reason. What is still missing
  is a wire row per pad (`vm.pad.<note>.<fn>` needs no new address —
  `PropertyComponent.spec_for` already synthesises open-ended computed
  rows for `vm.macro.<name>`), a pad list in the census for the UI to
  draw a grid, and the selection concept in Svelte.
- The deviations are visible on `/looping/probe/sequencer_stats` via
  `debug_state` (`deviations`, and `watching` for the listener count)
  beside the pitch `offsets`, so the rig can be asked what a kit holds.
- Two models now coexist for the same idea — `_PadPitch` polled,
  `_MemberEdit` pushed. Deliberate: the fields and semantics are
  identical so a later unification is mechanical, and destabilising the
  sequencer's write path to get there today was not worth it.

## Validation
- Surface: `uv run --with pytest --with ruff python -m pytest -q` —
  **2,310 passed, 4 skipped** (16 new: the kit value seeding from the
  first pad with the rest deviating, a fan-out keeping the kit's shape,
  a railed pad keeping its deviation, a hand edit becoming that pad's
  deviation and surviving the next fan-out, a hand edit moving neither
  the held value nor the wire, our own fan-out never read as an edit,
  a kit move adopted and re-emitted, a kit move leaving a hand-tuned
  pad's deviation alone, the stale-read window both sides, switches /
  enums / pitch carrying none, a mapped kit carrying none and watching
  nothing, detach on release, no stacking across a re-resolve, one
  schedule per burst, a pad added after seeding keeping what it holds,
  and rack-macro functions carrying deviations too). `ruff check` adds
  no new rule categories over HEAD.
- Interface: `npm run build`, `npm run test:run` (2,052 passed) — no UI
  change was needed; the wire shape is unchanged.
- Rig (Live 12.4.15b1, `Acuff Kit` on `tracks/1` — 16 unmapped
  `OriginalSimpler` pads, full Live restart at 08:36, 2026-09-08). Writes
  went through the bridge WebSocket as the interface's do; read-backs and
  the hand edit through the LOM probe; every value restored to the
  baseline the same run measured, and no `DrumVirtualMacroComponent`
  WARN or ERROR in Log.txt across the pass:
  - **Listener count: 96** on this kit — six continuous functions with
    Simpler bindings (attack, decay, start, release, sustain, spread) ×
    16 pads, with `pitch`, the switches and `fxType` correctly unwatched.
    Comfortably inside `MAX_MEMBER_LISTENERS`.
  - **Deviations seeded from the kit as loaded**, and the kit turned out
    to have a shape already: `Ve Decay` reads 0.518427 on pads 40 and 44
    and 0 on the other fourteen, so `vm.decay` cold-reads **0** (pad 36,
    the anchor) with `{40: 0.5184, 44: 0.5184}` held.
  - **A fan-out keeps that shape.** `vm.decay → 0.3` put pads 40 and 44
    at 0.818427 and the other fourteen at 0.3. Before this change all
    sixteen would have gone to 0.3 and the kit's two long pads would
    have been flattened by the first touch.
  - **Our own fan-out is not read as an edit.** Sixteen member writes
    fire sixteen value listeners; the deviations after the gesture were
    exactly the two that went in. So Live does dispatch parameter
    listeners for the surface's own writes, and the `_fanning_out` +
    `written` pair does ignore them.
  - **A hand edit becomes that pad's deviation and moves nothing else.**
    Writing pad 38's `Ve Decay` to 0.7 outside the fan-out produced
    `38: 0.4` (0.7 − the held 0.3); `vm.decay` stayed 0.3 and **no**
    `property/value` went out — one pad's edit does not yank the control
    on screen. `vm.decay → 0.5` then landed pad 38 at 0.9: the edit
    survived the gesture.
  - **A kit move is adopted and re-emitted.** `song.undo` after that
    gesture put every pad back to its 0.3-era value; the shared −0.2
    delta was recognised as the kit move, the held value went back to
    0.3, and the subscriber saw the re-emit — the three emits observed
    were `0.3` (cold read), `0.5` (our set), `0.3` (after the undo). All
    three deviations survived it intact.

## Addendum (2026-09-08): per-pad rows and the selected pad — the wire under a pad grid

The user's next want, stated the same morning the deviations landed:
**address and control a subset of pads from the interface** — a small
overview of the pads beside the controls; touch nothing and the controls
move the kit, hold one or more pads and they move only those, the held
pad also selected in Live's rack and the controls showing its values.
This addendum is the surface half, built and unit-tested first because
it is the same whatever the grid ends up looking like; the interface
half follows.

### The interaction, and why hold

Hold-to-scope was preferred over Push-style tap-to-select with a "kit"
button because it has no mode to forget: the scope lasts exactly as long
as the finger, and lifting returns to the kit. A tap and a hold are one
gesture at two lengths — touch-down selects the pad in Live at once, so
there is no ambiguity to resolve with a timer. Selection persists after
release (Live's device view stays on the pad; the Move encoder's
chain-volume knob, ADR-412, follows it for free). While held, the
controls show the *selected* pad's values — the last touched down — and
a drag moves every held pad by the same amount, the kit's own rule; to
make pads converge, hold them one at a time. The kit value does not move
when a pad does, so the control snaps back to it on release — the one
thing that may read as "my edit vanished" the first time; a mark on a
deviating pad tile is the later refinement. Layout, per the user: the
grid on the left of **every** Drum Rack profile, the existing controls
squeezed to make room, refined later.

### What the surface provides

Three additions, no new OSC address, all on the property channel
(wire-protocol §2.6):

- **`pads` in the census** — `[{note, name, class}]` in note order for
  every pad carrying a chain. `name` is `DrumPad.name`, which on the rig
  is the chain's name ("Kick Plastic 90s Heavy Rock"; an empty pad reads
  its note name, "E2"), capped at 24 characters; past ~8 KB the names
  are dropped so a 128-pad kit still fits the datagram.
- **`vm.selectedPad`** — `rack.view.selected_drum_pad` as a note, read
  and write, and — verified on the rig before the design leaned on it —
  Live 12 exposes `add_selected_drum_pad_listener` on the rack's view,
  so a pad tapped in Live lights on the iPad and a write from the iPad
  is echoed back by Live itself. A set is therefore echoed twice.
- **`vm.pad.<note>.<fn>`** — one pad's value, **absolute** in the
  function's own units, the second open-ended name family after
  `vm.macro.<name>`. A read is Live's own value off the pad's first
  continuous member — the kit's anchor rule applied per pad — rather
  than the model's belief, so a hand edit not yet absorbed still reads
  true. A write goes to that pad alone and is stored as the pad's
  deviation from the kit value (its pitch offset for `pitch`): the
  surface owns the arithmetic, the interface stays unit-free, and the
  next kit gesture carries the pad at its new distance. Pitch adds the
  held sequencer shift on write and subtracts it on read, as `vm.pitch`
  does. A section switch on the pad follows the pad's own amount. On a
  still macro-mapped pipeline kit the write is dropped with a warning.

A subscribed pad row is re-emitted when a hand edit in Live moves that
pad, when a kit move is adopted (every pad moved), and on every re-seed.
Pad rows ride the same per-pass coalescing and gesture undo step as the
kit rows.

### What is deliberately not here

Selection state. "Which pads are held" lives in the interface: the
surface holds no scope, so two clients (Mac and iPad) cannot fight over
one, and a multi-pad drag is simply N pad writes per tick, bounded by
the touch count and coalesced per row per pass. No bulk row either; if
traffic ever argues for one it is an addition, not a change.

### Validation
- Surface: `uv run --with pytest --with ruff python -m pytest -q` —
  **2,337 passed, 4 skipped** (26 new: parsing, the census pad list with
  names / classes / effect-only chains / note order / the size cap both
  sides, the selected pad read / write / listener re-emit / rejects /
  detach, pad rows reading the pad's own value in every kind and nil
  where there is none, a write moving one pad and leaving the kit value
  and the wire alone, the clamp echoed, the next kit gesture carrying
  the pad, the switch following the pad's amount, per-pad fxType, per-pad
  pitch as an offset under and over a held shift, dropped on a mapped
  kit and on a member-less pad, a rack-macro kit's pad macro and its
  transpose, coalescing, the undo step, re-emits on hand edit / kit move
  / re-seed, state lifetime, and the channel lane both ways). `ruff
  check` adds no new rule category over HEAD on any changed file.
- Interface: `npm run build`, `npm run test:run` (2,052 passed) — nothing
  changed; the census parser ignores the new key.
- Rig (Live 12.4.15b1, full restart at 09:06, 2026-09-08; the 16-pad
  Simpler kit then on `tracks/1/devices/0`, its pads renamed by the user
  to a "Gen Purpose Kit" since the morning). Through the bridge
  WebSocket as the interface's do, read back through the LOM probe:
  - **`pads`**: 16 entries in note order with Live's own names, capped
    at 24 — `{36, "Kick Tight Gen Purpose K", OriginalSimpler}`, `{37,
    "Side Stick Gen Purpose K"}`, `{38, "Snare Gen Purpose Kit #1"}`, …
  - **The anchor rule, visible on the wire**: `vm.decay` cold-read
    **0.651** (pad 36) while `vm.pad.37.decay` cold-read that pad's own
    **0.518**.
  - **`vm.selectedPad`**: cold-read 36; a set of 40 was echoed twice, 40
    and 40 — the channel's echo and then Live's own listener — and the
    LOM read `view.selected_drum_pad.note` = 40.
  - **`vm.pad.37.decay` → 0.7**: the pad row echoed 0.7, **`vm.decay`
    stayed silent**, and the LOM read pad 37 at 0.7 with pads 36 and 38
    exactly where they were (0.651, 0.730). No component WARN or ERROR
    in Log.txt across the pass.
  - **The restore did not run**: between the writes and the read-back
    the user replaced track 1's instrument with a four-chain Sampler
    rack ("Evo Rack 1"), so `tracks/1/devices/0` answered "Only drum
    racks can have pads!" and the edited kit had left the set — nothing
    of the pass remained to put back, and nothing was written. A
    reminder that paths are positions (ADR-350) and a rig pass should
    read, write and restore inside one quiet window.

## Addendum (2026-09-08): the pad grid — hold to scope the controls to a pad

The interface half of the per-pad rows above. Built the same day, layout
per the user: the grid on the left of **every** Drum Rack profile and the
existing controls squeezed to make room, the layout itself refined later.

### What it does

`DrumPadGrid.svelte` sits beside the controls in `DrumRackCentralView`:
Live's own pad view — four columns, rows of four consecutive notes
stacked bottom-up, the lowest note bottom-left, sixteen pads to a page,
paged for kits over sixteen (the page follows Live's selection, and two
arrows move it by hand). Tiles draw from the census's `pads` (names cut
to the first word, plus a short number or letter that tells two snares
apart); Live's selected pad wears a frame of the track's ink, a held pad
is a solid block of it.

**Nothing held: the controls move the kit, exactly as before.** Touch a
tile and three things happen at once: the pad is selected in Live
(`vm.selectedPad`), the view scopes to the held pads (`data-vm-scope`),
and the controls read that pad's own values (`vm.pad.<note>.<fn>`, kit
value until the row lands). A drag then writes the pad's row — the kit
row is never written while a pad is held — and lifting returns the
controls to the kit, values and all. A tap and a hold are one gesture at
two lengths; there is no mode to leave.

**Several pads held:** the control shows the last one pressed (which is
Live's selection) and a drag moves every held pad by the same delta from
its own value, so their differences survive — the kit's rule, applied to
a hand-picked few; hold pads one at a time to make them converge. An FX
type has no delta and lands on every held pad as is. A held pad with no
member for a function (FX on a Simpler pad of a mixed kit — the row
reads nil) ghosts that control for as long as it is held. Each finger is
its own pointer, captured on its tile, so pads release independently and
the last one down stays the scope.

Selection state lives in the view (`holds`: pointer id → note, in press
order), never on the surface — two clients cannot fight over it — and a
per-gesture memory of what we last wrote each held pad (`padLocal`) is
what the multi-pad delta is measured against, rather than an echo that
has not landed yet. Pad rows are subscribed for Live's selected pad (so
a hold has its values the instant the finger lands) and every held pad,
for the functions the current profile draws (`profileFunctions`).

### Squeeze

The grid takes a fixed 200 CSS px column; the four control columns each
give up about a quarter. Legible on the shot; the narrowed FX-type
button clips "Stretch" to "Stretcl", which is the layout pass's to fix.

### Validation
- Interface: `npm run test:run` — **2,070 passed** (18 new: the census
  pad list parsing, row naming, delta / absolute / clamp per kind, the
  functions per profile, Live's layout and paging and row-alignment, tile
  labels; and, rendered: sixteen tiles in display order with names and
  the selection lit, the grid on every profile with a 32-pad kit paged
  to the selected pad, a press selecting in Live and scoping and
  subscribing the pad's rows and a release undoing all of it, the
  control showing the pad's own value once its row lands and a drag
  writing the pad's row and never the kit's, two held pads moving by
  one delta with the last pressed as the number, a member-less pad
  ghosting its control and refusing the write, an FX-type tap landing on
  the held pad alone). `npm run build` clean. Five existing assertions
  that counted `button`s now count them inside `.vm-controls` — the
  sixteen tiles are buttons too — and the subscription list gained
  `vm.selectedPad`.
- Harness: the four fixture kits list their pads (`kitPads` in
  `scene.mjs`); pad 38 answers per kit, so `npm run shot -- default
  --click '[data-track-index="0"]' --click '.device-control:has([role=
  "slider"][aria-label^="Pitch"])' --hold '.pad-tile[data-note="38"]'`
  photographs the controls re-adjusting to a held pad
  (`screenshots/drum-padgrid-kit.png`, `drum-padgrid-hold38.png`).
- Rig, through the real interface (`npm run dev` at localhost:3000
  against the live bridge and surface, ` 606 + 808` — 24 DrumCell pads,
  unmapped, pitch live — on `tracks/2/devices/0`, 2026-09-08 09:32):
  the grid drew the kit's sixteen first pads with Live's names (the
  label rule had to learn to skip a leading kit code — every tile read
  "606" until it did); a hold on tile 38 transmitted
  `vm.selectedPad = 38` and Live's `view.selected_drum_pad` followed; a
  real-pointer drag on Trnsp while held transmitted
  **`vm.pad.38.pitch = 48` and nothing for `vm.pitch`** (the interface's
  own `property/set TX` log); the LOM read **pad 38 Transpose 48.0 with
  pads 36, 37 and 39 at 0.0**; on release the scope cleared and the
  slider snapped back to the kit's 0. Restored through the same row
  (`vm.pad.38.pitch = 0`; Live read 0.0 on every pad, the surface held
  no offset) and the selection put back to 36.
  A harness lesson recorded for the next session: JS-dispatched pointer
  events can hold a grid tile (its `setPointerCapture` is guarded) but
  cannot drag a `DeviceSlider` — its unguarded `setPointerCapture` throws
  `NotFoundError` for a pointer id the browser never saw, before
  `onInteraction` runs, so the slider moves locally and sends nothing.
  A synthetic hold plus a real pointer drag is the valid combination;
  the first two "the pad write was dropped" readings were that artifact.

## Addendum (2026-09-08, later): the grid follows the playing clip, and flashes

Two refinements asked the same afternoon: show only the pads the current
clip uses, and light a pad as it is triggered.

**Only the clip's pads.** A drum clip's notes are the pads it uses, and
the interface already holds the playing clip's notes — the cheap blob
`clipNotesService.requestNotes(clipPath)` that draws the strip's note
preview. While the track's clip plays (`playingClipsStore.get(trackPath)`
with `status > 0`), the grid shows just those pads (`clipPadNotes`),
**compacted into bigger tiles ordered by note** — a five-pad clip gets
five large tiles, which is what a finger wants — in the squarest grid
that never passes four columns (`compactPadColumns`: 1 → 1, ≤4 → 2, ≤9 →
3, else 4). Compacting was chosen over blanking the unused slots of
Live's 4×4: once the layout is not Live's there is no muscle memory to
keep, and the space is better spent on target size. Sixteen or more
pads, or nothing playing, is Live's paged view as before. A note the kit
has no pad for draws as an empty tile — the clip plays something the kit
cannot, which is worth seeing. The notes re-fetch on `notes/changed`
(the strip's own idiom, cancelled flag included).

**The flash.** The playhead arrives at 30 Hz (`playingClipsStore.position`)
and the notes carry their start beats, so `notesCrossed(notes, prev, pos,
loopStart, loopEnd)` names the pads the playhead crossed since the last
tick — following the loop round (a backward move is the wrap: the tail
to the loop end, then the start to `pos`) — and each lights for
`PAD_FLASH_MS` (130 ms, four ticks; a later trigger of the same pad
extends it by token). Two edges measured against how Live plays: a note
ON the loop start plays and counts; a note ON the loop end never plays
and is excluded everywhere. A step longer than a beat
(`MAX_PLAYHEAD_STEP_BEATS`) — a scene relaunch, a seek — counts nothing;
flashing every pad on a relaunch would be noise. The 30 Hz effect reads
only the position (`untrack` around the rest), so nothing else re-ticks
it.

**What it is not.** Live's LOM exposes no per-pad trigger event and the
surface never sees the track's MIDI input, so a pad played live on a
keyboard or the Move does not flash. This is the clip's own timeline,
and it says so in the code.

### Validation
- Interface: `npm run test:run` — service: the distinct pitches, the
  compact column rule and slots, `notesCrossed` forward / wrapped / the
  two loop edges / the step cap / a window inside the clip; view: the
  grid compacting to the playing clip's three pads in note order with a
  hold still working on a compact tile and the paged view back when the
  clip stops, the sixteen-pad fallback, and the flash — baseline tick
  lights nothing, the hat at 0.5 lights on 0.4 → 0.6, the snare joins on
  → 1.05, both go dark after `PAD_FLASH_MS`, the kick lights on the wrap
  3.9 → 0.1, a 2.9-beat jump lights nothing. `npm run build` clean.
- Harness: the Drums fixture's "Kick 4/4" is `SLOT.playing` and the mock
  answers `clip/notes/get`, so the default Drums shot shows the compact
  grid (`screenshots/drum-padgrid-clip.png`). The mock emits no playhead
  motion, so the flash is unit-tested and heard, not photographed.

## Addendum (2026-09-08, afternoon): the layout pass begins — Trnsp steps aside, pads wear their colours

The user's decisions, working through the squeeze's rough edges on
DrumCell kits first:

**The kit value stays the lowest pad's** (the anchor question, closed):
it only matters while nothing is held — a held pad shows itself.

**The central Trnsp goes** — the FX grid's top-left Pitch slider is the
same knob — **on one condition the user set: it must still obey the
hold.** So the holds moved out of the view into `drumPadScope`
(`stores/v6/`), with the scoped-write rule, and `InstrumentControl`'s
`drum-pitch` path reads the scope: while a pad is held the slider
subscribes that pad's `vm.pad.<note>.pitch`, shows it, ghosts when the
row reads nil, and a drag writes the held pads and never the kit. The
central view draws Trnsp only while the FX grid section is switched off
(`uiPrefsStore.showFxGrid`), so the kit is never without a pitch control.
Start now has column four to itself, which is the next reflow.

**Pads wear their chain colours.** Measured first: Live exposes
`drum_pads[n].chains[0].color` as an RGB int (the Croydon kit's kick
8754719 = `#85961f`, its snare `#ffffff`). The census's `pads` entries
carry it as `color` (`null` when unread), the interface parses it into
`VmPad.color`, and a tile is **filled** with it the way the rack's pads
are in Live — the user's correction to a first cut that had used the
colour as label ink — with the label in whichever of dark or light text
the fill leaves readable (`padTextCss`: YIQ ≥ 128 takes dark text; the
olive kick and the amber toms do, a deep blue would not). At rest the
fill sits a little dimmed; Live's selection brings it to full behind a
2px frame in the text colour, a held pad brightens under a 3px frame, a
triggered pad flashes brighter still. A pad Live left uncoloured keeps
the well and the track ink. Names are still dropped past the census size
cap; colours stay.

**Labels are a property of the kit, not of a name.** The user's next
kit named every chain "Chase", and sixteen tiles reading "Chase" said
nothing. `padTileLabels(pads)` now decides the whole grid at once: the
leading words every pad shares are dropped ("Chase Kick" → Kick, "Acuff
Kit Snare" → Snare), a leading kit code is skipped ("606 Kick" → Kick),
labels that still collide take one more word at a time while it fits
("Hat Cl" / "Hat Ped" / "Hat Op"; "Tom Hi" / "Tom Hi 2"), and a pad whose
name is nothing but the shared words shows **no label** — its colour and
position say which pad it is. Note names (C1, D♯1 — how Live itself
tells identical chains apart) were built as the fallback and as a second
line under a duplicated voice, and then hidden at the user's request
("let's hide the note name for now"); `noteName` and the `.pad-sub`
slot stay for when they return.

**The FX type is a round button; the row got real tracks.** The 3×3
FX-type grid — the column that clipped "Stretch" — is replaced by one
round button at the bottom-left of the FX pad naming the current type;
a tap opens a picker over the view (the launch-quantization picker's
idiom: absolute inside this view's own box, so it dims this section
only), the nine effects in a 3×3 at a comfortable size, closed by a
choice, the scrim or Escape. The choice goes through `setVm`, so with a
pad held it is that pad's type. The pad's title is plainly "FX" now —
the button carries the name. With Trnsp and the type grid both gone,
the row's equal columns had left Start a column wide ("make that start
slider narrower"): the row is a flex row with real tracks — the FX and
Time pads share the width, each slider slot is a fixed width — so a
slider never grows to fill a vacated column again; 72px at first, then
56px at the user's second ask.

**The page arrows reach the touch floor.** On a two-page kit the arrows
were the only way to the second page and were 20px tall — unhittable on
the iPad, and invisibly so, since `app.css` applies its 44px floor only
below the 1024px breakpoint. The pager is now a row at
`var(--height-touch, 44px)`: two half-width buttons, ▼ then ▲, the page
count between them, disabled at either end.

**Sampler kits lose Decay and Sustain** (the Abbey Road kits — `50s
Autumn` — where the amp envelope's middle is not what a performer
reaches for): `SamplerControlsRow` takes a `hidden` list and the kit
view passes `['decay', 'sustain']`; the single-Sampler view, which draws
the same row from its own parameters, keeps all four sliders.

**The Sampler Time pad is Attack across, Release up** — flipped from the
2026-09-07 cut (Release across, Attack up) at the user's call, for the
kit row and the single-Sampler view alike, which also matches the
Simpler row's Time pad. The Sampler-row section above records the
original axes as built; this line records the flip.

### Validation
- Interface: `npm run test:run` — the scope store (press order per
  device, the last pressed as scope, a second finger on one pad, delta /
  absolute / clamp per kind, the gesture memory cleared on the last
  lift, nil rows), the FX-grid slider under a hold (kit value with
  nothing held; the pad's row subscribed, shown once it lands, written
  alone on a drag, +24 landing at 36; the kit's again on release; a nil
  row ghosting and refusing), the Trnsp gate both ways (four slots with
  the grid on, five with it off), and a coloured pad wearing its colour
  as `--pad-ink` while an uncoloured one inherits. `npm run build` clean.
- Surface: `pytest` — the pad list carrying the chain colour, a
  non-numeric colour reading null, colours kept past the size cap; no
  new `ruff` category.
- Rig, through the real interface: with pad 38 held on the Croydon kit,
  a real drag on the FX-grid Pitch slider transmitted
  **`vm.pad.38.pitch = 19` and nothing for `vm.pitch`**, the slider
  snapped back to the kit's 0 on release, the central Trnsp was absent
  with the grid on; the pad restored to 0. The colours reach the tiles
  once the surface is restarted with the census change — the interface
  falls back to the track ink until then.
- A test of mine was wrong twice before the component was: applying a
  value on top of the store's optimistic write is treated as a stale
  echo (`reconcileEcho` → `suppress`), so a test must do its kit drag
  last. Recorded here so the next author does not re-learn it.

## Addendum (2026-09-09): the selected pad is always on the grid

The compact grid drew the clip's pitches and nothing else, so **Live's
selected pad vanished whenever the clip did not happen to play it** —
the one tile whose frame says what the controls are pointed at, gone,
with nothing on screen to say why the values read as they do. Held pads
were the same hazard arriving a moment later: a finger on a tile, a
different clip launches, and the pad still scoping every control is no
longer drawn.

`compactPadNotes(clipNotes, keep)` is the fix, and the shape of it is
the point: the kept notes are **added to the clip's set, never the basis
for it**. An empty `clipNotes` returns empty and the caller stays on
Live's paged view — a selection is not a reason to compact a grid — and
a kept note the kit has no pad for still draws, as the empty tile it is,
which is what explains a ghosted control rather than hiding it. When the
extra pads push the count to sixteen the grid falls back to the paged
view, which already pages to the selection, so the pad is on screen
either way.

### Validation
- Interface: `npm run test:run` — **2,109 passed**. The helper (added in
  note order, already-present notes not duplicated, `null` dropped, and
  an empty or absent clip returning empty however much is kept), and
  rendered: a selection the clip never plays drawn as a fourth tile and
  framed, the grid swapping which extra tile it carries when Live's
  selection moves, and a held pad surviving a clip start under the
  finger — that last one with the selection moved off the held pad
  first, so the hold rule is what the assertion actually tests.
- Harness: the synthetic Drums clip plays 36 · 50 · 54 · 56 · 57 · 59 ·
  62 · 63, and its kit is selected on 36 — so the default capture is
  itself the before/after: without this the grid drew seven tiles and no
  framed pad.
- A stale recipe found on the way and fixed in `scripts/shot/README.md`:
  `--hold '.pad-tile[data-note="38"]'` on the **Drums** track times out,
  and has since the playing-clip compaction landed — that track's clip
  is playing, so its grid never draws a tile 38. It works on tracks 8
  and 9, whose clips are not.

## Addendum (2026-09-08, later still): the grid is switchable, and a Gain slider

Two follow-ons to the pad grid, both at the user's request.

**PADS.** The grid is a switch — a seventh row in `SystemCentralView`'s
Sections card, between VIEW and FX, where the thing it controls sits on
the screen (`uiPrefsStore.showDrumPads`, default on, persisted per
browser like the rest of that card). Off, the column's fixed 200 px go
back to the controls and the Drum Rack view is what it was before the
grid landed: full-width controls moving the whole kit. It is the one row
in that card that is not a whole section, so it deliberately does not
reach `visibleSectionCount`. Because hold-to-scope is the grid's only
door, per-pad editing goes with it everywhere — the FX-grid Pitch slider
included — and the view clears `drumPadScope` on the off edge so a hold
cannot outlive the pads that made it. Seven switches made that card four
rows of two rather than three; the measurements are in
`SystemCentralView`'s own CSS comment.

**Gain.** One more fixed function, `vm.gain` — see its row in the
bindings table above and the paragraph under it. In the view it is a
slider at the end of the row, outside the profile switch, so it is in
the same place on every kit shape, at the same 56 px the full row's
Start and Trnsp use; not drawn on a macro-grid kit.

**Two things above are now stale, and this records it rather than
rewriting them.** The hold state left the view for
`stores/v6/drumPadScope.svelte.ts` (the FX-grid Pitch slider lives in a
different component tree and obeys the same hold), so the pad-grid
addendum's "Selection state lives in the view (`holds`)" means that
store now. And its "Squeeze" note — the FX-type button clipping
"Stretch" — was fixed by the layout pass that made the type a round
button with a picker.

### Validation
- Interface: `npm run test:run` — **2,106 passed**. New: the `gain`
  slot's place on every profile and its absence on a macro-grid kit, a
  drag writing `vm.gain` as `t`, a member-less kit ghosting it and
  writing nothing, a fully-held kit read-only with the badge, and a held
  pad taking the drag onto its own row; plus the PADS switch dropping
  the grid, leaving the controls, and letting go of a standing hold.
- Surface: `pytest` — **2,342 passed**. New: `gain` binding `Volume` on
  each bound class with its own measured range, a write landing in each
  member's units, the balance a mixed kit keeps, and a nested-rack kit's
  gain being the pads' chain volumes and never a macro.
- Ranges measured on the running rig before binding, not read off a doc:
  DrumCell `Volume` index 18 `0..1` on `Octagonal House`, Sampler
  `Volume` index 15 `−36..36` on `Bright Room`, chain volume
  `Chain Volume` `0..1` at 0.85 on the same kit. The Simpler's `−36..36`
  comes from the Acuff-kit measurement already recorded in the surface
  test fixtures. The bindings are by **name**; the indices are
  corroboration, not contract.
- Rig: confirmed working by the user after a full Live restart (the
  surface only picks up a new function once its bytecode cache is
  rebuilt).

## Addendum (2026-09-09, later): the grid is the pads in play, stacked

The user, after living with it a day: the sixteen-tile paged grid is
"too small and cluttered" — most of what it draws is pads nothing is
doing anything with. So the grid is now **only the pads in play**: the
playing clip's, Live's selected pad, and any pad a finger is holding.
Which in practice is a handful, so the tiles get bigger and the column
gets narrower.

**Stack first, widen second** (the user's rule). Up to four pads go down
one column in pitch order; a fifth starts a second column rather than
rebalancing the first, so five reads 4 + 1 and nine reads 4 + 4 + 1 — a
column that keeps its length as pads arrive is a column a finger can
keep its place in. Past three columns the width would start eating the
controls, so beyond twelve the rows grow instead; that case should hardly
ever happen.

**Each column stacks bottom-up**, lowest note at the foot, pitch climbing
as the eye does — the way a rack reads. The first cut had them the other
way up (ascending downward, carried over from the compact grid's reading
order) and the user caught it straight away.

That is `padGridCell` placing every tile explicitly rather than
`grid-auto-flow: column`, and the reason is the partial column: an auto
flow fills each column from row 1 down, so a lone fifth pad lands at the
TOP of the second column, out of line with the lowest note beside it.
Explicit placement puts every column's first note on the bottom row.
DOM order stays ascending — it is the reading order a screen reader gets,
and what the tests assert — with only the grid placement reversed.

The column is now exactly as wide as its columns need — 68px, 140px,
212px against the old fixed 200px — and the controls beside it take
whatever is left. That is the point of stacking before widening. The rows
are uncapped `1fr`, so the tiles fill whatever height the central section
gives them and a single pad is one full-height tile (user's call).

### What this costs, deliberately

**Reaching an arbitrary pad from the interface.** The paging went with
the full grid, so a pad the clip does not play and Live has not selected
is not drawn, and cannot be tapped or held. Per-pad editing is therefore
a while-something-is-playing gesture, plus whatever Live has selected;
the way to any other pad is Live's own rack or the Move, and the grid
follows the selection there. With nothing playing the grid is a single
tile — what the controls are pointed at, and nothing else.

That is the trade the user asked for, and it fits the way the interface
is played: the pads worth reaching for mid-set are the ones the clip is
already using.

### Validation
- Interface: `npm run test:run`. The shape rule (1–4 one column, five
  starting a second, nine as 4 + 4 + 1, sixteen falling back to three
  columns and six rows, zero as no grid at all), the bottom-up placement
  (the first note taking the last row, a lone fifth pad at the foot of
  its column rather than the top) asserted both as the pure function and
  on the rendered tiles' `grid-column` / `grid-row`, the note set (clip,
  selection and holds as equals now — with nothing playing the grid is
  the selection alone), and the slot pairing that still draws a note the
  kit has no pad for as an empty tile.
- The rendered pad-grid suite had to be rebuilt around this: nearly
  every test in it pressed a tile that the old grid drew unconditionally
  and the new one does not. They now render with a clip playing
  (`mounted()`), which is the shape of the feature — with nothing
  playing there is one tile and nothing else to hold.
- Deleted with the paging: `padPages`, `padPageIndex`, `PAD_PAGE_SIZE`,
  `PAD_GRID_COLUMNS`, the `.pad-pager` row and its two arrows.
  `compactPad*` became `padGrid*`, since the compact layout is now the
  only layout.

## Addendum (2026-09-09): the controls wear the held pad's colour

While a pad is scoped the controls *are* that pad's, so they now take its
chain colour — Live's own colour for it, the one its tile is filled with
— instead of the track ink. Nothing held, or a pad Live left uncoloured,
and they are the track's again.

Through `trackInk`, not raw. A chain colour is any of Live's seventy and
some of them are far too dark to draw a slider's line with; that is the
same envelope the track's own colour goes through (L 0.66–0.80,
C 0.11–0.19), so a pad's ink is exactly as legible as a track's and reads
as the same family of colour. The tile keeps the raw fill, since a fill
with contrasting text has no such problem.

**Three things deliberately do not follow the hold**, and the rule behind
all three is the same: colour follows scope.

- The **pad grid** keeps the track ink. Its `--pad-ink` paints the pads
  Live left uncoloured, so handing it the held pad's colour would make
  every one of those look like it shared it.
- The **Drum Buss rail** — Comp, Boom, Drum, and Squash — is a
  `CentralDisplay` sibling with its own drum-family ink and was already
  unaffected. That is correct rather than lucky: those are track-level
  devices, not per-pad, and a hold does not scope them (the user raised
  this while it was being built; nothing had to change).
- The **macro grid** on a plugin-hosted kit, for the same reason —
  `profileFunctions('macro-grid')` is empty, so a hold scopes nothing
  there.

### Validation
- Interface: `npm run test:run` — the controls' `--slider-tint` changing
  on a hold of a coloured pad and returning on release, and NOT changing
  on a hold of an uncoloured one.
- Harness: `npm run shot -- default --click '[data-track-index="0"]'
  --click '.device-control:has([role="slider"][aria-label^="Pitch"])'
  --hold '.pad-tile[data-note="50"]'` — the Ride pad is purple in the
  fixture kit, and FX / Time / Start / Gain / the FX-type button all take
  it while Comp, Squash, Boom and Drum stay their own.

## Addendum (2026-09-09): a tap latches the pad, a hold stays momentary

Hold-to-scope asked the performer to keep a finger on the glass for as
long as they wanted a pad's controls, which is fine for a nudge and
useless for actually working on one. So the press now means two things,
and which one is decided the way Solo and mute already decide it:

- a **tap** (clean release under 300 ms) latches the pad — the controls
  stay its with nothing on the glass. Tapping it again lets go; tapping
  another moves the latch. One latch per device, so this never becomes a
  way to collect pads.
- a **hold** is exactly what it was, and its release puts back whatever
  was latched before the press.

**The rule is `TrackStrip/utils/momentaryPress.ts`, not a copy of it.**
`shouldRestoreOnRelease` and `MOMENTARY_HOLD_MS` are already the answer
to "did that press mean tap or hold" for the two state toggles a
performer holds; a third control with its own 300 would be a number to
keep in agreement by hand, and a hand cannot learn two thresholds anyway.
The pad case maps onto it exactly once "the captured pre-press state" is
read as "whatever was latched before this press".

**A latched pad is a held pad in every respect** — it is in
`heldNotes`, takes the multi-pad delta, wears the held treatment, and
lends the controls its colour. The only difference is that nothing is
holding it there, which is why `pressedNotes` (finger-only) is what gates
clearing `padLocal`: that memory exists for the multi-pad delta, and a
lone latched pad is written absolutely.

**Only a clean release latches.** A `pointercancel`, or the grid
unmounting under the finger, restores instead — the same reasoning
`momentaryPress`'s own docstring gives for Solo, and worth more here:
a latch nobody asked for is a scope with no finger on it and no obvious
gesture to clear it. `DrumPadGrid` therefore reports the reason rather
than calling one `release()` for every ending. `lostpointercapture`
fires after `pointerup` on a normal release, so the tap wins and the
capture-release that follows finds the hold already gone.

`retainLatched` drops a latch the kit can no longer answer for: a rack
hot-swapped in place keeps its device path, so the note would otherwise
stay scoped over a kit with no such pad — an empty tile, every control
ghosted, and nothing saying why.

### Validation
- Interface: `npm run test:run` — the store (tap latches and toggles off,
  a hold restores the previous latch, tapping another pad moves it, a
  cancelled press never latches and never disturbs a standing one,
  latches are per device, `clear()` and `retainLatched` drop them) and
  rendered (a tap leaving the pad `.pad-held` with no finger, a drag
  writing the latched pad's row, a hold over a latched pad scoping the
  finger's pad and returning to the latch).
- The existing hold tests needed a clock: a synthetic press and release
  land in the same millisecond, which is now a TAP. `mockClock()` /
  `holdPast()` make the intent explicit at every call site, and the four
  that broke were the new rule working, not a regression.

## Addendum (2026-09-09): the filter as one XY pad

Cutoff across, resonance up — `filterFreq` and `filterRes`, paired into
a pad the way FX and Time already are, and sitting outside the profile
switch beside Gain so it is in the same place whatever the kit is.

**Two things the request got right and one it did not, all measured
before anything was bound.** The indices named — Simpler 31 / 36 / 37,
DrumCell 7 / 8 / 9 — are exactly where the rig has them (`FAT Kit` and
`Octagonal House`). The ranges were given as 0..1, and a Simpler's
`Filter Res` actually tops out at **1.25**. That costs nothing, because
the fan-out spans each member's own `min..max` — but it is the second
time in two days that a stated range was not the LOM's, which is the
argument for the table binding names and reading ranges at resolve time
rather than writing either down.

`F On` is measured on a MultiSampler (index 37 of the 55-parameter
variant); the two names beside it in the Sampler row are Simpler's,
which the Sampler matches on every other bound parameter. That is the
table's one inference, and its failure mode is visible: no member
resolves, the pad ghosts, and nothing moves the wrong parameter.

**The switch never follows the floor** (`switch_off_at_floor=False`, as
on `pitchEnvAmount` and unlike `oscAmount`). Cutoff at the bottom with
the filter ON is closed and silent; letting the floor switch the filter
OFF would open it wide instead, so the bottom of the sweep would jump
from silence to full. A write turns the filter on and never off.

The pad is drawn on every profile but the macro grid, ghosting where a
kit binds nothing — a nested-rack kit's filters are inside the racks,
and an Operator kit has no binding at all. It is capped at 220px so it
cannot crowd the three pads a Sampler row already draws.

### Validation
- Surface: `pytest` — the bindings per class with the switch as the
  amount's first member, resonance landing at each member's own maximum
  (1.0 on a DrumCell, 1.25 on a Simpler, from one `t`), the switch turning
  on and never off across a sweep to the floor, and no legacy macro on a
  still-mapped family kit.
- Interface: `npm run test:run` — the pad on every kit shape and absent on
  a plugin kit, a drag writing both axes as `t`, a nested-rack kit
  ghosting it, and a fully macro-held filter read-only with the badge.
- Rig: names read off `FAT Kit` (Simpler) this session and
  `Octagonal House` (DrumCell) the previous one. **The Sampler pair is
  not yet confirmed on a running Sampler** — no Sampler kit was loaded.

## Addendum — a rail squeezes the deviation out (2026-09-15)

The original rule was that a pad the clamp pins at a rail **keeps** its
deviation, so the kit's shape comes back when the kit value lifts off the
rail. Reversed today, by the user's call, after the behaviour was met on
the rig.

**What happened.** `Cait Slow 01.adg` — a 32-chain Drum Rack, one DrumCell
per chain, macros unmapped — loaded with 28 of its cells sitting 0.685
*below* the kit value on `decay` and 0.669 *above* it on `attack` (frozen
deviations; the cells held 40/127 and 85/127, the values of the rack's own
Macro 10 and Macro 9, the legacy Time-XY slots, while the held kit values
were 1 and 0). The census read healthy throughout — 32 members per
function, `held: 0`, no macro mappings, every parameter `is_enabled` — so
the fan-out was faithfully writing `1.0 + (−0.685)` and the four pads with
no deviation were the only ones that followed the Time XY. The user's
question was the design one: sweeping the control end to end ought to
force every pad together, and it did not.

It could not, for two separate reasons. **At the top rail a pad below the
kit value is never clamped at all** — its own ceiling is `1 + dev`, which
is where it stopped. And at the bottom rail, where those pads *do* clamp
together at 0, the old rule preserved the deviation, so the spread came
straight back on the way up and the pad also stood still at the rail
through the first 0.685 of the control's travel.

**The rule now.** A deviation is always *where this pad sits, relative to
the kit value*, which is already how the per-pad write records one
(`_apply_pad`: `dev = value − held`). So the kit fan-out re-anchors it
when the clamp bites: `dev = clamp(kit + dev) − kit`, in `_write_members`,
at the one line the clamp was already on. Consequences:

- Squeeze the control against an end and the pads pinned there come away
  **level** with it; a partial push shrinks each deviation by exactly what
  the clamp hid.
- A pinned pad moves **at once** when the control leaves the rail, instead
  of waiting for the kit value to come back under its old distance.
- **Only the direction squeezed is flattened.** A pad below the kit is
  reached by the bottom rail, one above it by the top; a kit deviating both
  ways needs both ends. This is the honest reading of the Cait case.
- The shape is no longer indestructible: passing through a rail during an
  ordinary gesture costs that much of it. That is the trade the user chose
  — the squeeze *is* the eraser — and a kit reload still restores the
  preset's own shape.
- **Pitch is deliberately excluded.** Its rails are ±48 semitones and its
  offsets are driven by the sequencer, which sweeps octaves through them by
  the bar: a Permute pushing a pad's Transpose against the rail would eat
  that pad's offset. `_apply_pitch` keeps the original rule.
- The read-back's rail rule is unchanged where it matters: a rail-pinned
  member still cannot vote on a kit move, because the clamp still hides
  travel. It simply no longer has a deviation to keep under one.

### Validation
- Surface: `uv run --with pytest python -m pytest -q` — **2,560 passed, 4
  skipped**; the file's own 198. `test_a_pad_at_the_rail_keeps_its_deviation_for_the_way_back`
  became `…_re_anchors_its_deviation` (it asserted the old rule), and three
  cases were added: the partial squeeze shrinking a deviation by what the
  clamp hid, a sweep to the rail flattening the kit, and only the direction
  squeezed being flattened (the Cait numbers). `ruff` on the two changed
  files adds no rule category (155 vs 154 findings, the extra being the
  module's own CamelCase filename).
- Rig (2026-09-15 19:0x, after a full Live restart onto the new surface;
  Live 12.4.15b2, kit `Memphis Studio + Plymouth`, 32 DrumCell pads, held
  `vm.decay` 1.0 with every cell at 1.0). Every write through the bridge
  WebSocket, exactly as the control sends them; every read back through the
  surface's own LOM probe, and the kit restored to the value this run
  measured:

| Step | Read back |
|---|---|
| Pad 37 (`Rim 3k Sharp`) deviated to 0.7 through `vm.pad.37.decay` | 1.0 × 31, **0.7 × 1** |
| Kit Decay swept to 0.0 | 0.0 × 32 — the deviated pad clamps with the rest |
| Kit Decay back to 0.05 | **0.05 × 32, the deviated pad included** — under the old rule it would have stayed pinned at 0.0, 0.3 behind the kit |
| Kit Decay restored to 1.0 | 1.0 × 32, uniform, the kit as it was found |

  No warning, error or control-thread hiccup in Live's log across the run.
  Each gesture is its own undo step, as before.

## Addendum — a new kit in the same rack device is adopted, not inherited (2026-09-15)

Found an hour after the squeeze, on the rig, from the same complaint in a
new form: "I loaded a new rack and swept the Time XY but not all the pads
updated — I don't think they were offset."

They were offset, by the load. Watched live, with the census and every
cell under a probe while `prepare_for_preset` landed `African Breath 06`
on the rack's own track:

```
 927ms  before:  1.0000×4  0.3870×27  0.6500×1
 940ms  load sent
1342ms  cells:   0.3150×32        <- the new kit lands UNIFORM (40/127)
1377ms  prepare ack
1504ms  held vm.decay = 0.928     <- the control keeps the old position
```

A preset load in replace-instrument mode replaces a Drum Rack's **chains**
without replacing the **rack**, so `same_lom_handle` holds, the state is
kept, and `_seed(only_missing=True)` keeps both the held value and the
deviation records. The records are keyed by `(pad note, parameter name)`,
which collides across any two kits sharing a note range and a pad class:
`African Breath 06` inherited `Cait Slow 01`'s whole table, four
zero-deviation pads included, and the uniform new kit acquired a −0.613
deviation on all 32 pads at once. Every pad still followed the control (a
kit write moved all 32 by exactly −0.1) — they simply sat 0.613 under it,
so Y at max reached 0.387 and the top of the sweep looked dead.

**What a preset load changes, measured before the rule was written** —
and the first version of this rule was built on a guess that the rig then
killed. Loading one 32-pad kit over another through `prepare_for_preset`,
reading `_live_ptr` either side:

| | across the load |
|---|---|
| the rack device | same object |
| every `DrumChain` | same object |
| every `drum_pads[n]` | same object |
| every `DrumCell` | same object |
| every `DeviceParameter` | **same object** — 16 of 16 Decay parameters, identical raw pointers |
| the pad chains' `devices` listeners | **never fired** (`vm.padFx` did not re-emit) |
| the rack's `name` | **changed** (`African Breath 06` → `Cait Slow 01`) |
| every chain's and every cell's `name` | **changed** |

So **LOM identity cannot see a kit swap** — Live re-points the same
objects at new samples — and neither can `PadChainWatcher`, whose
per-chain `devices` listeners do not fire. A first attempt keyed on
parameter identity (`disjoint` member sets) was therefore inert on the
rig: it never fired once, while the bug reproduced exactly as before.
Names are the only observable difference.

**The rule: the rack's own name is the fingerprint.** `_RackState.kit_name`
holds the rack's `name` as of the last seed; a re-resolve that reads a
different one is a new kit in the same device, so the deviations (and
pitch's offsets, with the pad-shift terms that rode the old chains) are
dropped and the held value is re-seeded from the kit in front of it — the
user's call between adopting the new kit and imposing the control's old
position on it. The rack's name is the one a similar-sample swap leaves
alone (ADR-439 renames chains and instruments), so it is the signal with
the least noise. A pad added to the kit does not touch it, so its
neighbours keep their deviations.

Two limits, both deliberate: **loading the same preset again is
invisible** (nothing changes, so nothing is detected — the rail squeeze
above is the cure there), and **renaming the rack by hand reads as a new
kit** and re-seeds.

### Validation
- Surface: `uv run --with pytest python -m pytest -q` — **2,564 passed, 4
  skipped**, the file's own 202. Four cases: a preset load into the same
  rack adopting the new kit (its fake now matches the rig — same objects,
  new values, new names), a re-resolve under the same name keeping its
  deviations, a pad *added* to the kit leaving the other deviations alone,
  and a load dropping the pitch offsets too. `ruff` adds no rule category.
- Rig (2026-09-15 19:38–19:40, after a full Live restart onto this surface;
  every write through the bridge WebSocket, every read back through the
  surface's own probe). Two loads, each over a kit already on the track,
  the second sharing the first's note range exactly (64–95 — the case where
  every `(note, parameter)` key collides and the inheritance was total):

| Check | Result |
|---|---|
| Live's log, both loads | `is now 'Cait Slow 01', was 'Memphis Studio + Plymouth'` and `is now 'African Breath 06', was 'Cait Slow 01'` — `a preset loaded into the same rack; re-seeding from the new kit and dropping its per-pad records` |
| Pad deviated before the load (pad 66 → 0.12, dev −0.30) | gone with the kit |
| New kit's cells | `0.3150 × 32`, level |
| Held `vm.decay` after the load | **0.31496** — the new kit's own value, adopted (it read the previous kit's 1.0 before this change) |
| A kit write of 0.42 after the load | **0.4200 × 32** — nothing inherited, the deviated pad included |

  The first attempt (parameter identity) was run on the rig the same way and
  never fired once: its log line is absent and the split reproduced exactly.
  The two `control-thread hiccup` warnings in the window (3,660 ms and
  1,994 ms) are Live loading 32 vocal samples — the prepare ack took 3.5 s
  on those loads — not the surface.

## Tags
`drum-rack`, `virtual-macro`, `property-channel`, `fan-out`, `undo`,
`issue-489`, `pad-deviation`, `kit-swap`
