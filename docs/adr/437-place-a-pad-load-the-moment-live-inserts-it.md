# ADR-437: A Pad's Browser Load Lands in the Chain Itself

## Status
**Accepted** (2026-09-14). Follows ADR-430 (pad chains, the deferred
placement check) and ADR-435 (a Permute in a pad chain). Research
brief: make loading a Permute onto a track or into a pad faster and
cheaper. The title changed during the day: it began as "place the
device the moment Live inserts it" and ended as "do not move it at all",
for the reason under Validation.

## Context

A preset that is not a native device — the Permute `.amxd` above all —
reaches a drum pad's chain through Live's browser: the surface selects
the track, the pad and the chain's last device and calls
`browser.load_item`, and Live landed the device on the *track* (ADR-430,
measured). Since 2026-09-10 the surface then looked for it on a later
tick — `schedule_message` at 200 ms, then 800 — and `move_device`d it
into the chain. Four Permute pad loads in Log.txt on 2026-09-14 (Live
12.4.15b2) put the time where nobody wanted it:

| Phase | Measured |
|---|---|
| resolve track and pad, browser-cache lookup | under 1 ms (the `Permute` Place has one entry; built in 3 ms once) |
| `load_item` until the surface saw the track structural | 86, 191, 212, 336 ms (track-level Permute loads this week: 52–270, median ≈125, n≈40) |
| surface structural handling to the `state/full` publish | +24 to 83 ms |
| the placement wait — two 100 ms scheduler ticks, phase-dependent | ≈130–400 ms of pure waiting |
| `move_device` and the second structural publish | 40–65 ms after the move |
| pad-chain composite | 150 ms after the move, by design |
| request → moved | **265, 487, 529, 821 ms** (the ADR-435 rig proof: 510) |
| undo entries | two: "Insert Device", then the move as a "Custom Action" |

During the wait the engine attached the newcomer as a *track-level*
Permute (kit route) and detached it on the move, and the UI received two
track structural bundles before the pad-chain composite.

The other routes were weighed and measured the same day:

- **Insert by name.** `Chain.insert_device("Max Audio Effect")` — the
  container's `class_display_name` — is accepted, on a track and in a
  DrumChain alike, and returns a `MaxDevice` in ~58 ms. But it is an
  *empty* container (one parameter, Device On) even with a user default
  at `Defaults/Audio Effects/Max Audio Effect.adv` (Live 12 stores a Max
  device as an `MxPatchRef` file reference, so the default is a 2 KB
  file) — added while Live ran and present at Live's start alike. Live
  does not apply user defaults to the Max container. Dead end; the
  default was removed again.
- **A pool** of pre-instantiated devices on a return track saves only
  the instantiation and costs set hygiene and stray undo entries.
- **A smaller patcher**: the thin device has 51 boxes and no
  dependencies; the `plugin~`/`plugout~` pair is the audio path.
- **A chain-targeted browser load**: the Python browser API is
  `load_item`, `preview_item`, `stop_preview`, `hotswap_target`,
  `filter_type`; a hot-swap target replaces, it does not append.
  `RackDevice.View.selected_chain` was already the pad's chain and
  `is_showing_chain_devices` already true when the loads went to the
  track.

The user's own question — "the blue line, the insert position, could we
use that?" — named the answer: `Track.View.device_insert_mode`.

## Decision

`DeviceLoadComponent._load_into_pad`:

1. Select the track, the pad and the chain's last device, as before.
2. **Set the track's device insert mode beside the selection** —
   `track.view.device_insert_mode = 2` — for the duration of
   `load_item`, and write `0` back afterwards (in a `finally`). A mode
   that already reads as "beside the selection" is left alone; a Live
   without the property logs once and falls through to step 4. Measured:
   the property reads as a bool (`True` in Live's default mode, `False`
   after 1 or 2 is written), and with 1 or 2 `load_item` lands the preset
   **inside the pad's chain**, every time; with 0 it lands on the track
   after the rack, every time.
3. **Look at once**, the moment `load_item` returns, in the same handler:
   chain grew → done.
4. Fallbacks, for a Live that put it on the track: `move_device` into the
   chain now; nothing visible yet → the same look on every fast tick —
   `LoopingSurface._schedule_next_tick`, a one-shot hook on the drain
   pump's Timer (~11 ms, a legal LOM write context, ADR-429), or the
   ~100 ms `schedule_message` tick when the pump is down — until
   `PAD_PLACEMENT_TIMEOUT_S` (1 s), then `landed-nowhere`.
   `PAD_PLACEMENT_CHECK_MS` and the `schedule_delayed` argument are gone;
   the component takes `schedule_tick` and an injectable `clock`. A
   pending placement is dropped on `disconnect`; a stale tick is inert.

**The load and the move are never grouped in one undo step**, and the
move is a fallback rather than the mechanism, because of what undo did:

## Validation

- Surface: `uv run --with pytest --with ruff python -m pytest -q` —
  2,481 passed, 4 skipped. The browser fake lands a pad load where Live
  does — the chain when the track's insert mode sits beside the
  selection at load time, the track otherwise — and the pad-load cases
  cover: the mode set for the load and put back (also when `load_item`
  raises), a mode already beside the selection left alone, a Live
  without the property falling back to the move, a later arrival caught
  on a tick, the deadline, no tick to wait on, a refused move, disconnect
  with a pending load, and that no undo step is opened around the pair.
  `ruff check` on the changed files adds no rule category.
- Rig, Live 12.4.15b2, the Untitled template set, kit "Memphis Studio +
  Plymouth", pads 36 and 38, transport stopped:

| Check | Result |
|---|---|
| Interim version: newcomer moved the moment `load_item` returned | `landed on the track; moved into pad …/pads/38 after 1 look(s), 114 ms`; request → moved 127 ms; engine attached it directly as the pad's instance; the track's `state/full` skipped as unchanged |
| `song.undo()` after that load, grouped with the move in one undo step | **Live aborted** — `Exception: Fatal Error: ADeleteAction::Do`, SIGABRT on the main thread inside the LOM call (11:58) |
| Cmd-Z in Live after that load, NOT grouped | **Live aborted**, same fatal error, from the Edit menu key equivalent (12:09, the user's own undo) |
| `song.undo()` after such a load, not grouped, second try | **Live aborted** again (12:20) |
| Insert mode 0 (reads `True`), pad load | landed on the track (moved by the fallback) |
| Insert mode 1 or 2 (reads `False`), pad load | **landed on pad …/pads/36 (chain 1 → 2)** — five of five loads, no move |
| `song.undo()` after a chain-landed load | `'Undo Insert Device'`; the chain back to its DrumCell, the track untouched, `can_undo` False, `can_redo` True — **no crash** |
| `insert_device("Max Audio Effect")` with the default installed, before and after a Live restart | an empty Max Audio Effect (one parameter) both times |
| `device/move_to_end` of a Delay that had been on the track for a while, then `song.undo()` | `'Undo Custom Action'`, order restored, no crash |
| `device/move_to_end` of the track's long-standing Permute, then `song.undo()` | `'Undo Custom Action'`, order restored, no crash — moving a Max device is not the problem in itself |
| browser-load a second Permute onto the Shaker track, `device/move_to_top` within the same track, then `song.undo()` | **Live aborted** on that first undo (12:29) — the pad chain is not required; a browser-loaded device moved in the same session is |

The final pad code, on the rig after the next restart (12:40): the
production path logged `calling load_item('Permute') into pad …/pads/36
(chain has 1 devices, insert mode beside the selection)` and `landed on
pad …/pads/36 (chain 1 -> 2)` **72 ms after the request**, the insert
mode read as Live's default again afterwards, and `song.undo()` returned
`'Undo Insert Device'` with the chain back to its DrumCell and the track
untouched.

## Addendum — the same rule for the wah and Random Start (2026-09-14)

Asked whether the other load-and-move flows were exposed, the rig answered
before the code changed: a browser-loaded **native** preset (the backup
`Hybrid Reverb.adv`) sent to the top of the Shaker track with
`device/move_to_top`, then `song.undo()` — Live aborted, the same
`ADeleteAction::Do`. So the rule is about any device Live has just loaded
through the browser, not about Max devices, and the wah — 18 loads-and-
moves in this build's log alone — was one Cmd-Z from a crash.

- **`DeviceLoadComponent.load_into_track(track, path, at_head=True)`**:
  the track's first audio effect is selected, the device insert mode set
  to 1 (left of the selection — forced even when a Push left/right mode
  is already set, since a head load needs "left"), `load_item`, mode put
  back when it read as the default. A track with no audio effect gets the
  plain load, which appends: the head of the effects either way. A Live
  without the property loads where Live puts it and says so.
- **`WahPedalComponent`** loads through that (`LoopingSurface`'s
  `load_wah_into_track` passes `at_head=True`) and no longer has a
  `_pending_move_to_top`, a `_move_to_top`, or the "load in flight"
  latch guard that flag doubled as: the rack is in `track.devices` when
  the load returns, so the next freq frame resolves it and a fast
  rock-back finds the wah instead of stacking one.
- **`SimplerLoadComponent._ensure_random_start`** no longer moves
  `devices[-1]` to the top. Live lands a MIDI effect at the head of the
  chain on its own (measured 2026-09-11), which made that move target the
  wrong device and get refused ("Couldn't move device", the one time it
  ran in the logs). The utility now stays where Live put it; a Random
  Start behind the instrument is reported as a warning, not moved.
- Tests: the wah's move cases became placement cases (no `move_device`
  ever), the Simpler stub lands a MIDI effect at the head as Live does
  and the move-failure case became the behind-the-instrument warning
  case, and the loader gained head-load cases (ahead of the first audio
  effect, an effect-less track, a forced "left", no property, and the
  plain append unchanged).
- Rig (12:5x): an unrelated undoable write between the browser load and
  the move does not help. The first `song.undo()` took the write
  (`'Undo Change "Chance"'`), the second aborted Live. The move of a
  just-loaded device never appears as its own undo entry: Live folds it
  into that device's "Insert Device" entry, and undoing the merged entry
  is what aborts — which is also why a long-standing device's move (its
  own "Custom Action") undoes cleanly. `device/move_to_top` /
  `move_to_end` from the FX slot arrows therefore stay unsafe to undo
  for any device the browser loaded this session (rack and plug-in
  tiles, the instrument, the track's Permute); native tiles inserted by
  name and devices from the set file are safe. **Decision (the user,
  2026-09-14): the arrows stay as they are.** The alternative — the
  surface refusing a move of a session-loaded device — was offered and
  declined; the rule to keep is "no Cmd-Z in Live after moving a freshly
  loaded device". Choosing the position at load time (a tile option or
  long-press loading at the top through the insert mode) is the later
  workflow fix.
- Rig (12:51, after a restart with this code): `/looping/v3/wah/engage`
  with the wah-less Shaker track selected logged `loaded 'Wah.adg' ahead
  of 'Permute' on 'Shaker' (insert mode left of the selection)`; the
  track read `['Wah', 'Permute']` with the insert mode back at Live's
  default, and no move was made. Two `song.undo()` calls then returned
  `'Undo Change Plug-in Parameter List'` each — the rack's plug-ins stack
  those entries above the insert — with the devices unchanged and no
  abort; the "Insert Device" entry itself was not reached in this pass
  (it is Live's own browser insert, the kind that undid cleanly for the
  pad load). The test wah was removed with `device/delete`.

## Consequences

- A pad load through the browser is Live's own insert into the chain,
  about 110 ms for the Permute `.amxd`: no move, no track structural, no
  transient track-level engine instance, and Edit → Undo removes it
  cleanly.
- The insert mode is written twice per pad load. A performer's own Push
  insert-left/right setting on that track is preserved: the surface only
  changes a mode that reads as Live's default, and only for the call.
- **Never `move_device` a device Live has just loaded through the
  browser, if anyone might undo.** Measured: undoing the move of a
  long-standing device (native or Max) is clean; undoing the move of a
  Max device loaded through the browser in the same session aborts Live,
  within its own track as much as into a pad chain. The move fallback in
  this component still exists for a Live without the insert mode; on
  such a Live the hazard is as it was before this ADR. Two other flows
  carry the same pattern and are NOT changed here: `WahPedalComponent`
  (loads `Wah.adg`, a native rack, then `move_device` to the top of the
  track — not measured with a native device) and
  `SimplerLoadComponent._ensure_random_start` (loads the `random-start`
  Max MIDI effect, then `move_device` to the top — in practice Live
  lands a MIDI effect at the head already and the move is refused, one
  such warning in the 12.4.5b11 log). Both could use the insert mode
  instead: select the chain's first device, write 1 (left of the
  selection), load, put 0 back — no move at all.
- The tick-poll branch has not fired on the rig: Live shows the device on
  return.
- Where a MIDI effect lands with the insert mode set has not been
  measured (Permute is an audio effect).

## Tags

`device-load`, `drum-rack`, `pad-scope`, `permute`, `performance`, `undo`, `surface`
