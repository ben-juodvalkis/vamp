# ADR-382: Editable Clip-View Mirror — M3 (rich notes) + M4 (editing) + M5 (polish) + M6 (selection)

## Status
**Accepted** (M3 + M4 + M5 + M6 shipped). The clip editor is feature-
complete for v1: read, edit (add/modify/remove/transpose), multi-select,
marquee, velocity lane, quantize, duplicate, and editor→Live selection.
Extends ADR-381 (M1/M2) and ADR-360 (read path). Plan + decision table:
`documentation/clip-view-mirror.plan.md`.

## Context

ADR-381 delivered the central read-only canvas (M1) and editable braces
+ audio params (M2), but the editor's MIDI notes still came from the
cheap, **identity-blind** `clip/notes/get` blob — nothing could
reference "this note" to move or delete it. M3 adds a rich,
ID-carrying channel for the one focused clip; M4 turns that identity
into editing (remove / modify / add). The Live LOM write contract was
verified empirically on Live 12.4 before this work (probe `ok=1` — see
the "Verified LOM contract" block in the plan and ADR-381 §4).

## Decision

### M3 — rich focused-clip note channel (read, with identity)

- **Two-tier note channels (plan decision 1).** The cheap blob
  (`clip/notes/get`, `[pitch,start,dur,vel]`, 512-cap, all tracks) stays
  untouched for strip thumbnails. A **separate rich channel** for the
  single focused clip feeds the editor.
- **Explicit `int32` note IDs, never packed into float32 (decision 2).**
  Per-note struct `<iffffi>` = `(note_id:int32, pitch:f32,
  start_beats:f32, dur_beats:f32, velocity:f32, mute:int32)` = 24 B.
  Live ids exceed float32's 24-bit mantissa over a session, so the id
  rides its own int32 slot.
- **Chunked begin→chunk→end (decision 3).** 24 B/note × a dense clip
  exceeds the 9216 B darwin UDP MTU, so the surface splits on whole-note
  boundaries under a 4 KB budget and ends with an FNV-1a checksum over
  the concatenated chunk bytes. The UI reassembles, verifies, and
  re-requests on mismatch / missing chunk. Hard ceiling 4096 notes
  (the plan's number; the cheap blob's 512 was a single-datagram limit
  that chunking lifts).
- **Focused-clip notes listener (decision 5).** `ClipNotesComponent`
  now owns its own `song.view` `detail_clip` listener (decoupled from
  `ClipPropertiesComponent`'s) and attaches one `notes` listener to the
  focused clip. On fire it pokes `clip/notes/changed` (empty `trackPath`
  slot) so an edit on one client re-pulls the others. `emit_on_accept`
  re-pokes the focused clip so a cold-start UI pulls the rich channel
  without a focus-change event.
- **UI:** `clipRichNotesService.ts` (request / reassemble / checksum /
  decode / edit senders) + `focusedNotesStore.svelte.ts` (id-keyed
  `Map<noteId, RichNote>`). `ClipEditorView` reads MIDI from the store
  instead of the cheap blob; the strip keeps the cheap blob (decision 1).
  `notes/changed` re-pull reuses `clipNotesService.subscribeNotesChanged`
  (one address fans out to both channels).

### M4 — by-id MIDI note editing (the core deliverable)

- **Three write endpoints**, each `clipPath`-keyed (not focus-only, so a
  focus change between gesture and arrival doesn't drop the write):
  - `notes/remove` → `clip.remove_notes_by_id(ids)` (delete only).
  - `notes/modify` → **read-mutate-writeback**: `get_notes_by_id`
    (falls back to the full read) → mutate the `MidiNote` objects' fields
    in place → `apply_note_modifications(vec)` (the SAME vector,
    positionally). Preserves `note_id`. **Not** `MidiNoteSpecification`
    (it can't carry an id); **not** `{"notes":[...]}`.
  - `notes/add` → id-less `MidiNoteSpecification` per note +
    `add_new_notes(tuple(specs))`, which returns the new ids. Replies
    `notes/added [requestId, clipPath, newIds]` so the UI swaps its temp
    negative ids for real ones — no re-read/diff dance.
- **Non-structural → no generation bump (decision 4).** Edits use the
  optimistic-apply + listener-reconcile pattern (ADR-358/360), not the
  generation-stale write path.
- **Own-write echo loop (decision 4) — suppression, not tagging.** The
  focused-clip `notes/changed` listener fires on our own writes too, and
  the poke is origin-blind on the wire. The initiating client therefore
  suppresses its own re-pull for a ~400 ms window after a local write
  (`clipRichNotesService.markLocalWrite` / `shouldSuppressReconcile`);
  external edits (no recent local write) reconcile normally. Permute
  sidesteps this by not observing `clip.notes` at all — we can't,
  because cross-client sync needs the poke.
- **UI editing (`ClipEditorView`):** a select/draw mode toggle; per-note
  pointer handlers for move (pitch + time, snapped) and right-edge
  resize; tap-to-select → Delete; draw-mode tap-empty-grid mints a temp
  note. Writes coalesce to a single emit at gesture end (optimistic
  during). Notes render id-keyed so Svelte preserves the DOM node across
  an optimistic edit.
- **Transpose migrated.** `handle_transpose` was a clear-and-rewrite
  (`remove_notes_extended` → `add_new_notes`) that churned every
  `note_id` on a pure pitch shift, justified by a docstring claiming
  `apply_note_modifications` couldn't change pitch. The probe (P2)
  disproved that. Transpose is now read-mutate-writeback (ids preserved),
  falling back to clear-and-rewrite only when `apply_note_modifications`
  is absent; the wrong docstring is corrected.

### M6 — editor→Live note selection

- **Probed first** (`SelectionProbe`, read-only, Live 12.4). The
  note-selection LOM lives on **`Clip`, not `Clip.View`** — the view dir
  is only grid/envelope/loop display. `Clip` exposes `select_notes_by_id`,
  `deselect_all_notes`, `get_selected_notes_extended`, plus a bonus
  `duplicate_notes_by_id` (an M5 duplicate-region primitive).
- **No selection-changed listener exists** (neither `clip` nor
  `clip.view`). So the round-trip is asymmetric: editor→Live can *push*
  cleanly; Live→editor would need *polling*. **Decision: ship the push
  half, defer the poll half** — a dedicated selection poll is exactly the
  mid-performance stateful guess decision 8 warned against.
- **New wire** `clip/notes/select [clipPath, noteIds:blob, gen?]` →
  `select_notes_by_id(ids)`; empty blob → `deselect_all_notes()`.
  Selection is *view state, not note content*: non-structural,
  fire-and-forget, **no echo**, and the UI sender does **not**
  `markLocalWrite` (there's no `notes/changed` to suppress — that
  machinery is for content edits only). `ClipEditorView.selectNote(id)`
  sets the local selection and mirrors it; tap-select, draw-add (after
  the temp→real id swap — a temp negative id can't be selected upstream),
  and delete-clear all push.

### M5 — editor polish (multi-select, marquee, velocity, quantize, duplicate)

- **Selection is a `Set<number>`.** Tap = replace, shift/⌘/ctrl-tap =
  toggle, marquee drag on empty grid = box-select (AABB intersect),
  Escape clears. The whole set mirrors to Live as one batch `notes/select`
  (M6). Group drag snapshots every member's pre-drag geometry and applies
  one delta; group delete/quantize/velocity are batch ops. The marquee
  catcher shares the draw-catcher's z-layer (2, below notes) so note taps
  still win.
- **Quantize is client-side — there is no `clip.quantize`.** The
  SelectionProbe `Clip` dump showed no quantize method (only `select_*`,
  `duplicate_notes_by_id`, the `*_notes_*` family). So quantize snaps each
  selected note's start to the grid and batch-`modify`s — no new endpoint.
  The plan's assumed `clip.quantize(grid, amount)` doesn't exist on 12.4.
- **Duplicate uses `duplicate_notes_by_id`** (verified present), a new
  `clip/notes/duplicate` endpoint that replies on the shared `notes/added`
  channel; the UI selects the returned copies. (The plan guessed
  `duplicate_region`/`duplicate_loop`; the by-id call is what's available.)
- **Velocity lane (decision 9):** a bottom strip (reserved from the roll
  height for MIDI), one bar per visible note, vertical drag = velocity.
  Dragging a bar whose note is selected edits the whole selection. Keeps
  pitch-drag (roll) and velocity-drag (lane) spatially separate — no
  disambiguating modifier, which is why decision 9 picked the lane over
  vertical-drag-on-note.
- **Grid source** is a **UI grid picker** (toolbar: 1/4·1/8·1/16·1/32 +
  triplet `T`) that drives snap, quantize, draw length, and the visible
  gridlines — all self-consistent. We deliberately do **not** mirror
  `Clip.View.grid_quantization`: it's an enum on a *different* object
  (`clip.view`) needing its own listener + enum→beats mapping, and on an
  iPad you can't see Live's grid anyway, so a self-consistent UI grid is
  the better fit. (Efficiency was a wash either way — the listener would
  be event-driven and bounded.) Reading Live's grid stays a possible
  future addition.
- **Group transpose** (`transposeSelected`): octave/semitone toolbar
  buttons, selection-scoped batch `modify` with a clamped pitch delta —
  distinct from `/clip/transpose` (whole clip).
- **Draw-drag-to-set-duration**: in draw mode, pointerdown mints a temp
  note and the wire `add` is deferred to pointerup, so dragging right
  sets the new note's length (snapped, ≥ one grid cell) in a single add.

## Consequences

### Non-obvious facts the next dev (M5) MUST know

1. **The editor reads the rich store; the strip reads the cheap blob.**
   `ClipEditorView` notes come from `focusedNotesStore` (id-keyed);
   `TrackClipMidiView` keeps `clipNotesService`. Don't unify them —
   the thumbnail must stay cheap across N tracks (decision 1).
2. **`notes/changed` is now dual-source.** Playing-clip poke
   (`PlayheadComponent`, `trackPath` set) AND focused-clip poke
   (`ClipNotesComponent`, `trackPath` empty). The UI subscriber set is
   keyed by `clipPath`, so both land in the same re-pull machinery.
3. **Own-write suppression is a time window, not a tag.** If a future
   edit path bypasses `clipRichNotesService`'s senders it won't call
   `markLocalWrite`, and its own echo WILL reconcile mid-gesture. Route
   all note writes through the service.
4. **`add_new_notes` returns the ids** on Live 12.4 — the UI swaps temp
   → real off `notes/added`. The empty-`newIds` fallback (older Live)
   relies on the `notes/changed` re-pull to surface the real note.
5. **Modify must reuse Live's own `MidiNote` objects.** Build a fresh
   `MidiNoteSpecification` and you can't carry the id; the edit becomes
   an add. Read → mutate → write the same vector.

### Two wire-encoding bugs caught in live Playwright testing (2026-05-23)

The unit tests passed but the first live add silently failed at the
bridge — the wire envelope can't carry binary the way the unit mocks
assumed. Both fixed:

1. **`Uint8Array` blob args were destroyed by `JSON.stringify`.**
   `WebSocketConnection.send` did `argsTypes: args.map(a => typeof a)`
   and `JSON.stringify(message)` — a `Uint8Array` flattened to
   `{"0":255,...}` with `argsTypes:'object'`, so osc.js on the bridge
   raised `Can't infer OSC argument type`. Fix: `buildWireMessage`
   serialises binary args to the Node-Buffer JSON shape
   `{type:'Buffer', data:[...]}` tagged `argsTypes:'blob'`; the bridge's
   `routeMessageToUDP` → `encodeOutboundArgs` rebuilds a real OSC `b`
   (`{type:'b', value:Buffer}`). This is the surface→UI blob convention
   run in reverse. **Every outbound blob arg depends on this** — not
   just notes.
2. **Int-array reply args can't encode.** The surface codec
   (`osc_codec.encode_message`) supports str/int/float/blob, not
   `list` — `notes/added [..., [3]]` raised `unsupported arg type list`.
   OSC has no array type. Fix: id arrays (`notes/added` newIds,
   `notes/remove` noteIds) travel as a **little-endian int32 blob**
   (`_pack_id_blob` / `encodeIdBlob` ↔ `_parse_id_list` / `decodeIdBlob`)
   — symmetric and reuses the blob machinery both sides already have.
   The wire contract rows say `blob`, not `int[]`.

Lesson for M5 / future wire work: **unit tests that mock the sender
don't exercise the JSON envelope or the OSC codec.** Any new
binary/array arg needs a live round-trip (or a bridge-level encode test)
before it's trusted.

### Z-index bug: loop-region ate note taps (2026-05-23)

A third live-only bug: notes inside the loop window were unselectable.
The `.loop-region` overlay ("Move loop") spans the whole loop and was
painted *over* the notes (both `z-index: auto`, region rendered later in
the DOM), so `elementFromPoint` at a note's center returned the loop
region. Fixed with an explicit content-layer z stack: loop-region (1) <
draw-catcher (2) < note (4) < note.selected (5) < brace-handle (6) <
playhead (7) — notes above the region (tap selects the note), brace edge
handles above notes (loop edges stay grabbable). Pure CSS; caught only
because Playwright's click refused to hit an intercepted element. Same
lesson: synthetic-event unit tests miss pointer-occlusion.

### Two fixes from the PR-#430 automated review (2026-05-23)

1. **Selection must clear on focused-clip change.** `selectedIds` is
   component-local state in `ClipEditorView` (distinct from
   `focusedNotesStore`, which `session.handleFocusedClipPath` already
   clears). Without its own clear, a clip-A selection leaked into clip B:
   stale Delete count, and Delete/transpose/quantize firing clip A's ids
   against clip B — and Live's ids are **session-monotonic**, so a
   wrong-note collision is possible, not just cosmetic. Fixed with an
   `$effect(() => { void clipPath; selectedIds = new Set(); })`, mirroring
   the `optimisticLoop` clear. **Any future component-local note state
   must clear on focus change too** — the store clear doesn't cover it.
2. **Gesture document-listeners must survive unmount.** All five drag
   gestures (note/brace/marquee/velocity/draw) attach document-level
   pointermove/up/cancel listeners. They now route through one
   `beginGesture(onMove, onEnd)` helper that registers teardown in a set
   drained by `onDestroy` — so toggling the editor away mid-drag can't
   leak a listener closing over stale state. Add new drag gestures via
   `beginGesture`, never raw `document.addEventListener`.

### Testing
- Python: `tests/test_clip_notes_rich_edit.py` (+20) — rich round-trip,
  chunk-on-note-boundary, checksum, over-ceiling, LRU replay, focused
  listener, remove/modify/add, transpose id-preservation. Existing
  `tests/test_clip_notes_component.py` updated for the transpose
  migration (3 error-path detail strings). Full suite green (1538).
- UI: `clipRichNotesService.test.ts` (reassembly / checksum / encode-
  decode / error mapping / edit senders / suppression),
  `focusedNotesStore.test.ts` (reconcile / optimistic / temp-id swap),
  `v3ClipNotesRich.test.ts` (handler routing). Full suite green (1144).

### Open / deferred (M5)
- Touch ergonomics — edge-resize hit targets are small on touch; the
  current `RESIZE_EDGE_PX` heuristic needs on-device tuning (not
  machine-verifiable with synthetic events).
- Marquee / multi-select, quantize, duplicate-region, dedicated velocity
  lane (decision 9), draw-mode polish.
- Undo is **already covered by Live's own stack** (probe confirmed
  Cmd-Z recovers note edits) — do not reimplement client-side.
- Hard note ceiling (4096) is a first guess; a `dense-clip-load` perf
  run should confirm it (plan "Open questions").

## Tags
`clip-view-mirror`, `clip-editor`, `rich-notes`, `note-editing`,
`note-id`, `chunked-channel`, `optimistic-reconcile`, `own-write-echo`,
`adr-381-followup`, `adr-360-followup`
