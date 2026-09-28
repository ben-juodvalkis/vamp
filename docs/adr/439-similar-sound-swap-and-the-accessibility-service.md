# ADR-439: Similar-Sound Swap, and the Accessibility Service That Carries It

## Status
**Accepted** (2026-09-15). Phases 0–3 of the swap plan, all built and run
on the rig the same day (see the addenda for each phase's measurements).
Phase 4 — the similarity database as a preview / direct-pick layer — is
deferred to its own ADR, which is **ADR-440** (its minimal form, for audio
clips). Open findings against this implementation are
tracked in `documentation/swap-audit.md`; they are fixes to the decision
below, not revisions of it. Supersedes the assumptions in
ADR-368 (clip Reverse via AX click) about trust and Space; keeps its
decision.

## Context

The request: a **swap** button on every instrument central view. On a
Drum Rack it swaps the whole kit, or one pad when a pad is held (the
Move pad-hold / pad-grid hold-to-scope rule of ADR-432); on other
instruments — Omnisphere patches, instrument racks — it steps to the
neighboring preset. Everything below was measured on Live 12.4.15b2
(Beta, build 2026-09-07) on the rig, 2026-09-15.

### There is no Python verb for similarity

Step 0 asked whether Live exposes its similar-sample feature to
Python. It does not, on any level: `dir(browser)` (31 names) is the
12.3.6 list plus listener accessors; `Live.Browser.FilterType` is
`disabled, hotswap_off, instrument_hotswap, audio_effect_hotswap,
midi_effect_hotswap, drum_pad_hotswap, midi_track_devices, samples,
count`; `BrowserItem` has nine attributes; `SimplerDevice` (99 names)
has `replace_sample` and nothing similar; **`DrumCellDevice` (40
names) has no sample verb at all**. Probed through a new `app` root and
`/looping/probe/py_introspect` on `DebugComponent` (commit 34309e79).

### The ranking is reproducible from Live's own index

Live's indexer stores one 64-float embedding per audio file in
`~/Library/Application Support/Ableton/Live Database/Live-files-12300.db`,
table `fe_values` (240,472 rows here; 268-byte blob = header
`(version 18, dim 64, 0)` + 64 × float32; not unit-normalized). The
binary's query template (`kEverythingSimilar_QTmpl`) orders candidates
by `approximatedistance(base, file)`, collapses duplicates by an
audio-content `hash`, and exposes the exact `featuredistance` as the
`distance` column. Against Live's own View → Show Similar Files list for
`Kick-SessionDry-Felt-Soft.aif` (22 rows read off the screen), **plain
Euclidean distance reproduced the list in exact order** (20/20 adjacent
pairs); L1, cosine and dot product each broke inside the top ten.
Vectors also exist for 6,985 `.adg` and 3,562 `.adv` sample-based
presets, so "similar" can extend to Live's own instrument presets — not
to Omnisphere patches, which are AU state and carry no vector.

The embedding model itself is off-limits: the `Ableton Index` process
loads it from four `Builtin/Models/*.dat` files that begin `Salted__`
(openssl-encrypted). Same rule as `.alp` content protection — we rank
from stored vectors and never embed audio ourselves. Only files inside
an indexed Place get a vector, which covers Current Project, User
Library and every sidebar Place.

### Two ways to put a sample on a pad, measured

| | `device/load` into the pad (ADR-437 path) | Live's own swap buttons, pressed via macOS Accessibility |
|---|---|---|
| what happens | Live **replaces the DrumCell with a new device** named after the sample | Live swaps the sample **inside** the DrumCell (same `_live_ptr`) |
| settings | reset (Transpose, Decay measured) | kept (Decay 0.5 survived every step) |
| effects after the instrument, chain volume | kept | kept |
| chain name | unchanged | unchanged |
| undo | one "Insert Device" step **per pad** | one step for the whole kit, "Undo Next Similar" |
| single pad | 84–135 ms request → readable | **29 ms** next, 24 ms previous |
| whole kit (30 pads) | ~3 s serial | **459–547 ms** warm; first cold pass ~5 s |
| previous / return | re-load the old sample | Previous restores the kit exactly (0/32 pads differ) |
| locks | ours to build | per-pad "Lock Pad for Similar Sample Swapping" checkbox |
| ranking | ours (L2 over `fe_values`) | Live's, with Live's reference sample |

The AX controls, with stable identifiers:

- `TrackView.Device[N].TitleBar.ShowSwapBar` — "Show/Hide Similar
  Sample Swap Buttons"; the buttons are absent from the tree until on.
- `TrackView.Device[N].TitleBar.SimilaritySwapView.SwapNext` / `SwapPrev`
  — "Swap All Pads to Next / Previous Similar Sample" (beta-only today).
- `TrackView.Device[N].pad_collection_view.Border.SwapBar.Next` /
  `Prev` / `Lock` — one triple per visible 4×4 pad. Identifiers repeat
  per pad; pads are addressed by grid order, the grid is scrolled with
  `RackDevice.View.drum_pads_scroll_position` (LOM).

`AXPress` blocks until Live finishes, so its duration is the swap time.
**Live full-screen on its own Space is fine, active or not** — Swap All
measured 506 / 458 ms with Terminal's desktop as the active Space
(Live's `AXWindows` reads empty then; `AXMainWindow` still resolves).

### What makes AX unreliable today is not the tree

- **Trust belongs to the launcher.** `AXIsProcessTrusted()` is False
  from every shell under the Claude app, and the running bridge inherits
  whatever identity `npm run dev` was started from. The two existing AX
  handlers — `interface/bridge/handlers/liveAxClick.js` (clip Reverse,
  ADR-368; **deleted by this ADR** — its job is now the helper client, dialed
  from `WebSocketServer.js`) and `liveSaveAs.js` (the Save As dialog, ADR-405)
  — are each
  their own `osascript … tell process "Live"` copy, both assume Live is
  frontmost and on the active Space, and both silently no-op without
  trust. Terminal.app is trusted on this machine; nothing else is.
- **The surface runs on Live's main thread, and so does AX servicing.**
  A Python handler that blocks waiting for a helper's press to complete
  cannot be answered: Live's run loop must be free to service the AX
  message. Any compound operation therefore has to be orchestrated
  outside Live.
- The view must show the target: the rack has to be the device in
  Live's device view (`TrackView.Device[N]`) with the swap bar on and the
  pad grid scrolled to the pad.

### Nothing records a track's current preset

Folder-next needs a "current" to step from. Live's per-track store
(`Track.set_data`, ADR 3.7.0) holds only `looping.role`. Replace-
instrument mode (`prepare_for_preset` with `target_track_path`,
ADR-390) already swaps an instrument in place with clips, Permute and
FX preserved — it needs to be told which preset is next.

## Decision

Four phases. 0 and 1 are the accessibility service; 2 is the shared
vocabulary and the non-sample instruments and depends on neither; 3 is
the kit and pad swap on top of all three.

### Phase 0 — a trusted identity

An **`Looping AX Helper`** process with its own, stable identity — an
app bundle with its own bundle id, launched by a LaunchAgent — granted
Accessibility once in System Settings, exposing a local socket the
bridge dials. It is the only process that touches AX. The exact
packaging follows the accessibility research thread's conclusion; the
requirements it must meet are fixed here:

- Trust survives a reboot and does not depend on which app started
  `npm run dev` (acceptance: `AXIsProcessTrusted()` true from the helper
  after a cold boot; one harmless press — Tap Tempo — verified by a
  `Song.tempo` read through the surface).
- The bridge reports the helper's state on its existing presence
  channel; an untrusted or absent helper is a **named error** to the UI
  (`ax-untrusted`, `ax-helper-down`), never a silent no-op.
- The helper is pyobjc (the probe scripts already are) run through
  `uv`; per-request `AXUIElementSetMessagingTimeout` of 15 s, because
  the cold first kit pass takes ~5 s and the default timeout returns
  `-25204` although the swap completes.

### Phase 1 — the verb core, and the two existing handlers move onto it

A small library inside the helper, not a UI-automation language:

1. **Targets** are looked up by `AXIdentifier` from `AXMainWindow`
   (never from `AXWindows`, which is empty whenever Live is not
   frontmost), with `AXDescription` as the fallback for controls that
   carry no identifier (device parameters), and the role verified before
   any action. Grid-repeated identifiers (the pad SwapBars) are
   addressed by an index in tree order plus the LOM scroll position.
2. **Verbs**: `press`, `show_menu` + `pick`, `increment` / `decrement`,
   `read` (value, enabled, position), `wait_for` (a notification or a
   value). Nothing that sets `AXValue` on a slider or checkbox — measured
   to return 0 and change nothing.
3. **A smoke check at helper start**: every identifier the bridge
   depends on is looked up once and logged; a missing one is reported at
   boot, not discovered on stage. This is the guard against Live
   renaming a control at the 12.4 release.
4. **Preconditions are errors, not fallbacks.** Untrusted, helper down,
   control not found, control disabled → named errors. There is no
   degrade to the `device/load` route: two mechanisms for one gesture is
   how a swap "sometimes resets my decay".
5. `liveAxClick.js` and `liveSaveAs.js` become bridge calls into the
   helper (`press` on the Clip Detail Reverse button by description;
   the Save As keystroke sequence as a helper verb). **As built,
   `liveAxClick.js` was deleted rather than converted** — the Reverse route
   is one address-handler entry in `WebSocketServer.js` — while
   `liveSaveAs.js` stayed and calls `save_as_dialog`. The Save As "keystroke
   sequence" did not survive either: keystrokes posted to Live never reached
   the panel's field, so the verb writes `AXValue` instead. Their two features
   are the regression test for phases 0–1, and the `osascript` copies
   are deleted.

### Phase 2 — the swap vocabulary, and the non-sample instruments

Independent of the helper; starts now.

> **Superseded** — see *The swap row becomes a pill* below: Commit and Return are gone end to end, and with them the bridge-counted reference. Kept here as the decision that was taken and then reversed the same day.

- **Every swap is anchored to a reference.** The controls on an
  instrument view are **◂ Prev · Next ▸ · Commit · Return**. Prev/Next
  walk a list computed once from the reference (Live's own list for
  kits and pads; catalog folder order for presets); Commit re-anchors
  the reference to the current pick; Return restores the reference.
  Every step is one Live undo step anyway. The shape copies Live's own
  Next / Previous / Update Reference / Return to Reference.
- **`looping.preset`** joins `looping.role` in the track's data store:
  the path of the preset the last `prepare_for_preset` / replace-
  instrument load used, written on the ack path like the role, carried
  on the T record. Tracks predating it carry none until reloaded, and a
  view with no `looping.preset` shows the swap controls disabled.
- **Folder-next** for an instrument with no vector (Omnisphere and every
  plug-in preset): the UI takes the neighbor of `looping.preset` in
  the generated per-type catalog and issues `prepare_for_preset` with
  `target_track_path` — replace-instrument mode, unchanged. AU loads are
  1.5–3 s, so the view shows a working state and the gesture is meant
  between phrases, not mid-phrase.
- **Pad labels read the instrument's name, not the chain's.** Both swap
  mechanisms leave `DrumChain.name` stale; the census `pads[].name`
  moves to the pad's first instrument's `name`, and a `DrumCellDevice`
  / `SimplerDevice` `name` listener re-emits the census so a swap made
  in Live's own UI shows up on the iPad as well.

### Phase 3 — kit and pad swap through Live's buttons

The **bridge** orchestrates one compound verb, `drum/swap_similar
[rackPath, scope, direction]` with `scope ∈ {kit, pad:<note>}`:

1. Bridge → surface: make Live show the target — select the rack's
   device (`device/select`), turn the swap bar on if the helper reports
   it off (`ShowSwapBar` press, once per rack), and for a pad scope set
   `drum_pads_scroll_position` so the pad's row is visible. Acked.
2. Bridge → helper: `press` `SimilaritySwapView.SwapNext` / `SwapPrev`
   for a kit, or the pad's `SwapBar.Next` / `Prev` for a pad. The helper
   blocks for the press (24–550 ms) and returns.
3. Bridge → surface: read back — the instrument names of the affected
   pads (the census re-emit from phase 2 covers it; the bridge also asks
   explicitly so the reply to the UI carries what changed). A pad whose
   neighbor has the same file stem reads unchanged and is reported as
   such, not as a failure.

Decisions inside phase 3:

- **Candidate scope is Live's — everything indexed.** No Place or pack
  filter in this ADR; the ranking was verified against exactly that.
> **Superseded** — see *The swap row becomes a pill* below: Commit and Return are gone end to end, and with them the bridge-counted reference. Kept here as the decision that was taken and then reversed the same day.

- **Reference and Return are counted by the bridge**: it holds the step
  count per rack and per pad since the last Commit; Return presses Prev
  that many times (24 ms each). If Live's own Update Reference / Return
  verbs turn out to be reachable (they are in the binary as AX labels —
  `sAxUpdateSimilarSampleReference`, `sAxReturnToSampleReference` — but
  not in the tree; the pad's context menu is the likely place), they
  replace the counter.
- **No lock UI.** A held pad swaps that pad, the kit button swaps the
  rest; Live's per-pad Lock checkbox stays available through the same
  verb layer when a session shows the need.
- **No Move encoder binding** in this ADR.
- **Kit swap is allowed with the transport running**; the ~0.5 s warm
  cost is Live's own UI cost and lands in one undo step. The cold pass
  per kit (~5 s) gets a working state in the UI and the 15 s helper
  timeout.
- Simpler-based pads go through the same buttons — Live puts the swap
  bar on Simpler and Drum Sampler views alike (`ASimplerView::
  SimilaritySwapButton` in the binary); measured on DrumCell only so
  far, so phase 3 begins with a Jazz-kit (Sampler pad) check.

## Consequences

- Kit swap costs ~0.5 s and one undo step, keeps every pad's settings
  and effects, and is Live's own ranking with Live's own reference —
  nothing to reverse-engineer at runtime and no format-stability risk
  in the hot path. The `device/load` replacement route measured here is
  not used for swapping; it stays what it is, the way a *chosen* sample
  is loaded (phase 4).
- The similarity database work of this session becomes the display
  layer, not the engine: previewing what Next will be, and jumping to a
  specific candidate, are phase 4.
- The accessibility service pays for itself beyond swapping: Reverse
  and Save As stop depending on which terminal launched the bridge,
  and Freeze / Bounce / Consolidate become one-line verbs.
- New moving part: a helper process with its own permission grant and
  its own failure modes, surfaced as named errors. A Live update can
  rename a control; the boot smoke check turns that into a log line
  rather than a dead button.
- The rack-level Swap All buttons are beta-only today. If 12.4's
  release ships without them, "kit" degrades to per-pad presses through
  the same verb — 30 × ~29 ms ≈ 0.9 s, one undo step per pad — and this
  ADR gets an addendum, not a rewrite.
- `paths.placesRoots` now lists `Samples Organized` (commit a19909a6),
  needed by phase 4 only; harmless before it.

## Open questions

Answered the same day, on the rig (Live full-screen, Terminal's desktop
active — every result below was obtained off-Space):

1. **The swap controls exist only while the rack's track is selected.**
   With another track selected, `TrackView.Device[0]` is that track's
   device and the tree holds no SwapBar or SwapAll at all; they return
   the moment the rack's track is selected again. The Drum Rack's title
   bar has no fold button (`ExtendViewButton` is absent on it), so
   folding is not a state to handle. **The pads themselves are not AX
   elements** — the grid exposes exactly the 16 `SwapBar` triples and
   nothing else — and their positions moved between two runs (y 987 →
   938 after full-screen), so the verb resolves grid order per call and
   never caches a position.
2. **Live's Update Reference / Return to Reference verbs are not
   reachable through AX.** No pad cell to open a menu on; `AXShowMenu`
   on the SwapBar buttons and on Swap All opens nothing; the nested Drum
   Sampler view (`TrackView.Device[0].Device[0]`) exposes its parameters,
   title bar, Save / Hot-Swap / Show Options — no waveform, no sample
   name, no swap bar of its own; its context menu is the device menu
   (Drum Sampler → Simpler, Compare, Fold, …). The bridge-counted Return
   is the design, not a fallback. **Superseded** — see *The swap row becomes
   a pill* below; there is no Return to count for. (Context menus did open with Live's
   Space inactive.)
3. **`ShowSwapBar` persists across track selection** — still on after
   selecting Operator and returning; per-set / per-session persistence
   is unmeasured and irrelevant to the verb, which reads the checkbox
   before it presses.

To be measured during the build (implementation, not design) — **both were,
later in this file; answers linked below:**

4. ~~Sampler-pad kits (Jazz): same buttons, same timings?~~ **Answered** —
   see *Open question 4 — a Sampler-pad kit* in the phase-3 addendum. Same
   buttons; Swap All presses (517 ms cold, then 10–18 ms) and changes 0/32
   pads, because a multisampled kit has nothing for Live to rank, and every
   pad's SwapBar button is disabled.
5. ~~What the surface sees when Live's own UI swaps a pad — the DrumCell
   `name` listener is the assumed signal.~~ **Answered** — the assumption
   holds: a swap through Live's own pad button re-emitted the pad census
   126 ms later with the new name. See the `name`-listener paragraph in the
   phase-3 addendum.

## Addendum — the swap on the rig, end to end (2026-09-16)

Measured through the bridge's WebSocket against Live 12.4.15b2, on a scratch
MIDI track carrying `606 + 808 unmapped` (24 pads with chains).

| | Cold (first swap after the kit loaded) | Warm |
|---|---|---|
| `showMs` (the surface hop) | 8 | 11 |
| `pressMs` (Live's own Swap All) | **6750.7** | **310.4** |
| `totalMs` | 6816 | 348 |
| pads changed / unchanged | 23 / 1 | 23 / 1 |

Three things follow.

**The cold press is slower than this ADR recorded.** 6.75 s against the ~5 s
measured at the time. It still lands, which is itself the check on M22: the
helper's default `AXUIElementSetMessagingTimeout` is 6 s and returns −25204 on a
press Live completes, so a 6750 ms press *succeeding* proves the configured
`axHelper.messagingTimeoutS` (15) reached the request. The literal that used to
sit beside it would have outranked the knob silently.

**`renamed: 0` with an empty `finishDetail`.** This kit's chains are not named
after their samples, so nothing needed renaming — and the reply says that
differently from "the renames were dropped", which is the whole of M4.

**A second swap on the same rack is refused in 1 ms.** Two requests fired
together: the second answered `swap-busy` synchronously, before `show_for_swap`
moved Live's view; the first completed normally (M8).

**Save As, second run.** With the panel already open, `save_as_dialog` answers
`ax-control-disabled: menu.save_as is disabled in Live's UI` — Live disables its
own menu item behind the modal. The name does **not** silently become take
N+1's, which was open question H3. The first run measured `panelMs` 1593 and a
`fieldPid` equal to Live's own pid. The refusal is pre-press, so nothing is
disturbed.

**Undo steps do not nest.** `begin`/`begin`/write/`end`/write/`end` produced
**two** undo entries, not one — see `docs/reference/live-api-measurements.md`. The step
this ADR holds open across a swap is therefore not safe against anything else
that opens and closes its own (a Drum Rack macro move does). The window is now
bounded at 45 s and measured at 6.8 s cold; the redesign that would remove the
hazard entirely is tracked in `documentation/swap-audit.md` §6.

## References

- Measurements and recipes: memory notes
  `project_no_python_similarity_hook`, `project_similarity_db_facts`,
  `project_pad_sample_swap_mechanics`, `project_live_ax_ui_tree`,
  `project_ax_trust_identity_and_probe_recipe`.
- ADR-368 (Reverse via AX click), ADR-390 (replace-instrument mode),
  ADR-405 (Save As on transport stop), ADR-428 (drum virtual macros),
  ADR-430 / ADR-437 (pad chains and pad loads), ADR-432 (pad hold).

## Addendum — phases 0–1 as built (2026-09-15)

Decisions this ADR left open, and what was measured while building them.

**Packaging.** `~/Applications/Looping AX Helper.app` (bundle id
`com.benjuodvalkis.looping.ax-helper`, built by `npm run install-ax-helper`)
holds a small Swift launcher; its LaunchAgent (`RunAtLoad`, `KeepAlive` on a
crash, `ProcessType Interactive`) starts it at login. The launcher *spawns*
`uv run --frozen --project owner/ax-helper python -m looping_ax_helper` as a
child — never `exec`, because TCC checks the responsible process's code
signature and `exec` would swap the signed binary for uv's — and reads that
command from its sealed `Info.plist`, never from argv, so the trusted
identity cannot be aimed at another program. It is signed with the Apple
Development certificate, whose designated requirement is certificate-based,
so a rebuild keeps the grant. Measured once granted: the launchd → launcher →
uv → Homebrew `Python.app` chain reports `AXIsProcessTrusted() = True`, i.e.
TCC attributes the Python child to the app.

**A grant does not reach a process that is already running.** Measured:
`AXIsProcessTrusted()` kept answering False in the helper that was running
when the switch was flipped, and True from a restarted one. An untrusted
helper therefore asks a fresh child process every 5 s (same responsible
launcher, same grant, no cached answer) and re-executes itself when the
child says yes.

**Transport.** An owner-only Unix socket (`axHelper.socketPath`, mode 0600 in
a 0700 directory) rather than a TCP port — whoever can connect can press
anything in Live. One JSON object per line each way, matched by id. Verbs run
serially on the helper's main thread (notification waits need a run loop,
and Live services AX one message at a time anyway); `status` is answered on
the connection's reader thread without messaging Live, so a 5 s cold kit swap
in flight never makes the bridge think the helper died.

**Named errors.** From the helper: `ax-untrusted`, `ax-live-not-running`,
`ax-no-main-window`, `ax-control-missing`, `ax-control-disabled`,
`ax-wrong-role`, `ax-timeout` (−25204), `ax-action-failed`, `ax-bad-request`,
`ax-unknown-target`, `ax-unknown-verb`, `ax-busy`, `ax-menu-missing`,
`ax-item-missing`, `ax-wait-timeout`. From the bridge: `ax-helper-down`.
`/bridge/ax_helper [state, detail]` carries `ready` / `ax-untrusted` /
`ax-helper-down`; `/cmd/clip/reverse/ack` carries `[0, code, detail]`.

**The screen lock hides Live's windows.** Measured with the screen locked:
`AXMainWindow` and `AXFocusedWindow` answer with the *application element*
itself (not nil), `AXWindows` is empty, and only the menu bar can be reached.
A "main window" whose role is not `AXWindow` is `ax-no-main-window`, and the
boot smoke check waits for a real window instead of reporting every control
missing (its first run, before this rule, did exactly that). Every AX-driven
control — and every AX acceptance test — needs the screen unlocked.

**Target catalog and smoke check.** Controls are named in
`owner/ax-helper/looping_ax_helper/targets.py`: an identifier (with small
integer `{params}`) or a description inside a named container, a role, and a
`context` saying when the control exists. The smoke check runs once per Live
launch after its window has existed 3 s; a missing control with no context
is logged at ERROR, a contextual one as "not showing".

**Save As.** `save_as_dialog` was first the old keystroke sequence moved into
the helper — ⌘⇧S read off Live's menu bar (`AXMenuItemCmdChar "S"`,
`AXMenuItemCmdModifiers 1`) and posted to Live's pid, then ⌘A and the name —
and on the rig it failed: the panel opened, but its name field still read
"Untitled" a second after the name was posted. The field belongs to Live's
own process (`AXUIElementGetPid` answers Live's pid) and the panel is a
separate `AXDialog` window titled "Save", so the cause is not an
out-of-process panel; what is known is only that pid-posted key events do not
reach that field, and a keystroke that misses it is a keystroke into Live.
The verb now sends no keystroke: it raises Live (`AXFrontmost`), presses the
Save Live Set As menu item, waits for the name field to take focus, writes the
name into its `AXValue` and reads it back — measured: the field focused
448 ms after the press and read the written name, and Escape closed the
panel.

**Tap Tempo is not harmless on this rig.** Measured on Live's Options menu:
"Start Transport With Tap Tempo" is checked. Two taps did not start the
transport: the phase-0 acceptance run pressed Tap Tempo twice through the
helper, 506 ms apart, from a shell with no Accessibility grant (presses of 9.3
and 2.7 ms), and `Song.tempo` read 111.0 → 118.80 with `is_playing` still
False; `song.undo()` answered `Undo Change "Song Tempo"` and the tempo read
111.0 again.

**Diagnosis without Terminal.** The helper's read-only `dump` verb (nodes
under a root, filtered by a pattern, plus a summary of Live's windows)
replaces the `open -a Terminal x.command` recipe once the helper is trusted:
`python -m looping_ax_helper.client dump '{...}'` from any shell.

## Addendum — phases 2–3 as built (2026-09-15)

**`looping.preset` is written by the surface, not on the UI's ack path.** The
ADR said "written on the ack path like the role", but the role is sent by the
UI after the ack, and only the surface knows a load landed; a write inside the
prepare handler also reaches the T record before the load's structural
republish. On the rig each Omnisphere prepare load read back
`get_data("looping.preset")` as the preset's path and echoed
`/looping/v3/track/preset` once. **Live's undo does not touch the key:** after
undoing four loads the track still named the last one, so a folder-next load
undone from Live's Edit menu leaves the swap control's reference stale until
the next prepare load — the same staleness as a replacement by any other means.

**Pad labels read the instrument on sample pads only.** The ADR moved
`pads[].name` to the first instrument's name on every pad. As built, a Drum
Sampler or Simpler pad reads its instrument (the rig's stale chain: pad 38's
chain `Snare-SessionDry-Stick-Hit-Soft`, its Drum Sampler
`…-Hit-Medium`; measured later the same day, only Live's Swap All leaves a
chain behind — a pad's own swap button renames the chain with the instrument,
on pads 36 and 51 alike), while an Operator, plug-in or Sampler pad keeps the chain's
name — their device name names the device, not the sound — and so does an
instrument still at its default name. The `name` listener rides the same pads:
a swap through Live's own pad button re-emitted the census 126 ms later with
the new name (open question 5).

**One swap row, above the view.** `SwapControl` is mounted once, at the top of
the central frame, for every instrument view rather than inside each view, with
the view's `data-density` mirrored so ADR-434's inset still holds — all 35
central tour states pass the layout check with it. On a Drum Rack it steps the
kit, or the scoped pad: held, latched or held on the Move. Folder-next's list is
the catalog leaf holding the exact recorded path, in catalog order, wrapping at
the ends; its Commit and Return are client-side. **Superseded 75 lines below,
in this same addendum** — *The swap row becomes a pill* removes both.

**Phase 3's hops, as built.** Step 1 is `show_for_swap`, which selects and
scrolls; the ShowSwapBar read and press moved into step 2 with the rest of the
AX work, since the surface cannot read a checkbox. The surface answers
`pad_names` before the press as well as after. Replies have a fixed arity,
`[requestId, ok, code, detail, …]`, and the bridge prefixes a surface code with
`swap-`.

**Rig acceptance** — Live 12.4.15b2, the Plymouth kit, through a bridge
launched from a Claude.app shell (no Accessibility grant), every result read
back through the surface's probe independently of the bridge's own reads:

| Check | Result |
|---|---|
| Kit Next, cold, swap bar off | bar pressed, then a 3209 ms press; 30/32 pads changed |
| Kit Next / Previous, warm | presses 510–520 / 447–464 ms; 476–547 ms end to end |
| Next then Previous | 0/32 pads differ from the reference, three times |
| Live's undo of a kit Next | one step, `Undo Next Similar`; 0/32 differ after it |
| Identity and settings | 32/32 instruments keep their `_live_ptr`; a marked Decay (0.863) unchanged |
| One pad | presses 26–33 ms, 63–79 ms end to end; only that pad changed |
| Grid order | index 3 swapped note 51, index 12 note 36; note 67 scrolled the grid 9 → 13 |
| Return | each pad back to its name; the scroll restored |

**Open question 4 — a Sampler-pad kit.** The catalog's 32 Pad Kit Jazz, a
top-level Drum Rack of 31 Simplers in Multisample Mode (`SimplerDevice.sample`
reads `None`) and one Sampler: Swap All is enabled and presses — 517 ms with
the bar turned on, then 10–18 ms — and changes 0/32 pads; every pad's SwapBar
button is disabled, so `pad.swap_next` answers `ax-control-disabled` for the
Sampler pad (65) and a Simpler pad (36) alike. A multisampled kit has nothing
for Live to rank. The bridge still counts a step for a kit press that changed
nothing, and Return then presses Previous, which changes nothing either. The
"mapped" Packs copy of the kit wraps the Drum Rack in an Instrument Rack, which
the verb does not address: it takes top-level Drum Racks only.

**Folder-next on Omnisphere, measured.** Loading the catalog neighbor onto a
track already holding Omnisphere acked in 178 ms (Aged → Ballad, and back); the
first Omnisphere load onto the track acked in 2041 ms. Each patch change leaves
a string of `Change Plug-in Parameter List` steps in Live's undo history — 68
across three loads — so undoing a folder-next session by hand is a long walk;
Return is the way back.

**`prepare_for_preset` with no target reuses a clip-less selected track.** The
rig run's first load, sent without `target_track_path`, replaced the Plymouth
kit on its own track (a MIDI track with no clips reads as reusable). That is the
existing reuse rule, not new; rig checks now create a track and pin the load to
it.

**Chain names follow the sample (added the same day, after the run).** A
swap through the swap row now renames each pad's chain that was named after
its old sample, so Live's own pad grid stops naming the previous file; a
chain with a name of its own ("606 Kick") keeps it. The renames share the
swap's undo step: the surface opens the step in `show_for_swap`, before the
press, and a fourth hop, `finish_swap`, renames and closes it. Measured before
building it, by hand through the probe and the helper: `begin_undo_step`, a
kit Next (30 samples changed), 29 chain renames, `end_undo_step` — one
`song.undo()` answered `Undo Next Similar` and put all 30 samples and all 29
names back (pad 38's chain already named another sample, so it was kept).
Swaps now also run one at a time across every rack rather than per rack: each
selects its own rack's track, so two at once could press each other's buttons.
The track name is left alone on a kit or pad swap — no single new name
exists — and folder-next already renames the track through the browser's
loader. Verified after a Live restart onto the new surface, through the
bridge: a kit Next changed 30 samples and renamed 29 chains, pad 38 keeping its
own; one `Undo Next Similar` put all 30 samples and 29 names back; a pad Next
and its Return needed no rename, because Live's pad swap button renames the
pad's chain itself (measured directly on pads 36 and 51, one `Undo Next
Similar` each).

**`looping.preset` persists (verified the same day, afterwards).** A preset
load pinned to a new track recorded the Wavetable `Default.adv` path; Live's
own Save Live Set wrote it into that track's `ViewData` in the `.als` (read
from the gunzipped file); after quitting Live and opening the saved set again,
`get_data("looping.preset")` on the track answered the same path.

**The swap row becomes a pill (the same day, the user's call).** Commit and
Return are gone, end to end. The control is the loaded name between two
arrows, left-aligned above the view; a press on the pill's left half steps
back, on its right half forward — two half-width buttons under one centered
name, each with its own press (ADR-427). The reference went with the two
buttons: folder-next keeps no reference index, the bridge counts no steps, and
`drum/swap_similar` takes `next` or `prev`, one press per request, with no
`steps` in its reply. Phase 2's "every swap is anchored to a reference" is
superseded; Live still keeps the reference sample its ranking starts from,
which Commit never moved. What it costs: the way back from a folder-next walk
is as many presses the other way, or the browser, where Return was one press
(an Omnisphere session's undo is the long walk measured above); and a kit swap
changes nothing on the pill, which names the rack — the pill dims while Live
works, and the pad tiles show the new names. A pill that cannot step shows why
in place of the name (`ax-helper-down`, `ax-untrusted`, `No preset recorded`,
a failed swap's code), so a refusal is still named on screen.

**After a cold boot (the same afternoon).** The helper logged its grant at
13:22:51, 34 s after the Mac booted and before Live launched, and its smoke
check found every control Live was showing. In an `npm run ipad` session the
transport-stop Save As worked (the user's report; the bridge wrote its name
counter at 13:24). A default set re-saved with instruments loaded from the
app's browser carries `looping.preset` on both instrument tracks, in both files
Live wrote at 13:26 (`User Library/Templates/Untitled.als` and
`BaseFiles/Untitled.als` in Live's preferences), so a new set starts with both
tracks swappable.

**Not verified on the rig:** the manual checklist walk. (The pill by hand *is*
verified — twice, further down this addendum: the user swapped presets from it
and then pads from it and confirmed both. What had never been walked is
`docs/reference/manual-test-checklist.md`, which had no swap/pill
section at all until §13 was added.)

**One pad through its Drum Sampler (the same day, the user's call).** A press
of a pad's `SwapBar.Next` / `Prev` in the rack's grid makes Live play the pad;
the Next / Previous arrows on the pad's Drum Sampler's own waveform display
swap without a sound (both heard on the rig). A pad swap now goes through the
Drum Sampler; a kit swap stays on Swap All, whose sound is fine. Measured
before building, on pad 37 ("Snap PrimeOne") of the Memphis Studio + Plymouth
kit, with Live neither frontmost nor on the active Space:

- The arrows are Accessibility elements only while a pointer is over the
  waveform: `TrackView.Device[N].Device[K].WaveformDisplay.SimilaritySwapView.Prev`
  / `Next` ("Swap to Previous / Next Similar Sample"), beside an unidentified
  "Hot-Swap Sample" button. With no pointer there, the Drum Sampler's group
  holds its title bar and parameters and nothing else — what open question 2
  found. The rack's swap bar need not be on.
- Mouse-moved events posted to Live's process (`CGEventPostToPid`, no button),
  13 moves 15 ms apart gliding from the device's left edge to (+126, +53) of a
  490 × 190 Drum Sampler, put all three buttons in the tree within 0.4 s; they
  were still there 1.9 s later with nothing more posted.
- `AXPress` on Next took 28.9 ms and on Previous 25.7 ms. The instrument kept
  its `_live_ptr` and its Decay (1.0), Live renamed the chain with the sample
  (`Snap PrimeOne` → `Snare PinkLazers 1` → back), and the kit track's
  `output_meter_level` read 0.0 in all 48 samples around each press.

As built: `show_for_swap` also selects the pad, so the device view shows its
chain. The helper gains a `hover` verb — mouse moves only, posted to Live, to a
point the target names (`sampler.device`: 0.26 × 0.28 of its frame), then a
wait for what it should reveal, re-posted once on a miss — and the
`sampler.device` / `sampler.swap_next` / `sampler.swap_prev` targets; it loses
`pad.swap_next` / `pad.swap_prev`. The bridge refuses a pad whose first
instrument is not a Drum Sampler (`swap-not-a-drum-sampler`), finds the Drum
Sampler among the first four devices of the pad's chain by its title — which is
also the proof that the view shows that pad (`swap-sampler-not-in-view`) —
hovers, and presses. The show ack keeps its arity; its `scroll` and `gridIndex`
no longer address anything.

**Verified through the bridge on the rig**, after a full Live restart onto the
new surface and a helper restart onto the new verb, with the WebSocket request
the pill sends, on pad 37 of the kit (`Rim 3k Sharp`, a Drum Sampler) with pad
36 selected beforehand: `show_for_swap` selected pad 37; the Drum Sampler was
found at `Device[0]`; hovers took 248–283 ms and presses 14–35 ms (181 ms for
the first press after Live launched), 329–558 ms end to end; the kit track's
`output_meter_level` read 0.0 in all 92–108 samples around each of six presses.
Next, Next, Previous, Previous read back through the surface probe as
`Rim 3k Sharp` → `Rim 3k Sharp` → `42606 RimShot SouSoul` → `Rim 3k Sharp` →
`Rim 3k Sharp`: the instrument kept its `_live_ptr` throughout, Live renamed the
chain with the sample, and Live's Edit menu read `Undo Next Similar` after each
Next and `Undo Previous Similar` after each Previous. The first Next landed on a
sample of the same name — Live's file database holds three files named
`Rim 3k Sharp`, one `.aif` and two `.wav` — which the reply reports as
`changed: false` rather than a failure. The user then swapped pads from the
pill by hand and confirmed it works.

**Not verified on the rig:** a Simpler pad's own arrows (refused, not measured);
a Drum Sampler behind a MIDI effect; a folded Drum Sampler; a Live zoom other
than 100 %.

**The pill stands on the left (2026-09-15, the user's call).** As a row above
the view it pushed every instrument view down — 52-60 px of a 329 px central
band, on views laid out for the whole of it. Stood on its end at the left of the
frame it costs width instead, which is the axis with room: the views get the
band's full height back (327 px, where the row left them 267-275) and give up
the same 52-60 px of 1062 px across. The column is `--height-touch` wide (44 px,
the touch floor in its narrow axis) and as tall as the frame's content; the up
arrow at the top steps back and the down arrow at the foot forward, down being
the order a catalog folder lists its presets in; the name lies between them in
`writing-mode: vertical-rl`, turned 180 degrees so it reads bottom to top, and
ends in an ellipsis at the reading end when it is longer than the column
("Memphis Studio + Plymouth ..." for a 509 px kit name in a 309 px column).
`CentralDisplay`'s frame is a row rather than a column, so the view is the
stretched flex item beside the pill and keeps a definite height for its `h-full`
children.

Measured under the shot harness's central tour, through a mock on a port of its
own while the rig held :8081: **all 35 states layout-checked and photographed,
plus a kit renamed longer than the column, 36/36 clean**, and the four states
worth a second engine repeated on **WebKit**, the iPad's, which lays the vertical
name out identically (`vertical-rl`, 24x309, ellipsised). A press on the top half
sends the previous catalog neighbor's `prepare_for_preset` and on the bottom
half the next (Drift: Darkened Strings / Drama Synth), and a kit's halves send
`drum/swap_similar ... prev` / `next`.

**The layout check now measures where a box is painted.** A `Range` reports a
whole text run, ellipsis or not, so the clipped kit name read as 144 px of
content above the frame and failed a check nothing on screen violated. Every box
- text runs included - is now cut to the ancestors that clip their overflow
(`scripts/shot/layout.mjs`). The gate's real catch is intact, and measured so:
with `overflow: visible` forced onto the name **and the pill** - the pill clips
it too, which the first attempt at this proof missed, so nothing overflowed and
the run proved nothing - the same text fails the check again, `inset: top 0px,
want 8`, the frame's own clip the only one left.

## Addendum — a greyed button is read, not pressed, and a refusal does not stay on the pill (2026-09-15)

From the first real "why can't I swap this kit": the pill wore
`ax-control-disabled` and kept wearing it.

**What Live was doing.** Its swap buttons are driven by the similarity
embeddings, and it greys them out — *both* directions, with the swap bar
on — when its index holds none for the samples on those pads. Measured on
the rig while it happened: the kit's samples sat in
`Live-files-12300.db` with `files.fe_version` 0 and no `fe_values` row, an
`Ableton Index` pass was running at ~145 files/s over a folder just added
to Places (+42,036 vectors in six minutes), and the same kit swapped
normally once the pass reached its samples. Nothing was broken; Live had
nothing to rank yet. A kit whose samples are outside every Place never
gets vectors at all, which is the same symptom with no cure but adding the
folder.

**Three things this changes.**

- **The bridge reads the control before pressing it.** A disabled button
  answers with a reason instead of an `ax-control-disabled` from a press
  that was never going to land — and **two different refusals wear the same
  greyed button**, told apart by reading the OTHER direction. A kit sitting
  on its reference sample has nothing behind it, so Live disables Previous
  and leaves Next alone: that is `swap-at-the-end`, and it is the state
  every freshly loaded kit is in. Both directions disabled is
  `swap-not-rankable`, the real "nothing to rank" (an index still catching
  up, or a folder never added). Without this split, the first press of a
  fresh kit read as an index problem — which is exactly how it was found:
  the user could press Live's own button by hand and not the pill, because
  by hand they pressed the direction that was enabled.

- **The pill's top half steps NEXT** (the user's call, 2026-09-15). It
  stepped *back* when the pill was stood on its end, so every first press
  on a fresh kit hit the one direction Live had disabled. Up is onward; the
  bottom half steps back.
- **A swap bar the bridge turned on is pressed back off** when the swap
  then does not happen. We changed Live's UI for a gesture that did not
  occur; a bar found already on is left alone — ADR-437's insert-mode
  discipline.
- **A refusal is transient.** The three swap stores keep state in a map
  keyed by path and nothing cleared an error but a later *successful* step
  on the same key, so the reason outlived the condition — and the keys are
  positional, so deleting a track above a rack handed a different rack the
  previous one's failure as its label (the swap audit's M18). `swapErrors`
  holds a reason for 6 s, then the pill names what is loaded again;
  `bridge-resync` flushes every held reason at once. The pill also renders
  the codes a performer can meet as phrases ("No similar samples yet")
  rather than as wire codes.

**What was never at risk:** the bridge already closed Live's undo step from
a `finally` whatever happened, and released the cross-rack single-flight
lock on failure, so a refused swap could not swallow the next edits or
wedge later swaps. The defect was that the pill lied about the present.

### Validation
- Interface: `npm run test:run` — `drumSwapSimilar.test.ts` gains three
  cases (a greyed button refused with a reason and no press; a bar the
  bridge turned on put back; a bar found on left alone) and
  `swapErrors.test.ts` is new (the TTL, replacement, key isolation, the
  cancel, the flush, and the `bridge-resync` flush).
- Rig: `swap-not-rankable` was met live three times before the split
  existed (the pill's `prev` on a fresh kit, logged with that code), and
  after it the same `prev` request swapped — `ok`, 30 of 32 pads changed,
  1.6 s — because the direction was readable all along and only the
  *reason* had been wrong. A kit whose samples are genuinely unfeatured
  greys both directions; that half is unit-covered, and its rig run waits
  for the next unindexed kit. Live's own enabled flags, read through the
  helper while the kit sat on its reference: `kit.swap_next` true,
  `kit.swap_prev` false.

## Addendum — the swap bar goes away after a kit swap (2026-09-16)

The user's call: Live's swap buttons should not stay on the rack after a swap.
Before this, the bridge pressed `ShowSwapBar` on for a kit swap and put it
back only when it had turned it on *and* the swap did not happen, so every
successful swap left the bar showing — and a bar found on was left alone
thereafter, so it stayed for good. Now the `finally` presses it off after
every kit swap, success or refusal, found on or turned on (`until`
`kit.swap_next` gone). A pad swap never touches it. A hide that fails is a
warning; the swap's reply is unchanged.

**Measured before choosing** (Live 12.4.15b3, the Hybrid - Beyond the Outer
Rim kit, through the helper's client): with both directions enabled (the kit
off its reference), the bar pressed off (the Swap All buttons leave the tree)
and on again kept `kit.swap_next` and `kit.swap_prev` both enabled — Live
keeps its reference sample across a hide — and each press took 7–26 ms. The
first Swap All Next after re-showing the bar pressed in 338 ms, a warm press,
so the per-swap show/hide does not turn every swap into the 3.2 s cold press
in the acceptance table above. Not measured: a Previous right after that
Next; the one attempt found `kit.swap_prev` missing from the tree ~110 ms
after the Next returned, with the performer playing the kit on the Move at
the time, so the cause is open.

## Addendum — the preset record checks its instrument (2026-09-15)

**The problem.** `looping.preset` is written with `Track.set_data`, which is
outside Live's undo history: after undoing four prepare loads the track held
its original Drum Rack again and still named the last load, so the swap control
would have stepped from a preset the track no longer held. A replacement made
outside `prepare_for_preset` left it just as stale.

**Three options, one taken.**

1. *Record the instrument beside the path and check it when the tree is
   walked* — taken.
2. *A listener that clears the key when the instrument changes* — rejected. The
   clear is itself outside undo, so a redo would come back to a cleared key;
   and telling that the instrument changed needs the same identity anyway.
3. *A UI-side check against the device records* — rejected. The UI would have
   to guess a preset's device from its path (an `.aupreset` names none), while
   the surface reads the real one when the load lands.

**As built.** The value is `{"path", "instrument": {"class", "name"} | None}`,
written by `TrackPrepareComponent._record_preset` (`preset_record`); the T
record's `preset` is the path only while the track's first instrument has that
class and name (`held_preset`, on every walk). No arity change and no version
bump: `""` was already the "none" value, and a 3.9.0 UI takes the narrower
meaning unchanged. A bare path written before this reads `""` until the track
is loaded again.

**Measured before building it** — Live 12.4.15b2, a MIDI track created for the
run (it came with Operator), four loads pinned to it, read through the probe
and the surface's own `Log.txt`:

| Step | Instrument afterwards | `_live_ptr` | Tree republished |
|---|---|---|---|
| Evo 01 (`.adv`) | MultiSampler "Evo 01 - Subtle Sul Tasto" | new | yes |
| Evo 02 (`.adv`) | MultiSampler "Evo 02 - Subtle Long Wave" | unchanged | **no** |
| Omnisphere patch 1 (`.aupreset`) | AuPluginDevice "Omnisphere" | new | yes |
| Omnisphere patch 2 | AuPluginDevice "Omnisphere" | unchanged | no |
| undo 1–35 | unchanged | unchanged | no |
| undo 36 | MultiSampler "Evo 02 …" | new | yes |
| undo 37 | MultiSampler "Evo 01 …" | unchanged | **no** |
| redo 1 | MultiSampler "Evo 02 …" | unchanged | **no** |
| redo 2 | AuPluginDevice "Omnisphere" | new, not the load's | yes |

Three consequences. The name, not the class, is what separates two native
presets of one device. `_live_ptr` cannot be the identity: undo and redo hand
back pointers the load never had. And **a device renamed in place fires no
`devices` listener**, so a check made when the tree is walked would never be
walked again after undoing a same-class step: `LOMListeners` now listens to
every top-level device's `name` and fires the structural-change callback,
debounced, so the rename during our own load publishes after the record. A dict
value round-tripped through `set_data` / `get_data`, a nested `None` included.

**The limits, stated rather than papered over.** A plug-in's patch is
invisible: undoing an Omnisphere patch change was 35 undo steps that never
touched the device or its name, so the record still names the undone patch —
Return is the way back. Two presets sharing a file name on one device class are
one identity. A track with no instrument (an audio track's effect preset)
records none and reads as held while it still has none. A renamed instrument
reads `""` until the next load.

**Not verified on the rig:** the surface as built. A changed surface loads
only after a full Live restart, which this session did not make; the table
above is the running 3.9.0 surface's, and the record, the check and the name
listener are covered by unit tests only.

## Tags
`similarity`, `drum-rack`, `accessibility`, `ax-helper`, `swap`,
`replace-instrument`, `looping-preset`, `bridge`, `python-surface`
