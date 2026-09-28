# ADR-430: Effects on Individual Drum Pads — the FX Grid Becomes the Held Pad's

## Status

**Accepted** (2026-09-10). Implements issue #491 as amended by its
design review; follows ADR-428 (virtual macros, per-pad rows, the pad
grid, hold-to-scope, tap-to-latch) and the #489 M2 item "chain grammar
scoped to the selected pad". Protocol 3.7.0 → **3.8.0**.

## Context

The FX grid and every effect central view address the selected track's
top-level devices. A Reverb loaded from the grid lands after the Drum
Rack and wets the whole kit. ADR-428 reaches one pad's *instrument* by
parameter name (FX, Time, Start, Filter, Gain, pitch, the Sampler row);
a device inside a pad's chain was unreachable — "a little room on the
snare", "distortion on the kick" was Live-only. The wall, verified in
the tree on 2026-09-10:

| Layer | Before |
|---|---|
| wire grammar | `chains/<index>` reserved; every handler rejects with `path-not-supported` |
| `path_resolver` | stops at the track's device list |
| `LOMListeners` | one `devices` listener per track; value listeners on top-level devices only |
| `V3StateFullComponent` | walks `track.devices`; the scoped walk rejects any sub-path |
| `DeviceLoadComponent` | shape-validates its `devicePath` argument and never reads it |
| interface | `devicesByPath[N]` is the device at chain index N; slots match `className + defaultName` over it; sixteen tile call sites swap the top-level view directly |

The design session's proposal (issue #491) had the wire carry the
*selected* pad's chain records and follow Live's selection. The review
changed two things before a line was written, and both are load-bearing
here.

## Decision

### The gesture

**Hold a pad (or latch one with a tap) and the FX grid is that pad's.**
A tile reads ghost where the pad's chain has no such effect and active
where it has one; a touch on a ghost tile loads the effect *into the
pad's chain*; a drag on an active tile moves the pad's copy alone.
Lift, and the grid is the track's again. An effect's central view opens
**inside the Drum Rack view**, beside the pad column, so the hold
survives opening it. Every gesture is one that already exists
(`drumPadScope`, ADR-428 addenda of 2026-09-08/09); nothing is added
to the glass but a **scope chip** on the grid naming the pad, and a
frame in the pad's ink.

### Wire: a note-keyed pad segment, records only for subscribed pads

```
padRef    := deviceRef "/pads/" note              // 0..127, the DrumPad's MIDI note
deviceRef := padRef "/devices/" index             // drum_pads[note].chains[0].devices[index]
paramRef  := deviceRef "/params/" index
```

`pads/<note>`, not the reserved `chains/<index>`: a rack's flat chain
list re-indexes whenever a pad gains or loses a chain, and every
per-pad row the property channel already carries keys on the note.
`chains/` stays reserved for Instrument and Audio Effect Racks. The
resolver walks "container, then devices", so a rack inside a pad chain
takes the same suffix; the parameter set path, the property channel
and the device commands work on chain devices with no change of their
own.

**Pad records never ride the whole-song tree, and never follow Live's
selection.** The proposal keyed the tree's pad records on
`selected_drum_pad`. Selection is shared state — ADR-428 kept it off
the surface precisely so a Mac and an iPad cannot fight over one — and
tying the records to it broke three ways: a momentary hold over a
latch would write the held pad as Live's selection and leave the
latched pane without records on release; a pad tapped in Live's rack or
on the Move would re-target the tree under a latched pane; two clients
holding different pads would rip each other's records out in turn.
Instead, the interface **subscribes** a pad in the property channel's
own refcounted idiom: `vm.padChain.<note>` — the FX grid and the Drum
Rack view each hold the row for the scoped pad for exactly as long as
it is held or latched, and the manager sends one subscribe between
them. While subscribed the
surface keeps value listeners on the pad's effects' parameters (feeding
the ordinary `param/value` echo with the composed pad path, so
suppression and display strings come free) and answers every cold read
with a **pad-scoped `state/full/tree`** — reason `pad-chain`, scope the
pad path, D and P records for the effects with the instrument skipped
and its chain index kept. An empty bundle is a real answer.

**Effect presence rides its own row, `vm.padFx`** — every populated
pad's chain devices as index, class, name and type, from a walk that
reads only those, re-emitted from the chains' own `devices` listeners.
It is what makes the ghost/active flip instant at touch-down, before
any records land; the subscription only supplies values. The
virtual-macro census is untouched: its re-seed re-resolves the whole
kit and detaches up to a thousand member listeners, which an effect
insert must not pay for.

**A narrower structural composite.** A chain listener defers 150 ms
(chains populate after the add fires; Live refuses writes inside a
notification), then advances the generation — paths inside the chain
shift, so the UI's mirror must move; the `state/invalidate` carries no
paths — runs the property channel's structural invalidate so a pad
Reverb's impulse-response subscriptions on a moved path are torn down,
re-emits presence and re-emits and re-watches every subscribed pad. It
never republishes the song, and it **never feeds `on_device_added`**:
that hook schedules the Simpler init rules and the random-start
prepend, and a Simpler kit's pads are Simplers. All of this is
`DrumPadChainComponent`, a second computed provider, so chain concerns
stay out of the virtual-macro component and out of the census.

**Load.** `device/load` reads its `devicePath` at last. A pad path
selects the track, `rack.view.selected_drum_pad`, and the chain's last
device — Live inserts a browser load after the selected device, the
rule Push and Live's own browser use — then `browser.load_item`, then
**a check on a later tick** (200 ms, then 800) rather than a read right
after the load: the chain grew, done; the track grew instead,
`song.move_device` into the chain; neither, `load-failed`. Every
pad-load error carries `;scope=<padPath>` because the UI's slot reset
matches on the preset path alone. Placement follows the device's type
(2026-09-11, see the follow-up): an audio effect goes to the end of
the chain, a MIDI effect after the MIDI effects already at its head,
directly before the instrument — the rule both the insert-by-name path
and this fallback's `move_device` use. `device/delete` is
`parent.delete_device(index)` by LOM identity, track or chain.

**3.8.0.** Record arities are unchanged, so the bump protects nothing by
itself — the surface emits the same records at every negotiated
version — but a 3.7.0 UI would mis-index a nested path in its
chain-order device array. The bump is the changelog marker, and this
says so.

### Interface: a separate map, a context, a router, a pane

**Pad devices live in a separate map keyed by pad path**, never in the
track's device list. The param-echo path splits paths expecting the
device and params segments in fixed positions and would have dropped
every pad echo as malformed; the subtree drop did not understand a pad
segment; several consumers read the track's device map directly; the
instrument finder returns array indexes every instrument view
re-indexes with. With a separate map no consumer needs a filter and the
chain-index invariant is never violated. A pad's records reconcile with
ADR-003 identity; before they land, **stand-in records built from
`vm.padFx`** let a tile read active and a drag write — a parameter path
composes from the pad path and the chain index alone.

**One slot table per pad scope** in `fxGridStore`, keyed
`${padPath}`: a scoped load names the pad, pending values and the
speculative store key on `${scope}|${slot}`, and completion reads the
scope off the arriving device's path — a track-level Reverb arriving
while a pad-scope Reverb load is pending completes the track's slot,
never the pad's. **Slot state is never cleared on release**: a load
outlives a typical hold, so a finger that lifts before the device lands
still gets its load and its values on the pad. Only what the grid
displays follows the finger.

**`fxScope` is a Svelte context carrying a getter**, set by the FX grid
while a pad is scoped on the selected track's Drum Rack and by the pane
wrapper, read by `useFxGridSlot` and `BaseDeviceControl`. Same
components, two answers, decided by the mount point; the getter because
the scoped pad changes while a view stays mounted.

**One routing chokepoint**, `deviceViewRouter.openDeviceView`, in a
service — not in the scope store, not in the display store. Under a
scope it sets the Drum Rack view's **pane** (a device *type*; the
scoped pad supplies the instance, so a momentary hold over a latch
shows the held pad's Reverb, ghosted if it lacks one) and re-opens the
Drum Rack view if another top-level view is up, because a pane nobody
can see is no answer; with no scope it swaps the top-level view as the
sixteen tile call sites used to. Those call sites now call the base
tile's `openView()`, which is a no-op when the right view is already
up, so a drag may call it per frame. The pane's lifetime is the
scope's. Inside it the effect keeps its family ink (ADR-400: device
colour is module identity); the pad's ink is on the chip only.

**Under a scope the right side of the Drum Rack view follows the pad's
own class** (`profileForPadClass`): the Jazz kit's Sampler pad gets the
Sampler row while held, rather than the kit's Simpler row with ghosted
slots, and its rows are what is subscribed.

### The refactors that came first (E0)

The per-pad code of the previous four days was sound but had outgrown
its files: the Drum Rack view (1,159 lines, 19 commits since 6 Sept),
the drum service (1,013), the surface provider (2,838) and its test
(3,142). Before anything above landed: the view became a composition
root with dumb rows (`DrumCellControlsRow`, `RackMacrosRow`, `VmSlot`,
`useClipPads`); "this function's value and state under the current
scope, and where a write goes" moved into one rune helper, `useDrumVm`,
shared by the view and the FX grid's Pitch slider (the tiles would have
been the third copy), which also pre-subscribes the rows of every pad on
the grid so a pressed tile has its own values the instant the finger
lands; the service became a directory behind one import path; the
surface provider split into vocabulary, records, walk and component,
with its LOM fakes moved to the tests' support package where the
pad-chain and load tests extend them. Proven inert: five Drum Rack
captures diffed at 0 px against HEAD under the fixture catalogs, both
suites green, no new lint category.

## Consequences

### Positive

- A performer mid-set puts room on the snare or drive on the kick from
  the same pad gesture that already tunes one pad, and the effect's
  view opens without letting go.
- No new gesture, no new address for reading: two computed rows, one
  scoped bundle reason, and the existing parameter channel — which is
  the strongest argument for the tree as the carrier; effect
  parameters as computed property rows would have re-implemented echo,
  ghost/loading and the pending drain for every effect.
- Two clients cannot disturb each other: each subscribes its own pads.
- The instrument layer and the effect layer never write the same
  parameter: the pad's instrument stays on the virtual-macro rows.
- The same subscription and the same "container, then devices"
  resolver open Instrument and Audio Effect Rack chains later.

### Negative

- A pad chain's records arrive a beat after touch-down (the cold read
  answers a subscription); presence covers the tile state in that
  window, and a control shows its rest value until the records land.
- A pad-targeted load through the browser is verified by observation
  on a later tick, which is a race the surface reasons about rather
  than a guarantee Live gives; a preset that lands on the track is
  moved, at the cost of one more structural fire. Since the follow-up
  below this is the fallback path only.
- The insert-by-name path depends on a file outside the repo: Live's
  user default for the device must be the app's preset, byte for byte.
  `npm run install-device-defaults -- --check` says whether it is; a
  machine where it is not simply loads through the browser.
- The wire now has two provider namespaces on one class
  (`drum_vm`, `drum_pad_chain`) sharing the `vm.` prefix; `spec_for`
  says which answers what.
- Multi-pad adds wait for E5. (MIDI effects on pads landed 2026-09-11 —
  see the follow-up below; a MIDI effect goes in at the chain's head.)
- The interface's `vm.padFx` stand-ins mean a tile can be active with
  an empty params map; every control already treats a missing value
  as "at rest", but a view that assumed `params.size > 0` for an active
  device would be wrong here.

## Follow-up: every tile may live on a pad (2026-09-11)

The Drum Buss shipped inert under a pad scope on the reasoning that it
is a track device; a kick with its own is the ordinary case, so the flag
went on, and the user then asked for the amp racks and the MIDI effects
too. Measured on the rig first: `Chain.insert_device("Random", 0)` puts
a MIDI effect at the head of a DrumChain, and with it there the kit
census still counts the pad's DrumCell (the virtual-macro layer finds a
pad's instrument by `Device.type`, never by position), presence lists
the Random at 0 and the instrument at 1, and `vm.pad.36.pitch` still
answers. So: every preset but Permute is `padScoped`; the insert-by-name
path already places a MIDI effect after the chain's leading MIDI effects
(position 0 on a plain pad), and the browser fallback now does the same
instead of moving to the end, which Live would refuse. The amp racks and
plug-in presets take the browser path and are moved into the chain.

The fallback was then measured for a MIDI effect as the code review
asked (2026-09-11, `Defaults/MIDI Effects/Random.adv` moved aside so the
by-name gate fails, restored after; the bridge client listing every
bundle's D records): **the browser puts a MIDI effect at the track's
index 0, ahead of the rack** — Live's own rule, a MIDI effect never sits
behind an instrument — so for the 200 ms until the placement check
moves it the rack is `devices/1`, and the structural bundle says so.
The property channel's structural rule (the same device at the same
path, or the row is torn down) drops the rack's rows at `devices/0` and
the chain's `devices` listener with them, so the move into the chain
raises no pad-chain composite. What the interface gets instead is the
second structural bundle, with the rack back at `devices/0`, on which
its subscriptions — keyed on the rack's path in the tree — come back
and cold-read the pad: the running UI re-subscribed `vm.padFx` and
`vm.pad.36.pitch` on `devices/1` and again on `devices/0`, presence then
listed the Random at 0 and the kick at 1, and the chain read
`[MidiRandom, DrumCell]`. The scope drops for that window (its latch is
keyed on the rack path, which returns) and the pad's records arrive from
the re-subscription's cold read rather than from the composite. An
audio effect through the same fallback lands *after* the rack, so its
path holds and the composite fires — the asymmetry first seen with a
Chord. Live also accepted the running surface's end-index `move_device`
and placed the device at 0 regardless; the head-index rule above
(516af44c) is exercised after the next Live restart. Nothing to fix:
the transit is Live's placement, the teardown is the channel's contract,
and the by-name path — the ordinary case, since the installer made every
default the preset — has no such window.

## Follow-up: the tile drew the track's values under a scope (2026-09-11)

First real use on the rig: an Auto Filter on the kick pad moved in Live
while a held kick's Filter XY was dragged, but the dot jumped home on
every lift. Measured over a second bridge client: the pad bundle
parsed, the writes reached Live (display echoes on the pad path), no
value echo and no bundle re-send followed — the snap was inside the
interface. `FXGrid` resolved each tile's `device` prop against the
track only; the tiles derive the values they draw from that prop, so
under a scope they showed the track's device (or the defaults) while
`BaseDeviceControl` wrote to the pad's. The grid now resolves the prop
with the scope key, and a test pins that a scoped tile shows the pad
device's values, keeps a write, and returns to the track's on release.

## Follow-up: native devices are inserted by name (2026-09-10)

The user asked why a pad load went onto the track and was then moved,
and pointed at `Chain.insert_device` (Live 12.3+; `Track.insert_device`
too). Measured on 12.4.15b2 in the open set, scratch track removed after:

- `insert_device("Delay")` on a pad's chain inserts in place and returns
  the device in the same call; no track structural fires, only the
  pad-chain composite; wrapped in `begin/end_undo_step` it is one
  "Custom Action", and insert plus a rename of the device is still one.
- It takes the device's **display name** — `class_display_name`, which
  is also the name the new device gets — and only native devices; no
  racks, plug-ins or Max for Live. Every tile class was inserted once to
  measure the table (`Delay`, `Auto Filter`, `Hybrid Reverb`,
  `Phaser-Flanger`, `Chorus-Ensemble`, `Beat Repeat`, `Utility`, …).
- It gives the device its factory settings — a factory Delay differs
  from `Delay.adv` at six parameters — **unless a user default exists**
  under `Defaults/Audio Effects/<display name>.adv`, which Live applies
  to an `insert_device` exactly as it does to its own browser (the
  inserted Hybrid Reverb came up as Quartz with Blend 100 %, the user's
  default file's values, not factory Dark Hall at 50 %; Auto Filter
  matched its default on four parameters). A default's stored
  `UserName` becomes the device's name (an old Reverb default called
  "Ambience Medium" named the device that).

So the decision the user made: **the app's presets become Live's
defaults** (`scripts/install-device-defaults.mjs`, backing up the seven
that differed), and `DeviceLoadComponent` inserts by name whenever the
preset is a single native device whose default is byte-identical to it —
reading the class off the `.adv`'s root element, renaming the device to
the preset file's basename (`Reverb`, not `Hybrid Reverb`, so the tiles
and every existing set keep matching), a MIDI effect at the index after
the chain's leading MIDI effects, all inside one undo step. The browser
load with the deferred placement check is the fallback for racks,
plug-in presets, a missing or different default, and an insert Live
refuses. Track-level loads take the same path, which also stops a load
from moving Live's track selection. The wire and the interface are
unchanged. Two tables carry the class → display-name map (installer and
surface); `deviceDefaultsTable.test.ts` pins them equal.

Validated after a Live restart, over the bridge, on a fresh kit: a Delay
into pad 36 produced no track structural at all — only the pad-chain
composite, with the device named `Delay` and Feedback at 0.0 and LFO mode
at 5 (the preset's values; factory is 0.53 and 0); a Reverb onto the track
produced one structural and a device named `Reverb` of class `Hybrid`;
`song.undo()` removed each as one "Custom Action".

## Follow-up: the code review's ten findings (2026-09-11)

A static review of the branch at 84bddc65 listed ten findings; nine are
fixed in the commit after 90f0f166, one is declined with its reason.

1. **A pad load only completed while the pad's chain row was held.** The
   pad map only refreshes while `vm.padChain.<note>` is subscribed, and a
   load completes against that map — so a finger lifting inside the
   surface's 150 ms composite window left the slot `loading` until the
   timeout with the drag's values parked, contrary to what this ADR
   promised. The FX-grid store now holds a chain row for every pad with
   a load in flight (`loadingPadScopes()`, watched from the store's own
   effect root so it lives whenever the store does and no section has to
   be on screen; holds are diffed per pad, so a second pad's load never
   re-subscribes the first) until the load lands or fails. Pinned in the
   store and the rendered grid test.
2. **Three pad-load errors carried no `;scope=`** (path-not-found,
   not-in-browser, and the resolver's device-slot-invalid, whose `path`
   was the pad rather than the preset). All three now name the preset in
   `path` and the pad in `;scope=`, so the UI resets the pad's slot
   instead of the track's. A track-level error still carries no scope.
3. **A refused rename after a successful insert left an orphan** under
   Live's display name that no tile matches — the slot would time out and
   the next drag insert a second copy. The insert is now deleted again
   inside the same undo step and the browser path runs instead.
4. **The insert's undo step closed only on LOM errors.** `try/finally`
   now closes it whatever is raised.
5. **Pad maps outlived their rack.** A whole-song replace never touched
   them and a track- or device-level invalidate dropped only paths that
   themselves contained `/pads/`, so a different rack landing at the old
   path served the previous rack's records until its own bundle arrived,
   their params staying in `paramByPath` for the session. A dropped track
   or device now takes its pad maps with it, and every tree replace and
   scoped merge prunes maps whose rack path no longer holds a Drum Rack.
6. **`RackMacrosRow.svelte` carried a literal NUL byte** in its `{#each}`
   key (main's `DrumRackCentralView` used the `\u0000` escape), so git
   treated the file as binary and no diff could review it. Escaped.
7. Two `wire-protocol.md` lines still said the UI declares 3.7.0.
8. **A failed scoped build shipped an empty bundle**, which for a pad is
   the legal "every effect gone" answer and empties the pad on the UI. A
   build exception under a scope now suppresses the bundle instead.
9. **`cleanup.sh`'s port sweep cannot see a Docker-forwarded listener** —
   declined. The sweep kills what it finds, and the process holding a
   forwarded port is Docker's backend; widening the command list would
   hard-kill Docker on every `npm run dev`, which is the same hazard the
   sweep already avoids for Live on 11022. Documented in the script.
10. `DrumPadChainComponent.py`'s `__all__` was unsorted (RUF022, a new
    ruff category on a new file). Sorted.

## Follow-up: the second review's fix-first list (2026-09-12)

A second static review of the branch at 5c7d646 — the week's pad-effects
work plus ADR-432 — listed nine things to fix before the next session;
all nine are fixed in one commit, each with the test that would have
caught it.

1. **Two raw NUL bytes in `useDrumVm.svelte.ts`** (the macro-name
   separator, meant as the six-character escape the pre-split view
   used). Git indexed the file as binary, ripgrep skipped it and viewers
   rendered the bytes as spaces; the `99ad0ba` sweep missed it because
   git's binary heuristic reads only the first 8000 bytes. Replaced, and
   `scripts/sourceBytes.test.ts` now walks every text source for 0x00.
2. **`install.sh`'s `stat` fallback was in the wrong order for GNU
   coreutils** — `stat -f %m "$d"` there prints the filesystem block to
   stdout before failing, so the mtime compare never fired and User
   Library detection fell to the default path: the four
   `userLibraryDetection` tests were red on Linux. GNU form first.
3. **`install-device-defaults --check` reported a false green** when
   presets were unreadable or a class was missing from the name table:
   skips did not count. They count now, as "N unchecked", exit 1.
4. **A tap on the OTT tile opened the placeholder view** on master
   (`ott` has no registered view, and the `a830a7a` net walks the grid
   layout, which `ott` is not in). The tile passes
   `disableCentralViewOnTap`; `OttControl.test.ts` pins it, and the
   "a tap LOADS" wording in `device-panel/CLAUDE.md` is corrected — a
   tile loads on its first drag frame (ADR-167), never on a tap.
5. **A hold's release wrote back a stale latch snapshot**, wiping a latch
   tapped during the hold — ordinary once a Move hold spans the other
   hand's taps. A hold now leaves the latch as it finds it.
6. **A stale Move hold tag blocked every later hold of that pad** on the
   surface (a lost `0`, or the patch restarted mid-hold, and only
   `disconnect()` cleared the dict). A `1` for a recorded tag releases
   the stale hold first; the same pad is still idempotent.
7. **A stale pad map shadowed presence**: `padDevices()` let an existing
   map win, and a map is fresh only while its pad is subscribed, so a
   Reverb added to a pad between holds read ghost until the cold read
   landed — the window presence exists to cover, and one a drag could
   load a second Reverb in. Presence decides which effects exist, the
   map supplies their records.
8. **The loading-pad hold pinned a refcount the surface had torn down**
   during the rack-path transit measured above: the FX grid's release
   and re-acquire went 2→1→2 and no `property/subscribe` left. The hold
   lives only while the rack is at its path, so the count passes through
   zero and the re-acquire reaches the wire.
9. **The pane's back button, the FX-type button and the picker used
   `onclick`** on a view that is by design operated with a pad held under
   another finger — the multi-pointer case ADR-427 exists for. All four
   are `use:press` now; the picker's scrim is a sibling behind the grid
   rather than its parent, so no `stopPropagation` is needed. The pane's
   component cache moved to `<script module>` (its "module-level" comment
   described an instance Map that died with every pane), and a type
   switch shows nothing until the new view's import resolves.

## Follow-up: the rest of the second review (2026-09-12)

The same review left four piles behind the fix-first list — duplication,
leftovers, tests kinder than Live, and comments that no longer described
the code. All of it is done in one further commit; nothing here changes
the wire, and nothing should change a pixel.

**One rule, one place.**

- `device_type(device)` in `drum_vm_functions` is the surface's single
  reading of Live's `Device.type` (an int on the rig, a string on older
  builds), with `DEVICE_TYPE_INSTRUMENT` / `_AUDIO_EFFECT` /
  `_MIDI_EFFECT` beside it; `_is_instrument`, the pad-chain component's
  walk and the loader's MIDI-effect placement all read through it.
- `REASON_PAD_CHAIN` names the pad-scoped bundle's reason once; the
  publisher and the component that asks for it both import it.
- `find_drum_pad(rack, note)` in `path_resolver` is the one pad-by-note
  lookup (index first, scan when the list is not note-indexed, bounds
  checked against `PAD_NOTE_MAX`); the resolver, the chain component's
  two walks and `vm.selectedPad`'s write — which was index-only — use it.
- `lom_id(obj)` is the resolver's public LOM identity, and the loader's
  private copy is gone. `CHAIN_CHANGE_DELAY_MS` is `RESEED_DELAY_MS` by
  definition rather than the same literal twice.
- `resolve_pad` refuses a four-segment path (`tracks/1/pads/36`) as
  malformed; the length guard let it through to an index error.
- `device/load` checks that the pad it is asked to load into sits on the
  track it was given (`pad-not-on-track`), the way the track path is
  checked, and an `insert_device` that hands back nothing falls through
  to the browser instead of raising on the rename of `None`.
- On the interface, `fxScopeFor(rackPath, note, pad)` builds the scope
  the router and the Drum Rack view each wrote as a literal;
  `usePadChainRows(getRackPath, getScopedNote)` owns the presence and
  chain-row `$effect`s the FX grid and the Drum Rack view each carried
  with the same comments (and the same rule — key on the primitives, not
  the scope object); `instrumentDevicePath(instrument)` is the one answer
  to "which path is the selected instrument at" for the router, the
  instrument slider and the Drum Rack view.
- The scope chip and the pad pane's chip share one face (`.pad-chip`,
  `app.css`, ink via `--chip-ink`), the held-by-macro badge has one face
  (`.vm-held-badge`, same file) instead of a copy in the slot and a copy
  in the FX-type row; each owner keeps its placement only.
- `padDevices()` parses the `vm.padFx` row once per distinct string
  rather than per tile per read, and `dropSubtree`'s pad branch reads the
  device path through `splitParamPath` like the track branch.

**Leftovers removed.** `DrumVirtualMacroComponent` carried a second
`_LOM_ERRORS`, eight one-line `@staticmethod` shims over the
`drum_vm_resolve` functions, and a 64-name re-export facade of which 33
were imported by nothing; the shims are inlined, the facade lists what
`LoopingSurface` and the tests actually import. `PropertyComponent`
imports the virtual-macro vocabulary from `drum_vm_functions` (one
statement per alias is ruff's isort default, not a leftover — the review
was wrong about that one). The chain component loses its unused `dirty`
flag, sorts `__slots__`, and answers a pad with no chain with `nil` and
no bundle. On the interface `isPadScoped`, `padChainDevice`,
`vmFunctionName`, `vmPadMacroProperty` and the two device-type constants
had no importer and are gone.

**Tests as unkind as Live.** The LOM fakes now refuse what Live refuses:
`move_device` raises for a MIDI effect placed behind a non-MIDI device,
`insert_device` can hand back `None`, and the browser fake lands a MIDI
effect at the track's head, so the placement tests exercise the real
transit. New cases pin the pad-not-on-track refusal, the insert that
returns nothing, a `begin_undo_step` that raises, a pad with no chain, a
non-note-indexed `drum_pads`, a scheduler that raises, an invalidate
that released the state under a pending composite, and the parameter
listener cap leaving a pad unwatched rather than half-watched. The
interface gains a unit test of `useDrumVm` itself (through the shared
rune harness — `mountRune` / `stateBox` in `runeHarness.svelte.ts`), a
test that the view inside the pad pane reads the PAD's slot and values
(ghost where the pad lacks the effect the track has; the pad's own LFO
once its record lands), path-shape rejection for `drum/pad_hold`, and
the loading-pad hold releasing its row on a track change. The mock
surface answers a plug-in preset's pad load with the scoped
`load-failed`, so the tile's fall-back to ghost can be photographed.

**Words matched to code.** `ui.gestures.momentaryHoldMs` in
`constants.json` (schema and example included) is the tap/hold boundary
`momentaryPress.ts` reads, and `move_pad_hold.js` names it as the number
it mirrors by hand. `BaseDeviceControl` names OTT and Permute as the two
unscopable tiles (the old list predated "every tile may live on a pad");
the FX grid's master column says OTT, not the Mastering rack; the CLAUDE
files say `v3DrumPadHold.ts` registers the accept hook and that MIDI
effect defaults live under `Defaults/MIDI Effects/`; the wire protocol
notes `device/delete` has no UI sender yet; the listener cap says per
rack. The reviewer's GitHub Action is still failing before it runs
(zero model usage in two seconds, both runs) — that is the repository's
`CLAUDE_CODE_OAUTH_TOKEN` to renew, not this branch's.

Gates for this pass: surface **2,457 passed** (the two `test_tcp_transport`
failures fail identically on a clean HEAD checkout in this container —
socket buffering, not the branch); interface **2,241 passed** across 143
files; `npm run build`, `check:wire`, `check:touch` green; svelte-check
61 → 56 errors, all pre-existing; the scoped FX grid and the pad pane
captured under `--fixture-data` **pixel-diff 0/5,595,136** against the
same captures from HEAD.

**Rig run (2026-09-12, Live 12.4.15b2, f142f8d).** Ben's local agent ran
the whole list above on the rig — fresh Live launch, three kits built
over the wire, a Playwright runner with CDP two-finger touch, LOM probes
between gestures — and found no regression: hold-to-scope, the native
insert (Delay in one step), the MIDI effect ahead of the instrument, the
plug-in preset through the browser and into the pad, the pane writing
the pad's Reverb and not the track's, the ghost Filter pane, every kit
control with one undo, Live's selection both ways, the Move hold with a
dropped release (the stale tag released first, as logged), CC 72 on the
selected pad's chain, the 300 ms boundary on Solo and pads, and the
second finger on the back button, the FX-type button and the picker.
Two corrections came out of it: the ready line reports **17** functions
(`len(FUNCTIONS)`), where `surface/CLAUDE.md` had said 14 since the
Sampler row; and neither OTT (master only) nor Permute (no grid slot) is
a tile a drum track's grid carries, so the `padScoped` branch in
`BaseDeviceControl` has no live case today — the comment says so. One
pre-existing observation, not this PR's: after Edit → Undo of an FX-type
gesture the kit's `vm.fxType` still reads the pre-undo value while every
pad reads the old one in Live, because `_tracks_edits` gives enum members
no listener by design; the continuous functions re-read correctly.

## Validation

- Surface: `uv run --with pytest --with ruff python -m pytest -q` —
  **2,404 passed, 4 skipped** (49 new: the resolver's pad grammar and
  `resolve_pad`; presence, the subscription rows, the composite, the
  listeners' lifetime and a rack replaced at its path; the pad bundle's
  records, the empty bundle, the memo bypass, unresolvable scopes; the
  pad-targeted load's selection, the three landing cases and the scoped
  error; delete by identity and its errors). `ruff check` adds no
  category over HEAD on any changed file.
- Interface: `npm run test:run` — **2,163 passed, 1 skipped**; `npm run
  check` unchanged at HEAD's 60 pre-existing errors; `npm run build`
  clean; the wire-address drift gate green with `device/delete`
  documented. New: the pad map and the nested grammar, the `pad-chain`
  bundle route and its dedupe exemption, scoped slot tables and the pad
  drain, presence stand-ins, the pane's lifetime, the router, the
  per-pad profile, the failure scope, and rendered: the Sampler pad's
  row under a hold on the Simpler kit, the pane replacing the controls
  with the pad's chip and closing with the hold.
- Harness: the unscoped Drum Rack captures diff at **0 px** against the
  pre-#491 baselines under `--fixture-data`; the held-pad capture
  differs only by the scope chip, the frame and the tiles' ghost/active
  flip. Two cuts of the chip failed the proof: positioned `relative` on
  the grid root at all times, every colored label on the page
  re-rasterised by a level or two; placed as a grid item, it took a cell
  and pushed the tiles into a third row (16.6 % of pixels). It is
  absolutely placed and the grid is its containing block only while
  scoped; the frame is an outline drawn inside the box, because the FX
  section scrolls and clipped the first, outset one. The mock now
  answers presence, pad bundles and pad-targeted loads (`padRacks`), and
  `--drag` exists because a tile loads on its first drag frame and never
  on a tap (ADR-167) — the padload capture shows the tile going active
  and the pane opening on the pad.
- Rig (Live 12.4.15b2, 2026-09-10, the unmapped 606 + 808 kit built
  over the wire on a fresh track): every measurement the issue owed came
  back the way the load path already handled it. `vm.padFx` lists each
  pad's DrumCell at index 0 with `Device.type` 1 (the LOM enum
  `instrument`; `audio_effect` reads 2); `vm.padChain.36` answers with an
  empty bundle and the entry. A pad-targeted `device/load` **lands the
  preset on the track every time**, even with the pad and the chain's
  last device selected — the 200 ms check finds the track grown and
  `move_device` puts it into the `DrumChain` (~240 ms after the request);
  the chain's `devices` listener fires for both the add and the move,
  and 150 ms later the composite emits the pathless `state/invalidate`,
  presence with the effect at index 1 and the pad bundle (220 args for a
  Delay). The cost: two whole-song structural republishes before the
  pad-chain one. Value listeners on chain parameters fire — a LOM-side
  change to the pad Delay's Feedback echoed `param/value` on the
  composed pad path; an own `param/set` echoes `param/display` (the
  value echo is suppressed as on the track). `device/delete` on the pad
  device empties the pad and re-emits presence. **Undo:** Live books a
  pad load as two steps — "Insert Device", then the move as a "Custom
  Action" — so a Cmd-Z after a pad load first leaves the effect on the
  track; each drag write is one more step. Grouping load and move under
  one undo step would mean holding a step open across the deferred
  placement check, left for a follow-up. Whether selecting a chain
  device moves Live's selected pad was not measured (the probe's invoke
  takes no object arguments); the load path sets the pad explicitly, so
  the answer changes nothing. The real interface, served by the ipad
  preview against the real bridge (`--no-mock --url
  http://127.0.0.1:8889`), photographed pad 36 held with its Delay tile
  active and reading the pad's value, then a drag on the ghost Reverb
  tile under the latch loading a Reverb INTO the pad and opening the
  Reverb view for it with the loaded preset's real values.

## Tags

`drum-rack`, `pad-chain`, `fx-grid`, `protocol-3.8.0`, `property-channel`,
`state-full`, `device-load`, `issue-491`, `adr-428`
