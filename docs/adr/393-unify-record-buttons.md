# ADR-393: Unify the Two Record Buttons into One Shared Component

## Status

**Accepted** — 2026-07-07.

## Context

Two record buttons exist in the UI, both "hold-to-record → capture →
auto-load into Simpler":

- **Sidebar** — `controls/RecordButton.svelte`, at the top of the
  drill-down browser rail (always visible). Captures external audio.
- **Clip-view rail** — an inline `.rec-btn` `<button>` inside
  `central/views/ClipCentralView.svelte` ("REC TO SIMPLER").

They were **divergent copies**. Both drove the same `captureStore`
(`/capture/start` → `/capture/stop`, then the auto-trim-into-Simpler
flow on `/capture/file`), and both reimplemented the same
hold-300ms/tap-toggle logic, optimistic `armedRecording` latch, and
meter fill — but independently. The duplication had already caused
drift: the sidebar button used a separate 6px blinking LED next to a
hollow `○` glyph, while the clip button used an `is-active` background
tint plus `animate-pulse`. A UI change to one didn't reach the other,
and the two looked and behaved subtly differently.

ADR-180 deliberately gave the two buttons **different meter sources**
(sidebar = interface input; clip view = current track output) and that
distinction is still correct. The real backend differences between the
two are small and enumerable:

| Aspect | Sidebar | Clip-view rail |
|--------|---------|----------------|
| Track send arming | none | `/looping/v3/track/send [tracks/N, 0, 1.0/0.0]` on start/stop |
| Idle pre-prep | `prepareForPreset('midi','')` on pointerdown | none (uses the selected track) |
| Guard | always enabled | requires a valid `selectedTrackIndex` |
| Meter source (ADR-180) | capture meter | track output meter |

Everything else — the interaction model, the state machine, the
indicator — should be identical, and the fact that it wasn't is a
maintenance hazard, not a feature.

## Decision

**One shared component** (`controls/RecordButton.svelte`) owns all the
behavior and the visual; the two call sites parameterize the small
backend differences via props:

- `armTrackIndex?: number | null` — when set, the component also flips
  the track's send/routing knob (`/looping/v3/track/send`) on
  start/stop and no-ops when the index is negative/null. Sidebar omits
  it; clip view passes `session.selectedTrackIndex`.
- `prepareOnHold?: boolean` — pre-create/reuse a MIDI track on
  pointerdown so the captured sample has a landing track. Sidebar sets
  it; clip view relies on the already-selected track.
- `meterLevel?: number` — the meter fill source (ADR-180 preserved).
  Defaults to `captureStore.meterLevel` (sidebar); clip view passes its
  `trackMeterLevel`.

**Unified indicator:** the central dot *itself* is the record
indicator. Idle it's a hollow `○`; while recording it fills to `●` and
blinks (`rec-blink`, `animate-pulse` on the glyph). The separate LED is
gone — one glyph carries the whole state, so there is no spurious
"second dot."

**Unified shell (chosen over per-call-site styling):** both buttons
adopt the sidebar's record-wash look everywhere. The alternative —
keeping the clip button's `btn-well`/`fam-rec` family styling so it
matched its neighbor rail buttons — was rejected in favor of the two
record buttons being truly identical.

**Perfect-circle sizing in either orientation.** The button must stay a
circle whether its cell is wider than tall (sidebar) or taller than
wide (clip-view rail). `height: 100%` + `max-width: 100%` produces an
oval in a tall cell (height fills the cell, width clamps); the mirror
rule ovals the wide cell. The robust fix is a thin wrapper
(`.record-button-fit`) that fills the parent and is a
`container-type: size` container; the button sizes to
`min(100cqw, 100cqh)` — the *smaller* of the parent's two axes — and
centers. This is a self-contained "largest square that fits a
rectangle" solve that doesn't depend on how the surrounding layout is
built, so it holds at both call sites without per-site CSS.

## Consequences

### Positive

- One source of truth for record-button behavior and look. The two
  buttons can no longer drift; a change lands in both.
- ~90 lines of duplicated state/handlers/CSS removed from
  `ClipCentralView` (handlers, the `armedRecording` latch + effect, the
  `.rec-btn` CSS block, `recMeterHeight`/`METER_CLIP_THRESHOLD`/
  `isRecording`, and the now-unused `captureStore` import).
- The backend differences are now explicit props instead of two
  hand-maintained implementations.

### Negative / Trade-offs

- Supersedes the *structure* of ADR-180 (two components) while keeping
  its *decision* (two meter sources) — now expressed as the
  `meterLevel` prop rather than two component bodies.
- The clip-view button no longer matches the `btn-well` family styling
  of the delete/replace buttons beside it in that rail (accepted
  trade-off — chosen so the two record buttons are identical).
- The circle sizing relies on CSS container queries
  (`container-type: size` + `cqw/cqh`). Supported in current iPad
  Safari; noted here so a future contributor doesn't "simplify" it back
  to a `height: 100%` + `aspect-ratio` form that ovals in one
  orientation.

### Operational

- Per-file diff:
  - `interface/src/lib/components/v6/controls/RecordButton.svelte` —
    shared component: `armTrackIndex` / `prepareOnHold` / `meterLevel`
    props, track-send arming, unified dot indicator, wrapper-based
    circle sizing.
  - `interface/src/lib/components/v6/central/views/ClipCentralView.svelte`
    — inline `.rec-btn` + its handlers/state/CSS replaced by
    `<RecordButton armTrackIndex={session.selectedTrackIndex}
    meterLevel={trackMeterLevel} />`.
  - `interface/src/lib/components/v6/browser/DrillDownBrowser.v6.svelte`
    — `<RecordButton prepareOnHold />`.

## Tags

`record-button`, `capture`, `component-consolidation`, `ui`,
`container-queries`, `supersedes-180`
