# Live's API, measured

What the Live Object Model does that its documentation doesn't say, measured on the rig. For
the API itself, read Cycling '74's [LOM reference](https://docs.cycling74.com/apiref/lom/)
(the Max `LiveAPI` projection of the same object graph), or ask the running Live: the surface's
probes (`/looping/probe/lom_introspect`, `py_introspect`; `owner/probes/lom_probe_driver.js`,
`surface/CLAUDE.md` "LOM probes") read any attribute or method off the live objects. When a doc
and the running Live disagree, Live wins.

Until 2026-09-28 these notes lived inside a scrape of Cycling '74's pages
(`documentation/lom-reference.md`, in Looping's history), which is not ours to publish.

**Reading the Max docs for Python.** Same objects, Pythonic accessors:

- `get foo` → `obj.foo`
- `set foo value` → `obj.foo = value`
- `observe foo` → `obj.add_foo_listener(cb)` / `remove_foo_listener(cb)`
- `call method args…` → `obj.method(args…)`

The UI reaches the LOM only through the surface, over the v3 wire ([wire-protocol.md](wire-protocol.md)).

## Song

- **`undo()`** returns the entry's label (`'Undo Custom Action'`), so a probe can read what it
  actually undid before deciding whether to redo.
- **`begin_undo_step` / `end_undo_step` are not reference-counted.** Measured 2026-09-16 on Live
  12.4.15b2: `begin` → `begin` → write A → `end` → write B → `end`, then undo twice. Undo #1
  restored only B; undo #2 restored A: two separate steps, both named `Custom Action`. The inner
  `end_undo_step` closed the step the outer `begin` opened, and everything written after it
  landed in a fresh one. So a long-held step is not safe against anything else that opens and
  closes its own: `DrumVirtualMacroComponent.flush` does exactly that, and a macro move during a
  held step silently splits it. Several writes that must undo as one need a window where nothing
  else writes, or must be grouped by their writer without relying on nesting (swap audit M3).
- **Live does not coalesce one handler's writes to different parameters into one undo step**
  (2026-09-07, 12.4.15b1): wrap a fan-out in `begin_undo_step()` / `end_undo_step()`.

## Track

- **`fold_state`** raises on a non-foldable track: gate on `is_foldable` (true for a Group Track)
  first; `getattr(…, default)` does not swallow it. There is no `add_fold_state_listener` (Live
  12.4.5b8); observe `Song.visible_tracks` instead (ADR-410).
- **`is_visible`** has no `add_is_visible_listener` (12.4.5b8); the UI derives visibility from the
  group tree (ADR-410).
- **`insert_device(device_name, target_index?)`** (Live 12.3+), measured 2026-09-10 on 12.4.15b2:
  takes the display name (`class_display_name`: `Delay`, `Auto Filter`, `Hybrid Reverb`,
  `Phaser-Flanger`, `Chorus-Ensemble`, `Beat Repeat`, `Utility`…), returns the device, applies the
  User Library default for that device (`Defaults/Audio Effects/<name>.adv`, whose stored
  `UserName` becomes the device's name), one undo step. A MIDI effect must be given an index
  before any instrument or audio effect, or it raises. Racks, plug-ins and Max devices raise.

## Track.View

- **`device_insert_mode`** (0 end, 1 left, 2 right of the selection), measured 2026-09-14 on
  12.4.15b2 (ADR-437): it reads as a bool, `True` in the default mode and `False` after 1 or 2 is
  written. The setter takes an int, a string raises, and writing `1`/`True` does not restore the
  default: only `0` does. It decides where `browser.load_item` puts a preset: default, on the track
  after the top-level device holding the selection (a rack); 1 or 2, beside the selected device
  inside its chain. The surface's pad loads write 2 for the call and 0 after.

## Clip

- **`is_playing`** can read True while `Song.is_playing` is False (12.4.15b2, ADR-440).
- **`warp_markers`**: in Python a `WarpMarkerVector` of `.beat_time` / `.sample_time` (seconds). A
  fresh warped clip has three: start, end, and a hidden one 1/32 beat past the end.
- **`add_warp_marker`**: `Live.Clip.WarpMarker(sample_time, beat_time)`, sample time first, in
  seconds; a dict raises `TypeError`. A marker that would cross a neighbor raises `RuntimeError`.
- **`move_warp_marker(beat_time, distance)`** moves it by `distance` beats and leaves its audio
  point put. A move past a neighbor is clamped just short of it, with no error. Moving the end
  marker carries the hidden marker 1/32 beat after it.
- **`remove_warp_marker(beat_time)`** needs exactly `beat_time` (4.1 misses a marker at 4.09:
  `RuntimeError`). The first marker can be removed, which Live's UI refuses.
- **`automation_envelope(param)`**: the clip's [Envelope](#envelope) for a parameter, or `None` if
  it has none (always `None` on an Arrangement clip or another track's parameter).
- **`create_automation_envelope(param)`**: an empty Envelope (no events; reads the parameter's
  current value everywhere). Session clips only.
- **`clear_envelope(param)`** takes the DeviceParameter; `automation_envelope` then answers `None`.
- **`beat_to_sample_time` / `sample_to_beat_time`** work in samples, not the seconds a WarpMarker
  uses: divide by `sample_rate`.

## Envelope

`Live.Envelope.Envelope`, from `Clip.automation_envelope(param)` / `create_automation_envelope(param)`.
Not in Cycling '74's pages. Measured on Live 12.4.15b4 (2026-09-27) with a throwaway probe, since
removed; the classes are also in 12.4.2 Suite.

| Function | Signature | Behavior |
|----------|-----------|----------|
| create_event | `(EnvelopeEvent(time, value[, EnvelopeEventControlCoefficients(x1, y1, x2, y2)]))` | Add a breakpoint. Two breakpoints make a **linear ramp**. An event at a time that already has one is **added, not replaced**: two events at one time make a vertical jump. Times outside the clip are kept |
| events_in_range | `(from, to)` → `EnvelopeEventVector` | Events with `.time`, `.value`, `.control_coefficients` |
| delete_events_in_range | `(from, to)` | Inclusive at both ends |
| insert_step | `(time, length, value)` | Flat block over `[time, time+length]` as four events; the envelope is continuous outside it |
| value_at_time | `(time)` → float | Interpolated, in the parameter's own units; before the first event it holds the first event's value |

- **Curves: write breakpoints right to left.** A segment's curve lives on its start event, and
  Live discards the coefficients of an event that has no later event yet: written first, the start
  point comes back `0.5, 0.5, 0.5, 0.5` and the ramp is straight. Written after its end point it
  keeps them, arbitrary values included, and `value_at_time` follows the curve. Inserting a point
  into a curved segment keeps the start event's coefficients, which then shape the shorter
  segment. Rewriting an identical event (same time and value) is ignored, so it cannot add a curve
  afterwards. Reads report curves drawn in Live's UI.
- In the `.als` a curve is `CurveControl1X/1Y/2X/2Y` on the start event's `FloatEvent`, the same
  four numbers as `x1, y1, x2, y2`. One Option-drag in Live's editor gave `0.953125, 0.015625,
  0.984375, 0.046875`, a steep ease-in; `0.5` on all four is a straight line.
- **Event values on dB parameters read back as linear gain.** `create_event` and `value_at_time`
  use the parameter's value (Track Volume, Operator Volume: 0.2 / 0.8), but `events_in_range`
  answers 0.0191 / 0.7943, i.e. −34.4 / −2.0 dB, which is what `str_for_value` shows for 0.2 / 0.8.
  Tone, Pan and Transpose read back unchanged. Quantized parameters round on write (Transpose
  12.5 → 12).
- Reads see a write in the same handler call.
- **During playback the envelope drives the parameter**: `value` follows the clip position (Track
  Panning −1 → 1 over a 4-beat loop, sampled about every half beat) and `automation_state` is 1.
  After stop the parameter keeps its last value.
- **Undo:** wrap each gesture in `song.begin_undo_step()` / `end_undo_step()`: one `song.undo()`
  then reverts exactly that gesture and `redo()` restores it (envelope events and warp markers
  alike). Ungrouped, one `song.undo()` after three `create_event` calls left all three in place.
- The `.als` stores a hidden first event at `Time="-63072000"` holding the envelope's starting
  value; `events_in_range` does not return it.
- **Modulation envelopes are invisible and unwritable.** A clip whose only envelope is Pan
  *modulation* (drawn in Live with the envelope's Modulation switch) reads `has_envelopes` True
  while `automation_envelopes` is empty and `automation_envelope(panning)` answers `None`. No
  `Clip` or `DeviceParameter` method names modulation, so everything above is automation mode
  only. In the `.als` the two differ only by target: a `ClipEnvelope` points at the parameter's
  `AutomationTarget` or at its `ModulationTarget`, with the same `FloatEvent`s; the modulation
  values are bipolar offsets (−0.497 … 0.577 on Pan). Push 3's bridge
  (`Clip.insert_automation_step(parameter, start, length, value)`) and the Extensions SDK (no
  envelopes at all) don't reach them either.
- **Modulation behavior is available through Max's `live.modulate~`** (measured 2026-09-27 with a
  throwaway audio effect: one float `live.dial` "Mod" −1..1 into `live.modulate~`, aimed by
  `live.path` at `live_set this_device canonical_parent mixer_device panning`; the prototype is
  `owner/Modulation Test.amxd`). It offsets the target around its knob without taking it over:
  the pan knob read 0.0 throughout while the output balance moved; pan knob +0.5 with Mod −0.25
  came out centered; on a bipolar parameter the offset is `Mod × (max − min)` (Mod −0.5 → full
  left). A clip automation envelope on the Mod dial (written from Python as above) then gives
  per-clip modulation: Mod followed the envelope and the balance swept with it, looping with the
  clip, the pan knob untouched.

## SimplerDevice.Sample

- **`slices`**: the listener is documented but does not fire when Live recomputes the list (a
  sensitivity or playback-mode change). The surface cascades from the source attributes instead
  (ADR-354).

## DeviceParameter

- **`is_enabled` is False while a macro holds the parameter**, and a `value` write then raises
  `RuntimeError: Value cannot be set, the parameter is disabled` (2026-09-07, 12.4.15b1;
  `RackDevice.macros_mapped` says which macro; ADR-428).

## RackDevice

- **`macros_mapped`**: one flag per macro slot (16), True where a mapping exists; the per-macro
  companion of `has_macro_mappings` (Live 12; 2026-09-07).
- **`view.selected_drum_pad` is settable** with a `DrumPad` object
  (`view.selected_drum_pad = rack.drum_pads[36]`, 2026-09-07); it retargets the Move knob lane.

## Chain (a drum pad's chain)

- **`insert_device`**: the same contract as `Track.insert_device`, measured on a `DrumChain`
  (2026-09-10): it lands in the chain in the same call, fires the chain's `devices` listener, and
  causes no track structural change.
- By contrast `browser.load_item` with the pad and the chain's last device selected lands the
  preset on the track every time; `Song.move_device(device, chain, index)` then moves it in (two
  undo steps: "Insert Device" + the move as a "Custom Action"). Since ADR-437 the surface avoids
  the move: with `Track.View.device_insert_mode` written 1 or 2 for the call, `load_item` lands
  the preset in the chain (2026-09-14, every time). The move is the fallback for a Live without
  the property, and **undoing a `move_device`d Max device aborts Live** (`Fatal Error:
  ADeleteAction::Do`, grouped in one undo step or not, from `song.undo()` or the Edit menu), while
  a chain-landed load undoes as a plain "Insert Device".
- **A MIDI effect lands at the track's index 0, ahead of the instrument** (2026-09-11, with a
  Random and a Chord), so the rack's path shifts by one until the move, which tears down
  path-keyed subscriptions on it. Live accepted an end index for the MIDI effect and placed it at
  chain index 0 regardless.
- The wire addresses a drum chain's devices as `tracks/N/devices/M/pads/<note>/devices/K`
  (protocol 3.8.0, note-keyed, never the reserved `chains/<index>`); see
  [wire-protocol.md](wire-protocol.md) §2.6.

## DrumPad

- **`note`** is the runtime MIDI note. The `.adg` stores the pad as `ReceivingNote = 128 − note`.

## DrumCellDevice

**Measured 2026-09-07, Live 12.4.15b1 (ADR-428):**

- 40 parameters. The continuous ones are **normalized 0..1 at the LOM** (`min` 0, `max` 1)
  whatever the panel displays; `Transpose` is the exception at −48..48; enums (`FX Type`, playback
  modes) are ints.
- Live's own macro → parameter fan-out **interpolates linearly in that LOM space** (a macro at 0 /
  .25 / .5 / .75 / 1 lands the cells at the same fractions), so a surface-side fan-out needs no
  curve table: `value = min + t·(max − min)` is exactly what Live does.
- Under a busy control thread a read-back can lag one write behind for a pass (it returns the
  pre-write value).
- `OriginalSimpler` (33 parameters) and `MultiSampler` carry `Transpose` at −48..48 too.
  **`MultiSampler`'s parameter list is dynamic**: a switched-off section contributes only its On
  switch (43 → 70 parameters when `F On` is set; 108 with Osc / Pitch env / Filter on), so indices
  shift per toggle and names don't. Resolve by name and hold the `DeviceParameter` objects.
- Reading a pad's chain (`drum_pads[n].chains[0].devices[0]…`) costs ≈600 ms of Live's control
  thread per call.

**Measured 2026-09-15, Live 12.4.15b2 (ADR-428 addendum): a preset load into an existing Drum
Rack.** One 32-pad kit loaded over another with `prepare_for_preset` in replace-instrument mode,
reading `_live_ptr` either side of the load:

| | Across the load |
|---|---|
| the rack device, every `DrumChain`, every `drum_pads[n]`, every `DrumCell` | **same object** |
| every `DeviceParameter` | **same object**: 16 of 16 Decay parameters, identical raw pointers |
| the chains' own `devices` listeners | **never fire** |
| the rack's `drum_pads` / `chains` listeners | fire |
| the rack's `name`, every chain's `name`, every cell's `name` | **change** (the rack takes the preset's name) |
| the parameters' values | the new kit's |

So **LOM identity cannot detect a kit swap**: Live re-points the same objects at new samples
rather than building new ones, and nothing watching a chain's device list hears it either. A name
is the only observable difference. The load itself took 3.5 s for 32 vocal samples (prepare ack)
and logged a `control-thread hiccup` of the same order.

## Quantization values

`Song.clip_trigger_quantization` (launch quantization), in Live's order, coarse to fine:

| Value | | Value | |
|---|---|---|---|
| 0 | None | 7 | 1/4 |
| 1 | 8 Bars | 8 | 1/4T |
| 2 | 4 Bars | 9 | 1/8 |
| 3 | 2 Bars | 10 | 1/8T |
| 4 | 1 Bar | 11 | 1/16 |
| 5 | 1/2 | 12 | 1/16T |
| 6 | 1/2T | 13 | 1/32 |

`Song.midi_recording_quantization`: 0 None, 1 1/4, 2 1/8, 3 1/8T, 4 1/8 + 1/8T, 5 1/16,
6 1/16T, 7 1/16 + 1/16T, 8 1/32.
