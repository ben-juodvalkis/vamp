# ADR-402: Instrument central views wear the track's ink

## Status
**Accepted** — extends ADR-400 §4 (`trackTint`) from the utility device to the
whole instrument layer; companion to ADR-399 (track role palette).

## Context

ADR-400 gave every device *and instrument* central view a function-family ink:
Simpler signalled its mode by hue (chartreuse in Classic, teal in Slice),
Operator/Drift/Wavetable/… carried `familyScheme('distortion')` etc. That's the
right model for an **insert effect** — a reverb tile in a fixed grid is module
identity, so it earns its own family hue, and ADR-400 deliberately made the
fx-grid tile, the CentralDisplay frame, and the view interior all agree.

But it reads wrong for the **instrument**. `CentralDisplay.zoneAccent` already
frames clip / permute / instrument views in the focused track's ink
(`selectedTrackInk()`, the no-device-color fallback) — so the *container*
around a Simpler already says "this is the rose drum track," while the
*interior* said "chartreuse, because Classic mode." Frame and guts disagreed,
and the mode hue spent the identity channel on state.

The distinction the codebase already encodes (ADR-400 §4): **is this thing the
track, or a module on the track?** The utility/gain device sets `trackTint:
true` and wears the track's color as "the track's own trim." An instrument is
even more the track — it *is* the track's voice, not an insert on it.

## Decision

### 1. `selectedTrackScheme()` — the instrument's body ink

A new helper in `utils/selectedTrackInk.ts` returns the focused track's
calibrated ink as a full `DeviceColorScheme` via `schemeFromInk()` (primary/
accent = the track ink, secondary = the standard 10 % wash — the same shape
ADR-400's `trackTint` chokepoints already emit), or `null` on cold start /
master.

Every `*CentralView` under `central/views/` registered as an **instrument**
(14 views) derives its body/theme ink from `selectedTrackScheme()`, falling
back to its former family scheme only when no track record exists yet:

```ts
let operatorInk = $derived(selectedTrackScheme() ?? { /* old familyScheme */ });
```

The whole instrument view now reads as the track it's on, and instrument tracks
already differ by role (ADR-399: bass azure, synth violet, …), so this produces
meaningful variety, not a monochrome set.

### 2. Simpler drops its mode hue entirely

`SimplerCentralView` no longer branches `simplerInk` on Classic/Slice
(`CLASSIC_COLOR`/`SLICE_COLOR`/`simplerColor` removed). Mode is read from the
toggle's label + active state, not from a colour shift. `SimplerLoopControl`
inherits the same track-ink twin, so brace / waveform / slice ticks tint in the
track's colour.

### 3. Clip view: rail follows the track, except REC + Delete

`ClipCentralView` adds a faint `color-mix(track-ink 8 %, transparent)` wash on
its interior background (the frame was already track-coloured), and the rail
controls take the track ink too — the CHANCE / TEMP / SHUFFLE / PITCH sliders,
the base-grid + warp mode switches, Dup Trk / to-Simpler, and the quant/monitor
action wells (transpose, loop-halve, Replace, Loop×2/Rev). A single
`--clip-track-tint` custom property (set on the root) flows to the wells via
`--fam-color` and to the switches via a `.clip-switch` class. The editor mirror
was already track-coloured.

**REC and Delete keep their red** (`--act-rec` / darkened `--act-master`): in a
looper, "recording" and "destructive" are state/danger signals that must stay
glanceable, so they are the one place track colour deliberately does *not*
reach.

### 4. Every instrument surface follows the track

The first cut kept some in-view sub-palettes (DrumRack's nine FX-mode hues,
Omnisphere's per-section pads, the pitch/mod wheels). A follow-up on the same
branch collapsed all of them: DrumRack's FX pads + mode buttons, Omnisphere's
six XY pads + ORB, and the pitch/mod wheels (`MidiWheel` / `MidiWheelsPanel`)
now take the track ink, distinguished by label + active state. An instrument
view is now *uniformly* its track's colour.

What is deliberately **not** recoloured:

- **Insert-FX device views** — unchanged; family ink, tile↔frame↔view still
  agree (no ADR-400 regression). An effect is a module *on* the track, not the
  track's voice.
- **REC + Delete** in the clip rail — state/danger red (see §3).

## Consequences

**Positive:**
- Frame, wash, waveform, and body chrome of an instrument or clip view all read
  as one track — context continuity from strip → central zone.
- The identity channel (track ink) and the state/function channel (`--act-*`,
  pitch/mod, mode toggle) stop competing for the same pixels.
- New instrument views inherit track colouring for free via
  `selectedTrackScheme()`; the family scheme survives as the cold-start
  fallback.

**Negative / accepted:**
- Instrument views collapse to a near-monochrome track wash — DrumRack's FX
  modes, Omnisphere's sections, Simpler's Classic/Slice, and the pitch/mod
  wheels no longer signal by hue; they rely on label + active state (owner-
  confirmed direction). The trade is context-legibility over intra-view hue
  variety.
- On-device performer sign-off (GRATICULE §2.5 gate) is the real acceptance
  test for the new weight; build + unit tests only prove it compiles and paints.

## Tags
`colors`, `design-system`, `graticule`, `central-view`, `instrument`, `track-coloring`
