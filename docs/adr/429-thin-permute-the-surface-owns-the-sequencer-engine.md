# ADR-429: Thin Permute — the Surface Owns the Sequencer Engine

## Status
**Accepted** (2026-09-07). Looping side of permute ADR-020. Branch
`feat/thin-permute` (cut from `feat/drum-virtual-macros-m1`, ADR-428).
Related: issue #489 Addendum 1 §4–§9, ADR-171 (the extraction this
reverses), ADR-406 (the step-telemetry ingest this retires).

## Context

Permute was a Max for Live device that did everything itself: it read
its own `live.*` pattern controls, ran two step sequencers off a
transport-locked `metro`, and wrote to Live through LiveAPI from a `v8`
object — note mutes, an octave shift, note probability, a
"temperature" scramble — with its own baseline bookkeeping, its own
handle pool and its own observer registry, and no tests. The surface
already loaded it onto every prepared track, already edited its steps
over `param/set`, already observed every one of its parameters, and
already translated its step telemetry onto the UI wire.

Issue #489 made the device the odd one out: per-pad drum pitch becomes a
*virtual macro* the surface computes (`pitch = global + offsets[note]`,
ADR-428), and Permute was the one writer with no route to it — on an
unmapped kit its name scan either wrote a dead macro or note-shifted the
Drum Rack, which on a 24-pad kit lands on empty pads. Fixing that inside
Max would have made two writers of the same cells, the shape of every
baseline bug in Permute's history. permute ADR-020 chose the other
direction: the device keeps only what Live does for free — the
parameters, with persistence, undo, automation and Push mapping — and
the surface owns the engine.

### Measured before building (2026-09-07, Live 12.4.15b1)

| Fact | Consequence |
|---|---|
| `current_song_time` listener ≈ 65.8 Hz (mean 15.2 ms, p99 32.7, max 53.7); the drain pump's `Live.Base.Timer` ticks every 10.8 ms (92.8 Hz); a Timer callback is a legal LOM write context (the ADR-428 fan-out writes from it). | The pump is the clock. The listener would have needed every write deferred out of the notification. |
| The fat device's `Mute Current` / `Pitch Current` were the *only* reason for the step-telemetry ingest; both reported the name `Mute Current`. | The thin device drops them; the surface emits the step wire itself. |
| Live's parameter list for the fat device was 23 names (Current / Reset never appeared). | The UI's index table stays valid; by-name resolution is hardening, not a fix. |
| Live records one undo step per parameter write, and does not coalesce writes to different parameters in one handler (ADR-428). | Drum fan-outs need explicit grouping. |

## Decision

### The device: 22 parameters and no code

`Vamp Devices/Permute/Permute.amxd` (+ `Permute.maxpat`, the same
patcher JSON for reading) is the fat device with 188 objects removed:
Live's `Device On`, the 22 `live.*` pattern controls with their long
names and parameter orders 1–22 unchanged (`Mute 1 … 8`, `Mute Length`,
`Mute Rate`, `Pitch 1 … 8`, `Pitch Length`, `Pitch Rate`, `Chance`,
`Temperature`), `plugin~` → `plugout~`, two dividers, six labels. Gone:
the `v8` object and its ten modules, the `transport` / `metro` clock,
both `udpsend`s, the Current numboxes and the Reset button, the
per-step display chains and every `---tojs` / `---fromjs` /
`---requestuivalues` / `setcell` / `coll rate` wire. The strip was done
on the JSON inside the `.amxd` (an `ampf` header, then the patcher,
with the `ptch` length rewritten); `scripts/amxd-inventory.py` verifies
a file without Max (22 parameters, orders 1–22, `fat-device markers
present: none`), and a fresh load from disk through the `Permute`
Place (`Vamp Devices/Permute`) reads back the same 23 names,
order, ranges and defaults as the fat device (rates 3 = 1 bar, lengths
8, chance 1, temperature 0). The device name stays `Permute` and the
class `MxDeviceAudioEffect` — both load-bearing.

The standalone permute repo is frozen at its last release; the fat
device remains the shareable artifact that works without a surface.

### Both sides resolve the parameters by name

`interface/src/lib/config/permuteLayout.ts` is the UI's contract (long
names per role, the measured positional table as a per-role fallback,
the device defaults); `sequencerStore`, `useTinySequencer` and the
duplicate-track reset all go through `resolvePermuteLayout`. The surface
engine indexes the same names. A re-ordered device can no longer shift
a step onto the wrong control.

### `SequencerComponent`, behind `sequencer_engine`

One engine for every device named `Permute` on a regular track's
top-level chain, gated by the persisted session toggle
`sequencer_engine` (default **off**). It is a switch-over gate: a set
still holding fat devices must never have both engines on one track,
so the user swaps devices per set and then flips it. Off restores
everything applied and drops back to the fat device's step ingest,
which is gated on the same toggle so no path is ever reported twice.

- **Clock.** `FastDrainPump.add_tick_hook` — every Timer fire, drained
  or not; `LoopingSurface._tick` carries the engine if the pump is
  down. Per tick: `is_playing`, `current_song_time`, `tempo`,
  `signature_numerator` once; per device `floor(ticks / ticks_per_step)
  % length` on the ported math (`sequencer_math.py`; bar rates scale
  with the numerator; an out-of-range rate index falls back to 1/4 and
  a negative one must not wrap like a Python list).
- **Lookahead.** The step is evaluated at `now + lead`
  (`sequencer_math.lead_ticks`), so the next step's state lands before
  the boundary Live triggers the note on. The lead was one tick interval
  (an EMA of the engine's own period, 4–40 ms, at the current tempo)
  until **2026-09-09**; see "The lead is a 1/32, not a tick" below for
  why it moved and to what. Apply lag is recorded per transition;
  `/looping/probe/sequencer_stats` reports it, and now also the lead it
  is aiming for.
- **Pattern: read-only, cached, sampled at boundaries.** Values come
  from the value listeners `LOMListeners` already attaches, keyed by
  parameter LOM id. The engine never writes a pattern parameter (they
  are automated with clip envelopes); an envelope change mid-step lands
  at the next boundary, as the fat device behaved.
- **Actions, delta-based.** *Pitch* routes by class, never by name: a
  Drum Rack (top-level or nested one deep in an Instrument Rack) → a
  shift term on `DrumVirtualMacroComponent` (`pitch = clamp(global +
  offsets[note] + shift)` per member, same fan-out / legacy-macro / undo
  path as `vm.pitch`, the UI never sees the term, needs no clip); a
  melodic instrument (an Instrument Rack without a Drum Rack included)
  → every note of the playing clip +12 through `apply_note_modifications`
  with ids preserved, each note remembering its own delta; an audio
  clip → `pitch_coarse` +12 relative, clamped ±48, the restore adopting
  a re-pitch made while shifted (permute ADR-019). *Mute*: `note.mute`
  on every unmuted note, unmuting only those; clip `gain` → 0 on audio;
  the fat device's solo override (a soloed track plays regardless).
  *Chance*: `note.probability` written through from the slider (a
  slider move applies at once and is authoritative; clip change and
  transport start re-apply it below 1.0; nothing restores it).
  *Temperature*: permute ADR-015's base model, ported — capture by
  `note_id` with the octave removed, every variation from the base
  (never cumulative), return to 0 verbatim, a content diff on the
  clip's `notes` listener to tell user edits from the engine's own
  writes (every note write records its pitches as `expected` first),
  re-baseline on an edit, overdubs never swapped until folded in.
- **Restore** on transport stop, toggle OFF, device removal, a clip
  change under a held step, and `disconnect`. Writes never run inside a
  notification: the structural / removal / value callbacks only mark
  state, and the next tick does the work.
- **Current clip** = the track's playing slot via
  `PlayheadComponent.playing_clip(track)`, a query on the component
  that owns the slot listeners.
- **Telemetry** `/looping/v3/permute/step` on each change, `−1` per
  kind on stop / disable / removal / disconnect.

### Per-pad offsets are seeded from the kit

Found on the way: the ADR-428 fan-out wrote the global to every pad,
which flattened a kit whose pads carry different Transpose values on
the first Trnsp move or pitch step. The reserved `offsets` table is now
filled from the kit itself (each pad relative to the first member) and
reconciled before every fan-out by reading each member back — a value
that is neither what we last wrote nor what the pad held before that
write is the user's edit and moves the pad's offset. A read equal to
the pre-write value is our own write still landing (measured: under a
busy control thread a DrumCell reads one write behind for a pass;
folding that in walked every pad away by the shift on each step).

**Review fixes (2026-09-07, branch `fix/drum-vm-pitch-model`).** The
first reconcile treated every changed pad as a hand edit, so Live's
Edit → Undo of our own gesture or step — every pad moving by the same
amount — was folded into 24 offsets and the next move landed the kit
elsewhere (a slider at +8 with the pads at +1; a step-off an octave
below home). The reconcile is now two passes over one `_PadPitch`
record per pad (`offset`, `written`, `prev`, `written_at`):

- **A uniform delta is a kit move.** When at least two pads share the
  same nonzero delta (read − written) and it is the most common delta
  across the pads read — an unchanged pad votes 0, a pad at the ±48
  rail abstains — that delta is the kit's move; it is subtracted before
  each pad's remainder goes into its offset. On the write path
  (`property/set`) the incoming value is the user's absolute intent and
  wins: the move is discarded. On the sequencer path there is no new
  user value: the move is adopted into the held global and `vm.pitch`
  re-emitted, so the Trnsp slider follows Live's undo — except when the
  move is exactly the shift change being applied (Cmd-Z on a held
  step), where the kit already sits where the step-off lands and
  nothing is adopted. Residuals, documented in the component: a
  single-member kit cannot tell a move from an edit; a rail pad keeps
  its offset under a move; two identical hand edits on a three-pad kit
  read as a move.
- **The stale-read guard is a window, not a memory.** A read equal to
  the pre-write value counts as our own write still landing only for
  `STALE_READ_WINDOW_MS` (400 ms on the component's clock — a 1/16 at
  180 BPM is 83 ms, the pump ticks every 11 ms); past it the same read
  is the user's. `prev` is cleared once a read matches the write or is
  judged an edit. A control thread stalled longer than that (a deep
  `drum_pads` probe costs ~600 ms) can still make a lagging read look
  like an edit — one more reason never to probe the rack at step rate.
- **A shift is committed only after a fan-out wrote something**: a
  step that fires while a kit is still populating is skipped, not
  deferred, so a later step-off cannot write an octave below where the
  kit loaded.
- **State follows the rack, not its path**: `rebind` re-keys a held
  state when a track above the kit is deleted (called from the engine's
  structural rescan, bookkeeping only), so a held step is restored on
  the moved rack instead of being re-seeded from its shifted pads.
- **Toggle OFF restores whatever any instance applied**, not only what
  a running transport applied: a temperature nudged from 0 while stopped
  writes a variation, and the toggle going off puts the base back.

## Measured on the rig

Test set `test.als`, Live 12.4.15b1, 111 BPM, tracks: `606 + 808
unmapped` (Drum Rack + thin Permute), `E Piano` (Drift + Permute, a
one-bar clip 60/64/67/72), `Bass[112] D Plastik` (an audio clip +
Permute). Quarter-note rates, pitch steps 1–4 on.

| Check | Result |
|---|---|
| Engine attaches | `engine attached to tracks/6/devices/1`, `pitch route drum rack at tracks/6/devices/0`; the two clip tracks route `clip`. |
| Step telemetry from the engine, ingest gated | mute/pitch 0, 1, 2 … at the pattern rate, `−1` on stop; the fat device's ingest dropped while on. |
| Clock (clean run, no probes) | 72 transitions for 12 steps × 6 sequencers; tick interval 11.1 ms; slowest tick 0.83 ms. |
| Apply lag at 111 BPM | mean −4.3 ms, p50 −6.6 ms (early, the lookahead), p95 +9.1 ms, min −10.3, max +9.1; 75 % of transitions early. The late ones are step 0 at transport start, which nothing can lead. |
| Melodic pitch | notes 60/64/67/72 → 72/76/79/84 for steps 0–3, back for 4–7, ids intact. |
| Audio pitch | `pitch_coarse` 0 → 12 → 0 in step; `gain` untouched. |
| Drum pitch | the first run exposed the stale-read-back bug (per-pad offsets section); after the fix every pad moves +12 relative to its own Transpose on steps 0–3 and back on 4–7 (a kit at −31 read −19 / −31), macro 4 untouched at 63.5, restored on stop. |
| Probe load | a probe reading `drum_pads[n].chains[0].devices[0]…` costs ~600 ms of Live's control thread per call and stalls the engine (max lag 530 ms under it) — sample the rack sparsely, never at step rate. |
| Mute | MIDI: every note's `mute` flag 1 on steps 0–3, 0 on 4–7, 0 after stop; audio: clip `gain` 0.4 → 0.0 → 0.4 → 0.4 after stop. |
| Chance | slider 0.3 → 0.75 → 1.0 written to every note's `probability` within one tick, kept after stop. |
| Temperature | 0.6 on the 4-note clip: variations drawn from the base (two identity draws, then `(3,60) (2,64) (4,67) (1,72)`), back to 0 → the exact original by id, stop while hot → the original, no re-baseline fired on the engine's own writes. |
| Apply lag, probe-free | 111 BPM: 72 transitions, mean −4.8 ms, p50 −5.5, p95 +9.2, min −8.8, max +9.2, 92 % early. 180 BPM: 114 transitions, mean −4.2, p50 −5.5, p95 +19.2, max +19.2, 95 % early. The late tail is the step-0 transition at transport start each run, which nothing can lead. Tick interval 9.9–10.3 ms, slowest tick 0.79 ms. |
| Undo | Live exposes no undo count to the LOM; its Undo History panel (Live 12.4) is the witness. A `begin/end_undo_step` group shows as **Custom Action**, a bare script write as **MIDI Controller Action**, and consecutive script writes merge into one entry: everything since the set opened — hand resets, pattern writes, two engines' applies and restores, 25+ temperature variations, the disconnect restore and the stop restore — is eight entries above `Open Live Set`. The history does not grow by one step per transition. Edit → Undo while the transport runs reads `Undo Custom Action` (the drum group). |
| Disconnect mid-play | Re-selecting the surface in Live's Settings while the transport ran with every pitch step on and temperature 0.6 on the piano: the old surface's teardown (2 ms, `disconnecting` 15:34:57.769 → transport closed .771) put back notes 60/64/67/72 by id, `pitch_coarse` 0 and the pads' own −31 before the new surface came up 3.3 s later; the new engine (toggle persisted on) then re-applied exactly +12 on all three — never +24, never pads at −7, which is what a missed restore would have stacked — and a stop restored all of it. An earlier read that looked like a failed reload was a Live **quit**: Live writes the set before it disconnects the surface (`Begin OnQuit` 15:19:00, test.als written, `Looping surface disconnecting` 15:19:05), so the held state was baked into the file and the next session's engine adopted it as the base. |

## Addendum — the lead is a 1/32, not a tick (2026-09-09)

The lookahead above shipped as **one tick interval** of the engine's own
clock, ~10 ms. That is the clock's *granularity* — the soonest the engine
can next act — and it was mistaken for *headroom*. It budgets nothing for
the time Live needs to act on a clip write before its playback engine
reads the note at the boundary, which is what the fat device's flat 120
ticks (a 1/16) was actually buying.

### Measured on the rig before changing anything (2026-09-09, Live 12.4.15b1)

Ten Permute instances on the live set, transport running, **97.74 BPM**,
`sequencer_stats reset` then a clean 60-second window — 485 transitions:

| | ms (negative = early) |
|---|---|
| median | −2.1 |
| mean | −0.8 |
| p95 | **+7.5** (late) |
| p99 | **+47.9** (late) |
| min / max | −18.8 / +296.9 |
| **share early** | **66.8 %** |

Tick interval 9.97 ms, zero slow ticks, slowest tick 3.58 ms — the engine
itself is healthy. **A third of transitions landed after the boundary.**
The clean-bench rows above (92–95 % early) were one instance with nothing
else running; ten instances on a real set is the distribution that counts.

### Decision

`lead_ticks(interval_s, tempo_bpm, ticks_per_step)` =
`min(max(one tick interval, MUSICAL_LEAD_TICKS), ticks_per_step / 2)`.

- **Floor: a 1/32 (60 ticks).** Half the fat device's 1/16. In *ticks*, so
  it scales with tempo — 76.7 ms at 97.74 BPM, 62.5 at 120, 41.7 at 180 —
  where the old lead was a fixed ~10 ms of wall clock that did not grow
  when the music slowed down.
- **Why a 1/32 and not the fat device's 1/16.** The lead must stay inside
  the gap between the boundary and the last note before it, or the state
  flips early on *that* note. A 1/32 clears a preceding 1/16 note with a
  1/32 to spare; the fat device's 1/16 lands exactly on it.
- **Clamp: half a step.** Keeps a fast rate from reaching back past the
  middle of the preceding step. It only bites at the 1/16 rate (120-tick
  steps), where it holds the flip to a 1/32 early anyway.
- **Computed per sequencer, not per device.** The clamp is a property of
  each sequencer's own rate, and the mute and pitch rates rarely match —
  on the rig, one device runs mute at 1 bar and pitch at 1/8. The lead
  therefore moved inside the per-sequencer loop; `_tick_instance` no
  longer takes a precomputed `target`.

The `lookahead=False` path is unchanged and still evaluates at `now`;
tests use it to pin the un-led timing.

**Not claimed:** that this makes the *audible* result correct. Apply lag
records when the write is **issued**, not when Live acts on it. The honest
test is a recorded boundary transition — whether the note on the beat
carries the new state. That has not been run.

## Consequences

- Permute no longer works without the surface; a reload of the surface
  mid-play restores every clip first (measured: the Settings re-select above).
- The baseline-inference lineage (permute ADR-005/014/016/019) is gone by
  construction: the surface owns every term of the drum pitch.
- Sets built with the fat device keep working until each track's device
  is swapped for the thin one and the toggle flips; the two must never
  overlap on a track.
- `PermuteStepComponent` stays only as the gated ingest for sets not yet
  switched; it retires with the last fat device.
- Undo: a drum shift is its own `begin/end_undo_step` group (or an open
  Trnsp gesture's), a note write one `apply_note_modifications`; Live's
  history merges consecutive script writes, so a run of transitions is a
  handful of entries, not one per step (measured above).
- **A save while a step is held bakes the held state into the set.** Live
  writes the document *before* it disconnects the surface on quit
  (measured: `Begin OnQuit` 15:19:00, test.als written, `Looping surface
  disconnecting` 15:19:05), and a Cmd-S mid-play has no hook at all — the
  LOM offers nothing pre-save. The notes, `pitch_coarse` and pad
  Transposes on disk are then the shifted ones, and the next session's
  engine adopts them as its base. The fat device had exactly the same
  exposure, so the rule is unchanged: stop the transport before saving a
  set with Permute steps held.
