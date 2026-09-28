# Clip Automation and Warp Markers — Plan

**Goal:** Draw and edit a clip's automation envelopes, and its warp markers,
from the iPad's clip editor. These are the two items `clip-view-mirror.plan.md`
set aside ("Clip automation / envelope editing — separate, large"; "full warp
editing deferred").

**Status:** Proposed, 2026-09-27. Live's API was measured on the rig first;
nothing is built. Three decisions below are Ben's to make before design.
**Owner:** Ben.
**Measured facts:** `docs/reference/live-api-measurements.md`, the **Envelope** and
**Clip** sections. This plan summarizes them; the reference has
the numbers.

---

## What Live allows (measured on 12.4.15b4)

**Automation envelopes: yes, fully.**

- Any parameter on the clip's own track: volume, pan, sends, device knobs,
  rack macros, Permute's lanes. **Session clips only.**
- Real breakpoints: ramps, instant jumps (two points at one time), flat steps,
  and **curves**. A curve lives on the point where its segment starts and only
  sticks if the segment's end point already exists, so writes go **right to
  left**. Any curve values work, not just the ones Live draws.
- Playback moves the knob along the envelope, looping with the clip.
- Reads return breakpoints and curves, including ones drawn by hand in Live, so
  the iPad can show exactly what the clip does.
- Wrapped in one undo step, a gesture undoes and redoes cleanly in Live.
- Quirk: on dB parameters (volume) a read returns linear gain, not the fader
  value. Show Live's own text for the value instead.

**Warp markers: yes, with rough edges.**

- Add, move and remove markers on warped audio clips, as one undo step.
- Remove needs the marker's **exact** beat. A move past a neighbor is silently
  stopped just short of it, so read back where it landed. Live's beat↔audio
  helpers count samples while markers count seconds.
- A fresh clip has a hidden third marker just past the end marker.

**Not possible:**

- **Arrangement automation** (the track's own lanes). Session clips only.
  Performance capture already records knob moves into the Arrangement.
- **Clip modulation envelopes** (Live's "Modulation" switch). No API reaches
  them: Python, Max's object model, Push 3's bridge and the Extensions SDK were
  all checked. The one working route is a Max device using `live.modulate~`,
  whose knob is clip-automated (measured; the prototype is
  `owner/Modulation Test.amxd`). Ben's call: not worth a Max
  device for now. Parked, see the end of this plan.

---

## Where it goes

The clip central view's top-right chip flips between the button rail and the
**clip editor** (`ClipEditorView`: piano roll with note editing for MIDI;
waveform, playhead and loop braces for audio). Both features are layers on
that editor's timeline, sharing its zoom, scroll and playhead.

## Automation lane (MIDI and audio clips)

**What you see.** A strip under the notes or waveform, like Live's envelope
box:

- A parameter picker. Parameters that already have an envelope in this clip
  are marked, so a clip's motion is visible before touching anything.
- Breakpoints, lines and curves, the loop region and the moving playhead.
  Values in Live's own units (dB, Hz, %).

**What you do.**

- Tap to add a point, drag to move it, drag a segment to curve it, long-press
  to delete. A finger-drawn line is simplified to breakpoints.
- Shape presets: fade in or out, swell, and sine, triangle, saw or square at
  a grid rate.
- Clear the lane.
- Every gesture is one step in Live's undo.

**How it behaves in performance.**

- The envelope lives in the clip: it loops with it, travels when the clip is
  duplicated, and plays back when recorded to the Arrangement.
- While the clip plays, automation owns that knob, so the matching iPad slider
  moves by itself. Grabbing it overrides the automation until it's
  re-enabled, as in Live. The wire already has an `automation-locked` refusal;
  how sliders show this is decision 3.

**Payoff.** Swells and fades shaped into an exercise, filter sweeps on loops,
and a different Permute pattern per clip (the sequencer already follows its
lanes, so clip envelopes on them give each clip its own pattern).

## Warp markers (audio clips only)

**What you see.** Marker flags on the waveform against the beat grid.

**What you do.** Tap the waveform to pin that point to a beat; drag a marker
to stretch or squeeze the timing; long-press to remove one; a "this is beat
one" action to fix a recorded loop whose downbeat landed late.

**Hidden from the user.** The surface tracks exact marker positions, reports
where a clamped move landed, and converts seconds and samples.

**Weight.** Less central than automation: Live already warps recorded loops to
tempo. No transient call has turned up in Live's API, so snapping markers to
hits would mean finding transients in the waveform peaks the editor already
loads.

---

## Build shape

1. **Surface:** one envelope component with four verbs — list (which
   parameters a clip automates), read (points and curves for one), write
   (replace one parameter's envelope, written right to left, one undo step),
   clear — plus a notice when a clip's envelopes change (`has_envelopes`
   listener). Warp-marker verbs (read, add, move, remove) beside the other
   clip verbs.
2. **Wire:** new `/looping/v3/clip/…` addresses in `wire-protocol.md`, in the
   same commit. Points ride a compact blob like the note editor's.
3. **iPad:** a lane component and a marker layer inside `ClipEditorView`,
   reusing its timeline math.
4. **Order:** automation first (bigger payoff), warp markers second (smaller).
5. **Checking:** rig checks the way the probe measured the API (read back
   after write; watch the parameter while the clip plays), unit tests for the
   surface verbs, `npm run shot` for the editor.

## Decisions for Ben

1. **Lane placement.** Always visible under the notes/waveform, or a mode
   switch (Notes / Automation) that uses the editor's full height?
2. **First parameters.** Proposed: volume, pan, sends, the instrument's
   macros and Permute's lanes, then device knobs.
3. **Sliders on automated parameters.** Proposed: a ring, the slider moving
   with the envelope, and a tap to re-enable after an override.

---

## Parked

- **Modulation.** Two routes if it comes back:
  - A native Utility after the sound, its Gain/Balance clip-automated, gives
    modulation-like volume and pan while the faders stay free. No Max. Not yet
    measured.
  - The `live.modulate~` device above (measured), for device knobs.
  - And a request to Ableton (Ben is on the beta): let
    `create_automation_envelope` make a modulation envelope. Live's own
    docstring already calls the class "automation or modulation envelope".
- **Ideas from reviewing Producer Pal** (2026-09-27):
  - **A scene per class exercise with its own tempo and meter.** Live 12
    scenes carry both; the surface doesn't touch them yet. Top pick.
  - Capture what's playing as a new scene (`capture_and_insert_scene`).
  - Rack variations: one-tap sound snapshots.
  - Voice commands (speculative: latency and room noise).
- **Drum pad layers.** Every drum path in the surface uses a pad's first
  chain; a pad can stack several. None of Ben's 473 Drum Rack presets does, so
  it's a latent limit, not a bug.

## Background

- `Tompz/ableton-mcp` (a fork of `ahujasid/ableton-mcp`) prompted this. Its
  envelope writer approximates ramps with stair steps and its warp-marker
  calls don't match Live's signatures. Nothing taken.
- Producer Pal (GPL-3.0) has clip envelopes in draft PR
  adamjmurray/producer-pal#1184. The curve, unit and warp findings were
  posted there:
  https://github.com/adamjmurray/producer-pal/pull/1184#issuecomment-5858085251
