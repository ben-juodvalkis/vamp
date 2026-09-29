# Wire protocol

> **Python-surface-only (2026-04-21; last legacy carriers deleted
> 2026-09-23).** This doc is written against the end state: no M4L
> device-loader, no AbletonOSC traffic, and since 2026-09-23 no
> `liveAPI-v6.js` or `maxObserver` port pair at all. Routing goes through
> `backendScope.pythonSurface` in `config/constants.json`; the history is
> in Looping's `documentation/archive/m4l-to-python-v3/10-cleanup-plan.md`. The
> contract below is authoritative today.

All wire traffic between UI and surface lives under `/looping/v3/`.
Identity on the wire is **LOM position** (`tracks/0/devices/1/params/2`),
never pointer cookies. Every address, arg, direction, error code, and
invalidation rule below is load-bearing.

Companion: [architecture.md](architecture.md) covers the process
topology and port map; this doc covers the OSC contract those
processes exchange.

## 1. Path grammar

All v3 refs are path strings carried as OSC `s` args. The OSC address
is the operation (e.g. `/looping/v3/param/set`); the path is the
subject (first string arg). This keeps the address space tiny and
the path space unbounded without ambiguity.

```
paramRef    := deviceRef "/params/" index
deviceRef   := trackRef "/devices/" index
trackRef    := "tracks/" index
             | "master"
             | "returns/" index                       // reserved
slotRef     := "tracks/" index "/slots/" index
clipRef     := slotRef "/clip"
sceneRef    := "scenes/" index

// Drum pad chains — protocol 3.8.0 (issue #491). A note-keyed pad under
// a Drum Rack, then that pad's first chain's devices; recursive, so a
// rack inside a pad chain takes the same suffix.
padRef      := deviceRef "/pads/" note                // 0..127, the DrumPad's MIDI note
deviceRef   := padRef "/devices/" index               // drum_pads[note].chains[0].devices[index]

// Rack-chain extension — reserved
deviceRef   := deviceRef "/chains/" index "/devices/" index

index       := digit+                                 // decimal, no leading zeros except "0"
note        := digit+                                 // 0..127
```

Segment names are closed-enum (`tracks`, `master`, `returns`,
`devices`, `params`, `slots`, `clip`, `scenes`, `chains`, `pads`).
Separator is `/`. Paths are ASCII in practice. A typical paramRef is
30–40 bytes; a pad-chain paramRef (`tracks/1/devices/0/pads/38/devices/1/params/4`)
is ~50.

**Why `pads/<note>` rather than the reserved `chains/<index>` for a Drum
Rack:** `rack.chains` is a flat list that re-indexes whenever a pad gains
or loses a chain, while every per-pad row the property channel already
carries (`vm.pad.<note>.<fn>`, `vm.selectedPad`, the census) keys on the
note. `chains/` stays reserved for Instrument and Audio Effect Racks.
A pad's chain devices are addressable everywhere a device is —
`param/set`, `param/query`, `property/*`, `device/select`,
`device/move_to_*`, `device/delete` — but they **never appear in the
whole-song tree**: they ride a pad-scoped `state/full/tree` (§2.2,
§2.6 `vm.padChain.<note>`) that a client receives only for pads it has
subscribed.

Canonical examples:

```
tracks/0/devices/1/params/2
master/devices/0/params/3
tracks/5/slots/0/clip
scenes/0
```

Returns and rack chains are reserved in the grammar; handlers may
reject with `path-not-supported` until implemented.

## 2. Address map

Direction column: **UI→Surf** = UI sends to surface,
**Surf→UI** = surface emits to UI.

### 2.1 Parameter operations

| Address                   | Dir     | Args                                       | Semantics |
| ------------------------- | ------- | ------------------------------------------ | --------- |
| `/looping/v3/param/set`     | UI→Surf | `path:string, value:float, generation:int` | Write a param. Stale-generation writes are rejected (see §4.2). |
| `/looping/v3/param/value`   | Surf→UI | `path:string, value:float`                 | Listener fire or echo. Path is canonical. |
| `/looping/v3/param/query`   | UI→Surf | `path:string`                              | Request current value; surface replies with `/param/value`. Cold-start probe; not needed on steady state. |
| `/looping/v3/param/display` | Surf→UI | `path:string, displayValue:string`         | Live's GUI-formatted value (`"440 Hz"`, `"-12.0 dB"`, `"1/4"`, `"On"`). Emitted only while a path is "hot" — within ~750 ms of a UI-driven `param/set`. Companion to `param/value`; the UI uses it for slider/XY readouts during interaction. External changes (automation, MIDI controller) do not produce display fires. |

### 2.2 State-full

| Address                        | Dir     | Args                                                                           | Semantics |
| ------------------------------ | ------- | ------------------------------------------------------------------------------ | --------- |
| `/looping/v3/state/full/tree` | Surf→UI | `reason:string, generation:int, etag:string, scope:string, tree_args...` | **3.6.0.** The whole canonical tree, one message. `reason ∈ {"accept","structural","resync","selection-change","pad-chain"}` (`pad-chain` since **3.8.0**: `scope` is a pad path and the records are the D/P of the effects on that pad's chain, no T — applied to the UI's separate pad map, never deduped, an empty bundle meaning "every effect gone"). `etag` is hex (`"0x1a2b3c4d"`). `scope` is `""` for a whole-song bundle, else the `"tracks/<N>"` or `"master"` subtree path the payload covers (`reason="selection-change"`). `tree_args` contents per §3. The four header args are **positional and always present** — a parser must never infer meaning from message length. Two bundles with the same `etag` *and* the same `generation` may be deduped on the UI side, except under `reason ∈ {"accept","resync"}` (both follow a tree wipe). |
| `/looping/v3/state/full/unchanged` | Surf→UI | `reason:string, generation:int, sessionId:string, etag:string` | **3.5.0.** Sent *instead of* the tree when the asking client declared an ETag (see §3.6) that matches the tree the surface just recomputed. The client keeps the tree it has and stamps `generation`; nothing else changes. Sent only in response to `accept` or `resync` — a push never produces one, because nobody declared anything. `sessionId` is mandatory to act on: the surface has no per-client channel (every emit fans out to every UI through the bridge), so a marker minted for one client also reaches the others and **must be ignored unless the id matches**. Applying another client's marker would advance `generation` over a stale tree — silent corruption. |

Cache-clearing decisions are driven by `generation`, not `reason`.
`reason` is informational for logs and metrics.

**`state/full/tree` rides the TCP leg only (§4.4).** It is the one
message whose size needs the stream, and with no stream peer connected
the surface logs a warning and publishes nothing — 389 KB does not fit
a 9,216-byte datagram, and the chunking that used to make it fit was
deleted in 3.6.0. The surface republishes unprompted when a peer
connects, which is what closes the window between Live starting and
the bridge dialling in.

**Pre-3.6.0 (retired).** The tree shipped as
`state/full/begin → chunk… → end`: `begin` carried
`reason, generation, chunkGen, totalChunks` plus an *optional* 5th
`scope`, each `chunk` carried `chunkGen, chunkIndex, tree_args…`, and
`end` carried `chunkGen, checksum` — an FNV-1a integrity checksum the
UI recomputed over the reassembled payload to detect a torn bundle.
All of it existed to fit the datagram cap (99 chunks on a realistic
set). Those three addresses no longer exist, so a pre-3.6.0 client
receives nothing even at a negotiated-down floor (§5.4).

### 2.3 Targeted invalidation

| Address                        | Dir     | Args                                            | Semantics |
| ------------------------------ | ------- | ----------------------------------------------- | --------- |
| `/looping/v3/state/invalidate` | Surf→UI | `generation:int, reason:string, paths:string[]` | "These paths are dead; generation has advanced." UI drops any cache entry rooted at each listed path. |

`paths:string[]` rides as a variadic tail of string args.

**Ordering guarantee:** a `state/invalidate` always precedes any
new `param/value` emissions against the post-invalidation tree. The
UI never observes `value → invalidate`.

### 2.4 UI-initiated resync

| Address                    | Dir     | Args      | Semantics |
| -------------------------- | ------- | --------- | --------- |
| `/looping/v3/state/resync` | UI→Surf | `sessionId:string?, "etag:0x…":string?` | "Republish a full state/full now." Surface replies with `begin reason="resync"` within its next tick — or, since **3.5.0**, with `state/full/unchanged` when the declared ETag matches. Both args are optional and were absent before 3.5.0; a client that declares nothing always gets the tree. Note that a UI recovering from packet loss holds an *incomplete* tree and must not claim an ETag for it — the client records an ETag only after a bundle applies cleanly, so a torn one declares the last good value or nothing, and either way the surface resends. |

Exists for UDP packet-loss recovery. Cold-start / reconnect tree
delivery rides on handshake accept (§5.5), not resync.

### 2.5 Device and track structure

| Address                                   | Dir     | Args                                                              | Semantics |
| ----------------------------------------- | ------- | ----------------------------------------------------------------- | --------- |
| `/looping/v3/devices/added`               | Surf→UI | `devicePath:string, name:string, className:string, generation:int` | Device insert hint. The full picture rides in the associated `state/full` or `state/invalidate`. |
| `/looping/v3/devices/removed`             | Surf→UI | `devicePath:string, generation:int`                               | Device delete hint. |
| `/looping/v3/tracks/added`                | Surf→UI | `trackPath:string, name:string, generation:int`                   | Track insert hint. |
| `/looping/v3/tracks/removed`              | Surf→UI | `trackPath:string, generation:int`                                | Track delete hint. |
| `/looping/v3/track/has_arrangement_clips` | Surf→UI | `trackPath:string, flag:int(0\|1)`                                | `1` when `len(track.arrangement_clips) > 0`. Master / returns never emit this. |
| `/looping/v3/track/set_role`              | UI→Surf | `trackPath:string, role:string`                                   | **3.7.0.** Record the rail this track's instrument was loaded from (`"drum"`, `"perc"`, `"bass"`, …). Persisted by Live in the track's own key-value store (`Track.set_data`), so it survives save/reload and a track duplicate — the UI no longer re-derives it each session from a 2.46 MB catalog fetch. `""` clears it (Live's store has no delete: writing `None` stores `None`, so both `""` and `None` read back as "no role"). **No generation gate** — a role is recorded *by* the load that just happened, not echoed back by a client, and the write rides the prepare-ack path where a generation advance is already in flight. Master and returns are refused (`path-not-supported`): they carry no instrument, so no rail. Errors: `write-rejected` (arg-count, or the LOM raised — e.g. a pre-12 Live with no data store, in which case the UI degrades to its catalog fallback), `path-not-found`. |
| `/looping/v3/track/role`                  | Surf→UI | `trackPath:string, role:string`                                   | **3.7.0.** Write-path echo of the above. Cold-start value rides the T record; this is the mid-session update. |
| `/looping/v3/track/preset`                | Surf→UI | `trackPath:string, presetPath:string`                             | **3.9.0 (ADR-439).** A `prepare_for_preset` load landed and the surface recorded its preset under `looping.preset` in the track's key-value store — the absolute path the load used (the catalog's `fullPath`), replace-instrument mode included, stored with the class and name of the instrument the load left. Written before the ack and before the load's structural republish, so the next T record carries it too; this is the mid-session update. There is **no set verb**: the load is the only authority, and a load that fails records nothing. The instrument views' swap control steps from this path (folder-next) and is disabled on a track with none. The T record's `preset` is the path only **while the track's first instrument still has that class and name** — `""` after Live's undo of the load, a hot-swap or a drag from Live's browser, and on every track loaded before 3.9.0 or outside `prepare_for_preset`; a top-level device rename republishes the tree, so an undo that only renames the instrument back reaches the UI too. The check cannot see inside a plug-in: an Omnisphere patch change keeps the device and its name. An echoed `""` means the chain could not be read after the load and nothing was recorded. A store that refuses the write logs and records nothing; the load still acks. |
| `/looping/v3/track/fold_state`            | Surf→UI | `trackPath:string, foldState:int(0\|1)`                           | A Group Track was folded (`1`) or unfolded (`0`) — ADR-410. Fires both for Live-side folds and as the write-path echo of `set/fold_state`. **Deliberately does not advance generation or ride a `state/full`**: a fold adds/removes/reorders nothing, so the tree is unchanged and the UI recomputes hidden strips from the group tree it already holds. Cold-start value rides the T record. |
| `/looping/v3/track/set/fold_state`        | UI→Surf | `trackPath:string, foldState:int(0\|1)`                           | Fold / unfold a Group Track. No generation gate (idempotent, index-independent — same stance as `mute_toggle`). Errors: `write-rejected` (bad args, `is_foldable` false → `"not a group track"`, LOM raise), `path-not-supported` (master / returns), `path-not-found` (malformed / out of range). |

These are hints, not sole-authority. The generation-bearing
`state/invalidate` or `state/full` is authoritative — **except**
`track/fold_state`, which is authoritative for its own field (nothing
else carries fold changes between state/full bundles).

#### Group Tracks (ADR-410)

Verified against Live 12.4.5b8 via `/looping/probe/lom_introspect`;
these facts are what the design above is shaped around:

- `Track.is_foldable` / `fold_state` / `is_grouped` / `group_track` /
  `is_visible` all exist.
- **`fold_state` raises on a non-foldable track** — it is not merely
  absent, so `getattr(track, "fold_state", False)` does not save you.
  Read it behind an `is_foldable` gate or a raise-swallowing helper.
- **`Track` has no `add_fold_state_listener` and no
  `add_is_visible_listener`.** Folding in Live's own UI fires nothing
  track-side.
- **`Song.add_visible_tracks_listener` does exist**, and a fold does
  change `song.visible_tracks`. That song-scoped observable is the
  surface's fold signal; `TrackMetadataComponent` diffs the foldable
  tracks on each fire and emits only what changed.
- A Group Track reports **`has_audio_input == True`** and
  `can_be_armed == False`, and its `clip_slots` are never `has_clip`
  (they mirror the scene row). So a group looks exactly like an *empty
  audio track* to any "find a track to reuse" scan — both
  `TrackPrepareComponent._is_reusable` (ADR-385) and the UI's
  `clipStateStore.emptyAudioTracks` gate on `is_foldable` for this
  reason.

The UI derives strip visibility from the group tree rather than from
`is_visible`: a track is hidden when **any** ancestor group is folded,
so one `fold_state` echo updates every descendant at any nesting depth
without a `state/full` republish. `groupTrackIndex` on the T record is
what makes that walk possible.

### 2.6 Device property operations

Properties sit between parameters and state-full records. They are
user-mutable, fire asynchronously, don't advance generation, and aren't
static metadata. Keying is `(devicePath, propertyName)` — not a path
suffix.

| Address                              | Dir     | Args                                                                  | Semantics |
| ------------------------------------ | ------- | --------------------------------------------------------------------- | --------- |
| `/looping/v3/property/subscribe`     | UI→Surf | `devicePath:string, propertyName:string`                              | Attach listener; send current value as one `property/value`. Idempotent. **A subscription follows the path, not the device handle:** when a structural change leaves a *different* device at the same path (a preset load that swaps the instrument class, a hot-swap, Live's own browser), the surface re-binds onto the newcomer and pushes a fresh `property/value` rather than dropping the subscription — the UI cannot detect the swap (the D record carries only `className`/`name`, and a DrumCell kit replaced by a Sampler kit is `DrumGroupDevice` either way) and `state/invalidate` carries no paths to tell it, so a drop stranded the row: surface half gone, UI half held, last device's values on screen for good. Only a property the newcomer's class does not allow is genuinely dropped, with a `None` to clear the stale value. The pass is deferred ~100 ms so those values land **after** the `state/full` carrying the new device (the UI replaces a device record wholesale when its class changes, and an earlier value would be wiped). |
| `/looping/v3/property/unsubscribe`   | UI→Surf | `devicePath:string, propertyName:string`                              | Detach listener. Idempotent. |
| `/looping/v3/property/set`           | UI→Surf | `devicePath:string, propertyName:string, value:any, generation:int`   | Write the property. `value`'s OSC type matches the property (`int`/`float`/`string`/`bool→int 0\|1`). Same stale-generation rule as `param/set`. |
| `/looping/v3/property/value`         | Surf→UI | `devicePath:string, propertyName:string, value:any`                   | Listener fire or subscribe-echo. |

Key rules:
- **No `property/query`.** `subscribe` is its own cold-read.
- **Closed allowlist.** Unsupported `(className, propertyName)`
  tuples reject with `write-rejected detail="property-not-allowed"`.
  Current allowlist: Simpler's `{playback_mode, sample.warp_mode,
  sample.warping, sample.slicing_sensitivity, sample.gain,
  sample.start_marker, sample.end_marker, sample.length,
  sample.file_path, sample.slices}`, Drift's `{voice_mode_index}`,
  Hybrid Reverb's 5 scalar IR properties, Compressor2's sidechain
  routing pair, and the Drum Rack's fourteen **virtual macros** plus their
  `vm.members` census (below).
- **Computed rows — Drum Rack virtual macros (ADR-428).** On a
  `DrumGroupDevice`, `vm.fx1`, `vm.fx2`, `vm.attack`, `vm.decay`, `vm.release`
  (the sample instruments' amp-envelope release — Simpler and Sampler
  `Ve Release`; a Drum Sampler has none), and the Sampler row's
  `vm.sustain` (`Ve Sustain`), `vm.oscAmount` (`Osc On` + `O Volume`),
  `vm.oscCoarse` (`O Coarse`, −2..48), `vm.pitchEnvAmount` (`Pe On` +
  `Pe < Env`, −48..48 — center is no envelope), `vm.pitchEnvAttack`
  (`Pe Attack`), `vm.spread` (`Spread`, 0..100) — Sampler only, except `sustain` and `spread`, which Simpler carries too, 2026-09-07;
  `vm.filterFreq` (`Filter On`/`F On` + `Filter Freq`) and `vm.filterRes`
  (`Filter Res`, whose max is **1.25** on a Simpler) — the filter as one
  XY pad, 2026-09-09, its switch turning on and never off;
  and `vm.gain` (2026-09-08 — `Volume` on every bound class, each
  through its own range: DrumCell 0..1, Simpler and Sampler −36..36 dB;
  on a kit of nested Instrument Racks the pad's own **chain volume**
  instead, and on a plugin-hosted kit nothing);
  a section's switch is the function's first member and turns on above
  1/127 of travel like FX On —
  `vm.start` (`float` 0..1), `vm.fxType` (`int` 0..8) and `vm.pitch`
  (`int` whole semitones, −48..48, center 0) have **no LOM attribute
  behind them**. The value is held by the surface
  (`DrumVirtualMacroComponent`), seeded on subscribe from the pad
  instruments — or from the legacy macro while the kit is still mapped
  — and a `set` fans out to every pad's matching parameter **by name**
  (DrumCell / OriginalSimpler / MultiSampler bindings; a mapped
  pipeline kit writes its legacy macro instead). Because nothing in
  the LOM fires for a virtual value, a successful `set` is **echoed by
  the surface itself** as one `property/value` carrying the stored
  value (clamped; int for `vm.fxType` / `vm.pitch`) — the one
  exception to the listener-driven echo rule. The surface also emits
  `vm.pitch` unprompted when a pitch fan-out's read-back finds every pad
  moved by one same amount on the sequencer path — Live's Edit → Undo of
  a gesture or a step, a *kit move* (ADR-429 review fixes): the move is
  adopted into the held global and re-emitted so the slider follows Live
  (on the `property/set` path the incoming value wins and the move is
  discarded). A rack with no member
  for a function (and no mapped legacy macro) cold-reads `nil` — OSC
  typetag `N`, which the bridge hands to the UI as JSON `null` (the
  surface's codec learned nil on 2026-09-07; before that the emit
  failed to encode and never left). Applies
  are coalesced to one fan-out per drain pass per `(device, function)`
  — the latest value wins — inside one surface-owned undo step that
  stays open until 300 ms pass with no apply, so a drag is one undo. A `vm.*` subscribe or set on a surface whose provider is
  not wired rejects with `write-rejected detail="computed-provider-missing"`.
- **`vm.members` — the census (ADR-428 Milestone 1b).** A read-only
  computed row beside the fixed functions, same provider, a JSON
  **string** on the wire:
  `{"padCount":32,"padClasses":{"OriginalSimpler":31,"MultiSampler":1},"hasMacroMappings":true,"mappedMacros":[1,2],"family":false,"functions":{"pitch":{"members":32,"held":32},"start":{"members":31,"held":0},…},"macros":[]}`
  — `padCount` = pads carrying a chain; `padClasses` = histogram of the
  first instrument's `class_name` on each populated pad (bound or not,
  so a Komplete Kontrol kit reads `AuPluginDevice`); `hasMacroMappings`
  = Live's flag; `mappedMacros` = the rack's own mapped macros
  (`RackDevice.macros_mapped`) as 1-based parameter indices, `[]` when
  none is — the Drum Rack view draws one slider per entry and nothing
  else (2026-09-29); `family` = the pipeline FX1/FX2 fingerprint;
  `functions.<fn>` = member *parameters* resolved for the function and
  how many of them are macro-held (`is_enabled == False`); `macros` =
  the pad racks' named macros on a kit of nested Instrument Racks (see
  `vm.macro.<name>` below), a **list** in rack order — `[{"name":
  "Attack","members":32,"held":0},…]`, one member per pad rack carrying
  that name, default `Macro N` / `.` / `-` names dropped — empty on any
  other kit; `pitchMacro` = the pad-rack macro name `pitch` binds
  through on such a kit (`"Transpose"`), else `null`; `pads` (2026-09-08)
  = the pads themselves in note order, one entry per pad carrying a
  chain — `[{"note":36,"name":"Kick Plastic 90s Heavy R","class":
  "OriginalSimpler","color":8754719},…]`, `name` the pad's label
  capped at 24 chars — on a Drum Sampler or Simpler pad the instrument's
  own name (ADR-439: Live's Swap All renames the instruments and leaves the
  chains' names on the old samples — a pad's own swap button renames both; an instrument still at its default
  `Drum Sampler` / `Simpler` falls back), on any other pad `DrumPad.name`
  (the chain's) — `class` the first instrument's
  or `null` on an effect-only chain, `color` the chain's color as Live
  paints the pad (`chains[0].color`, an RGB int — 8754719 is `#85961f`;
  `null` when unread) — what a pad grid draws from; past ~8 KB the names
  are dropped and the notes, classes and colors stay. Cold-read on
  subscribe; **re-emitted with the functions** whenever the rack re-seeds
  (`drum_pads` / `chains` / `macros_mapped` fire, kit swap, device
  replaced, a Drum Sampler or Simpler pad renamed — which is how a swap
  made in Live's own UI reaches the pad labels), so an unmapping in Live
  un-dims the UI on its own. A `set`
  rejects with `write-rejected detail="property-read-only"`. Keys
  sorted, compact separators, a few hundred bytes. The UI routes on it
  (plugin pads → macro grid, native pads → virtual macros), dims a
  function with `members == 0` and shows one with `held == members` as
  read-only.
- **`vm.macro.<name>` — rack macros (2026-09-07).** On a `DrumGroupDevice`
  whose pads hold nested Instrument Racks (an Ableton-pack kit such as
  `Ethnic Drums`: every pad an `InstrumentGroupDevice` around Sampler
  chains, the parameters the seven functions bind macro-held inside),
  one computed row per macro **name** the census lists: `float` `t`
  0..1, the name riding verbatim after the prefix (`vm.macro.Pitch
  Attack`, spaces and all). A `set` fans out to every pad rack's macro
  of that name through the macro's own 0..127 — the rack fans it on to
  its chains itself — skipping a macro that is itself macro-held
  (mapped from the Drum Rack's own macro; `held` in the census), inside
  the same coalescing and undo step as the seven; the cold-read is the
  first pad's macro, normalized. The Drum Rack's own top-level macros
  are never written on a rack macro's behalf (on these kits they are
  named but unmapped). This is the one **open-ended** name family on the
  channel: the class is still closed (any other class rejects with
  `property-not-allowed`, as does the bare `vm.macro.`), and a name the
  kit does not carry cold-reads `nil` and stores + echoes a `set` while
  moving nothing — the member-less rule. A re-seed that finds a
  function's members gone (racks dropped onto a Sampler kit's pads)
  drops its held value to `nil` rather than echoing the old kit's number.
  **`pitch` binds through the pad racks' transpose macro:** a macro named
  Transpose / Pitch / Tune / Trnsp (exact, case-insensitive; the first
  in that order) is the pad's `pitch` member under the project convention
  that a pitch macro spans −48..+48 semitones over its 0..127
  (`macro = (st + 48) / 96 × 127`), so `vm.pitch`, the ±12 buttons and
  the sequencer's octave move the same knob in semitones, with the
  per-pad offsets and the kit-move reconcile reading the macro back.
  The census names it as `pitchMacro`; the UI shows Trnsp in that
  macro's place rather than a second slider for the same knob.
- **`vm.selectedPad` — Live's selected pad (2026-09-08).** On a
  `DrumGroupDevice`: `int` MIDI note of `rack.view.selected_drum_pad`,
  or `nil`. A `set` selects `drum_pads[note]` in Live (any pad, empty
  ones too; a note outside 0..127 or a non-number rejects), and the rack
  view's own `selected_drum_pad` listener re-emits the row — so a `set`
  is echoed twice, once by the channel and once by Live, both carrying
  the note — and a pad tapped in Live's own rack reaches every
  subscriber the same way. Selecting a pad triggers nothing; it moves
  Live's device view and what the Move encoder's chain-volume knob
  (ADR-412) targets.
- **`vm.pad.<note>.<fn>` — one pad (2026-09-08).** The second open-ended
  family on the channel, `DrumGroupDevice` only: `<note>` 0..127 and
  `<fn>` any function name the row family knows, a rack macro included
  (`vm.pad.38.macro.Attack`); anything else rejects with
  `property-not-allowed`. The value is that pad's, **absolute**, in the
  function's own units (`t` 0..1, the `fxType` int, `pitch` in whole
  semitones *without* the sequencer's shift — as `vm.pitch` reports the
  kit). A read is Live's own value off the pad's first continuous member
  (the kit's anchor rule, per pad); `nil` when the pad has no member for
  the function or no such pad. A `set` moves **that pad only**, clamped
  and echoed as the pad row alone — `vm.<fn>` does not move — and is
  stored as the pad's deviation from the kit value (its pitch offset for
  `pitch`), so the next kit gesture carries the pad along at its new
  distance and a held sequencer octave stacks on top. Rides the same
  per-pass coalescing and gesture undo step as the kit rows; a section
  switch on the pad follows the pad's own amount. On a still
  macro-mapped pipeline kit the write is dropped with a warning (a pad
  cannot move on its own under Live's macro). A subscribed pad row is
  re-emitted when a hand edit in Live moves that pad, when a kit move is
  adopted, and on every re-seed.
- **`vm.padFx` — effect presence per pad (issue #491, 3.8.0).** On a
  `DrumGroupDevice`, read-only, a second computed provider
  (`DrumPadChainComponent`, `computed="drum_pad_chain"`): every populated
  pad's chain devices as a JSON string —
  `{"pads":{"38":[{"index":0,"class":"OriginalSimpler","name":"Snare","type":1},{"index":1,"class":"Hybrid","name":"Reverb","type":2}]}}`
  — `index` the device's chain position (its `devices/<index>` segment
  under the pad path), `type` Live's `Device.type` (1 instrument, 2 audio
  effect, 4 MIDI effect; `null` unread). Built by a walk that reads only
  those three attributes; re-emitted from each chain's own `devices`
  listener (and the rack's `drum_pads` / `chains`), after the same 150 ms
  deferral the census uses. Past ~8 KB the names are dropped. This is
  what lets the FX grid flip a tile to ghost or active the instant a pad
  is touched, before any records land.
- **`vm.padChain.<note>` — one pad's chain, subscribed (issue #491,
  3.8.0).** Read-only, same provider, the third open-ended name family.
  While subscribed the surface keeps value listeners on every parameter
  of every effect on that pad's chain (the instrument's are the
  virtual-macro layer's), feeding the ordinary `param/value` echo with
  the composed pad path, and answers **every cold read** with a
  pad-scoped `state/full/tree` (reason `pad-chain`, scope the pad path)
  — every cold read, not just the first, so a second client bumping the
  refcount gets the records too. The row's own value is that pad's
  presence entry (`{"note":38,"devices":[…]}`; `nil` for a pad with no
  chain). Live's selected pad plays no part: which pads are watched is
  each client's own refcounted choice, so two clients cannot rip each
  other's records out. A chain edit runs a **narrower composite** than
  the track's: advance the generation (the `state/invalidate` it emits
  carries no paths), run the property channel's structural invalidate
  (a pad Reverb's IR subscriptions on a path that moved are torn down),
  re-emit `vm.padFx` and re-emit and re-watch every subscribed pad — it
  never republishes the song and never feeds `on_device_added`.
- **Read-only properties** (e.g. `sample.length`) reject writes
  with `write-rejected detail="property-read-only"`; listeners
  still fire.
- **Dotted names are opaque on the wire.** `sample.warp_mode` is
  one OSC string arg. Surface splits on `.` when binding to the
  LOM.
- **Dict- and list-shaped values ride as JSON strings.** Compressor2's
  routing pair expose Python dicts; Simpler's `sample.slices`
  exposes a list-of-int. The surface `json.dumps` on emit
  (`_jsonable` recursively handles iterables and LOM proxy objects)
  and `json.loads` before `setattr`. The allowlist row is flagged
  `coerce_dict_to_json=True`. All other rows are scalar.
- **No cross-address ordering** with `state/full`/`state/invalidate`
  — properties don't advance generation.
- **Cascading re-emits** for properties whose mutation triggers a
  sibling recompute Live doesn't fire a listener for. Source-spec
  `cascade_to=("sibling.name", ...)` triggers the surface to read +
  emit `property/value` for each named target on both fire AND
  successful set. Each cascade emits twice — immediately, and
  ~150 ms later via `schedule_delayed` — so synchronous recomputes
  (e.g. `slicing_sensitivity` → `slices`) and asynchronous ones
  (e.g. `playback_mode` → `slices` recomputes on a later tick) both
  land. Consumers may receive duplicate same-value emits; the
  store's apply path is a no-op for unchanged values, so the UI
  re-renders identically. See ADR-354.

### 2.7 Clip and slot

| Address                     | Dir     | Args                                    | Semantics |
| --------------------------- | ------- | --------------------------------------- | --------- |
| `/looping/v3/clip/created`  | Surf→UI | `slotPath:string, generation:int`       | Clip now exists at `slotPath/clip`. |
| `/looping/v3/clip/removed`  | Surf→UI | `slotPath:string, generation:int`       | Clip at `slotPath/clip` gone. |
| `/looping/v3/clip/focused`  | Surf→UI | `clipPath:string`                       | Surface's observed focused clip changed. Empty string (`""`) when no session clip is focused. |
| `/looping/v3/clip/triggered` | Surf→UI | `slotPath:string, isTriggered:int(0\|1)` | Slot fired but not yet launched — the launch-quantization wait, which Live blinks in its own session view. From a per-slot `ClipSlot.is_triggered` listener in `ClipsComponent` (the `Clip` twin is not observable, and a slot-scoped listener also covers an **empty** slot queued to record, where there is no clip object yet). **Both edges are emitted**, so the UI never times a blink out on its own. Pure telemetry: no generation advance, and deliberately NOT in the S record — it is transient, and a snapshot carrying it would outlive the wait and leave a cell blinking forever. Cheap rate (two messages per launch per slot). |
| `/looping/v3/clip/property` | Surf→UI | `clipPath:string, name:string, value:any` | Named clip property changed. Fires only for the currently-focused clip. **`gain`** is the gain the user set: while a Permute mute step holds the clip at 0 it is the value the step will put back, never the 0 (2026-09-27). Every `gain` is followed by **`gain_display`** (string, Live's `Clip.gain_display_string`, e.g. `"-6.0 dB"` — the 0..1 value is not linear in dB), except while a mute step holds the clip silent, when Live's text would read the silence. |

Focus-scoped observation: the surface observes **one clip at a time**
— whichever `song.view.detail_clip` points at. Writes, however, are
accepted against any valid clipPath (late slider release after focus
change must still land). Late echoes from a prior focus are dropped
by the UI.

| Address                             | Dir     | Args                                              | Semantics |
| ----------------------------------- | ------- | ------------------------------------------------- | --------- |
| `/looping/v3/clip/set/loop_start`   | UI→Surf | `clipPath:string, value:float, generation:int?`   | Write `clip.loop_start` (beats, ≥0). Also writes start_marker. |
| `/looping/v3/clip/set/loop_end`     | UI→Surf | `clipPath:string, value:float, generation:int?`   | Write `clip.loop_end` (beats, > loop_start). |
| `/looping/v3/clip/set/start_marker` | UI→Surf | `clipPath:string, value:float, generation:int?`   | Write `clip.start_marker` (beats). |
| `/looping/v3/clip/set/end_marker`   | UI→Surf | `clipPath:string, value:float, generation:int?`   | Write `clip.end_marker` (beats). |
| `/looping/v3/clip/set/warp_mode`    | UI→Surf | `clipPath:string, value:int, generation:int?`     | Write `clip.warp_mode` (int ∈ {0,1,2,3,4,6}). |
| `/looping/v3/clip/set/looping`      | UI→Surf | `clipPath:string, value:int, generation:int?`     | Write `clip.looping` (0/1). |
| `/looping/v3/clip/set/pitch_coarse` | UI→Surf | `clipPath:string, value:int, generation:int?`     | Write `clip.pitch_coarse` (semitones, int ∈ [-48, 48]). Out-of-range / non-int **rejected** (no clamp — callers own the range math). |
| `/looping/v3/clip/set/pitch_fine`   | UI→Surf | `clipPath:string, value:int, generation:int?`     | Write `clip.pitch_fine` (cents, int ∈ [-50, 49]). Same reject-not-clamp contract as pitch_coarse. (M2 — clip-view-mirror) |
| `/looping/v3/clip/set/gain`         | UI→Surf | `clipPath:string, value:float, generation:int?`   | Write `clip.gain` (normalized float ∈ [0.0, 1.0], **clamped** — continuous fader pins to the rail rather than rejecting). Audio clips, warped or not (measured 2026-09-27, Live 12.4.15b4; 0.4 = 0 dB, 1.0 = +24 dB, 0.0 = -inf); a LOM raise (a MIDI clip) is swallowed and, on the focused clip, the real `gain` is re-emitted so the fader goes back. NaN rejected. **Under a Permute mute step** the clip is not written: the value becomes what the step puts back and is echoed as `gain`; the clip stays silent until the step ends. (M2 — clip-view-mirror; the clip view's Gain fader since 2026-09-27) |

Per-track playing-clip + playhead (ADR-360, `PlayheadComponent`):

| Address                          | Dir     | Args                                                                                                                                                                                                          | Semantics |
| -------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `/looping/v3/track/playing_slot` | Surf→UI | `trackPath:string, slotIdx:int, isAudioClip:int(0\|1), filePath:string, lengthBeats:float, loopStartBeats:float, loopEndBeats:float, looping:int(0\|1), status:int, fileStartBeats:float, fileEndBeats:float` | Track's playing slot changed (or display fallback for stopped tracks). `slotIdx=-1` = no clip on the track; otherwise the strip renders this slot's content. `status` ∈ {0=stopped, 1=playing, 2=recording}. **`fileStartBeats` / `fileEndBeats` (2026-09-18, appended, no version change)** place the audio file in the clip's own time — the span the `/api/sample-peaks` array covers, from `Clip.sample_to_beat_time` at the first and last sample on a warped clip, `0 .. sample_length / sample_rate` on an unwarped one (whose loop points are seconds too — Live: "unit depends on warping"). `0, 0` = unknown: MIDI, a take still flushing, any LOM raise. `lengthBeats` cannot stand in for it: on a looping clip it is the **loop's** length, so a renderer that took the file to span `[0, length]` drew nothing for a loop that had moved past it (measured on the rig: a 28-beat take looping 16..24 reports length 8). A UI reading nine args treats the span as unknown; an older UI ignores the two. **Since the same day it is also re-emitted (deduped) when the rendered clip's `warping`, `looping`, `loop_start`, `loop_end`, `start_marker` or `end_marker` changes** — coalesced to the next tick, since one warping toggle converts every loop point and marker with it — so an edit made with the transport stopped reaches the strip without a relaunch. **The loop fields are the clip's playable range either way:** with looping off Live reports the start and end markers in them (measured: a warped clip looping 0..4 with its end marker at 8 read `loop_end` 8 once looping went off; an unwarped take — which cannot loop — read `loop_start` equal to its start marker), so the UI draws `[loopStart, loopEnd]` whether or not the clip loops. Don't use `end_marker` / `length` for this: on that unwarped take they read 28.0 and 12 (beats) beside a 17.78 s file. Loop bounds are read once at slot-change time; subsequent edits flow through `/looping/v3/clip/property` (UI cross-subscribes by `clip_path`). **`filePath` here covers ONE slot per track** — the playing (or display-fallback) one, since this rides a single `playing_slot_index` listener per track. For any other slot's sample path (the ADR-415 session grid), use `/looping/v3/clip/sample/get`. Also re-emitted (with dedup) on `is_recording` flips and on `slot.has_clip` flips for the rendered slot — fresh-recording materialization, clip-deletion-out-from-under-render, and idle-track clip-create all reach the UI without manual refresh. The has_clip path is the in-process fanout of ClipsComponent's per-slot listener; PlayheadComponent registers `on_slot_has_clip_changed` (ADR-363). Cheap rate (gestural). |
| `/looping/v3/track/playhead`     | Surf→UI | `trackPath:string, slotIdx:int, positionBeats:float, status:int`                                                                                                | Throttled 30 Hz: live `clip.playing_position` straight to the UI. UI paints what it receives — no client-side extrapolation. When transport stops, `playing_position` listeners stop firing → no emits → playhead freezes. **Two unthrottled emits since 2026-09-18:** one right after every `playing_slot` that goes out for a live clip (the UI rebuilds the entry, and a UI that just connected has no position — with the transport stopped nothing else would say it: measured UI 0 vs Live 1.56 on a held clip), and one per live clip on a transport stop (the 30 Hz window can drop the last position before the stop). Live keeps a clip marked playing while the transport is stopped and resumes it on Play, so the UI keeps that clip's playhead, frozen where Live holds it; a stopped (display-fallback) clip draws none. `lengthBeats` and loop bounds intentionally NOT carried — UI already has them from `playing_slot` / `clip/property`. |

Permute step-position telemetry (`SequencerComponent`):

| Address                       | Dir     | Args                                                        | Semantics |
| ----------------------------- | ------- | ----------------------------------------------------------- | --------- |
| `/looping/v3/permute/step`    | Surf→UI | `devicePath:string, kind:string("mute"\|"pitch"), step:int` | Permute's current sequencer step, computed by `SequencerComponent` for every Permute device (permute ADR-020). The fat device's `/looping/permute/step` ingest, the other emitter until 2026-09-26, is gone with the `sequencer_engine` switch. `step` is 0..15 while running (0..length−1; 16 steps a lane since ADR-443), `-1` when idle/stopped. Event-driven (fires on step change only, not per tick) — ~10 Hz per sequencer per device, so no throttle. **Deliberately not `param/value`:** Permute exposes step position as params 23/24 ("Mute Current"/"Pitch Current") but Live fires no value-changed for them ("Visible (Not Stored)" mode) so they arrive frozen, and reading them back by index/name re-imports Permute's layout fragility (a verified off-by-two index shift; both params report the name "Mute Current", so name-matching collapses mute and pitch onto one index; a 1-indexing offset from a `+1` box in the Max display chain). Step position is ephemeral read-only telemetry — it follows the playhead/meter lane instead. Permute's *real* params (`Mute 1..16`, `Pitch 1..16`, Lengths, Rates, Chance, Temperature) still ride `param/value` via the generic listener. **ADR-435 (2026-09-14):** `devicePath` may be pad-shaped (`tracks/1/devices/0/pads/38/devices/2`) — a Permute inside a Drum Rack pad's chain is an engine instance of its own that drives that pad alone, and its step lights ride this same wire keyed by that path; the UI's step store needs no change, a pad path is just a longer key. `state/full` still emits frozen P records for the fat device's 23/24 (the walker is generic by design); nothing reads them. On the thin device 23/24 are `Mute 9`/`Mute 10` (ADR-443). |

Permute mute gate, surface → Max (`SequencerComponent`, 2026-09-17):

| Address                   | Dir      | Args                                     | Semantics |
| ------------------------- | -------- | ---------------------------------------- | --------- |
| `/looping/permute/gate`   | Surf→M4L | `trackIndex:int, open:int(0\|1)`          | **Private Surf→M4L wire, outside the v3 UI contract.** The mute lane's state for one track, sent straight to a `udpreceive` inside a Max device on that track — `osc.permuteGate.remotePort` (11030), no bridge hop, the same direct route `owner/Max Patches/foot-trigger.js` uses inbound. `open` 1 means the lane is letting sound through, 0 that this step is muted; the solo override is already applied, so a soloed track always reads 1. It exists so a device can gate **what it plays** rather than the surface writing a parameter to silence it: a LOM write per step transition would put an undo step on Live's stack for each one. Emitted on every mute-lane transition, on every restore (transport stop, device removal, disconnect — all of which open it), and re-stated on a 1 s heartbeat. **Track-level Permutes only:** a pad Permute's mute is scoped to its pad and this wire names a track. Receivers must **fail open** — the shipped one ([`Skaka Metronome Picker`](../ableton/M4L%20devices/Skaka%20Metronome%20Picker/)) opens after 2.5 s of silence, so a dropped datagram or a surface that never starts costs a beat, not a silent instrument mid-set. |

MIDI notes pull endpoint (ADR-360 Milestone 3, `ClipNotesComponent`):

| Address                            | Dir     | Args                                                                          | Semantics |
| ---------------------------------- | ------- | ----------------------------------------------------------------------------- | --------- |
| `/looping/v3/clip/notes/get`       | UI→Surf | `requestId:string, clipPath:string`                                           | Request the full MIDI note list of `clipPath`. Audio clip → `clip-not-midi`. Missing/unresolvable → `clip-not-found`. > 512 notes → `clip-too-many-notes` (cap is 512 to stay under the 9216 B UDP MTU; ADR-360 deviates from the plan's 4096 cap which would have produced 64 KB blobs). Bounded LRU (32 entries / 30 s) makes retransmits idempotent. |
| `/looping/v3/clip/notes`           | Surf→UI | `requestId:string, clipPath:string, count:int, notesBlob:bytes`               | Reply. `notesBlob` is OSC `b` (blob) carrying a flat little-endian float32 array `[pitch, startBeats, durationBeats, velocity] × count` — `struct.pack('<ffff', …)` on the surface; `DataView.getFloat32(off, true)` on the UI. **The velocity's sign is the note's mute bit (ADR-444, 2026-09-18, no version change):** a muted note is packed as `-velocity`; velocity 0 muted is `-0.0`, which float32 keeps and the UI reads with `Object.is(v, -0)`. Same 16 B stride and 512 cap. The UI folds the sign into `MidiNote.muted` and hands on `abs(velocity)`; an older client reads a muted note as a dim one. Live never sees a negative velocity — `MidiNote.mute` is its own boolean there. |
| `/looping/v3/clip/notes/changed`   | Surf→UI | `trackPath:string, clipPath:string`                                           | Surface-pushed poke. Emitted by `PlayheadComponent`'s notes-listener on the playing MIDI clip **and** (clip-view-mirror M3, ADR-382) by `ClipNotesComponent`'s notes-listener on the **focused** clip (`trackPath` empty for the focused poke). UI re-pulls only for clips it's rendering. The editing client suppresses its OWN-write echo for ~400 ms (`clipRichNotesService.shouldSuppressReconcile`) so it doesn't reconcile against its optimistic edit. |
| `/looping/v3/clip/sample/get`      | UI→Surf | `requestId:string, clipPath:string`                                           | **ADR-415.** Ask what sample a slot holds, so the session clip grid can draw a waveform in a cell that isn't playing. Path-keyed and **not** focus-scoped — that is the point, since the grid asks about cells the user hasn't touched. Owned by `ClipsComponent.handle_sample_get`. Errors: `clip-not-present` (any resolve failure — the caller only needs to know whether there is anything to draw), `write-rejected` (arg-count / empty requestId). Cheap rate (viewport-scoped: the UI asks only about visible cells and caches by clipPath). |
| `/looping/v3/clip/sample`          | Surf→UI | `requestId:string, clipPath:string, isAudioClip:int(0\|1), filePath:string, fileStartBeats:float, fileEndBeats:float`   | Reply. The file span is `playing_slot`'s (appended 2026-09-18, no version change; `0, 0` = unknown, and a four-arg reply reads as unknown). **A MIDI clip is a reply, not an error** (`isAudioClip=0`, empty `filePath`): the UI branches on that bit to draw note lanes via `clip/notes/get` instead, so routing it to the error channel would cost the caller the one bit it needs. An audio clip with an empty `filePath` is also a reply, not an error — Live reports one while a recording is still flushing to disk (same settle window `playing_slot` works around), and the UI draws the cell without a waveform and re-asks later. |

Rich focused-clip note channel (clip-view-mirror M3, ADR-382, `ClipNotesComponent`) — identity-carrying, chunked. Feeds the central editor only; strip thumbnails keep the cheap blob above:

| Address                              | Dir     | Args                                                              | Semantics |
| ------------------------------------ | ------- | ---------------------------------------------------------------- | --------- |
| `/looping/v3/clip/notes/rich/get`    | UI→Surf | `requestId:string, clipPath:string`                              | Request the rich note list. Audio → `clip-not-midi`; unresolvable → `clip-not-found`; > 4096 notes → `clip-too-many-notes`. Separate LRU (32 / 30 s) replays the whole begin→chunk→end sequence on retransmit. |
| `/looping/v3/clip/notes/rich/begin`  | Surf→UI | `requestId:string, clipPath:string, count:int, totalChunks:int`  | Reassembly header. `totalChunks=0` for an empty clip (UI resolves with `[]`). |
| `/looping/v3/clip/notes/rich/chunk`  | Surf→UI | `requestId:string, chunkIndex:int, noteBlob:bytes`               | One chunk. `noteBlob` is OSC `b` carrying whole `<iffffi>` note structs `(noteId:int32, pitch:f32, startBeats:f32, durBeats:f32, velocity:f32, mute:int32)` = 24 B/note. Chunks split on whole-note boundaries under a 4 KB budget (never split a struct). |
| `/looping/v3/clip/notes/rich/end`    | Surf→UI | `requestId:string, checksum:string`                              | `checksum` is `"0x%08x"` FNV-1a (int31) over the concatenated chunk bytes. UI verifies + re-requests on mismatch / missing chunk. |

By-id MIDI note editing (clip-view-mirror M4, ADR-382, `ClipNotesComponent`). Non-structural → no generation bump (§4); `generation` carried only for future-proofing. Cross-client sync via the focused-clip `notes/changed` poke:

| Address                          | Dir     | Args                                                          | Semantics |
| -------------------------------- | ------- | ------------------------------------------------------------ | --------- |
| `/looping/v3/clip/notes/remove`  | UI→Surf | `clipPath:string, noteIds:blob, generation:int?`             | `clip.remove_notes_by_id(ids)`. Delete only (Live's docstring forbids using it to implement an edit). `noteIds` is a little-endian **int32 blob** (OSC has no array type and the surface codec rejects JS arrays — `noteIds:int[]` ride as a blob both ways; `encodeIdBlob` / `_parse_id_list`). Audio → `not-midi-clip`; bad ids → `write-rejected`. |
| `/looping/v3/clip/notes/modify`  | UI→Surf | `clipPath:string, modsBlob:bytes, generation:int?`           | Read-mutate-writeback: `get_notes_by_id` (falls back to full read) → mutate the `MidiNote` objects' fields in place → `apply_note_modifications(vec)`. Preserves `noteId`. `modsBlob` is the same `<iffffi>` struct (real id required). Audio → `not-midi-clip`; bad blob → `write-rejected`. |
| `/looping/v3/clip/notes/add`     | UI→Surf | `requestId:string, clipPath:string, notesBlob:bytes, generation:int?` | Build id-less `MidiNoteSpecification` per note (the noteId slot is ignored — Live assigns ids) → `add_new_notes(tuple(specs))`. `notesBlob` is the `<iffffi>` struct. Audio → `not-midi-clip`; bad blob → `write-rejected`. |
| `/looping/v3/clip/notes/added`   | Surf→UI | `requestId:string, clipPath:string, newIds:blob`             | Reply carrying the ids `add_new_notes` returned, so the UI swaps its temp negative ids for the real ones. `newIds` is a little-endian **int32 blob** (`_pack_id_blob` / `decodeIdBlob`) — same reason as `notes/remove`. Empty blob (older Live returns `None`) → UI falls back to the `notes/changed` re-pull. |
| `/looping/v3/clip/notes/select`  | UI→Surf | `clipPath:string, noteIds:blob, generation:int?`             | **M6 (ADR-382):** select notes by id in Live's piano roll → `clip.select_notes_by_id(ids)`. Empty `noteIds` blob → `clip.deselect_all_notes()` (clear). Selection is view state, not content — non-structural, fire-and-forget, **no echo**. `noteIds` is a little-endian int32 blob. Editor→Live only; Live→editor reverse needs polling (no selection-changed listener exists on Live 12.4 — SelectionProbe verdict) and is deferred. Audio → `not-midi-clip`; bad ids → `write-rejected`. |
| `/looping/v3/clip/notes/duplicate` | UI→Surf | `requestId:string, clipPath:string, noteIds:blob`          | **M5 (ADR-382):** duplicate notes by id → `clip.duplicate_notes_by_id(ids)`. Replies on the shared `notes/added [requestId, clipPath, newIds:blob]` with the copies' ids so the UI selects them. `noteIds` is a little-endian int32 blob. Empty blob → `notes/added` with empty `newIds`. Audio → `not-midi-clip`; bad ids → `write-rejected`. NB: there is **no** `clip.quantize` LOM method — quantize is done client-side as a batch `notes/modify` (snap each start to grid), no dedicated endpoint. |

Launch / stop / delete / duplicate / transpose:

| Address                      | Dir     | Args                                                 | Semantics |
| ---------------------------- | ------- | ---------------------------------------------------- | --------- |
| `/looping/v3/clip/launch`    | UI→Surf | `slotPath:string`                                    | Launch clip at slot. Empty slot: records if track armed, else no-op. `launch-failed` only on LOM raise. |
| `/looping/v3/clip/stop`      | UI→Surf | `trackPath:string`                                   | `track.stop_all_clips()`. Idempotent. |
| `/looping/v3/clip/focus`     | UI→Surf | `slotPath:string`                                    | Show a clip without playing it — the session grid's long-press. Writes `song.view.detail_clip` (and, best-effort first, `highlighted_clip_slot`). **Emits nothing itself:** the answer rides the existing `clip/focused` + property echoes, because `ClipPropertiesComponent`'s `detail_clip` listener is what fires — so a focus driven from the UI is indistinguishable from one driven inside Live. Needed because every clip-view channel (properties, rich notes, groove) is focus-scoped on the surface, so a client-side "selection" would show an empty view. Empty slot → `clip-not-present`; a raise on the `detail_clip` write → `write-rejected` (a raise on the cosmetic highlight is logged and ignored). |
| `/looping/v3/clip/delete`    | UI→Surf | `slotPath:string`                                    | Delete the clip. Empty slot → `clip-not-present`. |
| `/looping/v3/clip/duplicate` | UI→Surf | `slotPath:string, destSlotPath:string`               | Same-track-only; destination must be source's next slot. Cross-track → `path-not-supported`; dest-occupied / non-adjacent → `duplicate-rejected`. |
| `/looping/v3/clip/transpose` | UI→Surf | `clipPath:string, semitones:int, generation:int?`    | Shift every note's pitch in a MIDI clip. Audio clip → `not-midi-clip`. Since M4 (ADR-382) this is read-mutate-writeback via `apply_note_modifications` — it **preserves every `note_id`** (the old clear-and-rewrite churned them), falling back to clear-and-rewrite only when `apply_note_modifications` is absent. |
| `/looping/v3/track/transpose` | UI→Surf | `request_id:string, trackPath:string, semitones:int` | **2026-09-25, no version change.** The clip view's ±12 on an **Instrument Rack**. The surface looks for a Drum Rack inside the track's instrument by class — top-level, or one level down in an Instrument Rack's chain (`drum_vm_resolve.find_track_drum_rack`, the same test Permute's pitch route uses) — and moves that kit's `vm.pitch` by `semitones`, clamped ±48, through `DrumVirtualMacroComponent` (fan-out, one undo step per gesture). The UI cannot do this itself: a wrapped kit's path runs through `chains/`, which the UI's wire does not address. A `/looping/v3/property/value [rackPath, "vm.pitch", value]` echo goes out as `property/set` would send it. Handled by `TrackTransposeComponent`. The UI sends this only for an Instrument Rack; a top-level Drum Rack it moves itself through `vm.pitch`. |
| `/looping/v3/track/transpose/reply` | Surf→UI | `request_id:string, result:string, detail:string, pitch:int` | `result`: `drum` (the kit moved; `pitch` = stored value), `not-drum` (no Drum Rack in the instrument — the UI keeps its rack-macro-by-name, then note-shift path), `held` (every pitch member is macro-held — nothing written; the UI moves the rack's named pitch macro, never the notes), `none` (a kit with no pitch member or no value yet), `invalid-args`, `no-track`. A surface older than this never answers; the UI waits 1 s and falls back as for `not-drum`. |
| `/looping/v3/clip/load_file` | UI→Surf | `trackPath:string, slotPath:string, filePath:string` | Load an audio file into a clip slot via `ClipSlot.create_audio_clip`. Bypasses the Browser walk, so arbitrary absolute `filePath`s work (including raw `.wav`/`.aif` under User Library that `/looping/v3/device/load` cannot resolve). Empty `slotPath` → surface picks the first empty slot on `trackPath`. Populated target slot → existing clip is deleted first (replace semantics). Errors: `path-not-found` (file missing), `slot-not-found` (explicit slot OOB), `no-empty-slot` (auto-pick and every slot full), `write-rejected` (malformed args), `load-failed` (`create_audio_clip` raised). |
| `/looping/v3/clip/swap_file` | UI→Surf | `requestId:string, clipPath:string, filePath:string` | **ADR-440.** Put `filePath` in the clip's slot and keep the clip — the clip view's similar-sound pill. Live has no verb that changes a clip's file, so `ClipsComponent.handle_swap_file` checks first (file on disk, an audio clip, not recording; a refusal changes nothing), then inside one undo step deletes the clip, `create_audio_clip`s the file and writes the old clip's warping, warp mode, gain, pitch, looping, launch mode, launch quantization, legato, velocity amount, RAM mode, muted and color onto the new clip; keeps a name of the user's own (one that is not the old file's stem); fires the slot when the old clip was playing or queued and the transport is running (Live keeps a clip marked playing after a stop, and a fire then would start the set); and sets `detail_clip` when it was the clip Live showed. A file Live will not load puts the old file back with the same settings — **every** way `create_audio_clip` can fail routes through that restore, not only the LOM's own `(RuntimeError, AttributeError, TypeError)`, because the slot is already empty by then (M11). **Always answers on the reply**, never `/looping/v3/error` — except a request with no `requestId` to answer (`write-rejected`). |
| `/looping/v3/clip/swap_file/reply` | Surf→UI | `requestId:string, ok:int(0\|1), code:string, detail:string` | Fixed arity. `ok=1`: `code` is `""`, and `detail` names every setting the new clip did **not** get (`"not kept: gain"`) — one Live refused on the write, **or one whose read on the old clip raised, so it could not be carried at all** (swap audit M14; it used to vanish, and the reply said everything was kept) — else `""`. `ok=0`: `write-rejected` (arg count, not a `…/clip` path, `delete_clip` raised) — **only for a refusal that changed nothing**, which is why everything after `delete_clip` returns is `load-failed` instead, whatever it raised (M11); `path-not-found` (file not on disk), `clip-not-present` (slot empty or unresolvable), `clip-not-audio`, `clip-recording`, `clip-file-unknown` (the clip's own `file_path` reads empty **or raises**, so the swap could not be put back), `load-failed` — `create_audio_clip` raised (`detail` ends "the old file is back" or "the slot is empty"), the slot reads empty after it returned ("the slot holds no clip after create_audio_clip"), or **reading the slot or the new clip raised**, which is a swap that happened and cannot be inspected ("reading the slot raised: …(the new file may be in the slot)", M13). |
| `/looping/v3/clip/set/color` | UI→Surf | `clipPath:string, color:int`                         | Write `clip.color` (RGB int, 0..0xFFFFFF). Used by the auto-color flow to recolor existing clips alongside their parent track on preset load (see `interface/src/lib/services/trackColoring.ts`). No listener echo — clip color is read-only via state/full snapshots; UI applies the write optimistically and cross-client sync recovers on the next state-full re-emit. Errors: `write-rejected` (arg-count, malformed `clipPath`, non-int / out-of-range color, or LOM raise), `path-not-found` / `path-not-supported` (resolver), `clip-not-present` (slot is empty). |
| `/looping/v3/scene/launch`   | UI→Surf | `scenePath:string`                                   | `scene.fire()`. Per-track empties are silent no-ops. |
| `/looping/v3/scene/stop`     | UI→Surf | `scenePath:string`                                   | Stop all clips on all tracks. |

Groove (focus-scoped, mirrors ClipPropertiesComponent):

| Address                                            | Dir     | Args                                              | Semantics |
| -------------------------------------------------- | ------- | ------------------------------------------------- | --------- |
| `/looping/v3/clip/groove/has_groove`               | Surf→UI | `clipPath:string, value:bool`                     | Focused clip has a linked groove. |
| `/looping/v3/clip/groove/property`                 | Surf→UI | `clipPath:string, name:string, value:number`      | Per-amount echo. `name ∈ {base, timing_amount, quantization_amount, random_amount, velocity_amount}`. |
| `/looping/v3/clip/groove/file`                     | Surf→UI | `clipPath:string, name:string`                    | The groove file the focused clip's groove holds (`Swing 16ths 57`, a Core Library `.agr`'s name without the extension), as far as the pool entry's name says; `""` for no groove, a template's `unassigned-*`, the default `Vamp Groove` or a legacy `Clip_*` claim. Sent on focus, on handshake accept, and after any write that changes the clip's groove. Since 2026-09-29. |
| `/looping/v3/clip/groove/set/file`                 | UI→Surf | `clipPath:string, name:string`                    | Put the clip on the groove file `name` (the Groove view's tiles): a Core Library file by its name, or one of the user's own as `User: <file>` — a file in the User Library's `Grooves` folder, any subfolder, found through `browser.user_library`. Takes a free groove holding that pattern (`unassigned-<idx> · <name>`, or an orphaned claim of it), else loads the file from the Core Library through Live's browser (`browser.packs` → `Core Library` → `Grooves`, found by name). Then writes the clip's Quantize, Timing, Random and Velocity onto it, since a loaded file brings its own; a clip with no groove gets Timing 100, the rest 0. The file's grid (`base`) is kept. The groove the clip left, when it was the clip's own claim and no other clip links it, is named `unassigned-<idx> · <its pattern>`. Already on `name` and unshared: no change, `file` re-echoed. A name that is empty, over 128 characters or holds `/`, `·` or `#` is dropped. A file Live's browser does not list: `/looping/v3/error` `pool-exhausted`, detail `No groove file <name>`, nothing moved. Since 2026-09-29. |
| `/looping/v3/clip/groove/set/base`                 | UI→Surf | `clipPath:string, value:int, generation:int?`     | `clip.groove.base` (int ∈ {1,2,3}). Assign-on-first-write (below). No UI sender since the Groove view (2026-09-29): a groove's grid comes with its file. |
| `/looping/v3/clip/groove/set/timing_amount`        | UI→Surf | `clipPath:string, value:float, generation:int?`   | `clip.groove.timing_amount` (0–100). |
| `/looping/v3/clip/groove/set/quantization_amount`  | UI→Surf | `clipPath:string, value:float, generation:int?`   | `clip.groove.quantization_amount`. |
| `/looping/v3/clip/groove/set/random_amount`        | UI→Surf | `clipPath:string, value:float, generation:int?`   | `clip.groove.random_amount`. |
| `/looping/v3/clip/groove/set/velocity_amount`      | UI→Surf | `clipPath:string, value:float, generation:int?`   | `clip.groove.velocity_amount`. |

**Assign-on-first-write.** An amount write on a clip with no groove
claims one: an `unassigned-<idx>` entry, else an orphaned claim with no
pattern named, else one minted from `Vamp Devices/Grooves/Vamp Groove.agr`.
A clip on a groove that is not its own and that another clip also links
(Live 12.1's default groove for new MIDI clips) takes one of its own on
the first write, starting from the shared groove's settings, and of the
shared groove's file when the Core Library has one of that name (else the
default). Pool exhaustion (nothing free and the mint failed) surfaces as
`/looping/v3/error` with code `pool-exhausted`.

**Pool entry names (2026-09-29).** A claim is `<track> <scene> · <pattern>
#<pathHash>` (`Bass 3 · Swing 16ths 57 #1a2b3c4d`), or `<track> <scene>
#<pathHash>` when it holds the default; a free groove is `unassigned-<idx>`
or `unassigned-<idx> · <pattern>`. Ownership is the hash; the label is for
reading Live's Groove Pool and is refreshed on every claim. The older
`Clip_<pathHash>` and M4L `Clip_<liveId>` claims are still owned. A free
groove is reused only for the pattern it holds.

### 2.8 Device / preset load

| Address                       | Dir     | Args                                          | Semantics |
| ----------------------------- | ------- | --------------------------------------------- | --------- |
| `/looping/v3/device/load`     | UI→Surf | `trackPath:string, devicePath:string, presetPath:string, source:string (optional), rel:string (optional)` | Load a preset onto the device chain at `trackPath`. Sources from the User Library, every sidebar Place and every Pack in Live's own `Library.cfg` (since 3.11.0; `paths.placesRoots` in constants.json until then, still honored). **3.11.0:** the optional 4th and 5th args name the Place and the path inside it, as `prepare_for_preset`'s do (3 or 5 args); Permute loads as `place:Vamp Devices` + `Permute/Permute.amxd` with an empty `presetPath`, which the surface fills in from the checkout it runs from. **3.12.0 (2026-09-28): a native device by name.** `source` `native:<class>` (`Hybrid`, `AutoFilter2`, `MidiRandom`…, the class Live reports) with an empty `presetPath` and `rel` the name the device takes (the tile's: `Reverb`, not `Hybrid Reverb`; empty keeps Live's) inserts that device with `Chain.insert_device` / `Track.insert_device`, so the user's own default for it applies (`Defaults/Audio Effects` or `Defaults/MIDI Effects` in their User Library, else Live's factory settings). No file is read. The FX grid's 20 native tiles load this way; a rack, a plug-in preset or a Max device is a file. An error names `native:<class>` as its `path`, with `detail` `unknown-device: <class>` (a class not in `NATIVE_DEVICE_NAMES`) or `insert-refused` (Live raised, returned nothing, or refused the rename). On failure: `load-failed`. **`devicePath` is read since 3.8.0 (issue #491):** a pad path (`…/devices/<N>/pads/<note>`) loads the preset INTO that pad's chain — the surface selects the track, the pad on the rack and the chain's last device, sets the track's device insert mode beside the selection (`Track.View.device_insert_mode` = 2, put back to 0 after), calls `browser.load_item` — which then lands the preset in the pad's chain — and looks the moment it returns where it landed (ADR-437): chain grew → done; the track grew instead (a Live without the insert mode) → `song.move_device` into the chain; neither yet → the same look on every fast tick (~11 ms) until 1 s → `load-failed` with `detail="landed-nowhere;scope=<padPath>"`. Every pad-load error carries `;scope=<padPath>` in `detail` so the UI's slot reset can tell a pad-scope load from the track's. A non-pad `devicePath` is shape-validated as before; empty loads onto the track. **Measured on Live 12.4.15b2 (2026-09-10):** with the pad and the chain's last device selected, `load_item` still lands the preset on the TRACK every time; the then-deferred 200 ms check found the track grown and `move_device` put it into the chain (~240 ms after the request; 265–821 ms across four Permute loads on 2026-09-14), so a pad load through the browser cost the track two structural republishes (add, then remove) before the pad-chain composite, and Live books it as two undo steps — "Insert Device", then the move as a "Custom Action". **Since ADR-437 (2026-09-14)** the load lands in the pad's chain itself: with `Track.View.device_insert_mode` set beside the selection for the call, `load_item` put the Permute `.amxd` into the chain every time (mode 1 or 2), and only Live's default mode (0) sends it to the track — so there is no move, no track structural, and Edit → Undo is Live's own "Insert Device" (measured: `song.undo()` → `Undo Insert Device`, clean). The move remains as the fallback for a Live without the property; **undoing a `move_device`d Max device aborted Live** (`Fatal Error: ADeleteAction::Do`) whether or not the pair was grouped in one undo step, from a probe and from the Edit menu alike. An interim version that moved the newcomer the moment `load_item` returned measured 1 look, 114 ms (request → moved 127 ms). **A native device is inserted by name** (the `native:<class>` source above; from 2026-09-10 until 3.12.0 only when Live's user default was byte-identical to the owner's preset file): the surface calls `Chain.insert_device` / `Track.insert_device` with the display name (a MIDI effect after the MIDI effects already at the chain's head, directly before the instrument — position 0 on a plain pad; the browser fallback's `move_device` uses the same index), renames the device to `rel` and wraps both in one undo step — one call, in place, no track republish, no selection change. Every file (a rack, a plug-in preset, a Max device, a user's own preset of a native device) takes the browser path above — where **a MIDI effect lands on the track at index 0, ahead of the rack** (measured 2026-09-11 with the Random default moved aside), so the rack's path shifts by one until the move: the property channel drops the rack's rows at the old path, the move raises no pad-chain composite, and the UI's path-keyed subscriptions return with the second structural bundle and cold-read the pad; an audio effect lands after the rack and the composite fires as usual. **A head preset (ADR-445, 2026-09-19):** a track-level load of the wah preset (`constants.devices.wah.presetPath`, the one path in `DeviceLoadComponent`'s `head_preset_paths`; `loads_at_head`) lands at the head of the track's audio effects the way the pedal's own load does — the first audio effect selected, the insert mode "left of the selection" for the call and put back after, never a move — so the Pedal central view's Wah button and the toe switch place it identically. Every other preset lands where Live puts it, as before. |

**`trackPath` is required** (2026-04-26). The pre-2026-04-26 behavior
fell back to `song.view.selected_track` when `trackPath` was empty;
that fallback caused instrument loads to land on the previously-
selected (occupied) track during the `/looping/v3/selected_track`
echo lag. An empty `trackPath` is now rejected as `track-not-found`
with `detail="empty-path"`. Most UI-initiated loads now travel as
`/looping/v3/track/prepare_for_preset` (atomic create + load +
Permute append); the remaining `/looping/v3/device/load` call sites
are effect-rack loads onto already-prepared tracks. The Permute
follow-up that previously fired after each instrument prepare-ack
is gone — Python's `TrackPrepareComponent` appends Permute
internally as part of the prep (idempotent, skipped when already
present).

**Browser-tree cache.** `DeviceLoadComponent` resolves `presetPath`
to a `BrowserItem` via `BrowserCache` (`components/browser_cache.py`),
which builds a `path → BrowserItem` map lazily per root (User
Library + each Place) on first use. After the cache is built for a
root, lookups are O(1) dict reads — eliminating the multi-second
freeze that the per-call descent caused on heavy User Libraries.

#### 2.8.1 Device commands (chain ops + Simpler actions)

Owned by `DeviceCommandsComponent`. The first three retired the M4L
"appointed device" (blue-hand) two-hop dance (ROW 5, 2026-04-21).
The Simpler trio binds to no-arg LOM methods that have no property
surface — verified at runtime via `/looping/probe/lom_introspect`
+ `lom_invoke` against a live Simpler.

| Address                              | Dir     | Args            | Semantics |
| ------------------------------------ | ------- | --------------- | --------- |
| `/looping/v3/device/select`          | UI→Surf | `devicePath`    | Set the view's selected device. Idempotent. |
| `/looping/v3/device/move_to_top`     | UI→Surf | `devicePath`    | `song.move_device(device, parent, 0)`. **Undo hazard (Live 12.4.15b2, measured 2026-09-14, ADR-437):** on a device the browser loaded in this session (a rack or plug-in tile, the instrument, the track's Permute, a wah) the move gets no undo entry of its own — Live folds it into the device's "Insert Device" entry — and the next Edit → Undo that reaches it aborts Live. Devices from the set file and native tiles inserted by name undo cleanly. Kept as is by decision (2026-09-14): the rule is "no Cmd-Z in Live after moving a freshly loaded device", not a refusal on the wire. |
| `/looping/v3/device/move_to_end`     | UI→Surf | `devicePath`    | `song.move_device(device, parent, len(parent.devices))` — Live shifts the source out first, so passing `count` (not `count - 1`) is the correct "append" index. Same undo hazard as `move_to_top`. |
| `/looping/v3/device/delete`          | UI→Surf | `devicePath`    | **3.8.0** (issue #491). `parent.delete_device(index)` on the device's `canonical_parent` — a track, or a drum pad's chain — with the index found by LOM identity, never by the path's own number. Success is silent (the chain's listener carries the news); `write-rejected` on a LOM raise or a device not in its parent's list. First UI sender (ADR-445, 2026-09-19): the Pedal central view's Wah button, held, removes the wah from the selected track (`deviceMoveService.deleteDevice`) — on a MIDI track that hands the expression pedal back to the Expression Pedal rack. The pad pane's delete affordance is still to come. |
| `/looping/v3/simpler/reverse`        | UI→Surf | `devicePath`    | `SimplerDevice.reverse()`. Symmetric — calling twice un-reverses. Class-gated to `OriginalSimpler`; non-Simpler targets reject with `write-rejected detail="device is <X>, not OriginalSimpler"`. |
| `/looping/v3/simpler/warp_half`      | UI→Surf | `devicePath`    | `SimplerDevice.warp_half()`. Halves the warped tempo. Requires `sample.warping == True`; the LOM no-ops silently when warping is off, so the UI hides the button in that state. |
| `/looping/v3/simpler/warp_double`    | UI→Surf | `devicePath`    | `SimplerDevice.warp_double()`. Doubles the warped tempo. Same warping precondition as `warp_half`. |

Errors on `/looping/v3/error`: `path-not-found` (grammar-valid but
device missing), `path-not-supported` (rack chains, Phase-1
unimplemented), `write-rejected` (malformed args, class gate,
LOM raise — detail discriminates).

#### 2.8.2 Simpler sample load (convert + capture)

Owned by `SimplerLoadComponent`. Two gestures land a sample on a
Simpler: the clip view's convert button (an audio clip → a new MIDI
track beside it) and the capture flow (a WAV from
`Vamp-Recorder.amxd` → a MIDI track the UI already prepared).
Both run the same load-and-swap helper, so both report the same way.

| Address                                          | Dir     | Args                          | Semantics |
| ------------------------------------------------ | ------- | ----------------------------- | --------- |
| `/looping/v3/simpler/replace_sample`              | UI→Surf | `clipPath:string`             | Convert. Reads `clip.file_path` server-side (the UI never carries it), `create_midi_track(sourceIdx + 1)`, inserts a Simpler by name (`Track.insert_device("Simpler")`, in place of any instrument the new track came with — no preset file since 2026-09-27), then `SimplerDevice.replace_sample(file_path)`, one undo step. A refused insert is `simpler-insert-failed`. Deduped at the wire on `clipPath` for 10 s — with two WS clients connected, one tap arrives twice. |
| `/looping/v3/simpler/replace_sample_onto_track`   | UI→Surf | `trackPath:string, filePath:string` | Capture. Same load-and-swap onto an already-prepared MIDI track; creates nothing. Deduped on `(trackPath, filePath)`, so a retake of a different file on the same track still passes. |
| `/looping/v3/simpler/replaced`                    | Surf→UI | `originAddress:string, devicePath:string, filePath:string` | **Success ack (2026-09-17).** Emitted by both flows once the sample is on the Simpler *and* its post-load defaults are written (Loop on, slicing mode Thru, peak normalization), so anything read off the back of it is settled. `originAddress` is the gesture that produced it, stamped first for symmetry with the error envelope; `devicePath` is the Simpler's real slot (`tracks/<N>/devices/<M>`), which is **not** always `devices/0` — a track carrying Random Start puts the utility at 0 and the Simpler at 1. On a track that does not carry it yet, the ack waits (up to 5 ticks) for the deferred Random Start prepend to land and reads the slot then (2026-09-27: sent at once, it named Random Start's slot). |

The ack exists because both flows' initiators need two facts the UI
cannot otherwise know: which device received the sample, and its
absolute path. Before it, success was silent and the interface guessed
— it watched `sample.file_path` property echoes and accepted the first
from a devicePath that had not existed when the gesture started. That
inference failed two ways. The echo only happens when something on
screen is subscribed to that Simpler, so a convert where the interface
stayed on the clip view produced nothing at all; and the convert's
adjacent insert shifts every track below the source down one, so the
new Simpler routinely lands on a path an existing device already
occupied and the "didn't exist before" test discarded the echo it was
waiting for. Consumers: the UI's auto-trim (`clipOperations`) and the
Recent-instruments entry.

The new track and its device still reach the UI through the ordinary
device-structure listener's `state/full`; the ack is a side channel
for the gesture's initiator, not a structural message.

### 2.9 Track create / prepare / delete

UI-initiated track creation runs through the atomic
`/looping/v3/track/prepare_for_preset` endpoint
(`TrackPrepareComponent`). Python decides reuse-vs-create against
authoritative LOM reads, executes the create + (audio) routing/arm +
preset load + Permute append within one Live tick (two for audio,
due to template settling — see §2.9.2), and replies with a single
ack carrying the same `request_id` the UI sent.

The pre-2026-04-26 addresses `/looping/v3/track/create_audio`,
`/looping/v3/track/create_midi`, and `/looping/v3/track/ensure_devices`
were retired in favor of the atomic endpoint. The
`/looping/v3/track/created` event still exists but is now emitted
**only** by the foot-pedal hold gesture (`FootTriggerComponent`); UI-
initiated creates correlate via `prepare_for_preset/ack`. No UI
listener consumes `/looping/v3/track/created` any more — Permute
placement is owned by Python in both paths (`TrackPrepareComponent`
for browser flows, `FootTriggerComponent` for foot-hold).

| Address                                       | Dir     | Args                                                       | Semantics |
| --------------------------------------------- | ------- | ---------------------------------------------------------- | --------- |
| `/looping/v3/track/prepare_for_preset`        | UI→Surf | `request_id:string, track_type:string, preset_path:string, target_track_path:string (optional), source:string (optional), rel:string (optional)` | Atomic create-or-reuse + (audio) configure + preset load. **3.11.0 (onboarding.plan.md §6.3):** the optional 5th and 6th args name the Place the preset is in — `source` is `place:<sidebar name>`, `library` (the User Library) or `pack:<Pack name>`, `rel` the path inside it (`Kits/Foo.adg`) — and are sent together (3, 4 or 6 args). The surface looks the item up in that root of Live's browser first (`BrowserCache.lookup_named`) and by path when that misses; an empty `preset_path` is filled in from the Place's folder, which the surface reads from Live's own `Library.cfg` (`live_library.py`), so a client need not know where a Place is. Without them the path is resolved as before, now through every Place, the User Library and every Pack `Library.cfg` lists, and a miss walks the root once more after a 10 s cooldown (§6.4). `track_type ∈ {"audio", "midi"}`. Empty `preset_path` means create-and-configure but skip the load. **`.alc` preset paths** (Ableton Live Clips) take a distinct path: Live's Browser creates its own track for the clip (metadata preserved — warp/loop/gain), so the surface lets the Browser create the track, then preps it and acks with its path — no `create_*_track` call. Falls back to a raw-sample audio clip if the `.alc`'s BrowserItem can't be resolved (see ADR-394). The optional 4th arg `target_track_path` (`tracks/<N>`) is **replace-instrument mode**: it pins the load to that exact track, bypassing the reuse-vs-create decision so Live swaps the instrument in place (clips / Permute / FX preserved). Empty or absent = legacy auto behavior (see ADR-390). The UI mints a fresh `request_id` per request (UUID); see §2.9.1 for idempotency. |
| `/looping/v3/track/prepare_for_preset/ack`    | Surf→UI | `request_id:string, track_path:string, was_created:int(0\|1)` | Success. `track_path` is the resolved path (`tracks/<N>`); `was_created=1` if Python created a fresh track, `0` if it reused an existing empty one — replace-instrument loads always ack `0`. |
| `/looping/v3/track/prepare_for_preset/nack`   | Surf→UI | `request_id:string, code:string, detail:string`            | Failure. `code ∈ {"invalid-args", "unsupported-type", "create-failed", "load-failed", "no-track"}`. `detail` is diagnostic text. A pinned `target_track_path` that is malformed nacks `invalid-args`; one that is out of range nacks `no-track`. |
| `/looping/v3/track/duplicate`                 | UI→Surf | `request_id:string, source_track_path:string, clear_clips:int=0` | Duplicate a whole track via `Song.duplicate_track`. `source_track_path` is `tracks/<N>`. Live places the copy at `N+1` carrying the full device chain (incl. Permute) — Python does NOT re-append a sequencer. Handled by `TrackPrepareComponent` (shares the prepare LRU; see §2.9.1). `clear_clips=1` (the UI's variation gesture) deletes **every** clip on the copy before the ack, in the same Live tick that made it. That emptying is server-side because a duplicate re-indexes every track below it: until the next `state/full`, the UI's record at `tracks/<N+1>` still describes the track that was displaced, so emptying from the UI's snapshot cleared the wrong scenes. The UI's `duplicateTrackAndReset` (`trackOperations.ts`) now follows the ack with the Permute param reset only. |
| `/looping/v3/track/duplicate/ack`             | Surf→UI | `request_id:string, new_track_path:string`                 | Success. `new_track_path` is `tracks/<source+1>` — server-returned so the UI never computes the post-duplicate index shift. |
| `/looping/v3/track/duplicate/nack`            | Surf→UI | `request_id:string, code:string, detail:string`            | Failure. `code ∈ {"invalid-args", "no-track", "duplicate-failed"}`. `detail` is diagnostic text. |
| `/looping/v3/track/select`                    | UI→Surf | `track_path:string` | Make `tracks/<N>` Live's selected track (`Song.View.selected_track`), the sibling write for the `selected_track` observer (ROW 2-F4, 2026-04-21; retired the AbletonOSC `/live/view/set/selected_track` hop). Silent — the change comes back as the `/looping/v3/selected_track` emit. |
| `/looping/v3/track/group`                     | UI→Bridge | `request_id:string, members_json:string` | The whole hold-and-tap group gesture in one shot (2026-09-20 rewrite). `members_json` is a JSON array of `{path, name}`, anchor first, then every track tapped while the Group button was held — all of it decided **locally** by the UI (`groupGestureStore`), with no wire traffic while tracks are being tapped. **Never reaches the surface.** Live's LOM cannot group or move a track at all -- no create-group call, no track-move call, and `group_track` / `is_foldable` / `is_grouped` are read-only -- so this drives Live's real Accessibility surface instead (`handlers/liveGroupTracks.js`, ADR-439 research 2026-09-19/20). **Two different shapes, depending on what the members touch:** if none of them belong to an existing group, this builds Live's selection fresh -- a plain click on the first member and a Cmd-click (`system_click`) on each of the rest, retried up to 3 times each against a read-back of `AXSelectedRows` -- then a real ⌘G (`system_key`) commits it, no context menu ever shown. If they touch exactly one existing group, nothing is grouped in the ⌘G sense at all: every member not already inside that group is **dragged** onto its own rows instead (`system_drag`, a held-button move confirmed on the rig, 2026-09-20, to add a flat member with the group's identity -- same AX row, same name -- completely unchanged). This replaced an ungroup-then-⌘G-regroup dance: Live's own "Group Tracks" always nests when the selection touches an existing group, so merging used to mean ungrouping it first and rebuilding a fresh one flat -- which worked, but a dissolved-and-recreated Group Track is a *different* object, and anything on the *original* group's own chain (a bus compressor, sends) does not travel to the new one. A drag never touches the group at all. Either shape ends by re-selecting a track explicitly, best-effort (the group already exists by that point, so a failure to also select something is logged, not reported as a failed gesture) -- but **not the same track**: adding to an existing group lands back on the **anchor** (the track already selected when the gesture began, re-resolved fresh by name since it may itself be the one just dragged in and so have a new identifier), so folding a track into a bus doesn't yank the view away from what the performer was doing; a brand-new group has no such anchor to return to and lands on the **group** itself (found by matching which tracks now nest under it). Refused as `"track-row-mismatch"` when a member's name matches no header row, `"already-grouped"` when every member already belongs to the one group touched (nothing to add), or `"multi-group-merge-unsupported"` when the members span more than one existing group. **A prior version ran this as four addresses** (`start`/`tap`/`commit`/`cancel`), clicking each tapped track into Live's real selection live, one Cmd-click per tap, while the button was still held — every tap was a real Accessibility round trip racing whatever the *next* tap or a `commit`/`cancel` did to the same server-side gesture record, and it crashed on the rig (a `tap` mid-flight reading the record out from under itself) with nothing exotic in play. |
| `/looping/v3/track/group/reply`               | Bridge→UI | `request_id:string, ok:int(0\|1), code:string, detail:string` | Verdict. `code` as above, plus the helper's own (`ax-helper-down`, `ax-untrusted`, `click-did-not-register`, `drag-did-not-register`, ...). On success the new (or enlarged) group arrives the ordinary way, on the surface's track stream. Live records its own undo step per ⌘G/drag performed. |
| `/looping/v3/track/group/record_suspend`      | Bridge→Surf | `request_id:string` | **2026-09-21.** Live refuses to reposition a track that is "currently recording" -- a real modal dialog, not a wire error -- and under `npm run ipad`'s auto-capture `song.record_mode` is on for the whole time the transport plays, so a reposition (a non-contiguous new group, or a drag into an existing one) used to silently do nothing mid-take. The bridge sends this **only when the tracks about to move are not already sitting together** (`isContiguous` in `handlers/liveGroupTracks.js` — an already-contiguous selection needs no reposition at all, so `record_mode` can never block it). `RecordSuspendComponent` (the surface half) reads `song.record_mode`; if it is on, clears it. Never a listened attribute and never touched except from this bracket — `PerformanceCaptureComponent` (§2.14) notices nothing, since it watches `is_playing`, not `record_mode` itself. |
| `/looping/v3/track/group/record_suspend/ack`  | Surf→Bridge | `request_id:string, was_on:int(0\|1)` | `was_on=1` means record_mode really was on and is now off — the bridge only sends the matching `record_resume` when this says so. A read/write failure answers `was_on=0` rather than leaving the bridge hanging. |
| `/looping/v3/track/group/record_resume`       | Bridge→Surf | `request_id:string` | Unconditionally sets `song.record_mode = 1` back on. Sent once, after the bracketed reposition finishes (success or failure) — never left stranded off. |
| `/looping/v3/track/group/record_resume/ack`   | Surf→Bridge | `request_id:string` | Acknowledges the resume. The bridge degrades gracefully if either hop above times out (`RECORD_SURFACE_TIMEOUT_MS`, 2s) or the surface port is closed: the group/drag still runs, at worst hitting the same dialog this feature exists to avoid — this bracket is a nicety, never a blocker. The cost while it IS engaged: whatever plays during the bracket is not captured to the Arrangement on a track that was actually recording, a gap the length of one Group gesture. |
| `/looping/v3/track/created`                   | Surf→UI | `type:string, trackIndex:int, origin:string`               | Foot-pedal hold gesture only. `origin="foot-trigger"`. No UI listener consumes this — Permute lands inline on the Python side in both paths. Retained on the wire for diagnostic / future use. |

#### 2.9.1 Idempotency

`request_id` is mandatory and must be unique per logical request (the
UI uses `crypto.randomUUID()`). Python's `TrackPrepareComponent`
keeps a bounded LRU (64 entries / 30s TTL) of `request_id → result`
and replays the cached ack/nack on retransmit. A WebSocket reconnect
that replays an in-flight `prepare_for_preset` will not spawn a
duplicate track — the LRU returns the original ack.

The UI also runs a per-`track_type` single-flight queue: a second
tap for `'midi'` while a previous `'midi'` request is in flight
waits for the first to settle before sending. This guarantees the
second tap sees the first tap's empty track in `song.tracks` and
reuses it.

#### 2.9.2 Audio template-settling deferral

When `song.create_audio_track` returns, Live applies
`Default Audio Track.als` asynchronously (observed: routing/arm
writes immediately after create get clobbered when the template
finalizes). For `track_type="audio"` creates, Python defers the
configure (`input_routing_channel`, `arm`) + load + ack one tick
via `schedule_delayed(0, …)`. MIDI creates and reuse paths run
inline. The UI ack timing is therefore typically <100ms for MIDI
and <200ms for audio.

### 2.10 Foot trigger

Two delivery paths, one owner (ADR-422). **Primary**: the pedal's USB
MIDI port is assigned as the Looping control surface's MIDI Input, and
the surface's `MidiPedalInput` converts the foot-switch CC
(`constants.midiPedals.footSwitchCC`, **23** on
`constants.midiPedals.channel` **10**) into tap/hold itself — including
the tap/hold timing (`osc.footTrigger.holdThresholdMs`, 500ms). CCs on
any other channel are not claimed and fall through to the framework. **Fallback**: the legacy Max chain
(`owner/Max Patches/foot-trigger.js`, same 500ms timing hardcoded) fires two
arg-free OSC wires at the surface. Both paths call the same
`FootTriggerComponent` handlers, so the wires below remain live:

| Address                  | Dir        | Args      | Semantics |
| ------------------------ | ---------- | --------- | --------- |
| `/looping/v3/foot/tap`   | Hardware→Surf | (none) | Short press. |
| `/looping/v3/foot/hold`  | Hardware→Surf | (none) | Long press. |

Tap branches on `song.view.highlighted_clip_slot` alone — never on what
else is playing on that track — so one pedal walks a single slot through
the looper cycle:

| highlighted slot | action |
| ---------------- | ------ |
| none             | no-op |
| empty            | `fire()` → records on the armed track |
| clip recording   | `fire()` → ends the take, launches it as a loop |
| clip stopped     | `fire()` → plays |
| clip playing     | toggle `session_record` (overdub) |

`is_recording` is checked **before** `is_playing`: a clip Live is
recording into reports both, so checking `is_playing` first collapses the
take-ending press into the overdub branch.

The hold's input channel is read by Python from
`constants.audio.defaultInputChannel` (was hardcoded
`"11/12 Guitar Mic"` in M4L). It is optional: unset, the new track keeps
Live's own default input.

### 2.10.1 Wah pedal — and MidiWheels on MIDI tracks

See ADR-407 (supersedes ADR-094) and ADR-445. The expression pedal's MIDI
(**CC 21** toe-switch, **CC 20** expression, both on **channel 10** — all
remappable via `constants.midiPedals`; the legacy Max chain still carries
the old CC 82 / CC 11) reaches the surface the same two ways as the foot
trigger (ADR-422): primarily as plain MIDI on the surface's own Input port
(`MidiPedalInput` does the edge detection), with the legacy Max ctlin→OSC
patch as the fallback, firing straight to the surface's UDP port (11020),
fire-and-forget, **no bridge, no generation, no `trackPath`**. Both paths
land on the same `WahPedalComponent` handlers, and the addresses keep their
`wah` name whichever rack they land on.

**Which rack (ADR-445, 2026-09-19).** The component picks the rack by the
kind of track under `song.view.selected_track`: a **wah already on the
track wins** on either kind; otherwise a **MIDI track** (`has_midi_input`)
gets **MidiWheels** (`constants.devices.midiWheels` — the MIDI effect the
on-screen wheels drive, §2.10.3; the pedal sweeps its mod wheel, CC 1, into
the instrument behind it) and an **audio track** the **Wah**
(`constants.devices.wah`). No `midiWheels` block → the wah everywhere.
Until 2026-09-25 the MIDI-track target was the **Expression Pedal** rack
(`Expression Pedal.adg`: one chain holding `Modwheel Sender.amxd`, Macro 1
mapped to its CC 1 dial, Macro 2 mapped to nothing); MidiWheels replaced it
so the pedal and the on-screen mod wheel share one device per track.
The pedal never summons a wah onto a MIDI track by gesture; the Pedal
central view's Wah button does that through `device/load` (§2.8.1, which
lands this one preset at the head of the audio effects), and its hold
removes the wah through `device/delete`, handing the pedal back to the
rack or MidiWheels. The value is the wah's Macro 1 or MidiWheels' Mod Wheel
parameter; only the wah has a chain selector (Macro 2) for engage to step —
engage on a track that already has MidiWheels does nothing.

| Address                    | Dir           | Args              | Semantics |
| -------------------------- | ------------- | ----------------- | --------- |
| `/looping/v3/wah/engage`   | Hardware→Surf | (none)   | CC 21 toe-switch — **either** edge across the value-64 threshold, since the switch latches (CC 82 on the legacy Max chain). **Pedal only — there is no UI sender.** (`WahControl.svelte` was mounted nowhere and was deleted in audit item 33; the Pedal view's Wah button sends `device/load`, not this.) The track's rack absent → load its preset (loads enabled): the wah at the head of the track's audio effects — placed by the load itself through the track's device insert mode (ADR-437; ADR-094's intent, never a move, since undoing the move of a just-loaded device aborts Live) — the Expression Pedal rack where Live puts a MIDI effect, ahead of the instrument; rack present → step Macro 2 (`toggleMacroIndex`, `parameters[2]`) to the next chain: `len(device.chains)` values spread evenly across the macro's `[min, max]` and rounded to whole units (2 chains → 0/127, 3 → 0/64/127, 4 → 0/42/85/127), snapping to the step nearest the macro's current value and advancing one, wrapping past the last. Fewer than 2 chains (or an unreadable `chains`) → the old 0↔max flip across the 63.5 midpoint. |
| `/looping/v3/wah/freq`     | Hardware→Surf | `value:float`     | CC 20 expression (CC 11 on the legacy Max chain). Writes Macro 1 (`freqMacroIndex`) of the rack the **currently-selected** track gets (a selection change re-points the sweep — ADR-407 revision; so does any track's device-list change — ADR-445; no-ops while the track has no rack and the sweep is partial). `value` is the **raw** macro value clamped to `[param.min, param.max]` — a 0-127 CC lands 1:1 on the 0-127 macro, no scaling (matches `param/set` value semantics). **Sweep-to-load**: on a track without its rack the value latches instead — both ends of the CC range seen (either order, within the rack's `sweepLoadMargin` of 0 and 127) loads the preset at the same place the toe switch does: the wah on an audio track, the Expression Pedal rack on a MIDI track. A partial sweep never fires; the latches drop on a selection or device-list change. |

**The surface owns all context** — this is why the Max side stays
dumb. A standalone Max client has no notion of the selected track, its
kind, or where the rack landed in the chain (that state only rides the
surface→bridge broadcast path; `osc_transport` does not last-sender-win
broadcasts back to ephemeral senders). So the surface reads
`selected_track` and `has_midi_input` itself, and re-finds the rack by
`class_name` + `name` (the same match `fxGridStore` uses), caching the
value macro for the ~100 msg/s sweep and re-resolving on a stale ref, a
selection change, or a device-list change (the sweep always follows the
track in view — ADR-407 revision).

Target devices, parameter indices, match keys and sweep tolerance come from
`constants.devices.wah` (`presetPath` / `className` / `deviceName` /
`freqMacroIndex` / `toggleMacroIndex` / `sweepLoadMargin`) and
`constants.devices.midiWheels` (`devicePath` / `className` / `deviceName` /
`modParamIndex` / `sweepLoadMargin`), so the mapping is tunable without a
code change. The value macro emits the normal `param/value` echo, so the
UI tracks the pedal on either rack. Sending raw `device/load` +
`param/set` from Max was the rejected alternative — it would force Max to
track selection and the append index, and repeated `device/load` stacks
duplicate racks (append, no dedupe).

### 2.10.2 Move drum-chain volume knob and pad hold

See ADR-412. Second Ableton Move encoder (CC 72 ch 1 in
`owner/Max Patches/Max Utility 1.0.maxpat`), same hardware lane as the
track-volume knob: Max converts the CC to OSC and fires it straight at
the surface's UDP port (11020) — no bridge, no `trackPath`. Owned by
`SelectedTrackComponent`. **ADR-432 (2026-09-11) adds the pad hold on
the same lane:** `owner/Max Patches/move_pad_hold.js` on the patch's
`midi_from_move` bus times a pad held past 300 ms and sends the first
row below; the surface names the pad Live selected — the pad struck,
which Live's selection follows (measured 2026-09-11: with a Random at
+12 before the rack every hit sounded an octave up and the selection
stayed on the struck pad), never the raw note, whose map onto the rack's
pages is the Move script's and moves with the page — and tells the
interface with the second,
where it lands on the pad scope as an external hold (momentary, never
a latch; released on every handshake accept). Ungated: the patch is
the switch.

| Address                                                | Dir           | Args            | Semantics |
| ------------------------------------------------------ | ------------- | --------------- | --------- |
| `/looping/v3/move/pad_hold` | Hardware→Surf | `note:int, held:int(0\|1)` | A Move pad crossed the hold threshold (`1`) or lifted after crossing it (`0`); a pad released sooner sends nothing. `note` is the raw note the Move sent, used only to pair a release with its hold. On `1` the surface reads the first `DrumGroupDevice` on `song.view.selected_track` and its `view.selected_drum_pad` and emits the row below; a repeated `1` for a tag already announced is ignored, a `0` for one never announced is silent. Two pads hit together both read the one selection, so a pad named by more than one tag is announced once and released only when the last of its tags lifts. Context misses (no selected track, no rack, no selected pad, an empty pad) drop with a one-shot INFO line; malformed args → `write-rejected`. |
| `/looping/v3/drum/pad_hold` | Surf→UI | `rackPath:string, note:int, held:int(0\|1)` | The pad the hold names — the rack's device path and the pad's MIDI note — held or released. The release names the pad that was announced, never the current selection (a quick hit on another pad mid-hold moves Live's selection but not the hold). The interface presses/releases it on `drumPadScope` under a reserved pointer id per note (`externalPointerId`), keyed on the rack as well — the same note announced on another rack replaces the hold, a release for another rack is ignored — so every reader of the scope — the FX grid, the Drum Rack view, the pad grid — treats it as a held tile; the release is a `cancel`, so it never latches. Broadcast like every emit: each client scopes. |
| `/looping/v3/selected_track/drum_chain/volume_relative` | Hardware→Surf | `midiValue:int` | `1` = up, `127` = down, ±`MOVE_VOLUME_STEP` (0.002) per tick, clamp `[0.0, 1.0]` — identical encoding to `…/volume_relative`. Target: the **currently-selected drum-pad chain** of the first `DrumGroupDevice` on `song.view.selected_track` — `rack.view.selected_drum_pad` → `pad.chains[0]` → `chain.mixer_device.volume`. `selected_chain` is the fallback only when no pad is selected; an **empty** selected pad drops the message with no fallback (`selected_chain` would still point at the previously-selected pad's chain). Context misses (non-drum track in view / no pad selected / empty pad) drop silently with a one-shot INFO line — they're performance states, not protocol errors. Malformed args reject on `/looping/v3/error`. Gated by `move_volume_knob` (same switch as the track-volume knob). No echo on success: chain mixers aren't in the v3 tree; Live's own UI reflects the write. |

### 2.10.3 TotalMix monitor levels

See ADR-423, which supersedes ADR-388. The bridge owns the UDP
conversation with the RME mixer; nothing else in this system addresses
TotalMix. **Every value on this path is dB**, matching the mixer's Global
OSC protocol and the `live.gain~` objects in the Live device. The `0..1`
a drawn fader needs is a rendering concern and lives in
`interface/src/lib/utils/totalmixScale.ts`.

Five channels: `room`, `playback`, `click`, `phones`, `main`. The first
four are writable; `main` mirrors the Control Room main out and is
**read-only** — a write to it is refused and counted as a routing error.

| Address                              | Dir                    | Args        | Semantics |
| ------------------------------------ | ---------------------- | ----------- | --------- |
| `/looping/v3/totalmix/<channel>`     | Bridge→UI, Bridge→Device | `db:float` | Current level. Emitted when the mixer reports a change, when a write is accepted (see below), and once per channel in reply to `hello`. A WS client also gets one per cached channel, sent to it alone, the moment it authenticates (on connect when the auth gate is off), so a client that reloads after the bridge started does not show empty wells. `-300` is the mixer's `-oo`. A channel the bridge has never heard from is **never** synthesised — the UI renders it empty rather than inventing a level. |
| `/totalmix/<channel>`                | Device→Bridge          | `db:float` | Write, from the Max patch on the bridge's `totalmixDevice` port. A WS client's `/totalmix/*` is unrouted and dropped (since 2026-09-27, when the transport header's faders went). Clamped to `[minDb, maxDb]` in `totalmixLink.toMixer` — the single place the clamp lives, so no writer can bypass it — then translated to the mixer's own address. A value at or below `minDb` (-65) is sent as `silenceDb` (-300), so the bottom of a fader is genuinely off rather than merely inaudible. |
| `/totalmix/hello`                    | Device→Bridge          | (none)      | The Live device announcing itself, on `live.thisdevice`. The bridge replies with one `/looping/v3/totalmix/<channel>` per **cached** channel. Live rebuilds the device on every set load, so this is how it adopts current levels; channels never heard from are omitted, which leaves that fader's gate shut and no write reaching hardware. |

**The mixer never echoes a write.** TotalMix's Global OSC "Re-send
received" is off, which is what makes a device-side echo loop structurally
impossible — but it also means an accepted write is the **only** moment a
device-driven change can reach anyone else. An accepted device write
therefore fans out to the WS clients (but not back to the device, which
would re-drive the knob that originated it).

**There is no read verb**, and an argument-less message is a *write of
1.0* rather than a query — verified against the hardware. The bridge
learns current levels once at startup by provoking a dump on TotalMix's
legacy remote controller, then releases that socket
(`handlers/totalmixBootstrap.js`).

### 2.10.4 Similar-sound swap (ADR-439)

A Drum Rack kit, or one of its pads, steps to Live's next or previous
similar sample through Live's own swap buttons, pressed by the Looping AX
Helper (`/bridge/ax_helper`, §2.13): Swap All on the rack's title bar
(`SimilaritySwapView.SwapNext` / `SwapPrev`) for the kit, and for a pad the
Previous / Next on its Drum Sampler's waveform display
(`TrackView.Device[N].Device[K].WaveformDisplay.SimilaritySwapView.Prev` /
`Next`). A pad never goes through the rack grid's `SwapBar` buttons: Live
plays the pad when those are pressed, and the Drum Sampler's own buttons swap
without a sound (heard on the rig, 2026-09-15). Those buttons exist only
under a pointer, so the helper first hovers the waveform with mouse moves
posted to Live's process. Live ranks the candidates and keeps the reference;
nothing on this path reads the similarity database.

The **bridge** orchestrates: the surface runs on Live's main thread, which
is where Live services an Accessibility press, so a surface handler must
never wait for one. One swap is four hops, each answered before the next
goes out — `show_for_swap` to the surface; to the helper, for a kit a `read`
of the rack's `ShowSwapBar` and the `press` (the bar first when it is off, and
pressed off again once the swap is over, whatever happened),
for a pad a `read` of the device view's Drum Sampler (its title must name the
pad's instrument, which is how a wrong pad in view is caught), a `hover` and
the `press`; `pad_names` to the surface, before the press and after it;
`finish_swap` to
the surface, sent whatever happened once `show_for_swap` went out. The three
surface verbs are bridge-terminated: their replies are consumed in the
bridge's `pythonSurface` middleware and never reach a UI. The bridge runs one swap
at a time across every rack — each selects its own rack's track. A helper that
is down or untrusted, a control Live is not showing and a surface that does
not answer are named errors in the reply; there is no fallback to
`device/load`.

**Chain names follow the sample, inside the swap's undo step.**
`show_for_swap` notes each pad's chain and instrument name and opens Live's
undo step; `finish_swap` renames each chain that was named after its
instrument and whose instrument Live has renamed, then closes the step — so
one `Undo Next Similar` reverts the samples and the names together (measured
2026-09-15 on the Plymouth kit: 30 samples and 29 chain names, one undo). A
chain with a name of its own keeps it. Live's own pad swap button renames the
pad's chain itself, so a pad swap leaves `finish_swap` nothing to follow; Swap
All is the case it exists for.

| Address | Dir | Args | Semantics |
| ------- | --- | ---- | --------- |
| `/looping/v3/drum/swap_similar` | UI→Bridge | `requestId:string, rackPath:string, scope:string, direction:string` | `scope` is `kit` or `pad:<note>`; `direction` is `next` or `prev`: one press of Live's button, which keeps its own reference sample. `rackPath` is a top-level rack, `tracks/<N>/devices/<M>`. `WebSocketServer` hands it to `handlers/drumSwapSimilar.js`; it is never routed to the surface. |
| `/looping/v3/drum/swap_similar/reply` | Bridge→UI | `requestId:string, ok:int(0\|1), code:string, detail:string, result:string` | To the requesting client only. On success `result` is JSON: `{scope, direction, barPressed, device, chain, changed, unchanged, renamed, finishDetail, pads:[{note, before, after, changed, sameDevice}], timings:{showMs, hoverMs, pressMs, pressTotalMs, totalMs}}` — `barPressed` whether a kit swap turned the rack's swap bar on; `chain` the pad's Drum Sampler's `K` in `TrackView.Device[N].Device[K]` and `hoverMs` the helper's hover (both `null` for a kit); `renamed` the notes whose chain name followed its sample; `finishDetail` `""` when step 4 did its job, else why the chain renames did not land — a `finish_swap` that answered `ok=0`, or one answering `ok=1, {"open": false}`, which is the surface saying it no longer had this rack's swap (expired after 60 s, or superseded), so `renamed: []` there means *dropped*, not *none needed*. **An `ok=1` reply whose `detail` is non-empty is that string**, the same shape `clip/swap_file` uses for a setting Live refused: the swap happened and something about it is worth saying. `pads` each affected pad's instrument name before and after (`changed: false` is a neighbor whose name reads the same: reported, not a failure); `sameDevice` whether the instrument object survived the swap. On failure `code` is the helper's (`ax-helper-down`, `ax-untrusted`, `ax-no-main-window`, `ax-control-missing`, `ax-control-disabled`, `ax-wrong-role`, `ax-timeout`, `ax-wait-timeout` — a hover that revealed no buttons — `ax-busy`, …), a surface code prefixed `swap-` (`swap-not-a-top-level-rack`, `swap-path-not-found`, `swap-not-a-drum-rack`, `swap-no-such-pad`, `swap-write-refused`, `swap-bad-args`), or the bridge's own (`swap-bad-request`, `swap-not-a-drum-sampler` — the pad's first instrument is not a Drum Sampler, `swap-sampler-not-in-view` — no device in Live's view of the pad's chain is titled with its instrument's name, `swap-surface-timeout`, `swap-surface-unreachable`, `swap-bad-reply`, `swap-busy` — a swap is already in flight for this rack, refused **before** `show_for_swap` moves Live's view (swap audit M8), `swap-timeout` — the whole swap passed the bridge's 45 s deadline, which sits under the 60 s at which `DrumSwapComponent` expires the undo step `show_for_swap` opened (M5); the `finally` still sends `finish_swap`, so the step closes either way). |
| `/looping/v3/drum/show_for_swap` | Bridge→Surf | `requestId:string, rackPath:string, note:int` | Select the rack's track and the rack, bring `Detail/DeviceChain` forward and, for a pad (`note ≥ 0`; `-1` is the kit), select the pad (`RackDevice.View.selected_drum_pad`, so Live's device view shows its chain) and move `RackDevice.View.drum_pads_scroll_position` the least distance that puts the pad's row in view; then note each pad's chain and instrument name and open Live's undo step for the swap, which `finish_swap` closes (as does a newer `show_for_swap`, a disconnect, or 60 s with no finish). `DrumSwapComponent`. |
| `/looping/v3/drum/show_for_swap/ack` | Surf→Bridge | `requestId:string, ok:int(0\|1), code:string, detail:string, trackPath:string, deviceIndex:int, scroll:int, gridIndex:int` | `deviceIndex` is the rack's `N` in `TrackView.Device[N]`, which is how the bridge addresses Live's controls; `scroll` the lowest visible row (0–28, four notes a row); `gridIndex` the pad's place in reading order in the 4×4 grid — top row first, the top row holding the highest notes, notes rising left to right — or `-1` for the kit. Since pad swaps went through the Drum Sampler's own buttons, `scroll` and `gridIndex` describe the grid and address nothing. On failure the last four are `"", -1, -1, -1`. |
| `/looping/v3/drum/pad_names` | Bridge→Surf | `requestId:string, rackPath:string, notes:string` | `notes` is `*` or comma-separated notes. |
| `/looping/v3/drum/pad_names/reply` | Surf→Bridge | `requestId:string, ok:int(0\|1), code:string, detail:string, json:string` | `{"pads":[{"note":38,"name":"…","class":"DrumCell","ptr":…}]}` — each populated pad's first instrument name (to 64 characters; the chain's name on a pad with no instrument), its class and its LOM identity. Past ~8 KB the classes are dropped, then the names shorten to 24, and the object carries `"truncated": true`. |
| `/looping/v3/drum/finish_swap` | Bridge→Surf | `requestId:string, rackPath:string` | Rename each chain in the swap's scope that was named after its instrument when `show_for_swap` noted it and whose instrument has another name now — a chain with a name of its own, or one renamed since, is kept, and one already naming the new instrument (a pad's own swap button renames its chain) is left alone — then close the swap's undo step. With no swap open for `rackPath` it touches nothing and answers `open: false`, so the bridge can always send it. |
| `/looping/v3/drum/finish_swap/ack` | Surf→Bridge | `requestId:string, ok:int(0\|1), code:string, detail:string, result:string` | `{"open":true,"renamed":[36,38],"kept":[40]}` — the notes whose chain was renamed, and those whose instrument changed while the chain kept its name. Consumed by the bridge. |

### 2.10.5 On-screen pitch and mod wheels → MidiWheels

The two wheels every instrument view draws (`MidiWheel.svelte`, sent through
`interface/src/lib/api/midiWheels.ts`) drive **MidiWheels**
(`Vamp Devices/MidiWheels.amxd`) on the selected track, through the
surface's `MidiWheelsComponent`. Until 2026-09-25 they were `/midi/pitch_bend`
and `/midi/mod_wheel`, routed by the bridge to the `midiConverter` port
(11004) and the standalone Max Utility patch's `xbendout` / `ctlout` into
Live through Max's virtual port "a"; that port and the `/midi/` route are
gone, so the wheels need no standalone Max.

| Address                     | Dir     | Args                | Semantics |
| --------------------------- | ------- | ------------------- | --------- |
| `/looping/v3/wheels/pitch`  | UI→Surf | `value:int 0-16383` | Pitch wheel, **8192 = centre**; the UI springs back and sends 8192 on release. Writes MidiWheels `parameters[2]` (`devices.midiWheels.pitchParamIndex`; `[0]` is Device On), clamped into the parameter's own range and to 16383, the 14-bit maximum `xbendout` takes (the dial itself reads 0–16384). |
| `/looping/v3/wheels/mod`    | UI→Surf | `value:int 0-127`   | Mod wheel (CC 1). Writes MidiWheels `parameters[1]` (`modParamIndex`) — the same parameter the expression pedal sweeps on a MIDI track (§2.10.1), so the two share one device and the last one moved wins. |

- **Fire-and-forget**: no reply, no error code; a dropped move is overtaken
  by the next one, and the release always sends a final value.
- **MIDI tracks only** (`has_midi_input`); on an audio track the move is
  dropped.
- **Load on first touch**: no MidiWheels on the selected track → the move
  loads `devices.midiWheels.devicePath` (through the "Vamp Devices"
  sidebar Place), where Live puts a MIDI effect — ahead
  of the instrument — and then lands on it. A failed load is not retried
  until the selection or a device list changes; a load not yet visible is
  never issued twice.
- **Latest value wins**: the handlers keep the newest value per wheel and a
  transport drain hook writes it once per pass.
- **One undo step per gesture**: the first write opens
  `song.begin_undo_step`, closed after 300 ms with no write. The parameters
  stay automatable, so a performance records the wheels into the
  arrangement as automation (the device's output is not recorded into the
  track's MIDI clip).

### 2.11 Transport / mixer / selection

These addresses carry session-global or track-global targets, not
pointer-id targets. They keep their v2 arg shapes; only the
`/looping/v3/*` prefix is new. Transport play/stop/tempo/metronome,
track mute/solo/arm, send volumes, master volume, and
`song.view.selected_track` writes all live here.

**Global launch quantization** (2026-07-27, ADR-411) joins the same
`SessionComponent` attr family:

| Address                                          | Dir  | Args        | Semantics |
| ------------------------------------------------ | ---- | ----------- | --------- |
| `/looping/v3/session/clip_trigger_quantization`   | both | `int 0..13` | Live's `song.clip_trigger_quantization` — the grid clip launch (and therefore loop record start/stop) snaps to. `0` None, `1` 8 Bars, `2` 4 Bars, `3` 2 Bars, `4` 1 Bar (Live's default), `5` 1/2, `6` 1/2T, `7` 1/4, `8` 1/4T, `9` 1/8, `10` 1/8T, `11` 1/16, `12` 1/16T, `13` 1/32. Out-of-range and non-int reject silently (validate-and-reject, never clamp — a bad wire value must not park the set on 1/32). Seeded by the surface's init-emit + handshake-accept re-emit like the rest of the family; `state/full` does not carry it. |

Unlike its siblings this attr carries a **listener-less fallback**: if
`add_clip_trigger_quantization_listener` fails to attach (the
`Groove.base` / `Track.fold_state` failure mode — observable on paper,
silent in practice), the surface still seeds the address and the write
handler emits its own echo. So the address is guaranteed to carry state
in both directions regardless of whether Live actually observes the
property. Where a listener does attach, that fallback is inert and the
echo comes from the listener as usual.

**Key detection** (2026-09-19, ADR-446) rides the same `SessionComponent`
family — one verb, one answer, protocol **3.10.0**:

| Address                                | Dir     | Args | Semantics |
| -------------------------------------- | ------- | ---- | --------- |
| `/looping/v3/session/scale/detect`     | UI→Surf | `apply:int(0\|1)` | Read every launched MIDI clip on a pitched, non-group track (`playing_slot_index` holds a MIDI clip; drum tracks — a `drum` / `perc` rail role or a `DrumGroupDevice` top level or one rack deep — are dropped, their notes being pad numbers) and decide the key by integer votes (`key_detect.py`: sixteenth-quantized sounding time weighted by rail role and beat position picks the pitch-class set and the Live scales that contain it, dropping up to two of the weakest classes as passing tones when no seven-note scale does; the bass's downbeat lows — double on the loop's first downbeat — its first and lowest notes, and the keys' chord roots (by stacking, so an inverted chord names its root) pick the tonic among the candidates' roots; a line votes only where it rests; shorter loops repeat inside the longest launched one; bars follow the time signature, LOM beats being quarter notes; an fx-role clip is left out; muted notes count, a mute here being Permute's gate; only notes inside each clip's loop count, an unlooped clip reporting its start and end markers there; a clip still recording is left out; when the notes leave the mode open on the winning root, the commoner scale is named). With `apply = 1` and a key found, writes `root_note`, `scale_name` and `scale_mode = 1` through the session handlers above in **one undo step** — the same three writes the picker sends. A `no-key` answer never writes. Anything but an int `1` (or `True`) reads as `0` — a float included. **Always answers on `…/detected`, never on `/looping/v3/error`** — nothing to analyze is a performance state. |
| `/looping/v3/session/scale/detected`   | Surf→UI | `root:int, scale:string, band:string, gapPct:int, runnerRoot:int, runnerScale:string, pitchClasses:int, reasons:string, applied:int(0\|1)` | **Broadcast** (every client sees a detection). `band ∈ {"sure","plausible","unsure","no-key"}`: the gap between winner and runner-up as a share of the winner, from 50 % / 20 %; `no-key` when nothing pitched is playing, when no bass or keys vote is cast (a melody alone), or when no Live scale contains the set; a single pitch class is taken as the root with Major assumed, two decide by the votes (`root = -1`, `scale = ""`, `runnerRoot = -1`). `pitchClasses` is a 12-bit mask, bit 0 = C. `reasons` is the vote ladder as text, `" | "`-joined, ≤ 1,500 chars — the audit trail (`bass downbeats C(8) D#(4) C(4) D#(4), first note C (2), lowest C (1) | keys chord roots C(6) F(3) … | synth rests F (2 each), longest A# (1) | tonic votes: C 24, F 8 …`). `applied = 1` only when Live reads the key back after the write (the session handlers swallow a refused write, so their returning proves nothing); the ordinary `scale_root` / `scale_name` / `scale_mode` echoes follow. A Follow pass (see `key_follow`) broadcasts on this address too, its last reason line `follow (…): …` naming what changed and what it decided. |

Since 3.10.0 `scale_root` and `scale_name` from the wire are **a hand
picking a key**: `KeyDetectComponent` owns the two addresses, turns
`key_follow` off (echoed) before the write — for any client, and
for a pick of the key already set, which Live signals with nothing — and
delegates the write to `SessionComponent` unchanged. `scale_mode` is not
a pick.

Since 3.10.0 a `scale_name` write is also **validated against Live's 35
names** (`key_detect.LIVE_SCALE_NAMES`, read back from the artifact):
Live does not raise on an unknown name, it silently switches to Major, so
the surface refuses it instead.

### 2.12 Session settings (runtime toggles)

Surface-side in-memory on/off flags that gate optional behaviors.
Owned by `SessionSettingsComponent` (Python). Bidirectional wire:
same address carries the UI→Surf write and the Surf→UI echo/seed.
Init-emit fires at surface `__init__`; re-emit on handshake accept
closes the cold-start gap for clients that connect after boot.

The original two default to `1` (on) — matches the pre-toggle
behavior so a surface that has never been written to behaves like
it always did. Default-on is also the UI store's initial state, so
cold-start doesn't flash the wrong control affordance before the
first emit arrives.

| Address                                | Dir    | Args   | Semantics |
| -------------------------------------- | ------ | ------ | --------- |
| `/looping/v3/session/song_time`        | Surf→UI | `beats:float` | Song position in beats (`song.current_song_time`), **throttled to 10 Hz** by `SessionComponent` — it is not a `_PR5D_ATTRS` row, because the LOM attr fires on every tick while the transport runs. Seeded once at construction (after the PR-5d seeds, so that pinned sequence is unchanged) so a UI meeting a stopped transport learns where the playhead is rather than assuming bar 1. Read-only: no UI→Surf write. The UI turns it into `bar.beat.sixteenth`. 10 Hz rather than the playhead's 30 because the consumer is a text readout, not a sweeping marker. |
| `/looping/v3/session/auto_arm`         | both   | `0|1`  | Gates automatic track-arm. When `0`, `ExclusiveArmComponent` stops arming on selection change (user's current arm state stays untouched) AND `FootTriggerComponent.handle_hold` skips its `track.arm=True` after creating the audio track AND UI-side `armTrackWithRetry` early-returns without sending. Writing the current value still echoes. Non-0/1 (including floats like `0.5`) reject. |
| `/looping/v3/session/move_volume_knob` | both   | `0|1`  | Gates both Move encoder handlers on `SelectedTrackComponent`: `handle_relative_volume` (first knob → selected-track volume) and `handle_drum_chain_relative_volume` (second knob → selected drum-pad chain volume, §2.10.2 / ADR-412). When `0`, inbound `/looping/v3/selected_track/volume_relative` and `…/drum_chain/volume_relative` messages are silently dropped — no error emit, no Log.txt spam. The Move keeps sending; the surface just ignores. |
| `/looping/v3/session/auto_arm/query`   | UI→Surf | (any/none) | Read-only state read. Surface replies **on this same address** (the transport's reply-to-sender echoes on the received address) **to the asker's source port** (not the broadcast remote), with `[0|1]` carrying the current value. So a client must listen for the reply on `/looping/v3/session/auto_arm/query`, **not** on `/looping/v3/session/auto_arm`. Args ignored — presence is the request. Unlike the broadcast `emit_on_accept` seed (which targets the fixed bridge remote), this lets a fire-and-forget client — e.g. the Ableton Extension preference panel — learn `auto_arm` on load without binding 11021 and without writing (no value-flip risk). No mutation, no broadcast echo. |
| `/looping/v3/session/move_volume_knob/query` | UI→Surf | (any/none) | Read-only state read for `move_volume_knob`, identical mechanics to `auto_arm/query`: reply echoes `[0|1]` **on this same address** to the asker's source port. Listen on `…/move_volume_knob/query`, not on `…/move_volume_knob`. No mutation, no broadcast echo. |
| `/looping/v3/session/auto_capture`     | both   | `0|1`  | Gates the performance-capture behaviors (auto-record-on-play + save-as-on-stop, §2.14). **Sole gate** for `PerformanceCaptureComponent`. Unlike the other two toggles (always default-on), its default is **launch-mode-derived**: seeded to `is_ipad_present()` on the first heartbeat that carries a `mode` (ipad→`1`, dev→`0`). After that seed — or any user write — it's a plain override: writing `1` under `npm run dev` genuinely enables capture; writing `0` under `npm run ipad` genuinely disables it. A user write commits, so a late-arriving mode seed won't clobber a deliberate override. Writing the current value still echoes. Non-0/1 reject. **Bridge-lifetime override replay (ADR-405):** the bridge remembers the last WS-client write on this address and, on seeing the surface emit a conflicting value (a rebuilt surface re-seeding the mode default after a set load), writes the remembered value back. Net contract: an override survives set loads and Live restarts, and resets to the mode default only when the dev/ipad script restarts. |
| `/looping/v3/session/auto_capture/query` | UI→Surf | (any/none) | Read-only state read for `auto_capture`, identical mechanics to `auto_arm/query`: reply echoes `[0|1]` **on this same address** to the asker's source port. Note the reply reflects whatever value the surface currently holds — which, very early in a session, may be the cold-start `0` before the first heartbeat's mode seed lands. Listen on `…/auto_capture/query`. No mutation, no broadcast echo. |
| `/looping/v3/session/key_follow` | both | `0|1` | **ADR-447 (2026-09-19).** The key follows the loops. While on, `KeyDetectComponent` re-runs the ADR-446 analysis whenever what is playing changes — driven by `PlayheadComponent`'s change hook (a launch, a stop, a clip appearing or deleted, a finished take, a moved loop, a note edit), never by listeners of its own. Launches, stops and takes coalesce into one pass ~300 ms later, note changes into one ~1.5 s later. A pass diffs what is playing against what the last one analyzed (clips by LOM identity; a clip still recording left out): a new clip, a finished take or a clip whose loop moved is an *add*; a clip gone, or one whose notes changed in pitch class or timing, a *correct*; nothing changed is no pass — Permute's octave and mute steps included. It runs only while the dev server is present (`compose_key_follow_gate`, the arm-follows-selection shape): in bare Live the key is never rewritten. It writes (`key_detect.follow_decision`): a key the loops' notes are outside of is replaced by any answer; one that still fits stays after a correct, and after an add moves on a `sure` answer, or a `plausible` one when the key is not Follow's own. Each pass broadcasts on `…/scale/detected` when something was added, re-looped or removed, when it wrote, or when the answer changed. **Who set the key:** `scale_root` / `scale_name` from any client turn Follow off before the write (§2.11); a key changed inside Live — the chooser, Push, Live's undo — is classified a tick later from `song.can_redo`: a redo waiting is Live's undo or redo and keeps Follow on (measured on the rig: `can_redo` reads True after `song.undo`, False after a fresh write), none is a hand and turns it off, unless the key is Follow's own (the redo that empties the stack). Turning Follow on runs a pass at once, deciding as if everything playing were new. **On at every surface start and not persisted**: a Live restart or a set load begins with Follow on, and a lock lasts until then. |
| `/looping/v3/session/key_follow/query` | UI→Surf | (any/none) | Read-only state read for `key_follow`, identical mechanics to `auto_arm/query`: reply echoes `[0|1]` **on this same address** to the asker's source port. |
| `/looping/v3/session/foot_switch` | Surf→UI | `enabled:int(0\|1), channel:int(0-16), cc:int(-1..127), mode:string, learn:string, heard:int(0\|1)` | **2026-09-26.** The foot switch, a user setting (`FootSwitchComponent`): whether it is on, what it is (`channel` 0 = all 16; `cc` -1 with nothing learned; `mode` `momentary`, `latching`, or `""` with nothing learned), where Learn is (`idle`, `listening`, `timeout` — nothing arrived in 10 s, almost always because the pedal is not the Looping surface's Input in Live), and whether the mapped CC has arrived since the surface was built. On init, on handshake accept, on every change. |
| `/looping/v3/session/foot_switch/enabled` | UI→Surf | `0\|1` | Turn the foot switch on or off; persisted to `logs/foot-switch.json`. On with nothing learned starts a learn instead. The reply is the state above. |
| `/looping/v3/session/foot_switch/learn` | UI→Surf | `0\|1` | 1 starts (or restarts) a learn: the surface forwards every CC on its Input, takes the next as the foot switch — the opposite side of 64 on it within 1.5 s is a momentary switch's release, nothing is latching — saves it and turns it on. Teaching fires no gesture. 0 cancels. The reply is the state above. |

Writing `/looping/v3/session/auto_arm [0]` while a user-manual arm
exists is safe — the component never touches tracks it didn't
arm. On re-enable (`[1]`), the next selection change arms that
target fresh. Tracks armed while the toggle was off stay armed.

**Server-presence gate (compounds with `auto_arm`).**
`ExclusiveArmComponent`'s arm-follows-selection additionally requires
the dev server to be running — it fires only when `auto_arm` is on
**and** `ServerPresenceComponent.server_present()` is true (a
`/looping/v3/server/heartbeat` landed within the grace window). This
makes selection-driven auto-arm automatically quiet during bare-Live
production / cleanup (no `npm run dev`) and self-heal on set load /
Live restart while the server stays up. The two gates are orthogonal:
the heartbeat answers "am I performing?", `auto_arm` answers "do I
want auto-arm right now?". `FootTriggerComponent` and the
move-volume-knob path keep the plain `auto_arm` gate only — they're
hardware performance gestures, not selection side-effects, so they
aren't presence-gated.

### 2.13 Bridge and surface liveness

| Address                               | Dir     | Args                           | Semantics |
| ------------------------------------- | ------- | ------------------------------ | --------- |
| `/bridge/ping`                        | Bridge→UI | `seq:int, ts:int`            | 5s heartbeat. UI swallows in its WS onmessage handler. |
| `/looping/v3/bridge/heartbeat`        | Surf→UI | `seq:int, monoMs:int`          | 1 Hz surface-alive beacon. UI dispatches a `surface-heartbeat` window event. HealthMonitor watches for >3s gaps (`tick-stall`). |
| `/looping/v3/server/heartbeat`        | Bridge→Surf | `seq:int, epochMs:int, mode:string?` | "The dev server is running" beacon, sent every `timing.serverPresence.heartbeatIntervalMs` (default 2s) while the bridge process is alive. Bridge-originated straight to the surface UDP port (no `backendScope` routing). The surface's `ServerPresenceComponent` treats a gap > `graceWindowMs` (default 6s) as "server gone" and gates performance-only behaviors (arm-follows-selection) off. Also refreshed on every handshake accept so set-load / Live-restart recovery is instant. The optional 3rd arg `mode` (`"ipad"`/`"dev"`, from `LOOPING_SERVER_MODE`) records which npm script started the bridge; on the first heartbeat carrying it, `is_ipad_present()` seeds the launch-mode default of the `auto_capture` toggle that gates the performance-capture behaviors (§2.12/§2.14). See §2.12 and §5.6. |
| `/looping/v3/surface/hello`           | Surf→UI | `surfaceInstanceId:string, protocolVersion:string, timestamp:int` | Fires once at every `ControlSurface.__init__`. UI uses instanceId mismatch to detect surface restart. See §5.6. |
| `/bridge/server_mode`                 | Bridge→UI | `mode:string` | Launch mode (`"dev"`/`"ipad"`) announced to WS clients — the WebSocket-side counterpart of the UDP-only `/looping/v3/server/heartbeat` `mode` arg (which never reaches WS clients). Sent once per client on connect (`WebSocketServer.handleConnection`) and re-broadcast on the 5s ping cadence for self-healing. `mode` comes from `LOOPING_SERVER_MODE`, fixed for the bridge process lifetime. Consumed by the menu-bar utility (`owner/menubar`) for its status line; the web UI ignores it. |
| `/bridge/ax_helper`                   | Bridge→UI | `state:string, detail:string` | **ADR-439.** The Looping AX Helper as the bridge sees it — the one process trusted with macOS Accessibility, dialed over its Unix socket (`axHelper.socketPath`). `state` is `ready`, `ax-untrusted` (the app has no Accessibility grant; `detail` names the System Settings switch) or `ax-helper-down` (no connection: not installed, not running, or restarting past a 1.5 s grace). Sent once per client on connect, on every change, and on the 5 s ping cadence. The same codes are the named errors every AX-driven reply carries (`/cmd/clip/reverse/ack [0, code, detail]`, Save As, similar-sound swap), so an AX control never silently does nothing. |
| `/bridge/features`                    | Bridge→UI | `snapshot:string` (JSON) | **General-release audit §7b.** The bridge's feature switches, `{ <id>: { enabled, available, reason } }`, one entry per switch it knows (`totalmix`, `maxUtilityPatch`, `expressionPedal`, `menubar`, `axHelper`; `interface/bridge/utils/features.js`), plus `captureRecorder`, which is no switch: always enabled, available while the recorder device says hello (§2.15; `No recorder on Return A`, `Waiting for the recorder`), and it goes back too. `enabled` is `constants.features.<id>`, read once at bridge start — only an explicit `true` is on. `available` says what the feature drives has been seen since the bridge started (for `totalmix`: the mixer answered on either OSC controller) and never goes back; `reason` is a short why-not, written to be drawn in a control (`Waiting for TotalMix`, `TotalMix not answering`, `TotalMix config missing`, `AX helper not running`, `AX helper needs Accessibility`), empty when available or off. `axHelper` alone can go back: it tracks the helper's own state. Sent once per client on connect (ahead of auth, like `/bridge/connection_status`: which subsystems exist is layout, not the set), on every change, and on the 5 s ping cadence. The UI draws nothing for a feature until a snapshot names it (`bridgeStatus.feature()` reads an unnamed one as off), hides one that is off, and greys out one that is on but unavailable, with the reason. Outside v3 version negotiation like every `/bridge/*` frame, so no protocol bump. |
| `/bridge/machine`                     | Bridge→UI | `snapshot:string` (JSON) | **2026-09-26 (onboarding.plan.md §3, §6.5).** The machine's values a client used to compile in: `{ paths: { instrumentsBase, effectPresetsBase, m4lDevicesRoot }, totalmix: { minDb, maxDb, silenceDb } | null }`. `instrumentsBase` is what a preset path recorded before the Places is read against, `effectPresetsBase` the preset folder of the FX tiles that are files — racks, plug-in presets and Max devices (`devicePresets.ts` holds `{effectPresetsBase}/Digital.adg`, resolved at send time; the native tiles name no file since 3.12.0), `m4lDevicesRoot` this checkout's `Vamp Devices` from the bridge's own location, `totalmix` the mixer's dB range (`osc.totalmix`) or null. Read once at bridge start; sent once per client on connect, after `/bridge/features`, and on the 5 s ping cadence. Until it lands the client's paths are empty and an FX tile's load answers `path-not-found`, as a missing preset always did. Outside v3 negotiation, so no protocol bump. |
| `/cmd/clip/reverse`                   | UI→Bridge | `clipPath:string` | **ADR-368, rebuilt on ADR-439.** Reverse the focused Session audio clip. Live's LOM has no `Clip.reverse()`, so the bridge asks the Looping AX Helper to press Clip View's own Reverse button — the helper holds the one Accessibility grant, so this works whichever terminal started `npm run dev`. Bridge-terminated: never relayed to the surface. |
| `/cmd/clip/reverse/ack`               | Bridge→UI | `ok:int(0\|1)[, code:string, detail:string]` | `[1]` on success. On failure **`[0, code, detail]`** with a named AX code — the same vocabulary `/bridge/ax_helper` publishes (`ax-helper-down`, `ax-untrusted`, `ax-no-main-window`, `ax-control-missing`, `ax-control-disabled`, `ax-timeout`, …). This replaced the osascript copy's `[0, stderr]` when `liveAxClick.js` was deleted; `clipReverseStore.isReversing` is held until this arrives, bounded by `axHelper.requestTimeoutMs` (20 s), not by an osascript timeout. |
| `/bridge/client_log`                  | UI→Bridge | `level:string, message:string, meta:string` | Browser watchdog reports (visibility change, rAF stall, online/offline). Bridge mirrors into `logs/bridge.log`. |
| `/bridge/batch`                       | Bridge→UI | (envelope) | Broadcast-batcher envelope. Bridge-only; not part of the surface contract. Shape: `{ address: "/bridge/batch", messages: [innerMessage, ...], source: "bridge" }`. Inner messages are full OSC-shaped frames `{address, args, source, timestamp}`. UI disassembles in `WebSocketConnection.ts` and re-dispatches inner messages in order — downstream handlers never learn the frame arrived batched. Only emitted when multiple Surf→UI broadcasts fall inside one `BRIDGE_BATCH_WINDOW_MS` window (default 10 ms); single-item windows ship raw. |
| `/bridge/batch`                       | UI→Bridge | (envelope) | Same envelope, opposite direction, `source: "ui"` (2026-08-31). Inner messages are `{address, args, argsTypes}` — exactly what an unbatched UI write looks like. The UI accumulates every `send()` issued in one event-loop turn and flushes on a **microtask**, so this adds zero latency: it merges only writes that were already leaving together. Single-message turns still ship raw, so the common case is byte-for-byte unchanged. The bridge unpacks in `WebSocketServer.handleBatch` and routes each inner message through the same path an unbatched one takes, **isolating failures per item** — one bad address must not discard the rest of the frame. Nested envelopes are refused rather than recursed. |

### 2.14 iPad-only performance capture (auto-record + save-as)

`PerformanceCaptureComponent` observes `song.is_playing` and drives two
behaviors, both gated on `compose_capture_gate(session_settings)` — i.e.
the `auto_capture` toggle (`SessionSettings.should_auto_capture()`, §2.12):

- **Transport start** → `song.record_mode = 1` (arm arrangement record).
- **Transport stop** → `song.record_mode = 0`, then emit the command below.

The `auto_capture` toggle *defaults* to the launch mode — seeded to
`is_ipad_present()` on the first heartbeat carrying a `mode` (ipad→on,
dev→off) — so out of the box these behaviors fire under `npm run ipad` and
not `npm run dev`, exactly as before this toggle existed. But the toggle is
now the sole gate and fully overridable: a `dev` session can force capture
on, an `ipad` set can force it off (from the web UI or the `owner/menubar`
utility). Cleanup on the stop edge is ownership-based, not gate-based — a
take armed while the toggle was on is always disarmed and offered for save
even if the toggle flips off mid-take.

An override outlives the surface (ADR-405): Live rebuilds the whole
Control Surface on every set load, and the fresh surface re-seeds the
mode default within ~2s (next heartbeat) — so the bridge remembers the
last client write for its process lifetime and replays it whenever a
surface emit disagrees. The override therefore holds across set loads
and Live restarts, and resets to the mode default exactly when the
dev/ipad script restarts.

| Address                                | Dir     | Args                         | Semantics |
| -------------------------------------- | ------- | ---------------------------- | --------- |
| `/looping/v3/session/save_as_request`  | Surf→Bridge | `tempo:int, sigNum:int, sigDen:int` | Fired on transport stop during an ipad session. **Bridge-terminated — not relayed to the UI.** The bridge owns the wall clock + a monotonic counter (persisted to `logs/save-as-counter.json`); the dialog Live's LOM cannot open is the AX helper's `save_as_dialog` verb (ADR-439): it raises Live, presses Live's own Save Live Set As menu item, waits for the panel's name field to take focus, writes `NNN_YYYY-MM-DD_<tempo>bpm_<num>-<den>` (e.g. `001_2026-07-06_120bpm_4-4`) into that field through Accessibility and reads it back, stopping **without** pressing Return — the panel stays open for the user to Enter (save) or Escape (decline). No keystroke is sent: measured 2026-09-15, a name posted to Live's process as key events never reached the panel's field. Belt-and-suspenders: the bridge re-checks `LOOPING_SERVER_MODE === 'ipad'` before acting. Accessibility trust is the helper's, not the bridge's launcher's; an untrusted or absent helper is logged as a named error (`ax-untrusted`, `ax-helper-down`) and costs no counter value. |

### 2.15 Capture recorder (Vamp-Recorder.amxd, 2026-09-27)

REC's device, on Return A, over its own UDP pair (`osc.loopingRecorder`: the
device listens on 11016, the bridge on 11017, both loopback). Every edition has
it; it is not a feature switch, but it rides `/bridge/features` as
`captureRecorder` so REC can grey out, saying why, while the device is not
there (`interface/bridge/handlers/captureRecorder.js`). A capture lands in the
current set's own project folder: beside the `.als` for a saved set, and in
Live's temp project for an unsaved one.

| Address | Dir | Args | Semantics |
| ------- | --- | ---- | --------- |
| `/capture/start` (`/capture/arm`) | UI→Device | — | Start recording a WAV. The bridge sends `/capture/folder` first, on the same socket. A start while recording is ignored. |
| `/capture/stop` (`/capture/disarm`) | UI→Device | — | Stop; the device then sends `/capture/state idle` and `/capture/file`. |
| `/capture/query` | UI→Device | — | Replays `/capture/state` and the last `/capture/file`. **Not a presence check:** the UI takes the file as a fresh capture and loads it. |
| `/capture/folder` | Bridge→Device | `path:string` | Where an unsaved set records: the newest `<YYYY-MM-DD HHMMSS> Temp Project` holding `Ableton Project Info` under `paths.liveRecordingsDir` (Live's temporary folder, default `~/Music/Ableton/Live Recordings`), picked by name. Empty when none exists. Bridge-originated, never from a client. The device ignores it for a saved set, whose `live_set file_path` names its folder. Reaches the device's script straight from `OSC-route` (the `sel` path drops arguments), so it needs the 2026-09-27 `.amxd`. |
| `/capture/hello` | Device→Bridge | — | Once a second from the moment the script loads. **Bridge-terminated.** Any packet from the device makes `captureRecorder` available; 3 s without one makes it unavailable, `No recorder on Return A`. |
| `/capture/bye` | Device→Bridge | — | Sent as the device is deleted (Max's `notifydeleted`), best effort. **Bridge-terminated.** Unavailable at once. |
| `/capture/state` | Device→UI | `state:string` | `idle` or `recording`, on every change and once as the device loads. Any state ends the UI's pending start. |
| `/capture/file` | Device→UI | `path:string` | The finished WAV, `LOOPING_CAPTURE_<YYYYMMDD_HHMMSS>.wav`. The UI prepares a MIDI track and loads it into a Simpler (`clipOperations.loadCaptureIntoSimpler`). |
| `/capture/error` | Device→UI | `code:string, detail:string` | A refused start. `no-project-folder`: the set is unsaved and no temp project was named; `sfrecord-missing`: the patch has lost its `sfrecord~`. The UI shows it in the error banner, ends its pending start and turns back down the Send A the tap turned up. |
| `/capture/meter` | Device→UI | `level:float` | 0–1. The device's meter chain is unwired today, so it never arrives. |

## 3. state/full tree args layout

`tree_args` is an enum-prefixed sequence of records. Each record
starts with a one-char OSC string tag, then typed fields.

> **Protocol 3.10.0 (current).** T arity **15** — 3.10.0 (ADR-446) changed no record: it added
> `/looping/v3/session/scale/detect` and validates `scale_name` against Live's 35 names.
> 3.9.0 (ADR-439) appends `preset`, the path the
> last `prepare_for_preset` load recorded under `looping.preset` in the same per-track store
> (see `/looping/v3/track/preset`), carried only while the track's first instrument still has the
> class and name that load left; `""` means none recorded or no longer held (the meaning widened
> without a version change — `""` was already "none"). 3.8.0 changed no record. 3.7.0 appended `role`,
> the rail an instrument was loaded from, read back out of Live's
> per-track key-value store (see `/looping/v3/track/set_role`). It is
> the first T field that is not a projection of a LOM *attribute*: it
> is a value this system wrote and is reading back. `""` means no role
> recorded, which is every track made before 3.7.0 or outside this app.
> D arity 3 (drops `legacyId`). 3.5.0 added the client-declared ETag
> and 3.6.0 collapsed the framing to one `state/full/tree` message;
> neither touched a record.
> `HandshakeComponent.SUPPORTED_VERSIONS =
> ("3.10.0","3.9.0","3.8.0","3.7.0","3.6.0","3.5.0","3.4.0","3.3.0","3.2.0","3.1.0","3.0.0")`;
> the UI declares `UI_SUPPORTED_VERSIONS = ['3.10.0']`. Every
> T-record addition appends, which is what lets an *older* UI run
> against a newer surface — but only for the *records*. 3.6.0 changed
> the addresses, so a client that wants the tree and does not speak
> 3.6.0 receives nothing at any negotiated floor (§5.4).

| Tag | Name             | Fields                                                                                                                                           |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `T` | Track record     | `trackPath, name, color:int, mute:int, solo:int, arm:int, hasMidiInput:int, hasAudioInput:int, hasArrangementClips:int, volume:float, isFoldable:int, foldState:int, groupTrackIndex:int, role:string, preset:string` |
| `D` | Device record    | `devicePath, name, className`                                                                                                                    |
| `P` | Parameter record | `paramPath, name, displayName, min:float, max:float, value:float, unit`                                                                          |
| `S` | Slot record      | `slotPath, state:int` (`0=empty, 1=has_clip, 2=playing, 3=recording`)                                                                            |
| `C` | Clip record      | `clipPath, name, length:float, color:int, pitch:int`                                                                                             |

Booleans are `0`/`1` ints (OSC has no native bool). Both
`hasMidiInput` and `hasAudioInput` can be `1` on the same track
(External Instrument). Master / returns emit `0` for
`hasArrangementClips` (single-arity parsing).

`volume` on T is read from `track.mixer_device.volume.value` via
safe-getattr; it rides every T to let the UI seed mixer state from
state/full alone.

`isFoldable` / `foldState` / `groupTrackIndex` are the Group Track
fields (ADR-410, §2.5). `foldState` **must** be read through a
raise-swallowing helper — Live raises on `fold_state` for a
non-foldable track. `groupTrackIndex` is the parent group's LOM index
or `-1`; it's recovered from `Track.group_track` by `_safe_int_id`
identity against `song.tracks` (never `is` — ADR-350). Master /
returns emit `(0, 0, -1)`.

### 3.1 What goes on which record

Doctrine for future extensions:

- **Per-object stable metadata goes on its record.** Track-level
  capability flags and identifying metadata belong on `T`. Per-device
  facts (className, mute/solo/active) belong on `D`. Per-param facts
  (min/max/unit/display name) belong on `P`.
- **Hot-changing values stay event-driven.** Param values ride
  `param/value` echoes; slot states ride `slot/state` events;
  generation rides `state/full/tree` + `state/invalidate`. Records
  carry a value snapshot at emit time; live mutation is its own
  address.
- **Static fields beat property bags.** Each new field is a named
  slot, not a generic `meta: Map<string, any>`.
- **Adding a field is a coordinated 3-place change**: wire-protocol
  doc + surface emitter (`V3StateFullComponent._build_payload` +
  `_RECORD_ARITY`) + UI normalizer. No field lands in only one
  place.
- **Read the live store before scoping a wire-spec extension.**
  Grep `interface/src/lib/stores/v3/normalized.svelte.ts` and
  `interface/src/lib/api/handlers/v3StateFull.ts` first — the v3
  wire often already carries it.

### 3.2 Record ordering

Records are depth-first: T, then its Ds (each D followed by its Ps),
then its Ss (each S followed by its C if any). Root is either a T or
the special `master` / `returns/<N>` emitting as T with `trackPath =
"master"`.

Chunk boundaries fall on record boundaries only — a chunk never ends
mid-record.

**Pad-chain bundles (3.8.0)** carry D and P records only — a pad is not
a track — with every `devicePath` directly under the bundle's scope
(`tracks/1/devices/0/pads/38/devices/1`). The chain's instrument is
skipped (its parameters are the virtual-macro layer's) but its chain
index is kept, so a Reverb after a Simpler is `devices/1` on the wire as
it is on the chain. The UI keeps these in a map of its own keyed by pad
path; the whole-song tree stays exactly 3.7.0-shaped.

UDP cap is 9216 bytes on darwin. Empirically 234 named parameters
carry in ~4.4 KB; chunk splitter keeps whole-track granularity.

## 4. Generation numbering

A **generation** is a monotonic `int32` that the surface advances
on every **structural change**:

- Track insert or delete
- Device add, remove, or reorder
- Plugin-initiated parameter list reconfig (VST preset load changing
  parameter count)
- Rack chain add, remove, or reorder (reserved)
- Clip create or delete
- Song or set load (generation resets to 1 on new session)

Does **not** advance generation:

- Parameter value changes (writes check generation; value changes
  don't bump it)
- Clip property edits that don't change structure
- Transport state changes
- Track mute / solo / arm

### 4.1 Who holds what

- **Surface** holds the authoritative generation. Advances it on
  structural observations in its listener callbacks. Serialized by
  the tick loop so structural events can't interleave with writes.
- **UI** mirrors the last generation it saw. Every `state/full/tree`
  and every `state/invalidate` refreshes the mirror.

### 4.2 Stale-write semantics

Every `param/set` carries the UI's current generation. If the UI's
generation is less than the surface's, surface replies:

```
/looping/v3/error [address, "generation-stale", path, "ui=<N>, surf=<M>"]
```

and does **not** write. The UI:

1. Discards the pending write.
2. Waits for the `state/invalidate` or `state/full` already in flight
   (ordering guarantee, §2.3).
3. Once caught up, rebinds its slider to the new path and replays the
   write only if the user is still holding the gesture.

Dropping the write rather than auto-retrying at the new path is
deliberate — the user's gesture semantics might have shifted.

### 4.3 Starting generation

New session: `generation = 1`. Zero is reserved as an unset sentinel
on the UI side and does not appear on the wire. `int32` wraparound
is 68 years at 1 structural change per second — not a real concern.

### 4.4 UI optimistic-apply contract (ADR-358)

UI-initiated value writes — `track/{volume,name,mute,solo}`,
`master/volume`, `param/set`, `property/set` — apply locally to the
v3 store **before** emitting OSC. The store is the single source of
truth; components read from it directly via `$derived` and never
maintain a parallel optimistic field.

This is load-bearing because the surface arms one-shot **echo
suppression** per UI write (`TrackMetadataComponent._handle_set`,
`MutationComponent` for params): the first listener fire after the
write is swallowed to keep the wire quiet during fast drags. Without
the local apply, the UI store would never see a UI-initiated write
land. Drags would show the right value via per-component optimistic
state, then snap back to the load-time store value when that
optimistic state cleared.

**Implementation:** thin command layer in
`$lib/services/trackCommands.ts` (and `selectedTrackStore.setParamValue`
/ `setPropertyValue`) pairs `applyXxx` with `send`. Components call
commands; they don't `send` directly for value writes. **Reconciliation:**
outside edits (Live → UI) and rare LOM rejections bypass suppression
and arrive via the standard listener echo, which calls the same
apply path — store reconciles. State/full bundles also re-hydrate
on the T-record.

**Control wires** (`track/{select,delete}`, `clip/launch`, etc.)
have no value-write semantics and don't need this pattern; they fire
and forget, with the surface emitting follow-up state changes that
the UI absorbs through the normal handler path.

## 4.9 Bridge↔surface transport (2026-08-31)

Two legs run side by side. **Which leg a message took is invisible to
the UI** — same addresses, same args, same order — so this section is
about the bridge↔surface hop only and changes nothing above it.

| Leg | Port | Carries |
| --- | --- | --- |
| UDP | 11020 surface-bound, 11021 bridge-bound | Everything, except as below. Fire-and-forget senders on ephemeral ports (Max probe drivers) require it. |
| TCP | 11022, surface **listens** | `state/full/tree` only. Since 3.6.0 that message has **no UDP fallback** — with no peer connected it is not sent at all. |

Framing is `[4-byte big-endian payload length][OSC message bytes]` —
the payload is exactly what the UDP leg already carries, so this is a
transport swap and not a codec change.

**Why only `state/full`.** It is the one message whose size the
9,216-byte darwin datagram ceiling actually constrains: 389 KB on a
realistic set, which is what forced ~99 chunks, an integrity checksum,
and a reassembler. Everything else fits a datagram comfortably and
gains nothing.

**Why there is no fallback.** 3.6.0 deleted the chunking, so the
message that used to fit a datagram no longer can. A publish with no
stream peer logs a warning and returns, deliberately **without**
updating the surface's memo of what the far side holds — otherwise the
republish that fires on peer connect would be skipped as a duplicate.
That republish is the whole safety net for the window between Live
starting and the bridge dialling in. The `state/full/unchanged` marker
is four small args and still rides UDP, so a client whose bridge has
no TCP leg can still be told its tree is current.

**The chunking protocol does not change.** Over TCP the chunk budget
is effectively unlimited, so the bundle ships as `begin` + **one**
chunk + `end` instead of `begin` + 99 + `end`. The UI needs no change
at all: the reassembler already reads `totalChunks` off `begin` and
concatenates however many arrive, so a one-chunk bundle is the
degenerate case of the protocol it already speaks. The checksum is
byte-identical over either leg.

**Falling back is normal, not an error.** With no TCP peer connected
the surface emits the chunked UDP bundle exactly as it always has —
which is what happens against a bridge that predates this leg, and in
the window between Live starting and the bridge dialling in. The wire
is chosen per publish, so a peer that comes or goes changes the *next*
bundle rather than half-committing the current one.

**Reconnect is the bridge's job.** UDP was connectionless, so a Live
restart was invisible; TCP is not, so the bridge redials with backoff
(500 ms doubling to 10 s). The UI's WebSocket to the bridge is a
separate connection that stays up throughout.

## 4.10 WebSocket auth (2026-08-31)

The bridge binds `0.0.0.0:8081`. Before this, anything on the LAN that
knew the port could drive Live and read the whole Set.

| Address | Dir | Args | Semantics |
| --- | --- | --- | --- |
| `/bridge/auth/challenge` | Bridge→UI | `salt:string` | Sent immediately on connect. Fresh random salt per connection. |
| `/bridge/auth` | UI→Bridge | `proof:string` | `HMAC-SHA256(secret, salt)`, hex. Must be the client's first substantive frame. |
| `/bridge/auth/result` | Bridge→UI | `ok:int, detail:string?` | `1` on success. `0` closes the socket with code 4403; the detail is deliberately uninformative. |

Until a client authenticates, the bridge **refuses its commands and
sends it no broadcasts**. Both halves matter — refusing only commands
would still leak the Set to anything that opened a socket, which is the
half needing no credentials to exploit. A socket that never
authenticates is closed after `auth.timeoutMs`.

The secret never crosses the wire, and the salt is per-connection, so a
captured exchange is not replayable.

**The secret is not in `constants.json`** — that file is committed.
Resolution: `LOOPING_WS_SECRET`, else `config/.ws-secret` (gitignored,
mode 0600, auto-generated on first bridge run). Auto-generation removes
the misconfigured state entirely: there is no setup step and no way to
end up with auth enabled and no secret.

**What this is worth, honestly.** It raises the bar from *anything that
can reach port 8081* to *anything that can load the app* — the browser
fetches the secret from `/api/ws-auth` on the interface server, which is
also on the LAN. It stops stray clients, stale tabs from another
machine, and port scanners; it is not a defence against a determined
attacker already on the network. Closing that gap needs per-device
pairing (a code shown on the Mac, typed on the iPad, held in
localStorage), which is deliberately not the default because a cleared
browser cache would then lock a performer out mid-session.

Clients that must authenticate: the web UI
(`WebSocketConnection.ts`) and the Swift menu-bar app
(`owner/menubar` — reads the secret file directly, since it runs on the
same Mac). If auth is enabled and no secret can be established, the
bridge logs an ERROR and runs **unauthenticated** rather than refusing
every client — failing open is the deliberate choice for a performance
rig.

## 5. Handshake

Protocol-version negotiation at UI-connect.

### 5.1 Flow

```
   UI                                                  Surface
    │                                                     │
    │──── /looping/v3/handshake/hello ──────────────────▶│
    │     [versions:string[], "etag:0x…":string?]         │
    │     web UI sends ["3.8.0"]. Other clients            │
    │     advertise their own (menubar: ["3.3.0"]).        │
    │     A reconnecting client appends the ETag of the    │
    │     tree it still holds; a cold start omits it.      │
    │                                                     │
    │◀─── /looping/v3/handshake/accept ───────────────────│
    │     [version:string, sessionId:string, generation:int]
    │                                                     │
    │         ── session proceeds on chosen version ──    │
    │                                                     │
    │  either — the tree changed, or none was declared:   │
    │◀─── /looping/v3/state/full/tree ───────────────────│
    │     [reason="accept", generation, etag, scope="",   │
    │      ...tree_args]                                  │
    │                                                     │
    │  or (3.5.0) — the declared ETag still matches:      │
    │◀─── /looping/v3/state/full/unchanged ──────────────│
    │     [reason="accept", generation, sessionId, etag]  │
```

### 5.1.1 Client-declared ETag (3.5.0)

The ETag rides *inside* the version list, namespaced as
`etag:0x0f6edcf5`, rather than as a positional argument. `hello`'s
args are an open-ended list of version strings, so a bare trailing
checksum would be indistinguishable from a version some future
surface might understand. The namespaced form is unambiguous in both
directions: a 3.4.0 surface fails to intersect `etag:0x…` against its
version tuple and ignores it, and a 3.5.0-or-later surface strips it
before intersecting. A hello carrying *only* an ETag is a version mismatch,
not an empty-but-valid negotiation.

The value is the `etag` from the header of the `state/full/tree` the
client last applied. The surface never trusts it as an assertion about
content — it recomputes its own tree and compares. A mismatch, a
malformed token, or no token at all all mean the same thing: send the
tree.

**The token is surface-local and opaque to clients.** Before 3.6.0 it
was an FNV-1a integrity checksum over a typed byte stream, mirrored
byte-for-byte in the UI so a reassembled multi-chunk bundle could be
verified. With the tree arriving as one message the client never
computes it — it stores what the header carried and echoes it back —
so it stopped being a cross-language contract. The surface is free to
change how it derives the value (it now uses a truncated MD5 of the
walk's `repr`, ~10x cheaper on Live's control thread) as long as two
things hold: stable within a session, and collision-resistant enough
that two different trees never compare equal. Clients must not parse
it for meaning or reimplement it.

**Why the client declares rather than the surface remembering.** Before
3.5.0 the surface decided from what *it* last sent, which is the wrong
question twice: on reconnect the UI may have dropped state, and with
two UIs connected (Mac and iPad hold independently-aged trees) one
client's history cannot answer the other's question. That is why
`accept` and `resync` had to be excluded from the skip entirely, and
why every tab-wake re-shipped the whole tree.

**The dangerous direction is claiming a tree you no longer hold** — the
surface would confirm it and the UI would sit empty with no error and
no retry. Clients must therefore drop their ETag in the same operation
that drops the tree (in this UI, `resetForSurfaceRestart` and
`resetTree` both call `clearHeldEtags`), and must record an ETag only
*after* a bundle has applied cleanly.

No common version: surface replies with
`/looping/v3/error ["/looping/v3/handshake/hello",
"handshake-version-mismatch", "", "UI: <versions>, Surface: <versions>"]`.

### 5.2 No mid-session fallback

Once `accept` returns a version, the session is that version for
its lifetime. A UI that encounters repeated errors disconnects and
reconnects (re-handshake).

### 5.3 sessionId

The surface mints a `sessionId` (UUID) at handshake. Useful for
correlating logs across bridge / surface / UI. Not load-bearing for
correctness.

### 5.3a hello delivery is unreliable — the UI retries (ADR-418)

`hello` does not ride the WebSocket end to end. The bridge relays it
onto **UDP 11020**, which is unacknowledged, and the surface only
drains that socket on a Live tick — `bridge.log` records
`tick-stall:pythonSurface` gaps of 3–12s, during which arrivals can be
lost to a full buffer.

A lost `hello` used to be silent and permanent: no `accept`, so no
`state/full` (§5.5), so no tracks, meters or playheads — while writes
kept working, because control and value writes are fire-and-forget and
need no negotiated session. A frozen display whose faders still reach
Live is this failure, and only a reload cleared it.

So **the UI resends `hello` every 2s until an `accept` arrives**,
bounded at 8 retries. `hello` is idempotent — a duplicate produces
another `accept` and another `state/full`, which is the recovery
anyway. Past the bound the UI stops; the reconnect path and
`surface/hello` (§5.6) each start a fresh sequence.

A surface implementation must therefore tolerate repeated `hello` from
one client, and a client must tolerate more than one `accept`.

### 5.3b accept is BROADCAST — it may not be yours (ADR-418)

The bridge is a pure router and the surface's UDP reply carries no
client identity, so **every `accept` reaches every WebSocket client**.
Clients negotiate independently, so a client routinely sees accepts
naming versions it does not speak (web UI `3.8.0`, menubar `3.3.0`).

A receiver must **ignore an `accept` whose version it never
advertised** and keep waiting for its own. This is sound, not a
heuristic: the surface picks only from the versions a client sent it,
and a genuine no-common-version is reported on `/looping/v3/error` as
`handshake-version-mismatch` (§5.1) — never as an `accept`. So an
`accept` for an unadvertised version can only belong to someone else.

Treating one as a local failure is what the UI used to do; it skipped
recording `sessionId` / `generation` and left the client stale.

### 5.4 supported versions

`HandshakeComponent.SUPPORTED_VERSIONS = ("3.12.0", "3.11.0", "3.10.0", "3.9.0", "3.8.0",
"3.7.0", "3.6.0", "3.5.0", "3.4.0", "3.3.0", "3.2.0", "3.1.0", "3.0.0")` — highest
common version wins. 3.12.0 (2026-09-28) is `device/load`'s `native:<class>`
source (§2.8): a tile names a native device instead of a preset file; arities
are unchanged. 3.11.0 (2026-09-26) is the loads that name their Place
(§2.8, §2.9): two optional trailing args on `prepare_for_preset` and
`device/load`; record arities are unchanged.
Kept in lockstep with `DebugComponent.PROTOCOL_VERSION` and
`SurfaceHelloComponent.PROTOCOL_VERSION`.

**Negotiating down is nominal for anything that reads `state/full`.**
The web UI therefore advertises `["3.12.0"]` alone: against an older
surface it takes a named `handshake-version-mismatch` on
`/looping/v3/error` rather than a successful handshake followed by a
tree that never arrives.

The tail is retained because clients that never read the tree still
negotiate against it — the Swift menubar advertises only `3.3.0` and
consumes transport, session and error addresses. But a pre-3.6.0
client that *wants* the tree cannot be served one at any floor: the
`begin` / `chunk` / `end` addresses it listens on no longer exist, and
the surface has no code left that could produce them. The floors have
always been partly nominal in this way (3.3.0 and 3.4.0 both changed
record arity without changing the emit); 3.6.0 does not make it worse
so much as make it obvious.

### 5.5 Accept drives state/full

After emitting `accept`, the surface fires one `state/full/tree` with
`reason="accept"`, carrying the same `generation` as the accept reply.
This is the cold-start tree-delivery mechanism.

A reconnect is an accept too: the UI's second `hello` produces a
second `accept` which produces a second `state/full`. **The UI does
not need `state/resync` on reconnect** — accept already brought the
tree. `state/resync` is reserved for packet-loss recovery.

Ordering: the accept reply lands on the wire strictly before the
`state/full/tree`.

### 5.6 surface/hello — restart detection

Live 12 can tear down and reconstruct the entire Python Control
Surface (`File → Open` triggers this in 12.3.7). The WebSocket to
the UI stays alive across the tear-down because the bridge is a
separate process. Without a signal, the UI would keep addressing
the previous session's context.

The surface advertises its identity unsolicited on every `__init__`:

```
/looping/v3/surface/hello
  [surfaceInstanceId:string, protocolVersion:string, timestamp:int]
```

- `surfaceInstanceId` — UUID minted fresh per
  `ControlSurface.__init__`. Per-surface-lifetime, **not** per
  handshake.
- `protocolVersion` — the highest v3 version this surface supports.
- `timestamp` — surface-side Unix seconds at emission. Diagnostic
  only.

UI behavior (normative):

1. InstanceId matches last-seen → **no-op** (idempotent).
2. InstanceId differs from last-seen *and* last-seen is set →
   **surface restart**. UI clears normalized store's generation +
   session state, issues fresh `/handshake/hello`.
3. Last-seen unset (first connect) → record the instanceId without
   side effects. Regular handshake path handles cold bring-up.

Emission timing: once, late in `__init__` — after transport is
bound and components wired. No re-fire on UI reconnect.

## 6. Error model

### 6.1 Address

```
/looping/v3/error [address:string, code:string, path:string, detail:string]
```

- `address` — the address that provoked the error.
- `code` — one of the closed enum below.
- `path` — the path the error is about. Empty (`""`) when not
  path-specific.
- `detail` — free-form diagnostic text. Safe to log, not safe to
  branch on.

### 6.2 Closed-enum codes

| Code                         | Meaning |
| ---------------------------- | ------- |
| `path-not-found`             | Path names a position that doesn't exist. Not a structural-change issue. |
| `path-structural-mismatch`   | Path was valid; a structural change has invalidated it. UI should wait for the expected invalidation or issue `state/resync`. |
| `generation-stale`           | Write arrived with a generation less than surface's current. See §4.2. |
| `write-rejected`             | Surface refused the write for a typed reason in `detail` (`"automation-locked"`, `"param-read-only"`, `"property-read-only"`, `"property-not-allowed"`). Not retryable until the condition changes. |
| `path-not-supported`         | Path grammar-valid but implementation doesn't support this suffix (e.g. `chains/...`, `returns/...`). |
| `pool-exhausted`             | GroovePoolComponent found no free groove (`unassigned-*` or orphaned `Clip_*`) and could not mint one during assign-on-first-write. |
| `device-slot-invalid`        | `devicePath` out of range for the target track's device chain. |
| `load-failed`                | `/device/load`, `/clip/load_file` or `/clip/swap_file` failed inside Live — any `_LOM_ERRORS` exception, empty `presetPath` (device load), a native insert Live refuses or a class it has no name for (device load, `path` `native:<class>`, `detail` `insert-refused` or `unknown-device: <class>`), or `ClipSlot.create_audio_clip` raise (clip load or swap; a swap's `detail` ends "the old file is back" or "the slot is empty"). `detail` carries exception class + truncated message, or `"empty-preset-path"`. Not retryable without fixing the underlying asset. |
| `clip-not-audio`             | `/clip/swap_file` against a MIDI clip, which has no file to swap. Carried on the swap's reply, not on `/looping/v3/error`. |
| `clip-recording`             | `/clip/swap_file` against a clip that is still recording. Carried on the swap's reply. |
| `clip-file-unknown`          | `/clip/swap_file` against a clip whose own `file_path` reads empty — either Live reports no file, or the LOM raised on the read. A swap is `delete_clip` then `create_audio_clip`, and the put-back on a file Live will not load needs that path, so with it missing there is no way back: refused **before** the delete. Carried on the swap's reply. |
| `no-empty-slot`              | `/clip/load_file` fell back to auto-pick (empty `slotPath`) and every slot on `trackPath` is occupied. UI should either delete a clip first or pick a specific slot. |
| `handshake-version-mismatch` | Handshake failed — no common version. |
| `slot-not-found`             | `slotPath` grammar-valid but `slots/<N>` out-of-range. |
| `clip-not-present`           | Write targeting a clip against a slot with `has_clip == False`. |
| `duplicate-rejected`         | `/clip/duplicate` failed — destination occupied, not next slot, or LOM raised. `detail` carries sub-reason. |
| `launch-failed`              | `slot.fire()` or `scene.fire()` raised. Rare; covers half-torn-down state. |
| `scene-not-found`            | `scenePath` out-of-range for `song.scenes`. |
| `not-midi-clip`              | `/clip/transpose` against an audio clip. |
| `clip-not-midi`              | `/clip/notes/get` against an audio clip (ADR-360). UI shows ghost / placeholder. |
| `clip-not-found`             | `/clip/notes/get` for a `clipPath` that doesn't resolve (malformed, slot OOB, slot empty, etc.). Pull endpoint collapses every resolve failure into this code rather than the granular write codes (ADR-360). |
| `clip-too-many-notes`        | `/clip/notes/get` reply would exceed 512 notes / 8 KB blob (UDP MTU constraint). UI logs but doesn't render. |

### 6.3 What's **not** an error

- A `param/set` clamped by the parameter's range is not an error.
  Surface applies the clamped value and echoes it via `param/value`.
- A `state/full` with an identical `etag` but an advanced generation
  is not an error. UI applies it.
- A `structural` fire that produces **no** `state/full` at all is not
  an error. The surface suppresses the emit when the walk yields a
  tree identical to the one it last shipped on that scope — the UI's
  current bundle is still authoritative. `accept` and `resync` are
  exempt and always ship, because the UI is actively waiting on them
  and may have just dropped state. (Since 2026-08-31 the surface
  compares the trees themselves rather than their 31-bit checksums,
  so a hash collision can no longer suppress a real update.)

## 7. Invalidation events

v3 has two granularities.

### 7.1 Full tree (`state/full/tree`)

Emitted on:
- Handshake accept (`reason="accept"`).
- Any structural change too large to enumerate cheaply
  (`reason="structural"`).
- UI-initiated `/state/resync` (`reason="resync"`).
- `song.view.selected_track` change after the 50ms coalesce fires
  (`reason="selection-change"`, with the `scope` arg set to the
  selected subtree path).

There is no `"init"` reason. Accept is the single cold-start state
signal.

### 7.2 Targeted (`state/invalidate`)

Emitted on small structural changes where the surface can cheaply
enumerate affected paths:

- Single device add/remove/reorder → invalidate `tracks/<N>/devices/*`.
- Plugin parameter list reconfig → invalidate `<devicePath>/params/*`.
- Clip create/remove → invalidate `<slotPath>/clip`.
- Arrangement-clip add/remove → `reason="arrangement-clips-changed"`
  with paths list containing the `trackPath`. Co-emitted with
  `/looping/v3/track/has_arrangement_clips`.
- A device added, removed or moved inside a **drum pad's chain** (3.8.0)
  → `reason="pad-chain"` with **no paths**: a bare generation bump, since
  paths inside the chain shift. The records follow as a pad-scoped
  `state/full/tree` for every subscribed pad, which reconciles the pad
  map by path; the song is never republished for a chain edit.

The surface may always fall back to `state/full` instead of
`state/invalidate` for any case; what's guaranteed is the
generation advance.

> **The paths tail is empty in practice, and always has been.**
> `InvalidationComponent._on_advance` emits `(generation, reason)` and
> nothing else — the enumeration above was deferred to "Phase 2" and the
> *consumer* is what got wired (`v3Invalidate.ts` reads `args[2..]` and
> calls `releaseUnderPath` on each). So every invalidate is the bare
> generation bump the `pad-chain` row describes, and `releaseUnderPath`
> has never run in production. Note also that the two ends read an empty
> tail in **opposite** directions: `InvalidationComponent`'s docstring
> calls it "drop everything and resync", `v3Invalidate.ts` calls it "a
> generation bump with no subtree change". Treat the generation advance
> plus the `state/full` that follows as the whole contract.
>
> The consequence that mattered: a device **replaced at a live path**
> carries no signal the UI can act on — the path string is unchanged, so a
> path-keyed subscription `$effect` never re-runs and never re-subscribes.
> The surface therefore owns re-binding its own property subscriptions
> across a device replacement rather than dropping them and expecting the
> UI to notice; see the `property/subscribe` row in §2.
>
> Note that a **preset load into an existing Drum Rack is not that case**:
> Live keeps the device object and mutates it, so the handle never changes
> and there is nothing to re-bind. Its only observable signal is the rack's
> own `name` — see `surface/CLAUDE.md`, "Drum Rack virtual macros".

## 8. What this contract closes

- UI holds `paramRef = "tracks/0/devices/1/params/8"` at generation
  `N`.
- Live re-walks. Surface advances generation to `N+1`, emits
  `state/full/tree reason="structural" generation=N+1`.
- UI updates its generation mirror.
- The slider, still bound to the same semantic parameter, keeps
  the same path — position didn't change. No cache wipe needed.
- If the position *had* changed (device moved), UI sees a
  `state/invalidate` with the old paths and rebinds its slider
  from state/full content.
- Any write in the window between structural event and rebind
  carries the old generation `N` → surface rejects with
  `generation-stale` → UI retries (if gesture still live) against
  the new generation and new path.

The pointer-cookie / `paramId` class of bug that ate the v2 wire is
structurally absent here.
