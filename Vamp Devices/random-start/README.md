# Random Start

A small Max for Live MIDI utility that randomizes the **Sample Start**
parameter of a Simpler placed immediately after it on the chain. Each
note plays from a different point in the sample, so a single one-shot
sample turns into a stream of variations.

## How it works

- **Trigger**: every note-on writes a fresh randomized offset to the
  Simpler's Sample Start parameter.
- **Timing**: the MIDI passes through to the Simpler unchanged. The
  randomization is written *after* the note has fired, so the offset
  applies to the **next** note. The current note plays at whatever
  offset the previous note set up. There is no added latency on the
  critical path.
- **Range**: random offsets are unipolar (forward only) and scaled to
  the headroom between the user's base position and the end of the
  sample, so the playback head never lands past the sample end.
  - `nextStart = baseStart + r * amount * (1 - baseStart)` where
    `r ∈ [0, 1)`.
- **Drift control**: every offset is computed from `baseStart`, never
  from the current value. The offsets do not compound across notes.
- **No note-off snap-back**: the Sample Start slider rests at the last
  random value between notes. Snapping back to `baseStart` on note-off
  would overwrite the prepared value before the next note-on could
  read it — every note would then play at `baseStart` and the offset
  would be inaudible. Bypass still restores `baseStart`.
- **External base updates**: the device observes the Simpler's Sample
  Start parameter. If it changes from any source other than this
  device's own writes (user dragging the slider, automation, OSC),
  the new value is adopted as `baseStart`.

## Parameters

| Param          | Range  | Default | Notes                                  |
|----------------|--------|---------|----------------------------------------|
| Random Amount  | 0–100% | 50%     | % of the headroom from base to end     |
| Bypass         | toggle | off     | Pauses randomization, restores base    |

## Placement

Place **Random Start before a Simpler** on a MIDI track:

```
[ MIDI in ] → [ Random Start ] → [ Simpler ]
```

The script self-starts as soon as the LiveAPI is ready (no patch wiring
required) and **observes the parent track's device list**. Add, remove,
or reorder devices and Random Start will re-lock automatically — no
polling, no `rescan` message needed in normal use.

The resolver **scans forward** from Random Start for the first device
whose `class_name` matches `OriginalSimpler` (Simpler's LOM class).
That means utility devices between Random Start and the Simpler are
fine:

```
[ Random Start ] → [ EQ Eight ] → [ Simpler ]   ← still locks
```

If no Simpler is downstream yet, Random Start waits silently. The
moment one is dropped onto the chain, the chain observer fires and the
lock happens immediately.

The "Sample Start" parameter is found by name with a fallback to
parameter index 3 to cover Simpler's Classic-mode quirk
(see project memory `project_simpler_param3_vs_start_marker.md`).

## Files

- `random-start.js` — v8 JavaScript engine. Self-contained, no
  dependencies on the Looping Python surface or OSC bridge.
- `random-start.amxd` — the Max patch shell. **Build this once in
  Max** following the wiring block at the top of `random-start.js`.

## Building the `.amxd` (one-time)

In Max:

1. **New → Max for Live MIDI Effect**.
2. Add a `[v8 random-start.js]` object pointing at this folder's JS.
3. Add a `[live.numbox]` named `Random Amount`, range `0. 100.`, unit
   style `%`, initial `50.`. Connect its output through a
   `[prepend amount]` to the `[v8]` inlet.
4. Add a `[live.text]` toggle named `Bypass`, mode `Toggle`, initial
   `0`. Route through `[prepend bypass]` to the `[v8]` inlet.
5. Add `[notein]` → `[t i i]` → `[midiout]` for passthrough. Tap the
   trigger to a `[pak note 0 0]` → `[prepend note]` → `[v8]` so each
   note fires `note <pitch> <velocity>` into the script.
6. Add `[live.thisdevice]` and `[loadbang]`, both connected to the
   `[v8]` inlet.
7. Save as `random-start.amxd` in this folder. Freeze the JS into
   the device if you want to ship it standalone.

## Logging

All output is structured: `[<level>][<tag>] message key=val key=val`.

**Levels** (set the floor — anything at or above this level prints):

| Level | Number | When to use                                         |
|-------|--------|-----------------------------------------------------|
| DEBUG | 0      | Wiring up. Every walk step, every note, every write.|
| INFO  | 1      | Resolve success, external base updates, bypass changes. |
| WARN  | 2      | Notes received before resolve, fallback param index used. |
| ERROR | 3      | Resolve give-up, write failures.                    |
| NONE  | 4      | **Default.** Silent.                                |

Log calls are call-site gated (`if (DBG)` etc.) so suppressed levels cost
nothing — no `kv` allocation, no string formatting, no `post`. Bring it up
to DEBUG only when wiring up; leave it at NONE in normal use.

**Runtime control** — send to the `[v8]` inlet:

- `loglevel debug` (or `0`) → flip to verbose
- `loglevel warn`  (or `2`) → back to default
- `loglevel none`  (or `4`) → silent
- `dump` → print full state snapshot (target, base, amount, counters)
- `rescan` → re-walk the device chain (use after moving devices)

**Tags** — filter the Max console by these:

- `init` — readiness probe, script load, parent-track resolution, freepeer
- `chain` — track devices-list observer fires (chain change events)
- `resolve` — lock attempts and outcomes
- `walk` — fine-grained chain walking (DEBUG only — noisy)
- `observer` — Sample Start listener fires, self-write suppression
- `base` — baseStart updates from external sources
- `note` — every note-on/off and the math behind the next offset
- `write` — every LiveAPI param write
- `bypass` — toggle transitions
- `ctrl` — runtime control messages (loglevel, rescan, etc.)
- `rx` — unexpected messages from the patch (means wiring is wrong)

**Outlet mirror** — every log line also fires out outlet 0 as
`log <LEVEL> <tag> <message>`, so a `[route log]` in the patch can
drive a status display, or a `[print rs]` mirrors to the console.
Outlet 0 also emits domain events: `resolved`, `unresolved`, `base`,
`wrote`, `bypass`.

## Design notes

- This device is intentionally standalone — it does **not** route
  through the Looping Python surface, the OSC bridge, or any Looping
  interface code. It can be lifted into any Live set as a single
  `.amxd` + `.js` pair.
- v8 (not legacy `js`) is required — the script uses `const`/`let`,
  template literals, and arrow functions.
- Self-write echo suppression uses a `1e-4` tolerance on the
  normalized 0–1 parameter value (~0.01% of sample length). LOM
  param round-trips are not bit-exact so an exact compare won't do.
