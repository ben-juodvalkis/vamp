# Clip rearrange: implement an Order lane on Permute

Work in the vamp checkout on the branch `clip-rearrange`:

    git fetch origin && git checkout clip-rearrange && git pull --ff-only

Commit to `clip-rearrange` only. This overrides the repo's CLAUDE.md "main only"
rule for this work: no commits to `main`, no merge into `main`, push the branch
only when Ben asks. Read `CLAUDE.md`, `surface/CLAUDE.md` (especially "Thin
Permute + the sequencer engine" and "LOM probes") and ADR-429 and ADR-443 in
`docs/adr/` before changing anything. Live is running on this machine; Ben can
restart it and is reachable by screenshare.

## What Ben wants

Rearrange a playing Session clip live: a 4-bar loop played as bars 3, 3, 3, 1,
2, 4, 4, 4, and likewise at finer steps (beats, 8ths, 16ths), finer than the
set's global launch quantization. It must always stay in sync with the song,
work on any track's playing clip (not the selected one), several tracks at
once, audio and MIDI. The state lives on the Permute device as a new **Order**
lane, so it saves with the set, is automatable and is visible in Live.

## What is already measured (do not re-derive; re-baseline on this machine)

All on Live 12.4.15b6, 175 BPM, recorded and decoded from the audio itself.
The tools are on this branch: `/looping/probe/clip_jump_probe` in
`surface/components/DebugComponent.py`, `owner/probes/clip_jump_probe_run.js`,
`owner/probes/clip_jump_research_run.js` (experiments `latency`, `clipquant`,
`finequant`, `swapquant`, `tapscrub`, `pending`, `edges`),
`owner/probes/clip_jump_groundtruth_run.js` + `owner/probes/clip_jump_audio.py`
(records a position-coded clip while firing jumps and decodes the take). The
commit messages of the four `Clip jump` commits hold the numbers.

- **`Clip.move_playing_pos(beats)`** is relative and exact (keeps phase), but
  an **audio** clip acts on it ~200–215 ms after the call, a fixed time
  (same at 175/120/90 BPM, in Beats/Complex/Re-Pitch/Tones). MIDI acts at
  once. Self-timed it landed 10–40 ms off. Not the mechanism.
- **`Clip.scrub(beat)` follows the global quantization only** (the clip's own
  `launch_quantization` is ignored) and **reads it at the call**. Held, it
  repeats one grid length; released at once it lands once.
- **The mechanism is the tap-scrub**, all in one surface call: set
  `song.clip_trigger_quantization` to the step's grid, `clip.scrub(target)`,
  `clip.stop_scrub()`, put the quantization back. 30 of 30 landed once, on the
  grid line, the clip exactly at `target`: audio 2.0–2.7 ms before the line,
  MIDI on the line with the landing note sounding. Absolute target = it
  cannot drift.
- **Lead:** on audio the tap lands on the first grid line ≥ ~205 ms after the
  call (203 ms ahead slipped one 1/16, still to the right position). So call
  at `G − lead − grid/2` for line `G`. MIDI needs far less (a tap ~80 ms
  ahead landed; a `move` 13 ms ahead was 14 ms late), not pinned down.
  Whether ~205 ms depends on the audio buffer or the machine is **unknown**:
  this is a different machine, so measure it first.
- **Safe for the set:** a launch or a recording already queued keeps its bar
  line when the global quantization is switched and switched back (also with
  1/16 held 300 ms). The switch leaves no undo step. A tap of Ben's cannot
  fall between the switch and the restore, because Live runs the surface and
  user input on one thread.
- **Clip quantization enums:** `Song.Quantization` 0 None, 1 8 Bars, 2 4 Bars,
  3 2 Bars, 4 1 Bar, 5 1/2, 6 1/2T, 7 1/4, 8 1/4T, 9 1/8, 10 1/8T, 11 1/16,
  12 1/16T, 13 1/32. Live reports the value by name
  (`Song.Quantization.q_bar`); the setter takes the number.
- An audio splice is a ~3 ms fade; some edges show up to 2× the steady slope,
  a possible faint click. Ben has not listened yet.

## Design

1. **Permute parameters** (`Vamp Devices/Permute/Permute.amxd`): append after
   order 38, never renumber: `Order 1` … `Order 16` (int, the source step each
   lane step plays, 1..16, default = its own index), `Order Length` (1..16),
   `Order Rate` (the same rate list as `Mute Rate`, see
   `components/sequencer_math.py`), `Order On` (toggle, default off). Add them
   on the patcher JSON by script the way ADR-443 did: first prove the script
   re-serializes the unmodified file byte-for-byte, then append. Keep it a
   parameter holder with no logic. `scripts/amxd-inventory.py` must verify the
   new count and orders. Regenerate `Permute.maxpat` per `surface/CLAUDE.md`.
   Put the controls somewhere sensible in presentation mode; Ben does the
   final layout with a Max save.
2. **Engine** in `surface/components/SequencerComponent.py`, on the same tick
   and lookahead as the Mute and Pitch lanes (`FastDrainPump.add_tick_hook`),
   resolving the track's playing clip through `PlayheadComponent`. Per
   instance with `Order On`: step length from `Order Rate`; at each lane
   boundary `G` whose `Order[k]` differs from where the clip would naturally
   be, tap-scrub to `loop_start + (Order[k] − 1) × step` so it lands at `G`.
   Taps due in the same tick share one quantization switch. Lead per clip
   kind (audio / MIDI) from `config/constants.json` (shared values live
   there; the machine's measured value can go in `constants.local.json`).
   Read the landing back from the `playing_position` listener and count
   misses (landed a grid late, or not at the target) in
   `/looping/probe/sequencer_stats`.
3. **Where the lane counts from**: count lane steps from the clip's launch,
   not from song time, so `Order On` with the identity order is exactly
   normal playback and switching on is seamless. Switching off returns the
   clip to its natural position at the next step. Source steps past the
   clip's loop wrap by the loop length. A pad-chain Permute ignores Order.
   If you find a reason to choose otherwise, ask Ben.
4. **The quantization echo**: `SessionComponent` reports
   `clip_trigger_quantization` changes to the UI. The switch must not reach
   the UI (no flicker of the quantization control). Measure whether the
   listener fires synchronously inside the call or later, then suppress it.
5. **Wire**: `/looping/v3/permute/step` gains kind `order` (current lane
   step), update `docs/reference/wire-protocol.md` in the same commit.
6. **UI**: an Order lane in the Permute central view and the mini sequencer
   row (`interface/src/lib/config/permuteLayout.ts`,
   `interface/src/lib/stores/v6/sequencerStore.svelte.ts` and the views that
   use them): one cell per step showing its source step number, a way to set
   each cell (propose two interaction options to Ben with a recommendation
   before building), Length, Rate, On, and a reset to identity. Show the
   current step from the telemetry. `npm run shot -- <view>` renders it
   without Live; send Ben the PNGs.

## Done means

- Unit tests for the engine (boundary math, lead, shared switch, wrap,
  identity = no tap, on/off) and the UI lane, run per file while iterating.
- On the rig, after Ben restarts Live: re-run `clip_jump_research_run.js
  latency` and `tapscrub` on an audio and a MIDI clip and set the leads from
  what this machine measures. Then 3,3,3,1,2,4,4,4 at 1 Bar on a 4-bar audio
  loop and on a MIDI loop, and a 1/16 order on each, verified with
  `clip_jump_groundtruth_run.js` + `clip_jump_audio.py` (every step lands on
  its line at its source, no repeats), two tracks rearranging at once, a
  clip recorded on another track while an order runs (its start stays on the
  bar line), and the UI's quantization control not flickering. Report the
  numbers you measured, and what you did not test.
- `surface/CLAUDE.md` "Thin Permute" no longer says 38 parameters where that
  is now wrong. No new ADR unless Ben asks.
- Commits on `clip-rearrange` with messages that say what changed and why.
  Tell Ben what behaves differently, that the surface change needs a Live
  restart, and that the Max layout save is his.
