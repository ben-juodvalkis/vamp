# ADR-352: Hot-Path GUI-Formatted Display Strings for Parameters

## Status

**Accepted** — 2026-04-26.

## Context

Live's `DeviceParameter` exposes its raw float `value` plus a separate
GUI-formatted string via Python's `__str__` (and equivalently
`str_for_value(value)` for an arbitrary point in range). The formatted
form is what Live's own UI shows: `"440 Hz"`, `"-12.0 dB"`, `"1/4"`,
`"500 ms"`, `"On"`. The format curves — Hz log scale, dB log scale,
time-with-tempo-sync, note-division enums — are baked into Live's C
code and not exposed as data; the UI cannot reproduce them locally
without drift across Live versions.

Until now the v3 surface only forwarded the raw float via
`/looping/v3/param/value`. UI sliders and XY pads showed either no
readout or a locally-formatted percent (`(value * 100).toFixed(0) +
"%"`), which is decoupled from what the user sees in Ableton's own
device panel. For LFO rates (`"1/4"` vs `"4 Hz"` depending on the
sync toggle), filter cutoffs, EQ frequencies, compressor ratios,
delay times, and envelope stages, the raw float carries no useful
unit context.

The naive solution — always include `str(parameter)` in every
`/looping/v3/param/value` fire — would call into Live's formatter on
every listener tick. A single fader drag is ~120 writes/sec; ten
simultaneously-dragged params on a multitouch session = ~1.2k
`__str__` calls/sec on Live's main thread, which is the same thread
Live's GUI repaints on. That's a regression we'd diagnose only after
a user reported "Live feels laggy when I touch the iPad."

A subscribe/unsubscribe model (UI signals pointerdown/pointerup) was
considered and rejected: it adds a wire-level state machine, a
client-side refcount manager, dropped-cleanup edge cases (tab loses
focus mid-drag), and reconnect/invalidation coherence requirements —
all to express "I'm interacting with this control," which the surface
can already infer from incoming `/looping/v3/param/set` traffic.

## Decision

**Surface infers "actively-interacted" from `param/set` traffic and
emits formatted display strings on a separate companion address with
a short TTL.**

Concretely:

- New surface→UI wire address `/looping/v3/param/display [path:string,
  displayValue:string]`, parallel to `param/value`. Emitted only while
  the path is "hot."
- `MutationComponent.mark_hot(canonical_path)` records an expiry
  timestamp (`time.monotonic() + HOT_TTL_SEC`, currently 0.75s) in a
  per-path dict.
- `DevicesComponent.handle_set_param_v3` calls `mark_hot(path)` after
  the path resolves on every UI-driven write. Drag traffic refreshes
  the entry; release decays it naturally.
- `MutationComponent.on_param_value_changed` checks the hot map on
  every fire. If hot, calls `str(parameter)` and emits
  `param/display`. The display emit runs **before** the existing
  one-shot suppression check, so suppressed value-echoes (the steady
  state during a drag) still surface display strings — without this,
  the display would never appear during the user's own drag because
  every fire is a suppressed echo of their own write.
- Stale entries are swept lazily on the same fire path — no
  background timer, no scheduler dependency.
- Display fires use `__str__`; Live's `str_for_value(value)` was not
  needed because the listener already fires after the LOM has settled
  on the new value, so `str(parameter)` returns the formatted
  post-write string.

UI side:

- `ParamRecord.displayValue?: string` — optional, populated by the new
  handler.
- `applyParamDisplay(paramPath, displayValue)` re-inserts the record
  via `params.set()` (mirrors `applyParamValue`'s SvelteMap reactivity
  pattern from ADR-002).
- `selectedTrackStore.paramDisplay(paramPath)` and
  `useFxGridSlot.paramDisplay(paramIndex)` — companion accessors to
  the existing `paramValue` shape.

Components opt in by reading `fx.paramDisplay(idx)` and falling back
to a sensible default when undefined (the param hasn't been
interacted with yet, or external automation is driving it).
AutoFilterCentralView is the first consumer: the LFO XY title shows
`"LFO"` when idle and `"LFO · 880 Hz"` / `"LFO · 1/4"` mid-drag,
auto-switching between the time and rate params based on the
Time/Sync toggle.

## Consequences

### Positive

- **Zero hot-path cost when nothing is being dragged.** Idle param
  fires (external automation, MIDI controller writes, listener
  echoes during clip playback) skip the `str()` call entirely.
- **Cost scales linearly with concurrency, not with subscriptions.**
  A multi-touch session dragging 10 params pays ~10 `str()` calls per
  fire batch — each on Live's main thread but each microsecond-scale.
- **Self-tuning.** TTL window matches the human-perception window for
  "I'm still interacting"; pauses inside a drag (a slider held briefly
  at one value) keep emitting, but a complete release decays within
  one TTL.
- **No new UI state machine.** Components opt in by reading one
  accessor; no pointer event wiring, no refcount manager, no
  reconnect-coherence requirements.
- **Composable with future needs.** A pinning escape hatch
  (`param/format/pin`) is a future ADR if a use case ever needs
  realtime display for a param the UI isn't writing to (e.g. an XY
  pad showing a value being modulated by an LFO).

### Negative

- **External changes don't surface display strings.** Automation
  writes, MIDI controller turns, and listener echoes from another
  session don't trigger `mark_hot`, so `paramDisplay()` returns
  undefined for them. UI consumers must fall back to a local format
  or accept "no readout while idle." The honest UX trade — local
  formatting drifts across Live versions, and the user cares about
  the readout most when they're the one driving the change.
- **Brief mismatch window.** When the surface decays a hot entry
  mid-drag (network stall delays a `param/set` past the TTL), the
  next fire stops emitting display strings until the next set lands.
  Acceptable: bumping TTL would extend the window at the cost of more
  idle-tail `str()` calls.
- **Wire-protocol minor bump.** `docs/reference/wire-protocol.md` §2.1
  gains a row. No breaking change to existing parsers — the new
  address is additive.

### Format-curve gaps Live owns

Live's formatter chooses the unit (e.g. AutoFilter LFO Time always
formats in seconds — `"0.50 s"` — even sub-second). UI components are
free to post-process the display string (parse `"0.50 s"`, render as
`"500 ms"` when `< 1.0`) when Live's choice doesn't match the central
view's design language. The brittleness lives in the consumer, not
the surface — the surface's job is fidelity to Live's value, not
opinion about formatting.

## Tags

`wire-protocol`, `python-surface`, `mutation-component`, `param-display`,
`hot-path`, `ui-feedback`, `live-api`, `v3`
