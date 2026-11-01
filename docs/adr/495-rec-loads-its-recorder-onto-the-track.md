# ADR-495: REC Loads Its Recorder onto the Track It Records

## Status
**Accepted** (2026-10-31), on the `capture-on-track` branch (issue #9,
`docs/plans/general-release/capture.plan.md`). The bridge and the page take it
when Vamp for Mac or `npm run ipad` next starts; no Live restart. The old
Vamp-Recorder on Return A stays in the repo for the sets that still hold one,
and goes quiet.

## Context
Capture (REC → a Simpler of what you just played) needed
`Vamp-Recorder.amxd` dropped by hand onto Return A in every set, with sends
set up, before REC did anything, and it only heard what reached Return A. For
anyone but the owner that was the weakest step of setup (Ben, 2026-10-31:
"not gonna really be workable for people").

The plan chose to load the recorder onto the track being played: it hears
exactly that track, and loading a device changes neither the track's arm nor,
when REC is on the selected track, the selection. A temporary audio track was
rejected (Live selects a track as it creates it, and auto-arm then disarms
the instrument being played), and so was a recorder inside Vamp for Mac
(it hears only the interface, never a track in Live).

Measured on Live 12.4.25b1 before this was wired: Vamp-Capture loaded with
`device/load` runs its script; Live offers its extra input Ext. In and every
track; the device set Ext. In 1/2 on its own once an input device was on, and
recorded a 31 s WAV into the unsaved set's temp project, replying with its
state, meter and file. Loading it onto the selected track left arm alone
(the selection moved there from Main, which REC on a track never meets).

## Decision
- **A new device, `Vamp Devices/Vamp-Capture/`**: the track passes straight
  through; a recording tap (two `selector~`s, off while idle) feeds
  `sfrecord~`; a Track | Input switch picks the track or the extra input, and
  Input points the extra input at Ext. In itself (Live saves that routing
  with the set). 26 objects, 30 KB unfrozen; the meter goes out only while
  recording. LiveAPI handles are long-lived, never dropped (the V8 GC crash).
- **One copy per track, one command port.** Every copy listens on 11023 and
  says `/capture/hello <track>` once a second; `/capture/start <track>
  [source] [channel]` is for one track and the others ignore it. The old
  recorder's 11016 hears nothing now, so a set that still has one on Return A
  does not record every take twice.
- **The bridge runs REC** (`handlers/captureRecorder.js`): a track whose copy
  says hello starts at once; one with none has the surface load Vamp-Capture
  (`device/load`, the Vamp Devices Place) and starts on that copy's first
  hello, or answers `recorder-not-loaded` after 8 s. A stop before then
  drops the start; a second start while it loads loads nothing more.
- **The recorder goes once the take is written** (Ben, 2026-10-31): its
  `/capture/file` names its own device path, and 500 ms later the bridge has
  the surface delete it (`device/delete`). Each take costs two undo steps in
  Live, Insert Device and Delete Device; the plan kept the device to avoid
  the second, since undoing a moved, freshly loaded Max device has aborted
  Live (ADR-437). Undoing these two is unmeasured. The chain overview never
  draws a Vamp-Capture (`constants.devices.captureRecorder`).
- **The page sends the selected track**, and the source and Ext. In channel
  from Settings → General → Capture (this screen's own setting: the input
  belongs to the rig, not to a track or a take). REC no longer turns up
  Send A, prepares a MIDI track on a hold, or waits for a recorder's hello;
  it is greyed out only without the bridge or with the master selected. The
  first-run checklist's recorder step and INSTALLATION.md's Return A step
  are gone.

## Consequences
- REC works in any set with the Vamp Devices Place, with nothing to set up.
- Every REC waits for the device to load before recording: about 0.1 s
  for `load_item`, then the device's own setup (measured 2026-10-31: a
  start 150 ms after the load recorded from its first block).
- A MIDI track with no instrument records silence; REC does not yet say so.
- `captureRecorder` is always available, so it no longer tells anyone a
  recorder is missing; a load that fails says so in the error banner.
- The Ext. In channel list in Settings is fixed (1/2 … 8); a channel the
  interface lacks comes back as `no-input-channel`.

## Tags
`capture`, `rec`, `vamp-capture`, `max-for-live`, `bridge`, `issue-9`
