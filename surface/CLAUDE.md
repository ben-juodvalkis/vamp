# Ableton - Python Surface

**Before you change the surface:**

- Live loads it once: a change runs only after a full Live restart. The
  `reload_on_reselect` probe (below; `{"kind":"reload"}`, then re-select
  the surface in Live's Settings) re-imports it without one; not yet
  confirmed on the rig, and not for `__init__.py`, the transports or
  `disconnect`.
- A component imports its siblings relatively (`from . import path_resolver`,
  `from .key_detect import …`). The absolute `from components.x import` form
  passes pytest, because the tests put the surface root on `sys.path`, and
  fails inside Live, which loads the package relatively.
- A protocol bump changes six literals in one commit:
  `DebugComponent.PROTOCOL_VERSION`, `SurfaceHelloComponent.PROTOCOL_VERSION`,
  `HandshakeComponent.SUPPORTED_VERSIONS` (prepend), the UI's
  `v3Handshake.ts` `UI_SUPPORTED_VERSIONS`, and the screenshot mock's
  `scripts/shot/scene.mjs` `PROTOCOL_VERSION` and `scripts/shot/capture.mjs`
  `UI_SUPPORTED_VERSIONS`. Then grep for the old version string.

Python Control Surface is the sole live backend bridging the
SvelteKit interface to Ableton Live's internal API. The last legacy
Max4Live carriers (`scripts/liveAPI-v6.js` and
`M4L devices/AbletonOSC helper.amxd`, in Looping), kept on disk as inert stubs
since 2026-04-22, were deleted on 2026-09-23 together with the bridge's
`maxObserver` port pair (general-release audit Tier 0, the user's call).
An old set that still carries the helper device will show it as missing
its script; delete the device from that set.

## Architecture (Python Surface sole live backend)

**Python Control Surface (`surface/`) owns everything
touching Live.** Track metadata, master track, meters, transport,
clip properties, grooves, device/preset loading (including
arbitrary filesystem paths via sidebar Places), foot-trigger
gestures, track selection, UI-initiated track creation, and
device-state observation all live on the Python side after
Phases 5–12 + the 2026-04-21 ROW 6.x sweep. AbletonOSC was
removed in ROW 11 (2026-04-21) and the M4L observer pipeline
was gutted to zero live handlers across pr12-5 and ROWs 6.5–6.9
(2026-04-21). Hardware-only Max modules (`owner/Max Patches/foot-trigger.js`,
`owner/Max Patches/midi-remap.js`) talk directly to the Python surface
on port 11020 — they never routed through `liveAPI-v6.js`. Since
ADR-422 the foot + wah pedal CCs also arrive **without Max at
all**, as plain MIDI on the surface's own MIDI input port — see
"Pedal MIDI input" below. The Utility patch's CC 67 chain stays as
the owner's home-studio piano-pedal looper (any input, any channel;
`foot-trigger.js`), opened only while `features.maxUtilityPatch` is on.

Address routing is controlled by `backendScope` in
`config/constants.json`. `/looping/v3/*` goes to the Python
Surface. The `maxObserver` port pair (11002/11003) is gone: it was
removed with `liveAPI-v6.js` on 2026-09-23, after carrying no live
traffic since 2026-04-22.

## Inbound drain — two pumps (2026-08-31)

The surface reads its UDP socket from **two** places, and the split
matters when reasoning about command latency.

`LoopingSurface._tick` re-arms with `schedule_message(1, self._tick)`.
Measured 2026-08-31, that fires every **99.44 ms** — two independent
probes agree (reply-clustering across a 40-message burst; and the max
of 120 randomised-phase round trips). It carries the 1 Hz heartbeat,
the scheduler-hiccup probe, and a *fallback* `poll()`.

`drain_pump.FastDrainPump` is the real read path. It runs the same
`transport.poll()` off `Live.Base.Timer`, measured at **10.77 ms
(92.8 Hz)** with `interval=1`. Net effect on inbound command latency,
via `owner/probes/inbound_latency_run.js`:

| | before | after |
|---|---|---|
| mean | 52.06 ms | 5.63 ms |
| p99 | 102.61 ms | 10.33 ms |

Four things worth not rediscovering:

- **`Timer`'s `interval` is not milliseconds.** `interval=1` buys a
  ~10.8 ms period. The unit is undocumented; Live's own class
  docstring says only "a certain inverval" [sic].
- **Both clocks are real and differ by 10×.** Live does run a ~100 Hz
  internal loop — that is what the Timer rides. `schedule_message`
  does not dispatch at that rate; one of its ticks is ten of Live's
  beats. An older `_init_heartbeat_state` docstring applied the fast
  rate to the slow period and was wrong by that factor.
- **Live stops a Timer whose callback raises.** Its docstring says so.
  `FastDrainPump._on_fire` is therefore total, and the tick keeps its
  own `poll()` so a dead pump degrades to the old ~100 ms latency
  rather than going deaf.
- **Don't infer module membership from the binary's string table.**
  `Timer` resolves at runtime as `Live.Base.Timer`, even though its
  docstring sits inside the `Live.Track` block and `Live.Base`'s block
  lists only the vector containers, `Text` and `LimitationError`.
  `discover_timer` looks it up at runtime for exactly this reason.

`OSCTransport.poll()` takes a non-blocking lock so the two pumps can
never double-dispatch; a loser returns 0 immediately rather than
waiting. `/looping/probe/drain_stats` reports pump source, fire count,
error count and the contention counter — measured `drainSkips` is 0 in
practice, i.e. the pumps do not actually collide.

## state/full ETag cost (2026-08-31)

Hashing the tree is the most expensive thing a publish does. On a
realistic set (20 tracks x 4 heavy devices, 41,734 elements) it was
58.7 ms of Live's control thread, with a further 9.5 ms to split.

Two rounds of work, and **the second only became possible because the
first round's constraint was deleted**.

**Round 1 — the value could not move.** The checksum was a
cross-language contract: `v3StateFull.ts` recomputed it over a
reassembled multi-chunk bundle and rejected disagreements, and
`v3ChecksumParity.test.ts` pinned both sides. So the fold had to stay
bit-identical. What shipped was a faster *route to the same bytes*:
`_encode_tree_args` builds the typed stream with C-level `bytearray`
appends instead of a per-byte Python closure (58.7 → 35.4 ms), and
`_ChecksumMemo` caches `(tree_args, checksum)` per scope so an
unchanged tree is recognized by a C-level list compare (0.26 ms).

**Round 2 — protocol 3.6.0 removed the contract.** With the tree
arriving as one message the UI never recomputes anything; it stores
the token and echoes it back as an ETag. Only two properties are still
required, both local: stable within a session, and collision-resistant
enough. `_compute_checksum` is now `md5(repr(tree_args))` truncated to
int31 — measured **40.3 → 3.8 ms** on the same set (3.0 ms `repr` +
0.7 ms `md5`; the fold itself is nearly free now, `repr` is the whole
cost). `pickle.dumps` in place of `repr` measures 1.4 ms and was not
taken: the memo already makes the common case free.

> The "0.7 ms" figure that circulated during the transport program is
> the md5 fold **alone**, not the digest end to end. Measure the whole
> function.

Realistic-set end-to-end publish, `test_state_full_scale_bench.py`
(round 1 numbers; round 2 takes another ~30 ms off the cold path):

| path | before | after |
|---|---|---|
| cold (tree changed) | 73.9 ms | 50.2 ms |
| repeat `accept` (unchanged tree, still ships) | 73.9 ms | 14.0 ms |
| `structural` on unchanged tree (skipped) | 73.9 ms | 4.2 ms |

The last two are dominated by `_build_payload` (~4 ms), i.e. the LOM
walk itself — the debounce, not the memo, is what cuts those.

Two behavior notes:

- The short-circuit compares **trees**, not checksums. The old
  31-bit comparison could collide (~1 in 2^31) and silently suppress
  a real update, leaving a stuck UI with no error anywhere.
- The memo is bounded (`_CHECKSUM_MEMO_MAX_SCOPES`, 32). Scope keys
  are track paths, so a long session that adds and deletes tracks
  keeps minting them; the predecessor dict was unbounded but only
  held an int, so the leak was invisible. Entries now carry a tree
  snapshot, so it is not.

## Client-declared ETag — protocol 3.5.0 (2026-08-31)

The surface used to decide whether to re-ship the tree from
`_last_checksums` — what *it* last sent. That is the wrong question
twice: on reconnect the UI may have dropped state, and with two UIs
connected (Mac + iPad hold independently-aged trees) one client's
history cannot answer the other's. Which is why `accept` and `resync`
had to be excluded from the skip entirely, and every tab-wake
re-shipped the whole tree.

Now the client declares what it holds:

- **`hello [versions…, "etag:0x…"?]`** — the token rides *inside* the
  version list, namespaced. `hello`'s args are an open-ended list of
  version strings, so a bare trailing checksum would be
  indistinguishable from a version. Namespacing makes it unambiguous
  both ways: a 3.4.0 surface fails to intersect it and ignores it; a
  3.5.0 surface strips it first. `extract_etag` / `parse_etag` in
  `V3StateFullComponent` do the splitting and are total — a malformed
  token means "declared nothing", which sends the tree.
- **`resync [sessionId?, "etag:0x…"?]`** — both optional, both absent
  before 3.5.0.
- **`state/full/unchanged [reason, generation, sessionId, etag]`**
  — sent instead of the tree. Rides UDP, not the stream: four small
  args that must still reach a client whose bridge has no TCP leg.

Three things to keep straight:

- **The surface never trusts the declared value.** It recomputes and
  compares. A client claiming a checksum it did not earn gets a tree.
- **`sessionId` on the marker is load-bearing.** There is no
  per-client channel — every emit fans out to every UI through the
  bridge — so a marker minted for the Mac also reaches the iPad, which
  must ignore it. Applying another client's marker would advance
  `generation` over a stale tree, which is silent corruption.
- **Only the state/full emit is suppressed.** `_emit_on_accept_chain`
  still runs every other seed (playhead, selection, arm, groove).
  Those exist precisely to repopulate fields `state/full` does not
  carry, so they are needed *more* on an ETag hit, not less.

The dangerous direction is a client claiming a tree it no longer
holds — the surface confirms it and the UI sits empty with no error
and no retry. The UI side guards this by clearing its ETag store
inside `resetForSurfaceRestart` / `resetTree` rather than at each call
site, and by recording an ETag only after a bundle applies cleanly.

Version constants that must move together:
`HandshakeComponent.SUPPORTED_VERSIONS`,
`DebugComponent.PROTOCOL_VERSION`,
`SurfaceHelloComponent.PROTOCOL_VERSION`, and the UI's
`UI_SUPPORTED_VERSIONS`. 3.5.0 was the **first bump that is not an
arity change**, and for one release the UI advertised two versions
because it could decode a 3.4.0 surface's bundles exactly as well.
3.6.0 took it back to one — see below.

## state/full is one message — protocol 3.6.0 (2026-08-31)

`begin → chunk… → end` collapsed to a single
`/looping/v3/state/full/tree [reason, generation, etag, scope,
*tree_args]`. The four header args are **positional and always
present**; `scope` is `""` for whole-song rather than an omitted arg,
so no parser infers meaning from message length.

Deleted with it: `_split_into_chunks`, both chunk budgets,
`_estimate_arg_bytes`, the chunk-gen counter, the FNV-1a encode/fold
pair, the UI's 453-line `v3StateFullReassembler.ts`, and
`v3ChecksumParity.test.ts`. All of it existed to fit a 9,216-byte
datagram, which the ordered TCP leg had already made unnecessary.

Three consequences worth knowing:

- **There is no UDP fallback.** A 389 KB message does not fit a
  datagram and the chunking that made it fit is gone. With no stream
  peer the publish logs a warning and returns, deliberately **without
  touching the memo** — otherwise `on_stream_peer_connected`'s
  republish would be skipped as a duplicate when the bridge dials in.
  That republish is the entire safety net; do not weaken it.
- **The ETag stopped being a contract.** See the cost section above.
  Nothing outside `V3StateFullComponent` derives the value.
- **Negotiating down is nominal for anything that reads the tree.**
  `SUPPORTED_VERSIONS` keeps its tail because clients that never read
  `state/full` still negotiate against it (the Swift menubar
  advertises only 3.3.0). But a pre-3.6.0 client that *wants* the tree
  cannot be served one at any floor — the addresses no longer exist —
  so the web UI advertises `["3.6.0"]` alone and takes a named
  `handshake-version-mismatch` instead of a silently blank UI.

## Track role in the Set — protocol 3.7.0 (2026-08-31)

Live has a **persistent per-track key-value store** and this is the
first thing in the project to use it:

```
Track.set_data(key: str, value: object)         -> None
Track.get_data(key: str, default_value: object) -> object   # default MANDATORY
Track.add_data_listener / data_has_listener / remove_data_listener
```

Probed at runtime, not inferred — `Track` and `Song` have it;
`Device`, `Clip`, `ClipSlot`, `MixerDevice`, `DeviceParameter` and both
`View` classes raise `AttributeError`. (The `set_data` docstring sits
in the binary's `Live.Track` string block *right beside* `Timer`'s, and
`Timer` resolves as `Live.Base.Timer`. Adjacency proved nothing.)

**Verified persistent, not assumed.** Wrote a marker, saved, gunzipped
the `.als`:

```xml
<ViewData Value='{"push-note-repeat-rate": 0.5, …, "looping.role": "drum"}' />
```

Four things worth not rediscovering:

- **The namespace is shared with Ableton.** Push and Move firmware
  write into the same per-track dict — `push-instrument-selected-notes`,
  `push-note-repeat-rate`, `move-note-repeat-enabled`,
  `alternative_mode_locked`. Hence `looping.role`: they prefix theirs,
  we prefix ours. Present in shipping 12.4.2 Suite, not beta-only.
- **Values keep their types.** str, int, float, **dict and list** all
  round-trip — the store serialises as one JSON blob per track. The
  role only needs a string, but a structured value is available.
- **Data survives a track duplicate**, so it is document state rather
  than a runtime side table.
- **Keys cannot be deleted.** There is no `delete_data`, and writing
  `None` *stores* `None` — `get_data` then returns it instead of your
  default. `V3StateFullComponent._track_role` runs the value through
  `_safe_str`, which is what collapses "never set" and "cleared" into
  the one wire value `""`. `str()` there would put the literal "None"
  on the wire as a role name.

What it bought: `trackRole.svelte.ts` re-derived "Drum rail or Perc
rail?" every session from a 2.46 MB catalog fetch plus a three-tier
guess (catalog membership → track color → Drum Rack class), purely
because there was nowhere to write the answer down. The answer was
already known upstream — `resolveAutoColor` computed the rail at load
time and threw it away as a color. Now `applyAutoRoleOnPrepareAck`
sends `/looping/v3/track/set_role` beside the color write, the surface
persists it, and it rides back on the T record (arity 13 → 14).

The reconstruction tiers were then **deleted outright** rather than
kept as a fallback (2026-08-31, Ben's call: "commit to the future, no
worries about older sets"). The gate was two tiers — the recorded
role, then a bare Drum Rack for a kit dragged out of Live's own
browser. Tracks predating 3.7.0 carry no role until reloaded. The rail
that gate fed went with ADR-431 (the Drum Buss is an FX-grid tile with
its own view), and the gate module, with no caller since, was deleted
2026-09-18. The role's one reader now is the strip's device band, as
its fallback when a track records no preset.

Two deliberate asymmetries:

- **`resolveAutoRole` has no brand fallback**, though `resolveAutoColor`
  does. Colouring an unrecognised Ableton preset yellow is a reasonable
  last resort; calling "Ableton" a *rail* is not, and a wrong role
  would outrank the catalog tier that could have answered correctly.
  `null` means "this load says nothing", and the caller then leaves any
  existing role alone.
- **`set_role` takes no generation.** Every other track write mutates a
  LOM attribute the UI is also rendering, so a stale write paints the
  wrong thing. A role is recorded *by* the load that just happened, on
  the prepare-ack path where a generation advance is already in flight.

## Loads name their Place — protocol 3.11.0 (onboarding.plan.md §6.3, 2026-09-26)

`components/live_library.py` reads the newest `Library.cfg` (every sidebar
Place, the User Library, the Packs), so `BrowserCache` resolves a path in
any of them with nothing typed into the config: the Place's `user_folders`
entry, the User Library for a Place inside it (which `user_folders` omits),
`browser.packs` for a Pack. `prepare_for_preset` (3, 4 or 6 args) and
`device/load` (3 or 5) take optional trailing `source` (`place:<name>` /
`library` / `pack:<name>`) and `rel` (the path inside it):
`BrowserCache.lookup_named` looks there first, by path second, and an empty
preset path is filled in from the Place's folder. A miss walks the root once
more, no more often than every 10 s, so a file Live has listed since loads.
Permute, MidiWheels and Random Start are the checkout's own (`live_library.device_path`,
found from this file's real path through the Remote Scripts symlink), loaded
as `place:Vamp Devices` + the path inside; an older config's
`devices.<name>.devicePath` is honored verbatim. `paths.placesRoots` and the
two `devicePath`s left `constants.json`; Random Start followed on 2026-09-27, and
the rig's `random-start.adv` override left its local file. Tests: `tests/test_browser_cache.py`
and the arg cases in `test_track_prepare_component.py`.

## Track preset in the Set — protocol 3.9.0 (ADR-439, 2026-09-15)

A second key in the same per-track store, `looping.preset`: the preset the
last `prepare_for_preset` load used (the catalog's `fullPath`),
replace-instrument mode included, **stored with the instrument that load
left on the track** — `{"path": …, "instrument": {"class": …, "name": …}}`,
`instrument` `None` on a chain with no instrument. It is the preset the
instrument views' swap pill steps from — folder-next loads the catalog
neighbor of the path with `target_track_path`, and that load records the
next one.

- **Written surface-side**, by `TrackPrepareComponent._record_preset`
  (`preset_record` in `TrackMetadataComponent`), right after
  `load_into_track` returns success and before the ack — unlike the role,
  which the UI sends after the ack. Only the surface knows the load landed,
  and a write inside the same handler call lands before the load's deferred
  structural republish walks the tree, so the next T record already carries
  it. `_finalize_audio_create` records the same way for the deferred audio
  create. A failed load, an empty prepare and an `.alc` clip record nothing;
  a chain that cannot be read after the load stores `None` and echoes `""`.
- **Echoed** as `/looping/v3/track/preset [trackPath, presetPath]`. There
  is no set verb: the load is the only authority.
- **Verified persistent**, like the role (2026-09-15): a load recorded the
  Wavetable `Default.adv` path, Live's Save wrote it into the track's
  `ViewData` in the `.als`, and after quitting Live and reopening the set
  `get_data` answered the same path.
- **On the T record** as its 15th field (`V3StateFullComponent._track_preset`,
  arity 14 → 15), read as totally as the role — `_LOM_ERRORS` and a stored
  `None` both come out as `""`.
- **On the T record** as its 15th field (`V3StateFullComponent._track_preset`
  → `held_preset`, arity 14 → 15): the path **only while the track's first
  instrument still has the recorded class and name**, else `""`. Worked out
  on every walk and never written after the fact. `set_data` is outside
  Live's undo history (measured 2026-09-15: after undoing four loads the
  track still named the last one), so a key cleared on undo would stay
  cleared through a redo; this reads `""` after the undo and the path again
  after the redo. `""` too for no record, a stored `None`, `_LOM_ERRORS`, a
  malformed value, a chain that cannot be read, and a bare path — the value
  3.9.0 first wrote, with no instrument to check.
- **A device renamed in place is a structural change.** Measured on the rig
  (Live 12.4.15b2, 2026-09-15): a native preset loaded onto a device of its
  own class keeps the device and renames it (Evo 01 → Evo 02 on one
  MultiSampler, `_live_ptr` unchanged), and Live's undo and redo of it only
  rename it back — none of the three fired the track's `devices` listener or
  republished anything. `LOMListeners` listens to every top-level device's
  `name` and fires the structural-change callback, which republishes the D
  record's name and the T record's `preset` — debounced, so a rename during
  our own load publishes after the record. Pad instruments are not covered:
  their renames are `DrumVirtualMacroComponent`'s.
- **Class and name, not `_live_ptr`**: undo and redo each handed back a
  device with a pointer the load never had.
- **What the check cannot see**, by construction:
  - **A plug-in's patch.** Every Omnisphere patch reads `AuPluginDevice` /
    `Omnisphere`; undoing a folder-next patch change took 35 undo steps and
    none changed the device, so the T record still names the undone patch.
    The way back is the pill's other half or the browser, not Live's undo.
  - **Two presets with one name on one device class** (the same file name in
    two folders).
  - **A track with no instrument** (an effect preset on an audio track): the
    record names none and reads as held while the track still has none.
    Nothing reads a preset there.
- A renamed instrument reads `""` from the next publish, and the swap
  control shows disabled until the next prepare load.
- A store that refuses the write logs a warning and records nothing; the
  load still acks, and the swap control shows disabled, which is the
  honest state.

The version constants moved together: `HandshakeComponent.SUPPORTED_VERSIONS`
(new head), `DebugComponent.PROTOCOL_VERSION`,
`SurfaceHelloComponent.PROTOCOL_VERSION`, the UI's `UI_SUPPORTED_VERSIONS`,
and the shot harness's copies in `scripts/shot/scene.mjs` / `capture.mjs`.

## Similar-sound swap — the surface half (ADR-439, 2026-09-15)

`components/DrumSwapComponent.py` owns the three verbs the bridge's swap
orchestrator (`interface/bridge/handlers/drumSwapSimilar.js`) sends around
the AX helper's presses of Live's own swap buttons. None waits for
anything: Live services an Accessibility press on its main thread — this
thread — so a handler that waited for the press would stall it.

- **`/looping/v3/drum/show_for_swap [requestId, rackPath, note]`** selects the
  rack's track and the rack (`song.view.select_device`), shows
  `Detail/DeviceChain`, and for a pad (`note ≥ 0`) selects the pad
  (`RackDevice.View.selected_drum_pad`) — Live's device view then shows that
  pad's chain, where the bridge presses its Drum Sampler's own swap buttons,
  which swap without playing the pad as the rack grid's buttons do — and moves
  `RackDevice.View.drum_pads_scroll_position` the least distance that puts the
  pad's row in view. Top-level racks only: `TrackView.Device[N]` is the N-th
  device of the selected track. The ack carries `deviceIndex` and the pad's
  `gridIndex` in reading order (which no longer addresses anything). It then
  notes each pad's chain and instrument name and opens Live's undo step for
  the swap. A selection Live refuses is `write-refused`, with no undo step
  opened.
- **`/looping/v3/drum/pad_names [requestId, rackPath, notes]`** answers each
  pad's first instrument name (to 64 characters, so two long stems sharing
  24 still differ), class and `_live_ptr`.
- **`/looping/v3/drum/finish_swap [requestId, rackPath]`** renames each chain
  in scope that was named after its instrument and whose instrument Live has
  renamed since, then closes the undo step — so one `Undo Next Similar`
  reverts the samples and the chain names together (measured 2026-09-15: 30
  samples and 29 names in one undo). A chain with a name of its own ("606
  Kick"), or one renamed mid-swap, is kept; one already naming the new
  instrument is left alone — a pad's own swap button renames its chain itself
  (measured on pads 36 and 51), so a pad swap leaves nothing to follow; with no
  swap open it touches nothing. A step no finish closes is closed by the next `show_for_swap`, on
  disconnect, or after `SWAP_UNDO_MAX_MS` (60 s).
- Replies keep a fixed arity, `[requestId, ok, code, detail, …]`; the bridge
  prefixes a surface code with `swap-`.

Measured on the Plymouth kit (Live 12.4.15b2): `drum_pads_scroll_position`
is the lowest visible row — it read 9, rows 9–12, notes 36–51, Live's default
view — and `gridIndex = (scroll + 3 − note // 4) · 4 + note % 4` is the order
of Live's SwapBar buttons: index 3 changed note 51 and only 51, index 12 note
36 and only 36, and note 67 scrolled the grid to 13 and swapped at index 3.
A kit Next or Previous is one undo step, `Undo Next Similar`. Those per-pad
SwapBar buttons also make Live play the pad, so a pad swap presses its Drum
Sampler's own buttons instead (ADR-439, "One pad through its Drum Sampler").

**A multisampled kit offers nothing to swap.** On the catalog's 32 Pad Kit
Jazz — 31 Simplers in Multisample Mode (`sample` reads `None`) and one Sampler
— Swap All presses and changes 0/32 pads, and every pad's SwapBar button is
disabled (a press answered `ax-control-disabled`). A pad swap now refuses a
Simpler or Sampler pad with `swap-not-a-drum-sampler` — but **not before
touching Live**: the check is at `drumSwapSimilar.js`, after `show_for_swap`
has already selected the track and the pad, scrolled the grid and opened an
undo step, because the pad's instrument class comes from `pad_names`, which
needs the rack resolved. The
"mapped" Packs copy wraps the same Drum Rack in an Instrument Rack, which these
verbs do not address (top-level Drum Racks only).

**Pad labels read the instrument where a swap renames it.** The census's
`pads[].name` (`drum_vm_resolve.pad_label`) is the instrument's own name on a
Drum Sampler or Simpler pad, because Live's Swap All renames each instrument and
leaves `DrumPad.name` on the old sample (a pad's own swap button renames the
chain as well — measured on pads 36 and 51): pad 38's chain read
`Snare-SessionDry-Stick-Hit-Soft` while its Drum Sampler read
`Snare-SessionDry-Stick-Hit-Medium`. An instrument still named `Drum Sampler`
/ `Simpler` (no sample yet) and every other class keep the chain's name — an
Operator or plug-in is named after the device, not the sound. A `name`
listener on those instruments (`DrumVirtualMacroComponent._attach_name_listeners`)
marks and schedules the usual re-seed, so a swap made with Live's own buttons
re-emits the census: measured 126 ms after the swap, carrying the new name.
A kit swap through the interface's swap row renames the chains too
(`finish_swap`); a Swap All made in Live's own UI leaves them.
**A rename is not the only shape a swap takes**, and the instrument `name`
listener only covers that one. Two more, with different signals:

- **A preset loaded into the whole rack** (DrumCell kit → Sampler kit)
  changes the rack's own `name` and **nothing else observable** — same
  `_live_ptr` on the chains, the pads, the devices and every
  `DeviceParameter`, the pad chains' `devices` listeners silent (measured
  2026-09-15). Nothing watched that name, so no re-resolve ran: the census
  kept the previous kit's pad classes and names, the Drum Rack view kept
  its profile, and the held values kept describing a kit that was gone.
  `_attach_listeners` now watches `name` beside `macros_mapped`, which is
  also what makes `_kit_replaced` reachable at all. A similar-sample swap
  renames the chains and the instruments but never the rack (ADR-439), so
  this fires on kit loads and not on swaps; renaming a rack by hand reads
  as a new kit, the documented cost of the name being the only signal.
  **The tree publisher watches the same name** (2026-09-16):
  `LOMListeners` holds a `name` listener on every top-level device (keyed by
  `_safe_int_id`, detached with the device) that fires the structural
  republish, so the D record — and the swap pill, which names the rack —
  follows a kit load. Before it the name reached the UI only when a
  selection-change republish carried it (leave the track and come back).
- **One pad's instrument replaced on its own** (a device dragged onto a
  pad) fires only that pad **chain's** `devices`. The component holds a
  `PadChainWatcher` (`DrumPadChainComponent`) for those, making it that
  class's third owner after `DrumPadChainComponent` and
  `SequencerComponent`; it replaces the hand-rolled `drum_pads` / `chains`
  pair rather than adding to it, and `_resolve` calls `refresh()` so a pad
  that gains or loses a chain gains or loses its listener. It does **not**
  see a whole-rack preset load — that is the bullet above.
Tests: `tests/test_drum_swap_component.py`, and the census and name-listener
cases in `tests/test_drum_virtual_macro_component.py`.

## Similar sounds for an audio clip — `clip/swap_file` (ADR-440, 2026-09-15)

Live has no similarity swap for a clip (every `SimilaritySwapButton` in the
binary belongs to a device view) and `Live.Clip.Clip` has no verb that changes a
clip's file. So the clip view's similar-sound pill ranks from Live's index
(`/api/similar-samples`, a SvelteKit route) and asks the surface to put the
chosen file in the slot: `ClipsComponent.handle_swap_file` on
`/looping/v3/clip/swap_file [requestId, clipPath, filePath]`, answering
`/looping/v3/clip/swap_file/reply [requestId, ok, code, detail]` — fixed arity,
never the error channel, except a request with no id to answer.

- **Checks come first** — the file is on disk, the slot holds an audio clip, it
  is not recording, and **the clip's own `file_path` reads** — so a refusal
  touches nothing. That last one is the put-back's precondition rather than the
  swap's: `_put_back` needs the old path and returns False without it, and
  `_read_file_path_safe` answers `""` for a raising read as well as for a clip
  Live names no file for, so without the check a `load-failed` on such a clip
  left the slot empty and the take gone, recoverable only by Cmd-Z. There is no
  way back from a `delete_clip` you cannot reverse, so the honest answer is
  `clip-file-unknown` **before** the delete.
- **Then one undo step:** `delete_clip`, `create_audio_clip`, the old clip's
  `_CARRIED_CLIP_SETTINGS` written onto the new clip in order (`warping` before
  `gain`), its name when that was not its file's stem, `slot.fire()` when it was
  playing or queued **and the transport is running**, and `detail_clip` when it
  was the clip Live showed. The step closes in a `finally`, and an unexpected
  raise still answers.
- **Live keeps a clip marked playing while the transport is stopped:** the
  rig's "8ths" clip read `Clip.is_playing` True with `Song.is_playing` False, so
  a fire keyed on the clip alone would start a stopped set. Swapped while
  stopped, the new clip stays stopped.
- **The name rule matters on the rig:** the Shaker track's clips are named
  "8ths", "16ths" and "16ths 2" after their rhythm; only the `Quarters.wav`
  clip reads its file's stem, so only it takes the new file's name.
- **A file Live will not load puts the old one back** with the same settings,
  still inside the step (its loop points go with the deleted clip), and answers
  `load-failed`.
- A setting Live refuses on the new clip is named in an `ok` reply's `detail`
  (`"not kept: gain"`).

**Measured in Live** (12.4.15b2, 2026-09-15, through the bridge, on the Shaker
track's "16ths" clip with the transport stopped): the reply came back ok in
42 ms; the slot held the new file under the name "16ths" with all thirteen
settings as they were and the new file's own loop end (4.0 where the old read
8.0); the clip was not launched; Live showed the new clip. One `song.undo()`
answered `Undo Custom Action` and put back the old file, the name, the loop end of
8.0 and every setting — the whole swap is one undo step, and that undo restores the
deleted clip's loop points too. The transport rule was confirmed by hand once a
restart had loaded it. **Not yet measured:** a relaunch while the transport
runs, and the gap it leaves.
Tests: `tests/test_clips_swap_file.py`.

## Bridge↔surface TCP leg (2026-08-31)

`tcp_transport.py` binds a second, ordered transport on port 11022
**beside** the UDP pair, not instead of it. UDP stays because
fire-and-forget senders on ephemeral ports (the Max probe drivers)
need a datagram socket regardless.

Only `state/full` moved across, because it is the only message whose
size the 9,216-byte darwin datagram ceiling actually constrains —
389 KB on a realistic set, which forced ~99 chunks, an FNV-1a
checksum, and a 453-line reassembler on the UI side. Protocol 3.6.0
then deleted all three, which makes this leg the tree's **only** wire.

Four things worth not rediscovering:

- **Threadless works, comfortably.** Measured 2026-08-31 writing only
  from the surface's real 92.8 Hz pump: 389 KB clears in **1 pump /
  0.14 ms**, the 1.22 MB pathological case in 3 pumps / 24 ms — both
  inside one 99.4 ms tick. The migration plan budgeted for a ~1 kHz
  pump and worried 10 Hz would be marginal; the actual rate makes the
  question moot, because the inner drain-until-EAGAIN loop moves far
  more than one buffer per pump when the reader keeps up. No threads
  were needed.
- **The chunking survived the transport change, then went.** Over TCP
  the budget was effectively unlimited, so for one step the bundle
  shipped as `begin` + one chunk + `end` and the UI needed no change.
  Protocol 3.6.0 removed the framing entirely — see the section above.
- **The wire is probed per publish, not cached.** A peer that comes or
  goes changes the *next* bundle rather than half-committing the
  current one. Since 3.6.0 "no peer" means the tree is not published
  at all; the republish on connect is what makes that safe.
- **`scripts/cleanup.sh` must never list 11022.** Its port sweep is
  `kill -9`, and the process holding 11022 is Ableton Live. The sweep's
  repo-cwd filter would spare Live today, but the port list names ports
  this repo's servers own, and Live is not one of them.

The bridge dials in (`interface/bridge/transport/SurfaceTcpClient.js`)
and redials with backoff after a Live restart. That reconnect is new
work TCP creates: UDP was connectionless, so a Live restart used to be
invisible to the bridge.

`/looping/probe/drain_stats` reports the TCP leg's state under a `tcp`
key — connection count, frames in/out, pending outbound bytes, drops.

## Track creation pipeline (2026-04-26)

UI-initiated track creation runs through a single atomic endpoint
owned by `TrackPrepareComponent`:

`/looping/v3/track/prepare_for_preset [request_id, track_type, preset_path, target_track_path?]`

The optional 4th arg `target_track_path` (`tracks/<N>`) is
replace-instrument mode (ADR-390): it pins the load to that exact
track, bypassing reuse-vs-create so Live swaps the instrument in
place (clips / Permute / FX preserved). Empty/absent = auto. The
component decides reuse-vs-create against authoritative LOM
reads (no UI store snapshot — no staleness window), creates the
track if needed, runs audio routing/arm via `schedule_delayed` so
Live's audio-track template settles first, loads the preset via
`DeviceLoadComponent.load_into_track`, appends Permute (idempotent —
skipped when already present), and replies with one
`/looping/v3/track/prepare_for_preset/ack` carrying the same
`request_id`. A bounded LRU (64 entries / 30s TTL) makes
retransmits idempotent — a flapping WebSocket can't spawn duplicate
tracks.

**The metronome track is protected by content, not position (2026-09-21).**
`_is_reusable` already refused track 0 as a reuse/create target (ADR-385:
"keep the first track clean") — which is *why* the user's metronome track
had always been safe sitting there, purely as a side effect. Grouping it
moves it off index 0, and the position-based rule doesn't follow it.
`_is_metronome_track` adds a second, structural exclusion: any track
holding an Instrument Rack whose macro 1 reads "Pattern N" (`_PATTERN_MACRO_RE`)
— in practice the Skaka Metronome Rack, which generates its own notes off
the transport and so carries no clips of its own, making it otherwise
indistinguishable from a genuinely empty track. Deliberately the same test
`macroLayoutUtils.isPatternRackMacroName` uses to route the UI's Pattern
Rack central view, not a literal name match on the rack or the track — a
resave from Live's own preset browser can drift the device's own name.
Mirrored in the UI at `clipStateStore.svelte.ts`'s `isMetronomeTrackFromV3`
(the `emptyMidiTracks`/`emptyAudioTracks` picker lists). That UI copy is
advisory; this component is the authority, same as the
group-track guard beside it.

**`.alc` clips (ADR-394):** an `.alc` (Ableton Live Clip) preset_path
takes a distinct branch. Live's Browser preserves clip metadata
(warp/loop/gain) but *always creates its own track* for the clip and
ignores `highlighted_clip_slot`. So `TrackPrepareComponent` doesn't
create a track — it calls `DeviceLoadComponent.load_clip_new_track`
(snapshot tracks → `browser.load_item` → return the new track), then
preps that track and acks. Pack clips that miss the User-Library
`BrowserCache` resolve via a bounded walk of `browser.packs`/`clips`.
**A symlinked clip is looked up at its target** (`resolve_clip_item`,
2026-09-24): Live's browser lists no symlink, so the 190 accapella clips
linked into the User Library (from `Samples Organized`, a Place in
`paths.placesRoots`) all answered `not-in-browser` and fell back to a raw
sample the resolver could not find — 0 of 190 loaded, through v1's
`Audio Samples` links as through the Places copy. Measured after, on the
rig: **190 of 190 load as real clips** through the Place's browser item,
the old binary format included (Live reads it at home); 174 with their
audio, 16 whose audio is no longer on disk (they load silent). The
fallback's upward walk likewise starts from the clip's real folder, then
the link's (0 → 79 of the 190 resolvable).
**`BrowserCache` compares names the way Live writes them**
(`browser_name`): Live's browser shows a POSIX colon as a slash
(`Hicks' Farewell (F#) (3:4).alc` reads `(3/4)`) and an accent spelled
with a combining mark (NFD on disk) as the composed character — 5 of the
45,415 loadable files in the Places missed the cache for it, two of them
Omnisphere presets; all 5 load since.
Falls back to a raw-sample audio clip (via `alc_resolver.resolve_alc`)
if the BrowserItem can't be found. The `.alc`→sample resolver is pure
stdlib in `components/alc_resolver.py` (gunzip → parse `<SampleRef>` →
upward filesystem walk → the installed pack); `AlcClipProbe` +
`owner/probes/alc_clip_probe_run.js` verify metadata survival against live Ableton.
**A pack clip copied out of its pack resolves through the Packs folder
(2026-09-24).** A factory clip's reference is relative to its pack's root,
which the upward walk only finds while the clip sits inside the pack — as
the old `Audio Samples` links did. The Places are clones, so from the
Sidebar the walk reaches nothing: 908 of the Places' 1,099 clips (Vinyl
Classics, Retro Synths, Cyclic Waves, The Forge) answered `no-file-path` to
every Simpler load, measured on the rig. The last step is now
`<paths.abletonPacksBase>/<LivePackName>/<relative path>`, the pack name
never read as a path; `LoopingSurface.__init__` sets the root
(`set_pack_roots`) for every caller — Simpler, slot load and track prep. The
web side's mirror (`routes/api/sample-peaks/alcResolver.ts`, waveforms and
the catalog's thumbnail bake) takes the same root from its callers. 987 of
the 1,099 resolve now; the rest are 92 old-binary clips (Live reads those
itself) and 20 whose audio is gone.

Permute placement (2026-04-30): the UI no longer fires a follow-up
`/looping/v3/device/load` after the prepare ack. The same Python
component that owns the create-or-reuse decision also owns the
Permute append, so a single round-trip leaves the track ready and
the broadcast wire double-load (multiple WS clients each firing
their own follow-up) is structurally impossible. Foot-pedal hold
continues to append Permute inline via `FootTriggerComponent` — it
has its own `song.create_audio_track` call and bypasses
`prepare_for_preset`.

Browser-tree resolution goes through `BrowserCache` (built lazily
per root: User Library + each Place), making preset lookups O(1)
after the first miss. This eliminates the multi-second freeze the
per-call descent previously caused on heavy User Libraries.

**LOM identity is `_live_ptr`-based, never `is`-based.** Live's v3
framework hands out a fresh Python wrapper per attribute read, so
`song.view.selected_track is song.tracks[i]` always returns False
even when both reference the same LOM track. Compare via
`_safe_int_id(obj)` (`components/LOMListeners.py:1352`) — same
pattern `ExclusiveArmComponent._same_track` and
`path_resolver.same_lom_handle` (`:763`) use. Prefer
`same_lom_handle` for a plain "are these the same LOM object?"
check; it is the shared public helper. ADR-350 documents the
production bug this gotcha caused in `TrackPrepareComponent`.

The historical `/looping/v3/track/{create_audio,create_midi,
ensure_devices}` wires were retired in the same change; the
`/looping/v3/track/created` event still fires from
`FootTriggerComponent` for the foot-pedal hold gesture but no UI
listener consumes it any more — Permute lands on the Python side
in both that path and the prepare path. `DeviceLoadComponent` no
longer falls back to `song.view.selected_track` when `trackPath`
is empty — such loads now reject with `track-not-found / empty-path`,
making the "instrument lands on wrong track during selection echo
lag" bug structurally impossible.

## The groove chooser (2026-09-29, issue #1)

Live's API cannot set a groove's pattern, so `/looping/v3/clip/groove/set/file
[clipPath, name]` (`GrooveComponent.handle_set_file`) puts a clip on a Core
Library groove file by claiming a groove that holds it: a free one of that
pattern, else one loaded by name (`DeviceLoadComponent.load_core_groove` →
`BrowserCache.find_leaf("pack:Core Library", "Grooves", name + ".agr")`). It
then writes the clip's four amounts back, because a loaded file brings its own,
and names the groove it left free again. **The pattern lives in the pool
entry's name** — `<track> <scene> · <pattern> #<pathHash>` for a claim,
`unassigned-<idx> · <pattern>` for a free one (`GroovePoolComponent`,
`parse_groove_name`) — since a claim used to rename it `Clip_<pathHash>` and
erase it. Ownership is the hash; the label is for a person reading Live's pool.
A free groove is reused only for its own pattern. A groove of the user's own is
named `User: <file>` (`USER_GROOVE_PREFIX`) and loaded from the User Library's
`Grooves` folder (`find_leaf("library", …)`), so it can sit beside a Core Library
file of the same name. `/looping/v3/clip/groove/file`
echoes the focused clip's pattern (`""` when none is named). What was measured
is in `docs/reference/live-api-measurements.md` ("Groove pool and groove files").
Tests: `tests/test_groove_component.py`, `tests/test_groove_pool_component.py`.

## Group Tracks (ADR-410, 2026-07-27)

`TrackMetadataComponent` owns the fold wire —
`/looping/v3/track/fold_state` (Surf→UI) and
`/looping/v3/track/set/fold_state` (UI→Surf) — and
`V3StateFullComponent` carries `isFoldable` / `foldState` /
`groupTrackIndex` on the T record (arity 10 → 13, protocol 3.4.0).

Three LOM traps, all verified against Live 12.4.5b8 by probing the
running set (`owner/probes/lom_introspect_probe.js` / the generic
`/looping/probe/lom_introspect` address) — Cycling '74's
LOM docs did not list `fold_state` at all:

1. **`fold_state` raises on a non-foldable track.** Not absent —
   raising. `getattr(track, "fold_state", False)` does *not* swallow
   it. Gate on `is_foldable` first, or read through
   `_safe_getattr`.
2. **`Track` has no `add_fold_state_listener` and no
   `add_is_visible_listener`.** Folding in Live's own UI fires
   nothing track-side. The signal is song-scoped
   `Song.add_visible_tracks_listener`, which does exist and does fire
   on a fold; the component diffs foldable tracks against a
   `track_path → 0|1` cache so add/remove fires and self-writes
   dedup to nothing. The write path emits its own echo (there's no
   listener to produce one) — same shape `Groove.base` needs.
3. **A group reports `has_audio_input == True`** with
   `can_be_armed == False`, and its `clip_slots` are never
   `has_clip`. So it looks exactly like an *empty audio track* to any
   reuse scan. `TrackPrepareComponent._is_reusable` has guarded this
   since ADR-385; the UI side now does too.

Folds deliberately **do not advance generation** and do not trigger a
`state/full` — the LOM tree is unchanged by a fold, and the UI
recomputes hidden strips from the group tree it already holds.

## Performance capture — auto-record + save-as (2026-07-06)

`PerformanceCaptureComponent` observes `song.is_playing` and, when the
`auto_capture` toggle is on, arms Live's arrangement record
(`song.record_mode = 1`) on transport start and, on transport stop,
disarms it, rewinds the Arrangement start marker, and emits
`/looping/v3/session/save_as_request [tempo, sigNum, sigDen]` to the bridge
(which pops Live's native Save As dialog — Live's LOM has no save-as verb).

**Start-marker rewind on stop (2026-08-19).** The Stop edge also parks
`song.start_time` one bar before `song.last_event_time`, floored to a bar
line, so the next Play resumes at the end of the take with a bar of lead-in
instead of restarting at 1.1.1. Bar length is `sig_num * 4 / sig_den` beats;
the math is the pure `compute_rewound_start()` free function next to the
component. Two facts read off the Live 12 binary's own LOM docstrings, not
Cycling '74's LOM docs:

- `last_event_time` is "the time of the last set event in the song" with
  **no** display padding — `song_length` is the one that adds extra beats
  for the arranger view, so it is the wrong property here.
- `start_time` is settable, but "the set time **may be overridden by the
  current loop/locator start time**" — with the Arrangement loop switch on,
  Live starts from loop start no matter what we write.

The write is deferred like the `record_mode` writes (same notification
rule) and is scheduled *before* the save-as emit goes out, so the marker is
already parked when the user commits the Save As dialog. It rides the same
ownership check as the rest of Stop cleanup, so it only fires for takes this
component armed — an empty Arrangement (`last_event_time <= 0`) leaves the
marker alone.

**Gate: the `auto_capture` toggle, not the launch mode directly.**
`compose_capture_gate(session_settings)` reads
`SessionSettings.should_auto_capture()`. That toggle's *default* is
launch-mode-derived — `SessionSettingsComponent.seed_auto_capture_default`
is called from `ServerPresenceComponent`'s `on_first_mode` callback when
the first heartbeat reveals `mode` (ipad→on, dev→off) — but it is then
fully user-overridable from the web UI or the `owner/menubar` app. So a
dev session can force capture on and an ipad set can force it off. A user
write commits the value so a late mode seed can't clobber a deliberate
override. (Historically the gate was `is_ipad_present()` directly; the
mode check moved into the toggle's default seed so the behavior became
overridable — mirrors `compose_auto_arm_gate`.)

**Persistence.** A set load reconstructs the whole surface, so
`SessionSettingsComponent` persists `auto_arm` / `move_volume_knob` to
`logs/session-settings.json` (reloaded on `__init__`) — user overrides
survive set loads / restarts. `auto_capture` is deliberately **not**
persisted surface-side: it re-seeds from the launch mode each init.
Because a set load *is* a surface teardown, the surface alone would
reset an override on every set load — so the **bridge** carries it
across (ADR-405,
`interface/bridge/handlers/autoCaptureOverride.js`): it remembers the last
client write for its process lifetime and replays it over a conflicting
surface emit. Net: an override survives set loads / Live restarts and
resets to the mode default when the dev/ipad script restarts — which
preserves the dev↔ipad staleness guarantee, since a mode switch is a
script restart. No surface code changed for this (no Live restart needed
to pick it up).

**Deferred writes.** `record_mode` cannot be set inline in the
`is_playing` notification — Live raises *"Changes cannot be triggered by
notifications. You will need to defer your response."* The component hops
the arm/disarm writes to the next tick via `schedule_delayed`
(`LoopingSurface._schedule_delayed`). Ownership (`_armed_by_us`) is
claimed at decision time so a stop that lands before the deferred arm
still runs cleanup + save-as.

Edge-driven — it won't retro-arm a transport that was already playing
when the toggle turned on. See `docs/reference/toggles.md` for the full
map of gated behaviors and `docs/reference/wire-protocol.md` §2.12/§2.14.

**Borrowed for a moment by the Group gesture (2026-09-21).** `record_mode`
being on for the whole time the transport plays is exactly what makes Live
refuse to reposition a track mid-take ("Live cannot move a track that is
currently recording") — which blocks the Group-Tracks gesture (see "Group
Tracks" below) whenever it actually needs to move something. A separate,
tiny component, `RecordSuspendComponent`, answers two bridge-only
request/reply verbs (`/looping/v3/track/group/record_suspend` /
`.../record_resume`) that turn `record_mode` off and back on around one
bracketed reposition. It holds no listener of its own and this component
never notices: the bracket starts and ends with the transport still
running, so `is_playing` never fires and `_armed_by_us` ownership is
untouched. The cost, paid only when a reposition is actually happening
(the bridge decides that from track contiguity before ever asking): a gap
in whatever a recording track captures, the length of one Group gesture.

## Permute step telemetry

`/looping/v3/permute/step [devicePath, kind, step]` comes from
`SequencerComponent` (below), for every Permute device. Until 2026-09-26 a
second emitter, `PermuteStepComponent`, translated the fat device's private
`/looping/permute/step` ingest (ADR-406); it went with the fat device and the
`sequencer_engine` switch between the two. Step position is telemetry, never
a parameter: the fat device's "Mute Current"/"Pitch Current" params never
fired value-changed ("Visible (Not Stored)"), which is why this is a wire.

## Wah pedal and MidiWheels on MIDI tracks (WahPedalComponent, ADR-407 → ADR-445)

The expression pedal reaches the surface exactly like the foot pedal — its
MIDI arrives either USB-direct on the surface's own MIDI input
(ADR-422, primary: **CC 21** toe-switch, **CC 20** expression, both on
**channel 10** — see "Pedal MIDI input" below) or via a Max ctlin→OSC
patch firing straight to 11020 (wireless/legacy fallback, still on the
old CC 82 / CC 11) — no bridge, no generation, no `trackPath`
either way. `WahPedalComponent` owns the two wires (their addresses keep
the `wah` name) and, since ADR-445 (2026-09-19), drives **one of two
devices by the kind of track under the selection**:

- **Audio track → the Wah** (`Wah.adg`, an Audio Effect Rack,
  `constants.devices.wah`) — exactly as before.
- **MIDI track → MidiWheels** (`Vamp Devices/MidiWheels.amxd`,
  `constants.devices.midiWheels`, since 2026-09-25): the pedal sweeps its
  Mod Wheel parameter (CC 1) into the instrument behind it — the same
  device the on-screen wheels load, so one per track and the last one moved
  wins. Before, this was the **Expression Pedal** rack (`Expression
  Pedal.adg`): one chain holding `Modwheel Sender.amxd`, Macro 1 mapped to
  its dial, Macro 2 mapped to nothing. Both files are still on disk and
  nothing loads them.
- **A wah already on the selected track wins on either kind.** That is how
  a wah goes on a synth: the Pedal central view's **Wah button** loads one
  through the FX tiles' `device/load` — which the surface lands at the head
  of the audio effects for this one preset, the pedal's own placement —
  and from then on the pedal is the wah until the button (held) removes it
  through `device/delete` and hands the pedal back to the rack. The pedal
  never summons a wah onto a MIDI track by gesture.
- **No `midiWheels` block** in constants → the wah everywhere, the
  pre-ADR-445 rig. A block without a `devicePath` drives a MidiWheels that
  is already there but cannot load one, like the wah's.

Both take the same handlers through a `_PedalTarget` — the value the
expression pedal sweeps (the wah's Macro 1, MidiWheels' Mod Wheel) and, on
the wah only, the chain selector the toe switch steps (Macro 2;
`toggle_index` is None on MidiWheels, so engage on a present one does
nothing):

- `/looping/v3/wah/engage` (arg-free) — the track's rack absent on
  `song.view.selected_track` → load its preset (loads enabled); present →
  **step Macro 2** (`toggleMacroIndex`, `parameters[2]`) to the next chain
  in the rack. The step table is `len(device.chains)` values spread evenly
  across the macro's own `[min, max]`, rounded to whole macro units — 2
  chains → `0, 127`; 3 → `0, 64, 127`; 4 → `0, 42, 85, 127` — and each engage
  snaps to the step nearest the macro's current value then advances one,
  wrapping past the last. Even spacing (not a fixed increment) is what lands
  each value inside its own chain-selector zone: Macro 2 is mapped across
  the selector's `0..n-1` range and Live gives auto-created chains equal
  zones, so `0, 48, 96, 127` on a four-chain rack would put two steps in one
  zone and skip a chain. A rack with < 2 chains — or a `chains` read that
  raises — falls back to the pre-stepping 0↔max flip across the 63.5
  midpoint. A freshly loaded **wah** lands at the head of the track's audio
  effects (ADR-094's intent) *by the load itself*: `load_into_track(...,
  at_head=True)` selects the first audio effect and sets the track's device
  insert mode to "left of the selection" for the call (ADR-437); **MidiWheels**
  takes the plain load — Live puts a MIDI effect ahead of the
  instrument on its own. Neither is ever moved afterwards — undoing the move
  of a device Live had just loaded aborts Live (measured 2026-09-14) — and a
  hand-placed rack is never touched. **The FX grid has no WAH tile**
  (`device-panel/WahControl.svelte` was mounted nowhere and was deleted in
  audit item 33); the Pedal view's button is the one UI door, and it sends
  the same `device/load [trackPath, "", presetPath]` the tiles do rather
  than an `engage` — the button knows its `trackPath`, the pedal does not,
  and the ADR-350 selection-lag bug must stay impossible. The chain count
  never reaches the wire (`RackDevice.chains` isn't in the v3 record), so no
  UI could compute the step table; stepping stays the toe switch's.
- `/looping/v3/wah/freq [0-127]` — write the rack's value macro (Macro 1,
  `freqMacroIndex`). Value is the raw macro value clamped to `[param.min,
  param.max]` (0-127 CC → 0-127 macro, 1:1). **The sweep is scoped to the
  selected track** (ADR-407 revision, 2026-07-24): a `selected_track`
  listener drops the cached macro on every selection change, so the pedal
  always drives the rack on the track in view and never keeps writing an
  old track's macro after you navigate away. **It is also dropped on any
  track's device-list change** (`on_track_devices_changed`, fanned out from
  `LOMListeners`' add/remove callbacks in `LoopingSurface`): a wah the button
  just put on the selected MIDI track takes the pedal over on the next frame
  with no track switch, and a rack the pedal loaded is found the moment Live
  shows it — pure Python state, one chain walk per structural change, and
  it fires harmlessly for every device on the startup walk.
  **Sweep-to-load**: on a track without its rack the value isn't discarded —
  it feeds two latches, one per end of the CC range, and once both have been
  seen (either order, within the rack's `sweepLoadMargin` of 0 and 127) the
  component loads the preset at the same place the toe switch does: the wah
  on an audio track, MidiWheels on a MIDI track. The point is
  that your foot is already on the pedal mid-phrase; a full heel-to-toe
  rock is a gesture nothing else produces by accident, and a partial sweep
  — however wide — never fires. The latches are dropped on a selection or
  device-list change, and the rack is in `track.devices` when the load
  returns, so a half-sweep can't summon a rack onto the track you just moved
  to and a fast rock-back finds the rack instead of stacking a second copy.

**Surface-owns-context, same as `FootTriggerComponent`** — that's the
whole point. A standalone Max client can't know the selected track or
where the rack landed in the chain (that state only rides the
surface→bridge broadcast path; `osc_transport` deliberately does NOT
last-sender-win broadcasts back to ephemeral senders — see
`osc_transport.py` `poll`). So the component reads `selected_track` and
`has_midi_input` itself (a raising read counts as audio, the wah) and
re-finds the rack by `class_name` + `name` (mirrors `fxGridStore`'s
match), caching the value macro for the hot sweep and re-resolving
against the selection when a cached ref raises, the selected track
changes, or a device list changes (guarded detach on `disconnect`, same
idiom as `SelectedTrackComponent`/`ExclusiveArmComponent`). Sending raw
`device/load` + `param/set` from Max was the rejected route: it forces
Max to track selection + the append index, and repeat `device/load`
stacks duplicate racks (append, no dedupe).

Config lives in `constants.devices.wah` (`presetPath` / `className` /
`deviceName` / `freqMacroIndex` / `toggleMacroIndex` / `sweepLoadMargin`)
and `constants.devices.midiWheels` (`devicePath` / `className` /
`deviceName` / `modParamIndex` / `sweepLoadMargin`, read through
`MidiWheelsComponent.read_midi_wheels_config`) so the devices,
macro indices and sweep tolerance are tunable without code — verify the
indices against a live dump (`parameters[0]` is Device On, macros follow
at `[1..]`). Load reuses the lazy `load_into_track` closure in
`LoopingSurface` — `(track, preset_path, at_head)`, `at_head` per rack
(DeviceLoad ordering / 12.3.7 gate safe). `DeviceLoadComponent` is built
with `head_preset_paths=[devices.wah.presetPath]`, so a wire-level track
load of the wah lands at the head too (`loads_at_head`). Tests:
`tests/test_wah_pedal_component.py` (the ADR-445 block at its end) and the
wire-level head tests in `tests/test_device_load_component.py`.

## Pedal MIDI input — USB-direct (ADR-422)

With the pedal plugged in over USB and its port assigned as the
Looping control surface's MIDI **Input** in Live's prefs (Output stays
None; turn the port's Track/Remote switches off so the expression CC
can't leak into armed tracks or MIDI mapping), the surface receives
the pedal CCs itself — no Max, no OSC hop:

- `components/midi_pedal_input.py` (`MidiPedalInput`) is the plain-
  Python translator: CC parsing scoped to exact `(channel, CC)` pairs
  (the foot switch on its own learned channel, the wah on
  `midiPedals.channel`, 10 — other traffic isn't claimed and falls
  through; channel `0` restores the omni parsing the old `ctlin` did), edge
  detection (both switches split high from low at value ≥ 64 — the
  retired Utility patch's literal `> 0` edge latched down on a pedal
  whose "off" is a low non-zero value), and the 500ms
  tap/hold state machine ported from `owner/Max Patches/foot-trigger.js`
  (press debounce, hold-suppresses-tap, press-seq guard against stale
  scheduled checks, plus a release-time clock check that keeps the
  tap/hold boundary exact despite `schedule_message`'s ~100ms tick —
  measured 99.44ms, see "Inbound drain" above).
  Fully pytest-covered (`tests/test_midi_pedal_input.py`) — the Max
  ES5 timing never was. **The two switches read those edges
  differently.** The foot switch is momentary or latching
  (`FootMapping.mode`, which Learn detects). Momentary: one side of 64 is
  a press (high on most switches; Learn records `press_high` for one
  that presses low), the other a release, and the gap between them is
  the tap/hold timer. Latching: every stomp is a tap and there is no
  hold — read as momentary, a latching switch made every first stomp a
  hold. The wah
  toe switch **latches** — one physical press flips it 0 → 127, the
  next flips it back — so *both* edges fire engage. Edging on the
  rising side alone advanced the wah's chain on only every other
  press. A repeated same-side level is still collapsed into one edge,
  so a pedal that streams its state engages once per change.
- `LoopingSurface` owns the framework half: `build_midi_map` forwards
  the adapter's `forwarded_pairs()` — exact `(channel, CC)` pairs — via
  `Live.MidiMap.forward_midi_cc`, so the script claims exactly what it
  will act on (every CC on every channel only while Learn listens) (Live only delivers MIDI a
  script claims — the element tree is empty, so the base class claims
  nothing) — and `receive_midi` /
  `receive_midi_chunk` route owned CCs to the adapter inside
  `component_guard`, everything else to the base class.
- The resolved gestures call the **same** `FootTriggerComponent` /
  `WahPedalComponent` OSC handlers (`source_addr="midi:pedal-input"`
  in Log.txt), so `/looping/v3/foot/*` + `/looping/v3/wah/*` stay live
  as the fallback path and semantics keep a single owner.
- **The foot switch is a user setting (2026-09-26), not config.**
  `components/FootSwitchComponent.py` owns it: on/off and **Learn** from
  the System view's Foot Switch card, persisted to
  `<repo>/logs/foot-switch.json` (its own file — `SessionSettingsComponent`
  rewrites `session-settings.json` whole). Learn calls
  `MidiPedalInput.start_learn`: the adapter forwards every CC for up to
  10 s, takes the first as the channel + CC, and names the mode from what
  follows — the opposite side of 64 on the same CC within 1.5 s is a
  momentary switch's release, nothing is latching. Teaching fires no
  gesture. Nothing heard is `timeout`, which the card turns into "set the
  pedal as Looping's Input in Live". Every mapping change and learn
  start/stop asks Live to rebuild the MIDI map (`_request_midi_rebuild`).
  Wire: `/looping/v3/session/foot_switch [enabled, channel, cc, mode,
  learn, heard]` out; `…/foot_switch/enabled [0|1]` (on with nothing
  learned starts a learn) and `…/foot_switch/learn [0|1]` in. With nothing
  saved it is seeded from `midiPedals.footSwitchCC`; with neither there
  is **no** foot switch — before this a missing key fell back to CC 23, so
  a keyboard picked as the Input fired looper taps.
- **The wah CCs exist only while `features.expressionPedal` is on**
  (`config_loader.feature_on`, the surface's half of the bridge's
  `readFeatureFlags`: only an explicit `true`). Off, `LoopingSurface`
  passes no wah callbacks, so the adapter claims neither CC; the OSC wah
  wires stay. The general edition leaves it off.
- Channel + CC map live in `constants.midiPedals` (`channel` 10,
  `footSwitchCC` 23 (the seed), `wahToeSwitchCC` 21, `wahExpressionCC` 20 —
  measured off the USB pedal 2026-08-27; 67 / 82 / 11 were the retired
  Bluetooth rig's, and CC 67 lives on in the Max Utility patch as the
  owner's piano-pedal looper). The hold boundary is
  `constants.osc.footTrigger.holdThresholdMs` (650) — foot-trigger.js
  mirrors it hardcoded because Max ES5 can't read JSON. A collision
  (the same CC on overlapping channels) keeps the first mapping (foot →
  toe → expression) with a WARN; an out-of-range `channel` falls back to
  10 with a WARN. Tests: `tests/test_midi_pedal_input.py`,
  `tests/test_foot_switch_component.py`.

Don't run both paths at once for the same pedal (assign the port in
Live *or* keep the Max patch listening to it, not both) — each press
would fire twice. The two maps no longer overlap (23/21/20 on ch 10 vs
67/82/11), so this only bites if you re-point one side at the other's
CCs.

## Move encoders and pad hold (ADR-320 → ROW 5, ADR-412, ADR-432)

The Ableton Move is a dumb MIDI controller here: `Max Utility
1.0.maxpat` converts its encoder CCs (ch 1) into relative-volume OSC
fired straight at 11020 — same no-bridge/no-`trackPath` lane as the
wah and foot pedal. Both encoder handlers live on
`SelectedTrackComponent`, share the MIDI-relative encoding (`1` =
+`MOVE_VOLUME_STEP`, `127` = −`MOVE_VOLUME_STEP`, 0.002/tick, clamp
`[0,1]`) and are gated by the single `move_volume_knob` session toggle;
the pad hold (third bullet) shares the lane and the component but is
ungated — the patch is its switch:

- **CC 71** → `/looping/v3/selected_track/volume_relative` —
  selected-track volume (`handle_relative_volume`, master supported).
- **CC 72** → `/looping/v3/selected_track/drum_chain/volume_relative` —
  volume of the **selected drum-pad chain** of the first
  `DrumGroupDevice` on the selected track (ADR-412):
  `rack.view.selected_drum_pad` → `pad.chains[0]` →
  `chain.mixer_device.volume`, so tapping a pad re-targets the knob.
  `selected_chain` is the fallback only when no pad is selected; an
  **empty** selected pad drops with no fallback (`selected_chain`
  would still point at the previous pad's chain). Context misses
  (non-drum track in view / empty pad) drop silently with a one-shot
  INFO — performance states, not protocol errors. No success echo:
  chains aren't in the v3 tree; Live's own UI reflects the write.
- **A pad held ≥ 300 ms** → `/looping/v3/move/pad_hold [note, held]`
  (ADR-432, 2026-09-11) — `owner/Max Patches/move_pad_hold.js` on the patch's
  `midi_from_move` bus times every pad note and sends `1` when a hold
  crosses the threshold and `0` when that pad lifts; a plain hit sends
  nothing. The note is only a tag pairing a release with its hold.
  `handle_pad_hold` names the pad **Live selected** — the same
  `rack.view.selected_drum_pad` read as the knob, on the first
  `DrumGroupDevice` of the selected track — because the selection is the
  pad struck (measured 2026-09-11: a Random at +12 before the rack made
  every hit sound an octave up and the selection stayed on the struck
  pad), while the raw note is the Move script's own grid (`68 + 8·row +
  col` for pad `36 + 4·row + col` on the first page) and moves with the
  page. It emits `/looping/v3/drum/pad_hold [rackPath, padNote, held]`
  to the interface, remembering what it announced per tag so the
  release names the held pad even after a quick hit on another pad
  moved the selection; two pads hit together both read the one
  selection, so a pad named by two tags is announced once and released
  when the last lifts; forgotten on disconnect. A fresh `1` for a tag
  still recorded — its `0` lost on the wire, or the patch restarted
  mid-hold — releases the stale hold first, then announces the new pad
  (the same pad: nothing to do), so a lost release cannot block that
  Move pad for the session (2026-09-12). The
  interface presses the pad on `drumPadScope` under a reserved pointer
  id — the FX grid, the Drum Rack view and the pad grid all see a held
  tile — and releases it with `cancel`, so a Move hold never latches;
  every handshake accept drops the external holds, so a dead patch
  cannot leave a stuck scope. Same context misses, same silent
  one-shot INFO drops. Tests: the `pad_hold` block of
  `tests/test_selected_track_component.py`.

CC map on the Move ch 1: 71/72 above, 75–78 TotalMix
(room/playback/click/phones), 73/74 free.

## Drum Rack virtual macros (ADR-428, 2026-09-07)

`components/DrumVirtualMacroComponent.py` owns the whole-kit gesture on
a `DrumGroupDevice` (split on 2026-09-10 into `drum_vm_functions.py` — the
vocabulary and the function table — `drum_vm_state.py` — the records —
and `drum_vm_resolve.py` — the guarded LOM reads — with every name still
importable from the component module). The Drum Rack central view's seven controls no
longer write rack macros by index; they read and write the **computed**
properties `vm.fx1`, `vm.fx2`, `vm.fxType`, `vm.attack`, `vm.decay`,
`vm.start`, `vm.pitch` on the ordinary property channel
(`PropertyComponent` allowlist rows flagged `computed="drum_vm"`).

- **A virtual macro is a musical function** with a binding per pad
  instrument class keyed by parameter **name** (DrumCell /
  OriginalSimpler / MultiSampler; Operator and unknown classes are
  non-members; a nested Instrument Rack is a non-member of the seven
  and the member class of the rack-macro functions below). Members are
  resolved per pad from `rack.drum_pads[n].chains[0].devices` at first
  use and re-resolved when the rack's `drum_pads` / `chains` /
  `macros_mapped` fire.
- **Rack macros — `vm.macro.<name>` (2026-09-07).** A kit whose pads
  hold nested Instrument Racks (`Ethnic Drums` on the rig: every pad an
  `InstrumentGroupDevice` around two Sampler chains, the parameters the
  seven bind macro-held inside; the Drum Rack's own macros named but
  **unmapped**, so Live cannot drive them either) gets one function per
  macro **name** its pad racks carry: `_resolve_rack_macros` reads each
  rack's `parameters` minus `Device On` / `Chain Selector` (by name,
  never position; sixteen slots; default `Macro N` / `.` / `-` names
  dropped — `is_empty_macro_name`), builds `macro.<name>` functions in
  rack order (`_RackState.macro_functions`, the first pad's rack setting
  the order) with one member per pad rack carrying the name, and the
  census lists them as `macros` — a **list** (`sort_keys` must not
  reorder it) of `{name, members, held}`. Kind `t`: seeded from the
  first pad's macro, written through each macro's own 0..127 (the rack
  fans it on to its chains), a macro that is itself macro-held skipped
  and counted, same coalescing / undo step / re-seed as the seven, and
  **no legacy macro ever** — `legacy_macro` is 0 and `_legacy_macro`
  guards `idx <= 0`, because `macros_mapped[-1]` would otherwise route
  the write to macro 0, Device On. `PropertyComponent.spec_for`
  synthesises the computed row for any `vm.macro.<name>` on a
  `DrumGroupDevice` (the channel's one open-ended name family; the
  class stays closed, the bare prefix rejects); a name the kit lacks is
  a transient member-less function — reads nil, a set stores + echoes
  and moves nothing. A re-seed now drops a value whose source is gone
  (no member and no mapped legacy macro — `_has_source`): racks dropped
  onto a Sampler kit's pads used to leave `vm.decay` at 0.65 on a kit
  with nothing to move (measured on the rig). The UI's `rack-macros`
  profile renders the names like the Instrument Rack view. **Pitch binds
  through the transpose macro:** a pad rack macro named Transpose /
  Pitch / Tune / Trnsp (`PITCH_MACRO_NAMES`, exact, case-insensitive,
  first in that order) is the pad's `pitch` member as a *semitone macro*
  (`_Member.semitone_macro`: read and written in semitones through
  `_member_read` / `_member_write`, −48..48 across the macro's 0..127 —
  the project convention, confirmed by the kit file's
  `MidiControllerRange`; the LOM exposes no mapping range), so the Trnsp
  slider, the ±12 buttons and the sequencer's octave all work on such a
  kit; the census names it as `pitchMacro`. Before this the Permute
  step logged `sequencer shift 12 skipped: rack has no pitch value yet`
  on `Ethnic Drums`.
- **The Sampler row (2026-09-07)** adds seven fixed functions, no
  legacy index: `release` (`Ve Release`, Simpler and Sampler) and, on
  `MultiSampler` only, `sustain` (`Ve Sustain`), `oscAmount` (`Osc On`
  + `O Volume`), `oscCoarse` (`O Coarse`, −2..48), `pitchEnvAmount`
  (`Pe On` + `Pe < Env`, −48..48), `pitchEnvAttack` (`Pe Attack`),
  `spread` (`Spread`, 0..100) — ranges measured on `50s Autumn
  Brushes`; `sustain` and `spread` bind on `OriginalSimpler` too
  (measured present on `Acuff Kit`). A Simpler kit's row is the Time
  pad and Trnsp, all bound long since. A section's switch is the function's first member (on
  above 1/127 like `FX On`). A real Sampler lists all 108 parameters
  with fixed indices; the 43-parameter variant lists only a section's
  switch until first enabled, so `_resolve` counts the bound names a
  pad did not list (`_RackState.missing`) and `_apply` re-reads the
  rack after a switch member turns on (`_grow_sections`) to write the
  amount in the same pass — a no-op on a full list.
- **`gain` (2026-09-08)** — how loud a pad is, one more fixed function
  with no legacy index. `Volume` on every bound class, each through its
  own range, measured on the rig: DrumCell `0..1` (index 18 on
  `Octagonal House`), Simpler and Sampler `−36..36` dB (index 15 on
  `Bright Room`). A **nested-rack** pad has no `Volume` a name lookup
  can reach, so its member is the pad's own chain volume
  (`chains[0].mixer_device.volume`, `Chain Volume`, `0..1`, 0.85 = 0 dB)
  — added in `_rebuild_members`, not the bindings table, and the one
  fixed function such a kit answers besides `pitch`. A plugin-hosted pad
  gets none. Being a `t` function it carries the per-pad deviations, so
  a drag moves the kit and every pad keeps its offset.
- **Write rule** `value = min + t·(max−min)` through each member's own
  LOM range — measured to reproduce Live's macro exactly; a two-state
  switch (`FX On`) turns on above `1/127`, the measured macro threshold;
  `fxType` is the int; `pitch` is whole semitones, clamped ±48. Members
  with `is_enabled == False` are skipped; a refused write disables that
  member and re-resolves.
- **Per-pad offsets are seeded from the kit** (2026-09-07): one
  `_PadPitch` record per pad (`offset`, `written`, `prev`, `written_at`),
  the offset being the pad's Transpose relative to the first member's
  (which is the global `vm.pitch` shows). Every pitch fan-out reads each
  member back first (`_reconcile_pitch`, two passes) and sorts what
  changed since our last write: **a delta the kit shares — at least two
  pads, the most common delta across the pads read, unchanged pads
  voting 0 — is a kit move** (Live's Edit → Undo of our own gesture or
  step, a macro, a hand move of every pad), not 24 hand edits; what
  remains per pad is the user's edit of that pad and moves its offset
  (permute ADR-019's read-before-write rule, per pad). On the write path
  (`property/set`) the incoming value wins and the kit move is discarded;
  on the sequencer path it is adopted into the global and `vm.pitch`
  re-emitted, so the slider follows Live's undo — unless the move is
  exactly the shift change being applied (Cmd-Z on a held step), which
  leaves the kit where it is. **A read equal to the pre-write value is
  our own write still landing only inside `STALE_READ_WINDOW_MS` (400 ms
  on the component's clock; a 1/16 at 180 BPM is 83 ms)** — a DrumCell
  reads one write behind under a busy control thread — and an edit past
  it. Residuals: a single-member kit keeps the per-pad rule; a pad at the
  ±48 rail cannot vote; two pads hand-tuned identically on a three-pad
  kit read as a kit move. So the Trnsp slider and the sequencer's shift
  term (below) move every pad by the same amount and a tuned kit stays
  tuned; a pad added after seeding keeps its pitch until the next move.
  No UI for the offsets yet.
- **Per-pad deviations for the other functions** (2026-09-08): the same
  idea as the pitch offsets, generalized to every continuous (`t`)
  function — one `_MemberEdit` per member (`dev`, `written`, `prev`,
  `written_at`) on `_RackState.edits`, keyed by `(pad note, parameter
  name)` so it survives a re-resolve of the same kit (a load is told
  apart by name — below). A member is written
  `clamp(global + dev)` in the function's own space, so **a kit control
  moves the kit and keeps its shape** instead of flattening it, and a
  pad tuned by hand in Live survives the next gesture. **A clamp at a
  rail re-anchors the deviation** rather than hiding under it
  (`dev = clamp(global + dev) − global`, 2026-09-15, ADR-428 addendum):
  squeeze the control against an end and the pads pinned there come away
  level, a pinned pad moves the moment the control leaves the rail, and
  only the direction squeezed is flattened — a pad *below* the kit value
  is never clamped by the top rail. `pitch` is excluded: the sequencer
  sweeps its ±48 rails by the bar and would eat a pad's offset.
  **A preset load into the same rack is told by the rack's NAME**
  (`_RackState.kit_name`, 2026-09-15, ADR-428 addendum): the records — keyed
  by pad note and parameter name — used to be inherited by a kit that never
  had them, which is how a freshly loaded 32-cell kit acquired a −0.613
  deviation on every pad at once. A different name on a re-resolve drops the
  deviations and pitch offsets and re-seeds the held value from the new kit.
  **Identity cannot be used and neither can `PadChainWatcher`**: measured on
  the rig, a preset load hands back the same rack, chains, pads, devices and
  DeviceParameters (same `_live_ptr`, 16 of 16) and never fires a chain's
  `devices` listener — only names change. A rename by hand therefore reads
  as a new kit, and reloading the *same* preset is invisible. Reconciled by
  **push, not poll**: pitch reads every member back before each fan-out,
  which is affordable for one parameter a pad and not for ten (`fx1` is
  320 members on a 32-pad kit), so every watched member carries an
  `add_value_listener` and `_absorb_edits` runs `EDIT_ABSORB_DELAY_MS`
  (150 ms) after a fire. The callback marks and schedules — no LOM read
  or write in a notification. Our own fan-out fires those listeners too
  and is ignored twice: `_fanning_out` for Live's synchronous dispatch,
  the `written` baseline if it ever defers. Classification is
  `_reconcile_pitch`'s rules in `t` space — a shared, most-common delta
  is a **kit move** (Live's Edit → Undo, a macro) and is adopted into
  the held value and re-emitted; the remainder is that pad's edit; a
  pre-write read inside `STALE_READ_WINDOW_MS` is our write landing.
  **The 150 ms deferral is load-bearing for the kit-move half** — fired
  inline, each pad is seen alone and reads as an edit. No deviation on a
  two-state switch (no room; it follows its amount), on `fxType` (a
  choice, not an amount — per-pad FX type wants absolute values, so it
  waits for the per-pad milestone) or on `pitch` (keeps its own
  `_PadPitch` poll: the sequencer's write path, rig-validated; two
  mechanisms on one function would fight). `MAX_MEMBER_LISTENERS` (1024
  vs ~700 for the worst real kit) leaves a whole function unwatched
  rather than half of one, logged once. `debug_state` reports
  `deviations` and `watching`. **This is the substrate for per-pad
  control from the interface**: "set pad 38's decay" is `dev = target −
  global` on that pad's records, which is why they are keyed by note.
- **Per-pad rows and the selected pad** (2026-09-08, the wire a pad
  grid needs): the census gains `pads` — `[{note, name, class, color}]`
  in note order for every pad carrying a chain, `name` the pad's label
  capped at `PAD_NAME_MAX` — the instrument's own name on a Drum Sampler
  or Simpler pad, `DrumPad.name` (the chain's) on any other (ADR-439; see
  "Similar-sound swap" above) — `color` the chain's RGB int (`chains[0].color`, the
  color Live paints the pad with — the Croydon kit's kick reads
  0x85961f, its snare 0xffffff; `None` when unread), names dropped past
  `CENSUS_BYTES_SOFT_CAP` so a 128-pad kit still fits the datagram
  (colors stay).
  `vm.selectedPad` reads / writes `rack.view.selected_drum_pad` as a
  note and the view's `add_selected_drum_pad_listener` (exists on Live
  12, verified) re-emits it, so Live → iPad and iPad → Live both work; a
  set is echoed twice (channel + Live). `vm.pad.<note>.<fn>`
  (`parse_pad_function`, `is_pad_property`; `PropertyComponent.spec_for`
  synthesises the row, the second open-ended family) is one pad's value,
  **absolute** in the function's units: read off the pad's first
  continuous member (Live's truth, not the model's belief); a write goes
  through `_apply_pad` — sets that pad's `_MemberEdit.dev` (or
  `_PadPitch.offset`) to `value − kit value`, then writes the pad's
  members with `_write_members(…, absolute=True)` — so the kit value
  never moves and the next kit gesture carries the pad at its new
  distance. Pitch adds the held shift on write and subtracts it on read.
  Coalesced and undo-grouped like the kit rows; `_absorb_edits` re-emits
  subscribed pad rows for the pads it touched (all of them on a kit
  move). Dropped with a warning on a still-mapped family kit. The UI
  side (a 4×4 pad grid on the left of every Drum Rack profile;
  hold-to-scope: touch-down selects the pad in Live and, while held, the
  controls read from and write to the held pads) is the next stage.
- **Sequencer shift term** (permute ADR-020): `set_sequencer_shift(rack,
  path, 0|12)` holds the Permute engine's octave on top of the global —
  `pitch = clamp(global + offsets[note] + shift)` per member, through the
  same fan-out / legacy-macro path, applied inline in its own undo step
  (or an open gesture step). **The term is committed only after the
  fan-out wrote at least one member (or the macro)**: a rack with no
  pitch value yet (chains still populating) or with every member held
  writes nothing and holds nothing — that step is skipped, not deferred.
  `vm.pitch` reads stay the global; a re-seed while shifted subtracts
  the term; a shifted rack is never released on unsubscribe.
- **State follows the rack, not its path.** `rebind(rack, path)` re-keys
  a held state (offsets, shift, listeners, pending applies) under the
  rack's new path after a track above it is deleted — identity by
  `same_lom_handle`, bookkeeping only, so
  `SequencerComponent._resolve_route` calls it from the structural
  rescan and `_state_for` before it would build a fresh state. A state
  that sat at the new path (a rack that is gone, or moved and not yet
  rebound) is parked, not released, while it holds a shift, so a retired
  engine instance can still restore it by handle; a restore for a rack
  the component holds nothing on is a no-op. The change listeners and
  the deferred re-seed resolve the state object, never a path.
- **Transitional rule:** while `macros_mapped[legacy−1]` is true on a
  pipeline-family rack (macros 1–2 named `FX1` / `FX2`) the function
  writes its legacy macro (1, 2, 3, 4, 9, 10, 11) in macro units. Never
  on a non-family rack — its indices mean other things.
- **Echo is the surface's:** nothing in the LOM fires for a virtual
  value, so `PropertyComponent.handle_set` emits `property/value` with
  what the provider stored. Reads are seeded from the members (or the
  mapped macro); `None` when the rack has no member for the function.
- **One apply per drain pass:** `property/set` stores + queues, and
  `OSCTransport.add_drain_hook(flush)` applies the latest value per
  `(device, function)` at the end of the pass — a queued burst for one
  control costs one fan-out. Writes stay in handler context; the
  listeners only mark dirty and schedule a 150 ms re-seed + re-emit.
- **One undo step per gesture, explicitly.** Live records every cell
  write as its own undo step (measured; the Phase 0 note that a
  handler's writes coalesce was wrong — only same-parameter writes
  merge), so `flush` opens `song.begin_undo_step()` on a gesture's first
  apply and closes it 300 ms after the last (`GESTURE_UNDO_IDLE_MS`,
  re-armed per pass, closed on disconnect).
- **`vm.members` — the census (Milestone 1b, 2026-09-07).** A read-only
  computed row beside the seven (`writable=False`, so `handle_set`
  rejects it with `property-read-only` before the provider is asked):
  the JSON string `members_json()` builds from the resolved state —
  `padCount` (pads with a chain), `padClasses` (histogram of the first
  instrument's class on each populated pad, **bound or not**: a Komplete
  Kontrol kit reads `AuPluginDevice`, a pad holding a nested rack
  `InstrumentGroupDevice`), `hasMacroMappings`, `family`, and per
  function `{members, held}` counted over member *parameters*, `held`
  being those with `is_enabled == False`. Cold-read on subscribe (with
  the same one-shot re-resolve when the rack is still populating);
  re-emitted beside the functions from `_reseed_and_emit`, so a
  `macros_mapped` fire after an unmapping in Live pushes the new held
  counts on its own. `_resolve` walks each pad once
  (`pad_devices` → `first_instrument`, `drum_vm_resolve`) for both the census and the
  bindings. The UI (`interface/src/lib/services/drumVirtualMacros.ts`)
  routes on `padClasses` and `mappedMacros` (plugin pads or a rack with mapped macros → one slider per mapped macro), dims a function
  with `members == 0` and shows one with `held == members` read-only —
  by decision no name-based macro fallback for a held function.
- **Sampler's `parameters` list is dynamic** (measured 2026-09-07): a
  `MultiSampler` lists a section's parameters only while that section
  is on — the Jazz kit's Sampler pad shows 43 with everything off and 70
  the moment `F On` is 1; the Autumn kit's show 108 with Osc, Pitch env
  and Filter on. Indices shift with every section toggle; names don't.
  Members are resolved by name and held as `DeviceParameter` objects,
  and the bound `Transpose` / `Ve Attack` / `Ve Decay` live in always-on
  sections, so a toggle never moves a binding — but never index a
  Sampler by a number read off another Sampler, or off the same one
  earlier.
- **`None` rides the wire as OSC nil** (`osc_codec.py`, 2026-09-07):
  typetag `N`, no payload, decoded back to `None`; the bridge's `osc.js`
  turns it into JSON `null`. Any `property/value` of "no value" — a
  virtual macro with no member on the kit, a Simpler property whose
  container is missing — depends on it; before, `encode_message` raised
  `unsupported arg type NoneType` and the emit silently never left.
- Ready line: `DrumVirtualMacroComponent: ready (17 functions: …; rack
  macros=vm.macro.<name>; census=vm.members; …)` — the count is
  `len(FUNCTIONS)` (the seven, the Sampler row, `filterFreq` /
  `filterRes` and `gain`; confirmed on the rig 2026-09-12 after this
  line had said 14 since the Sampler row landed).
  Tests: `tests/test_drum_virtual_macro_component.py`.

## The clip view's ±12 on a wrapped kit (`TrackTransposeComponent`, 2026-09-25)

What a drum track is, for pitch, has one answer: `drum_vm_resolve.find_track_drum_rack`
— a `DrumGroupDevice` at the top of the chain, or one level down in an
Instrument Rack's chain, by class and never by macro name. Permute's pitch
route (`SequencerComponent._resolve_route`) and the clip view's ±12 both ask
it. The UI types an instrument from its top-level class alone, so a wrapped
kit (196 library kits, the Packs "mapped" copies) reads there as a plain
Instrument Rack, and the UI cannot address the kit inside it (`chains/` is
reserved). So on an Instrument Rack the UI sends
`/looping/v3/track/transpose [requestId, trackPath, semitones]` first; the
component moves the kit's `vm.pitch` through `DrumVirtualMacroComponent`
(read the held value, add, clamp ±48, `write` — the same fan-out, legacy
macro and undo step as the Trnsp slider), echoes `property/value` for the
rack path, and replies `drum`. `not-drum` sends the UI down its old path
(named rack macro, then notes); `held` (every pitch member macro-held — the
wrapper's macros hold them) writes nothing and the UI moves the named macro
but never the notes; `none` is a kit with nothing to move. A top-level Drum
Rack never comes here — the UI writes its `vm.pitch` itself. Tests:
`tests/test_track_transpose_component.py`.

## Drum pad chains — the devices inside a pad (issue #491, protocol 3.8.0, 2026-09-10)

`components/DrumPadChainComponent.py` makes the devices inside a Drum Rack
pad's chain addressable, listable, observable and loadable; before it,
nothing on the wire could name one. ADR-430.

- **Grammar.** `path_resolver` gains the note-keyed `pads/<note>` segment
  under a device, walked as "container, then devices" so a rack inside a
  pad chain takes the same suffix (`_resolve_device_segment` loops);
  `resolve_pad(song, "…/devices/0/pads/38")` answers a `PadRef` (rack,
  rack path, note, pad, first chain). `drum_pads` is note-indexed on the
  rig (`drum_pads[36].note == 36`), so the note is tried as an index and
  the list scanned only if that disagrees. `chains/<N>` stays reserved
  (NOT_SUPPORTED). `param/set`, `param/query`, `property/*`,
  `device/select` and `device/move_to_*` therefore work on chain devices
  unchanged — `canonical_parent` is the chain.
- **Two computed rows, a second provider (`drum_pad_chain`).**
  `vm.padFx` is effect presence for every populated pad — chain index,
  class, name, `Device.type` — from a walk that reads only those, re-
  emitted from each chain's own `devices` listener (and the rack's
  `drum_pads` / `chains`). `vm.padChain.<note>` is a pad's refcounted
  subscription: while open the component keeps value listeners on the
  pad's *effects'* parameters (never the instrument's — those are the
  virtual-macro layer's) feeding the mutation fan-out with the composed
  pad path, and every cold read sends a **pad-scoped `state/full/tree`**
  (`V3StateFullComponent.emit_pad_chain`: reason `pad-chain`, scope the
  pad path, D/P for the effects with the instrument skipped and its
  chain index kept; an empty bundle is sent; never memo-suppressed).
  Both rows are read-only. Live's selected pad plays no part — selection
  is shared state two clients would fight over, which is why ADR-428
  kept it off the surface; which pads are watched is each client's own
  choice.
- **A narrower structural composite.** A chain listener marks the rack
  dirty and defers `CHAIN_CHANGE_DELAY_MS` (150 — a chain populates after
  the add fires, and Live refuses writes inside a notification anyway);
  the tick advances the generation (the `state/invalidate` carries no
  paths), runs `PropertyComponent.on_structural_invalidate` (a pad
  Reverb's IR subscriptions on a path that moved are torn down), re-emits
  `vm.padFx` and re-emits and re-watches every subscribed pad. It never
  republishes the song and **never feeds `on_device_added`** — the
  Simpler init rules and the random-start prepend would fire per pad.
- **`device/load` reads its `devicePath` at last** — and **inserts a
  native device by name** (`Chain.insert_device` / `Track.insert_device`,
  Live 12.3+, measured on 12.4.15b2). Since protocol 3.12.0 (2026-09-28)
  a tile names the device, not a file: `source` `native:<class>`
  (`Delay`, `Hybrid`, `AutoFilter2`…, mapped to Live's display name by
  `NATIVE_DEVICE_NAMES`) and `rel` the tile's name. The surface calls
  `insert_device` with the display name (a MIDI effect at the index after
  the leading MIDI effects), renames the device to `rel` (`Reverb`, not
  `Hybrid Reverb`) and wraps both in one undo step: in place, one call,
  no track republish, no selection change. Live applies the user's own
  default for the device (`<User Library>/Defaults/Audio Effects/<display
  name>.adv`) to an `insert_device` exactly as to its own browser, so each
  user gets the device as they have set it up. A refusal is `load-failed`
  `insert-refused`, with no browser fallback. Until 3.12.0 the insert was
  taken only when that default was byte-identical to the owner's preset
  file. **The browser path** is for files — racks, plug-in presets, Max
  devices, a user's own preset: select the
  track, `rack.view.selected_drum_pad = pad`, the chain's last device
  (`song.view.select_device` — Live inserts a browser load after the
  selected device), set the track's device insert mode beside the
  selection, then `browser.load_item`, then put the mode back (ADR-437,
  2026-09-14). `Track.View.device_insert_mode` (Live 12.2+) is what
  decides where a browser load goes: it READS as a bool — `True` in
  Live's default mode, where `load_item` lands the preset on the track
  after the top-level device holding the selection (the rack), and
  `False` after 1 or 2 is written (Push's insert left / right), where it
  lands beside the selected device INSIDE its chain — measured on
  12.4.15b2 with the Permute `.amxd`: mode 0 → the track every time,
  mode 1 or 2 → the pad's chain every time. The surface writes 2 for the
  duration of `load_item` and 0 after (a mode already at 1 or 2 is left
  alone). Then a look **the moment `load_item` returns**: chain grew →
  done (the normal case now: no move, no track structural); track grew (a
  Live without the property) → `song.move_device(newcomer, chain,
  index)` — an audio effect to the end, a MIDI effect after the MIDI
  effects already at the chain's head, directly before the instrument
  (Live refuses one behind it; the same rule `insert_device` uses); neither
  yet → the same look on every fast tick (the drain pump's Timer, ~11 ms,
  via `LoopingSurface._schedule_next_tick`) until `PAD_PLACEMENT_TIMEOUT_S`
  (1 s) → `load-failed` `landed-nowhere;scope=<padPath>`. The two
  `schedule_message` looks this replaced (200 ms, then 800) cost 130–400 ms
  of pure waiting per pad load, and the move they fed cost more than time:
  **undoing a `move_device`d, freshly browser-loaded Max device aborted
  Live** — `Fatal Error: ADeleteAction::Do`, four times on 2026-09-14,
  grouped with the load in one undo step or not, from `song.undo()` or
  from Live's Edit menu, into a pad chain or to the top of its own track
  alike; moving a long-standing device (native or Max) and undoing that
  is clean. The wah now lands at the head of the effects *by the load*
  (`load_into_track(..., at_head=True)`, mode 1 with the first audio
  effect selected) and the Simpler random-start prepend no longer moves
  anything — Live lands a MIDI effect at the head on its own; a Random
  Start behind the instrument is reported, not moved (ADR-437 addendum). A
  preset that landed in the chain undoes as Live's own "Insert Device"
  (measured: `song.undo()` → `Undo Insert Device`, chain and track back as
  they were). Every pad-load error carries `;scope=` so the UI's slot reset
  can tell scopes apart. A MIDI effect through the move fallback transits
  the track at index 0 (ahead of the rack, Live's own placement, measured
  2026-09-11); where a MIDI effect lands with the insert mode set has not
  been measured.
- **`device/delete [devicePath]`** — `parent.delete_device(index)` by
  LOM identity on the device's `canonical_parent`, track or chain. First
  UI sender (ADR-445, 2026-09-19): the Pedal central view's Wah button,
  held (`deviceMoveService.deleteDevice`).
- Protocol 3.8.0 (record arities unchanged; the path shape is new).
  Tests: `tests/test_drum_pad_chain_component.py`, plus the pad cases in
  `test_path_resolver.py`, `test_v3_state_full_component.py`,
  `test_device_load_component.py`, `test_device_commands_component.py`;
  the LOM fakes live in `tests/support/lom_fakes.py`.

## Thin Permute + the sequencer engine (permute ADR-020, 2026-09-07)

The sequencer device lives in this repo now: `Vamp Devices/Permute/Permute.amxd`,
loaded through the "Vamp Devices" Place in Live's sidebar (`live_library`,
`devicePresets.ts`).
It is a **parameter holder with no code** — Live's `Device On` plus the 38
`live.*` pattern controls (`Mute 1 … 8`, `Mute Length`, `Mute Rate`,
`Pitch 1 … 8`, `Pitch Length`, `Pitch Rate`, `Chance`, `Temperature`, then
`Mute 9 … 16` and `Pitch 9 … 16`) and `plugin~` → `plugout~`. The `v8` JS,
the transport/metro clock, both `udpsend`s, the Current/Reset controls and
the display plumbing were stripped (188 objects; `scripts/amxd-inventory.py`
verifies a save without Max: 38 parameters, orders 1–38,
`fat-device markers present: none`). The standalone permute repo is frozen;
the fat device is what its last tag ships.

**16 steps (ADR-443, 2026-09-18).** Each lane has 16 cells and both Lengths
run 1..16; the default length stays 8, so a fresh device plays as before.
Steps 9–16 are orders 23–38, appended after the other 22, so every earlier
index and order held. The device's own "hide the cells past the length"
chain (`route 1 … 16`, `!- 16`, `!- 17`) hides 9–16 at the default. On
the device's face each lane is two rows of eight cells (1–8 over 9–16)
with Steps and Rate side by side under them, ~81 px wide (a later Max save
the same day narrowed it from the old ~101 px and set the cells' font to
6 pt; the 2026-09-21 save widened the cells from 9.6 to 11.4 px, raised six
labels from 8.3 to 9.9 pt and turned one lane's on-colour from cyan to a
soft blue — presentation only each time, same 38 orders).
The parameters and wiring were added on the JSON inside the `.amxd` by a
script (it first proved it re-serializes the file byte-for-byte); the
layout is a Max save. `Permute.maxpat` is the final `.amxd`'s patcher JSON,
rewritten beside it — regenerate it after every Max save: the JSON between
the first `{` and the last `}` of the `.amxd` (the slice
`scripts/amxd-inventory.py` reads), written as `json.dumps(obj, indent=4)`
plus one trailing newline. That form reproduces the committed twin
byte-for-byte; Max's own tab format does not.

`components/SequencerComponent.py` is the engine, and it always runs. Until
2026-09-26 it sat behind a persisted session toggle, `sequencer_engine`
(default OFF), a switch-over gate from the fat device; that toggle, the fat
device's step ingest and `PermuteStepComponent` are gone. A set still holding
a fat Permute needs it swapped for the thin one, or the same clip is shifted
and muted twice.

- **Clock.** `drain_pump.FastDrainPump.add_tick_hook` — every Timer fire
  (92.8 Hz measured), drained or not, unlike `OSCTransport.add_drain_hook`
  which runs only after a non-empty drain. A Timer callback is a legal LOM
  write context (the drum fan-out writes from it). `LoopingSurface._tick`
  carries the engine when the pump is not running. Each tick reads
  `is_playing` / `current_song_time` / `tempo` / `signature_numerator` once;
  per device the step is `floor(ticks / ticks_per_step) % length` on the
  ported math in `components/sequencer_math.py` (bar-length rates scale with
  the numerator; an out-of-range rate index falls back to 1/4 — a negative
  one must not wrap like a Python list).
- **Lookahead.** The engine evaluates the step at `now + one tick interval`
  (an EMA of its own period, clamped 4–40 ms, at the current tempo), so the
  next step's state lands at or just before the boundary Live triggers the
  note on. Per transition it records `now − boundary` in ms (negative =
  early); `/looping/probe/sequencer_stats` (`reset` clears) reports the
  distribution, the tick interval and the slowest tick.
- **Pattern is read-only and cached.** Controls are resolved by **name**
  (never index) and sampled once; the cache is kept fresh by the
  per-parameter value listeners `LOMListeners` already attaches — the
  `on_param_value_changed` fan-out keys on the parameter's LOM id, so a
  path shift cannot mis-route a value. The cache is sampled at step
  boundaries: an envelope change mid-step lands at the next boundary, as
  the fat device behaved. The engine never writes a pattern parameter.
- **Discovery** by `name == "Permute"` and `class_name ==
  "MxDeviceAudioEffect"` on regular tracks' top-level devices; rescanned
  on every structural change (handles and paths re-resolve, runtime state
  survives keyed by device LOM id, never `is`; a Drum Rack whose path
  moved is re-keyed in the drum provider through `drum_vm.rebind`, so a
  held shift is restored on the moved rack). `on_device_removed` retires
  an instance; its clip restore runs on the next tick because the callback
  is a notification (no writes there).
- **Current clip** = the track's playing slot via
  `PlayheadComponent.playing_clip(track)` — a query on the component that
  owns the `playing_slot_index` listeners, no second listener.
- **Telemetry** `/looping/v3/permute/step [devicePath, kind, step]` on each
  change, `-1` per kind on stop / removal / disconnect — the wire's only
  emitter.
- **Restore** on transport stop (whatever any instance
  applied, including a temperature moved while the transport was
  stopped), device removal, clip change under a held step, and
  `disconnect` (measured 2026-09-07: a Settings
  re-select mid-play restores inside the old surface's 2 ms teardown and
  the new surface re-applies). **Live saves the set before it disconnects
  the surface on quit**, so a held step is baked into the file — stop the
  transport before saving; the fat device had the same exposure.
- **Actions** (pitch / mute / chance / temperature) land per phase; the
  dispatch (`_on_step_value` → `_apply_pitch` / `_apply_mute`) and the
  per-clip `_ClipState` bookkeeping are the seams.
- Ready line: `SequencerComponent: ready (N Permute device(s): …)`;
  `engine attached to tracks/N/devices/M`.
  Tests: `tests/test_sequencer_component.py`, `tests/test_sequencer_math.py`.

## The Permute mute gate — surface → Max (2026-09-17)

`SequencerComponent` states its mute lane on `/looping/permute/gate
<trackIndex:int> <open:int 0|1>`, sent from the surface's own UDP socket
straight to `osc.permuteGate.remotePort` (11030) — a `udpreceive` inside a
Max device on that track. No bridge hop; it is the outbound twin of the
route `owner/Max Patches/foot-trigger.js` already uses inbound.

**Why a wire and not a write.** Every other way this engine silences
something is a LOM write — `note.mute` on a clip's notes, or an audio
clip's `gain`. Live records one undo step per parameter write, so a mute
lane at a 1/16 rate fills the undo stack with the engine's own
bookkeeping. A device that gates **what it plays** costs nothing on that
stack, and on an instrument that free-runs it is the only thing that works
at all: the Skaka Metronome Rack generates its own notes off the
transport, so there is no clip for a mute to land on.

A rack-macro route was tried for this on 2026-09-17 — name a macro `Mute`
or `Pitch` and the lane writes it — and was removed the same day. It
worked and it was the wrong mechanism: an undo step per step transition,
on a knob a performer plays and can automate. Don't re-propose it; the
wire does the job with no write.

Emitted on every mute-lane transition (the solo override already applied, so
a soloed track always reads open), on every restore — transport stop, device removal, disconnect, all of
which **open** it — and re-stated on a 1 s heartbeat. Track-level Permutes
only: a pad Permute's mute is scoped to its pad and this wire names a track.

**Receivers must fail open.** A dropped `open` datagram would otherwise
leave an instrument silent for the rest of a set, which is the one failure
here that actually costs something. The shipped receiver
(`owner/Skaka Metronome Picker/skaka_pattern_pick.js`) opens after
2.5 s of silence, so a drop — or a surface that never starts — costs a beat rather than a metronome. `gate_emit` is None
when `osc.permuteGate` is absent from `constants.json`, and then the gate is
simply never spoken.

The picker acts on it by releasing its held pattern note and sending it
again on the unmute; Skaka is phase-locked, so the pattern keeps its place
underneath and comes back in the right part of the bar.

**Measured on the rig, 2026-09-17** (engine off so its heartbeat could not
re-open the gate, transport confirmed playing, sampling the Shaker track's
`output_meter_level`):

| phase | min | peak | mean |
|---|---|---|---|
| gate untouched | 0.4906 | 0.6731 | 0.6357 |
| `gate 0 0` re-sent every 1 s | 0.0000 | 0.6596 | 0.3452 |
| 0–1.5 s after the last shut | 0.0000 | 0.0000 | **0.0000** |
| 1.5–4.5 s after (watchdog) | 0.0000 | 0.6996 | **0.6510** |
| explicit `gate 0 1` | 0.5121 | 0.6996 | 0.6679 |

Silent while shut, and back on its own at ~2.5 s — both the mute and the
fail-open confirmed on real audio rather than inferred. The track filter
was checked the same way: with the engine running, `gate 99 0` left the
meter at 0.6954 while `gate 0 0` moved it, so the device really is
matching its own track index and not accepting everything.

## Key detection (`KeyDetectComponent` + `key_detect.py`, ADR-446, 2026-09-19)

One verb, `/looping/v3/session/scale/detect [apply]`, reads every launched
MIDI clip on a pitched, non-group track (loop notes via
`get_notes_extended`, the `looping.role` rail role, the drum check — a drum
role or a `DrumGroupDevice` top level or one rack deep) and hands plain
numbers to `key_detect.py`, which has **no Live imports** and runs whole
under pytest. The decision is integer votes, not key profiles: sounding
time quantized to sixteenths, weighted by role (bass 4, key 3, synth /
inst / unset 2, fx 0) and beat position (downbeat 4, beat 3, off 2), picks
the pitch-class set and the Live scales containing it (seven-note first);
the bass's downbeat lows (4, 8 on the loop's first downbeat), first note
(2) and lowest note (1) and the keys' **chord roots** (3 on a downbeat, 6
on the first, 1 off; root by stacking — the note with a fifth above it,
then a third, then the lowest, so an inverted chord still names its root)
pick the tonic among the candidates' roots; a line votes only where it
rests (2 per note followed by a beat of silence, 1 for its longest). The
rig's melody sits on the fifth and must not decide. Shorter loops repeat
inside the longest launched one.
Clips are sorted canonically first, so the same set always gives the same
`reasons` line, which the answer carries as text. With `apply = 1` the key
is written through `SessionComponent`'s three handlers in one undo step.

**Follow (ADR-447, default on).** The same analysis runs by itself while
the `key_follow` toggle is on (`SessionSettingsComponent`; on at every
surface start and not persisted — a lock lasts until a Live restart or a set
load), and
the component keeps **no per-track listeners**: `PlayheadComponent` calls
its `on_playing_change` through `add_change_callback` whenever it
re-resolves a track's clip (launch, stop, delete, the fresh-recording race,
a moved loop), a take ends, or a clip's notes change. The call only
schedules (300 ms lane, 1.5 s lane for note changes). A pass diffs what is
playing against the last pass, clips keyed by `_safe_int_id`: new clip,
finished take or re-looped clip = add; clip gone or notes changed in pitch
class or timing = correct; nothing = no pass (Permute's octave and mute
steps). `key_detect.follow_decision` writes: a key the notes are outside of
is replaced by any answer; a fitting key stays after a correct and moves
after an add on `sure`, or `plausible` when not Follow's own. Recording
clips are left out until the take ends. Follow runs only while the dev server
is present (`compose_key_follow_gate`, beside `compose_auto_arm_gate`). A
single pitch class is the root with Major assumed; two decide by the votes.

**Who set the key.** `scale_root` / `scale_name` are registered on this
component, not `SessionComponent`: a wire write is a hand, Follow turns off,
then the write is delegated. A key changed inside Live is classified a tick
later from `song.can_redo` — measured: True after `song.undo` (inline and a
tick later), False after a redo that empties the stack and after a fresh
write — so a redo waiting keeps Follow on, none is a hand (unless the key is
Follow's own, the last redo). Our own writes are read back: `applied` is 1
only when Live holds the key after.
Selecting a clip is neither: Live 12 applies the selected clip's own scale
(set from the song's when it was recorded) to the song. A key change that
arrives with a `detail_clip` / `highlighted_clip_slot` change and equals the
selected clip's scale keeps Follow on; when the replaced key was Follow's,
Follow writes it back onto the song and stamps the clip, one undo step.

Measured on Live 12.4.15b3 before building: `Song.root_note` /
`scale_name` / `scale_mode` are settable from Python (1–2 ms a write), the
same four properties exist per clip (selecting a clip applies its scale
to the song, measured on 12.4.15b2), and **an unknown scale name does not
raise — Live silently switches to Major**, which is why `SessionComponent`
now validates names against `LIVE_SCALE_NAMES`. The 35 interval tables in
`key_detect.py` were read back by setting each name and restoring.

## LOM probes (`DebugComponent`, debug-only; probe v2 2026-09-07)

`/looping/probe/*` is a private diagnostic family on the surface's UDP
port (11020) — **not** part of the `/looping/v3/*` UI contract (the wire
gate ignores it) and never sent by the UI. Each request is answered on
its own address back to the sender. Driver:
`node owner/probes/lom_probe_driver.js '<json array>'`
— one request per datagram, sequential, prints `[{req, reply}]`
(request shapes in the file header).

| Address | Args | Does |
|---|---|---|
| `/looping/probe/lom_introspect` | `path, attrs_csv, dir_regex` | reads attribute chains on a resolved object → `{attrs:[{name, exists, callable, value_repr, error}], dir_matches}`. The safe way to ask "does this attribute exist" — `hasattr` alone raises on Live 12. |
| `/looping/probe/lom_invoke` | `path, method, observe_csv, args_json?` | calls a method (positional args as a JSON array — `Track.set_data(key, value)` needs it) and reports the observed chains before / after. **Mutates the set.** |
| `/looping/probe/lom_set` | `path, sets_json, undo_group?` | assigns `[chain, value]` pairs inside one handler call (one control tick — the shape of a fan-out); a value `{"$ref": "<chain>"}` assigns a LOM object (`view.selected_drum_pad` ← `drum_pads[36]`); `undo_group=1` wraps the writes in one undo step; replies before / after / `changed` / `error` / µs per write. **Mutates the set.** |
| `/looping/probe/song_time_probe` | `start` / `stats` / `stop` | cadence of the `Song.current_song_time` listener — count, Hz, interval mean / p50 / p95 / p99 / max / min, beat delta. Measured 65.8 Hz; the number behind ADR-429's clock decision. |
| `/looping/probe/sequencer_stats` | `reset?` | the sequencer engine's apply-lag distribution and tick maxima (`SequencerComponent.handle_stats`). |
| `/looping/probe/py_introspect` | `module, chain, dir_regex` | imports a module (`Live.Browser`, `Live.SimplerDevice`) or takes the `app` root (the Application instance), walks the chain, replies `{resolved_type, value_repr, doc, enum, dir_total, dir, truncated}`. `enum` is `{name: int}` for a Boost.Python enum (`Live.Browser.FilterType`). Trimmed to fit a datagram — `truncated` says so; narrow with the regex. For API-surface questions no song path reaches. |
| `/looping/probe/reload_on_reselect` | none | arms a fresh import of the surface for its next instance → `{armed, loaded}`. Nothing changes until the surface is re-selected in Live's Settings (or a set is opened): `create_instance` then drops the package's modules from `sys.modules` and imports the edited files (`surface/__init__.py`; Log.txt: `reload_on_reselect: purged N modules`). One-shot. The old instance's `disconnect` is what tears down, so a change to it, to the transports or to `__init__.py` still needs a restart. |

`path` is a v3 LOM path (`tracks/<N>`, `tracks/<N>/devices/<M>`,
`tracks/<N>/slots/<M>/clip`, `master`, …), `song`, or `app` (Live's
Application — `app` + `browser.filter_type` reaches the Browser). A chain is dotted
attribute names with two probe-only extensions — `name[N]` indexes a
list, `*name` maps an attribute over a list (`parameters.*name` → every
parameter name; `drum_pads[36].chains[0].devices[0].parameters[4].value`
reaches one pad's parameter). The grammar is `_walk_chain` and stays
out of the production `path_resolver` on purpose.

Rules learned on issue #489 Phase 0:
- **Keep a request under darwin's 9,216 B UDP datagram cap** — the
  driver's socket refuses a larger one (`EMSGSIZE`); split batches.
- **A pad-chain read costs ≈600 ms of Live's control thread** per call.
  Probe sparsely, never at step rate, and never while the transport runs
  a Permute (the engine always runs since 2026-09-26) — a stalled control thread makes the drum provider's lagging
  read-back look like a user edit (ADR-429's stale-read window).
- Runtime `DrumPad.note` is the pad's MIDI note; the `.adg` stores
  `ReceivingNote = 128 − note`. Addressing pads by the file's number
  misses every write.
- `lom_invoke` / `lom_set` are destructive, and `song.undo` through
  `lom_invoke` reverts the **last** step whatever it was — read the
  reply's `changed` flags before undoing blind.

## Key Files

### `scripts/liveAPI-v6.js` and `M4L devices/AbletonOSC helper.amxd` — deleted 2026-09-23

Both were inert stubs from 2026-04-22 on: the script's handlers were empty
or tombstone-only after pr12-5 + ROW 6.5–6.9, with zero outlet emits and
zero UI senders on any `maxObserver` route. Their migration history —
device/preset loading → `DeviceLoadComponent`, the foot-trigger state
machine → `owner/Max Patches/foot-trigger.js` + `FootTriggerComponent`, track
creation → `TrackPrepareComponent`, the observers and AU-plugin retry →
`SelectedTrackComponent` / `TrackMetadataComponent` / `SessionComponent` /
`DeviceInitComponent` — is in Looping's git history (`git log --diff-filter=D --
ableton/scripts/liveAPI-v6.js` there; vamp started with fresh history). Surface docstrings that cite
`liveAPI-v6.js:<line>` are provenance for that ported logic, not live links.

### `Vamp Devices/MidiWheels.amxd` — the on-screen wheels' device (2026-09-25)

A MIDI effect the user saved in Max 9.1.5: `midiin` → `midiout` passes the
track's MIDI through; **Mod Wheel** (`live.dial`, Int 0–127) drives
`ctlout 1` and **Pitch Wheel** (`live.dial`, Float 0–16384, initial 8192)
drives `xbendout`. On the LOM they are `parameters[1]` and `[2]` —
`[0]` is Device On — and read `Mod Wheel` / `Pitch` (Live names a Max
parameter by its **short** name; Live's undo menu uses the long one,
"Pitch Wheel"). Both stay **Automated and Stored**, so a performance
records the wheels into the arrangement.

`MidiWheelsComponent` owns `/looping/v3/wheels/{pitch,mod}` (wire-protocol
§2.10.5); the pedal's MIDI-track leg drives the same device. It loads
through the **"Vamp Devices"** sidebar Place (the whole `Vamp Devices/`
folder at the repo root, which Permute and Random Start load through too).

**Measured on the rig, 2026-09-25:**

- **A surface write is one undo step per unbroken run on one parameter.**
  Seven `lom_set` writes alternating mod/pitch → three `song.undo()`
  labels (`Change "Mod Wheel"`, `Change "Pitch Wheel"`, `Change "Mod
  Wheel"`) before the load's `Insert Device`. Hence the component's
  one-undo-step-per-gesture group (the ADR-428 pattern).
- **A surface write records as arrangement automation**: with
  `record_mode` on and the transport running, writes to a device
  parameter left it at `automation_state` 1 (measured on Operator's
  Algorithm; the Max-parameter case is the rig check below).
- **The pitch dial loaded at 0** — full bend down — until the user set its
  initial value to 8192 with Initial Enable on.
- **`parameter_invisible` 3 and 4 hide a dial from the LOM entirely** —
  the device then lists only Device On. Max's "Visible" / "Visible
  (Unstored)" modes (which would take a parameter out of undo via "Undo
  When Visible", at the cost of automation) are stored some other way; set
  them in Max's inspector, don't write the number.
- **`create_midi_track` and `delete_track` from the surface leave no undo
  step**, so a probe that undoes its own writes must stop at its own
  `Insert Device` — one undo too many reverts the user's last action.
- **The surface's `BrowserCache` is built once**: a file added to a Place
  after its first lookup is `not in … cache` until the surface restarts.

### `Modwheel Sender.amxd` — retired 2026-09-25

The mod wheel as a device parameter, held by `Expression Pedal.adg`. Both
were retired for MidiWheels (above) and stayed behind in Looping; nothing
loads them.

### `Vamp Devices/Vamp-Recorder/capture-looping.js` — capture engine

Live Max v8 JS that drives `[sfrecord~]` to write WAV captures to disk.
Designed to be shareable as a standalone .amxd — **do not introduce
Python-surface dependencies on the recording leg.** (The load-into-Simpler
leg does require the Python surface, but that's post-record.)

**Capture path policy (ADR-356, 2026-04-28):**

- Saved set → `<set_dir>/LOOPING_CAPTURE_<timestamp>.wav` (project root,
  alongside the `.als`). We deliberately don't write into
  `<set_dir>/Samples/Recorded` because Max v8 JS has no portable mkdir
  and `sfrecord~` silently no-ops on a missing parent directory. The
  project root always exists.
- Unsaved set → `/Users/Shared/Music/Ableton/User Library/Captures/`
  (pre-created at install time, also flat).

The `LOOPING_CAPTURE_` prefix lets users filter capture WAVs out of the
project folder in Finder.

**Peak normalization (ADR-356, amended):** the Python surface peak-normalizes
to −1 dBFS via `sample.gain`. **Both** flows do it — `handle_replace_sample`
(clip → Simpler) at `SimplerLoadComponent.py:300` and
`handle_replace_sample_onto_track` (capture) at `:420` both pass
`normalize=True`. ADR-356 originally exempted the clip flow ("library samples
are presumed deliberate") and its decision text still reads that way; see the
amendment at the top of that ADR.

Consequence worth knowing: the clip flow carries Live's own recordings, which
are AIFC `fl32`, so it lands in `sample_normalize._peak_float_be` — the float
branch — rather than the integer one the capture flow's 16-bit WAVs use. That
scan runs synchronously on Live's tick. Curve calibration table lives in
`components/sample_normalize.py`; re-run `owner/probes/sample_gain_curve_probe.js` if
Live's `sample.gain` mapping ever changes.

### `Vamp Devices/` — the one Place a user adds

Everything the app loads by itself, and nothing else (plan.md §8). Live
names a Place after its folder, so the folder's name is what the loads name
(`place:Vamp Devices`, `live_library.M4L_DEVICES_PLACE`, `devicePresets.ts`).

- `Permute/` - `Permute.amxd` + `.maxpat`, the **thin** sequencer device
  (permute ADR-020 / ADR-429): Device On + the 38 `live.*` pattern
  parameters, `plugin~`→`plugout~`, no code, no clock, no sender — the
  surface's `SequencerComponent` is the engine (see "Thin Permute"
  above). `scripts/amxd-inventory.py` verifies a Max save kept the long
  names / orders and grew no logic.
- `MidiWheels.amxd` - the on-screen wheels' device (above).
- `random-start/` - the Simpler's Random knob (`random-start.amxd`).
- `Vamp-Recorder/` - the capture engine (`capture-looping.js`, above).
- `Abstractions/manydeferlows.maxpat` - an abstraction the recorder's
  routing chooser uses (so does the owner's Max Utility patch).

### `owner/` — the owner's rig, off by default

- `Skaka Metronome Picker/` - the Max MIDI effect inside the **Skaka
  Metronome Rack** (`owner/Skaka Metronome Rack.adg`), with the
  `makenote on transport.amxd` that fires the rack's second chain.
  **On the rig these still load from Looping's copy**
  (`Looping/ableton/M4L devices/Skaka Metronome Picker/`): the rack stores
  that absolute path, and the User Library holds **symlinks** into that
  folder (`Presets/MIDI Effects/Max MIDI Effect/` for both `.amxd`s, plus
  the `.js` beside the picker), kept so that older sets still resolve. An
  edit made here reaches the rig once the rack is re-saved from Live
  pointing at this folder.

  The script holds the **whole note lifecycle** and writes raw MIDI bytes
  to `midiout` — `0x90 pitch vel` to sound, `0x80 pitch 0` to stop. There
  is deliberately no `midiformat` or `midiflush`: they kept their own
  record of what was held beside the script's, and `held` is now the only
  one. `notifydeleted()` is the teardown flush `midiflush` used to give,
  and is load-bearing — a deleted device with a note held leaves Skaka
  shaking. Macro 1's five-state `live.tab` (Auto / 16th / 8th / 4th / 6-4)
  picks the pattern; on Auto the script chooses from tempo and meter (16th
  below 110, 8th below 130, quarter otherwise, 6/4 in 3/4 or 6/4 above 160
  — both bounds exclusive). Skaka selects its pattern by **held note**,
  pitch = pattern − 1, shakes while it is held, stops on the note-off and
  stays **phase-locked** to the transport — so a note-off is a true mute
  rather than a restart (measured on the rig). The note sounds only while
  the transport runs **and** the Permute gate is open (below).

  Holds **no `LiveAPI` handle** by design: one reaching v8's garbage
  collector takes Live down with a SIGTRAP. Tempo, meter, `is_playing`
  and the track index all arrive on inlets from objects in the patch —
  the track index from the device's own `live.thisdevice` → `path
  this_device` → `getpath` → `zl nth 4` chain (the user's 2026-09-17
  cleanup, replacing a tap on the Utility-mute branch's path). The patch
  carries its own comment saying all of this.
- `Skaka Metronome Rack.adg` - the metronome the interface's **Pattern
  Rack** view drives, tracked through a named `.gitignore` exception
  (`*.adg` is otherwise user content). It references the picker and
  `makenote` by their **Looping** paths. An Instrument Rack whose macro 1 is
  `Pattern 4` — the picker's `live.tab` — and macro 2 `Offset`; nothing
  past that is named, which is why the view draws six cells and no
  sliders. It wraps the picker and an inner rack of two chains: Klevgrand
  Skaka → Utility → Delay, and a `makenote on transport` → Sampler click
  that is no longer in use (user, 2026-09-17). The picker mutes that
  Utility (`chains 0 devices 1 parameters 10`, from its own path + 1) when
  the transport stops, because the Skaka free-runs.

  **Where Live finds it:** the user saves it from Live to
  `User Library/Presets/Instruments/Instrument Rack/`, and this file is a
  copy of that one — so it drifts on a re-save there, unlike the devices.
  It is **no longer** in `Looping Presets/Effect Patches/`
  (`paths.effectPresetsBase`), so the interface's effect-patch browser
  does not list it.
- `mute-solo-control/` - `Lock Move Knobs.amxd` (running `mute-solo-control.js`), a
  hand-placed device in the rig template: Track Key Controls' mute/solo keys with the Move's four
  dials on its face. No code talks to it. It replaced Track Key Controls on 2026-09-28.
- `Modulation Test.amxd` - the `live.modulate~` prototype
  `docs/plans/clip-automation-warp.plan.md` cites.
- `Max Patches/` - the Max Utility patch and its scripts
  (`features.maxUtilityPatch`).
- `ax-helper/`, `menubar/` - the AX helper and the menubar app
  (`features.axHelper`, `features.menubar`).
- `probes/` - the rig probes (below: "LOM probes").

## Max/MSP JavaScript Constraints

- **ES5 only** - no `const`/`let`, no arrow functions, no template literals, no modules
- Cannot import JSON or external files
- LOM API docs: Cycling '74's [LOM reference](https://docs.cycling74.com/apiref/lom/); what the rig measured beyond it is `docs/reference/live-api-measurements.md`
- Permute (sequencer) lives in this repo since permute ADR-020 (`Vamp Devices/Permute/`); the standalone repo at https://github.com/ben-juodvalkis/permute is frozen at its last tag

## A Permute inside a drum pad's chain (ADR-435, 2026-09-14)

`SequencerComponent` drives a Permute found in a top-level Drum Rack's
pad chain (`drum_pads[note].chains[0]`, wire path
`tracks/N/devices/M/pads/<note>/devices/K`) as an instance of its own
that acts on **that pad alone**: its octave step is a per-pad term on
`DrumVirtualMacroComponent` (`set_pad_sequencer_shift`; the pad's
Transpose is `global + offset + kit shift + pad shift`, so it composes
with a track-level Permute's octave), its mute and Chance touch only the
clip's notes at the pad's pitch (`_read_notes` scopes itself:
`Clip.get_notes_extended(pitch, 1, …)` where offered, else the full read
filtered), and Temperature is inert on it. The track-level Permute's
Chance skips the pitches pad Permutes govern.

**Under the track-level Permute's Temperature the pad's mute and Chance
follow the pad, not the note (ADR-435 addendum, 2026-09-18).** The kit's
variation and its return to base settle the pads inside their own write
(`_settle_pads`): a note moved onto a pad whose mute step holds is muted
and remembered by that pad, a note the pad muted that moves off it is
unmuted, and a mover's probability becomes the value of whichever Chance
governs where it landed when that Chance has been applied to the clip.
The pad's unmute clears its ids wherever the swap put them
(`_read_notes(…, whole=True)`). Notes the write does not move are never
touched. Before this the mute rode on the note id: a loop jump under a
held pad stranded notes muted on other pads through unmute, Temperature
0 and stop, and let unmuted notes sound on the held pad.

Three things the design rests on, all verified in the tree first:

- **Nothing reached a chain device's parameters for the engine.**
  `LOMListeners` attaches value listeners to top-level devices only, and
  `DrumPadChainComponent` watches a pad's effects only while a client
  holds `vm.padChain.<note>`. A pad instance keeps its own 22 listeners
  (`own_listeners`), re-synced by parameter id on every rescan.
- **Nothing told the engine a chain changed shape without a client.**
  The pad-chain component's rack and chain listeners lived only with its
  subscription state; they are now `PadChainWatcher` (same module), and
  the engine holds one per top-level Drum Rack for as long as the rack
  is in the set. Its callback marks a rescan due 150 ms later
  (`PAD_RESCAN_DELAY_S`); the tick runs it, retires a removed instance
  and restores it in the same pass.
- **A Drum Rack nested in an Instrument Rack is not walked**: the wire
  has no path to a pad under the reserved `chains/` segment.

`/looping/probe/sequencer_stats` reports `route: "pad"` and `pad` per
instance and a `rescan` block (`last_ms`, `max_ms`, `watchers`, `due`),
because the walk now reads pad chains on every structural rescan and its
cost is a number to measure, not assume. A Permute is a `.amxd`, so a
pad-targeted `device/load` takes the browser path (landed on the track,
moved into the chain after the pad's instrument).
