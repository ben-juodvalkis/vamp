# ADR-533: Vamp for Mac Records an Input Device

## Status
**Accepted** (2026-11-13). Extends ADR-495; Vamp-Capture still records
tracks and, with no device picked, Live's own input. The page and the bridge
take it on their next start. Vamp for Mac takes it once rebuilt (a checkout
rebuilds itself on the next open from the Dock, ADR-490). The surface's half,
the set-path query, takes a full Live restart; until then a take falls back
to Live's temp project (below).

## Context
REC on Input recorded through Vamp-Capture's extra input, routed to Live's
Ext. In. That meant a Max device loaded onto the track and deleted after
every take (two undo steps, up to 8 s before the first take on a track),
and only the interface Live itself uses, on a fixed list of eight channels.
Ben asked whether external capture could live in the Vamp app instead, then
asked to "choose device as well as input channel, either mono or stereo".
The capture plan rejected a recorder in Vamp for Mac because it cannot hear
a track inside Live; for an external source that reason does not apply.

## Decision
- **Settings → Capture picks the input**: Live's input (Ext. In, through
  Vamp-Capture, as before) or any Core Audio device with inputs that Vamp for
  Mac offers. Then **Stereo or Mono**, and the channel: the pairs `1/2`, `3/4`…
  or each input alone, as many as the device has (14 on the Babyface Pro).
  The choice is this screen's, with the source and channel (localStorage);
  the device's name and input count are kept with its UID so it still reads
  right while the app is not offering it.
- **Vamp for Mac records it** (`owner/apps/Mac/InputRecorder.swift`). It opens
  the device by its UID with its own IOProc, beside Live's hold on the same
  interface, copies the chosen channel or pair and writes a 24-bit WAV at
  the device's rate with `ExtAudioFileWriteAsync` (made for the IO thread).
  Its meter is Vamp-Capture's scale and rate, so REC's fill reads the same.
- **The app is a bridge client like the page.** It says
  `/capture/input/hello <devices>` once a second; the bridge offers the
  devices to every client and sends a start naming one to the app alone.
  The app's replies go to every client as the device's `/capture/*`, so REC
  and the Simpler load cannot tell the two recorders apart. Nothing is loaded
  into Live and nothing is deleted: no undo steps.
- **Where the take goes stays the device's rule**: beside the saved set, or
  Live's newest temp project. The bridge asks the surface
  (`/looping/v3/session/file_path/query`, `Song.file_path`, measured present
  on Live 12.4.25b1) before each take. A surface that does not answer in 1 s
  gets the temp project, which is where every take goes until Live restarts
  onto the new surface.
- **Permissions**: macOS asks once for the microphone (Info.plist's
  `NSMicrophoneUsageDescription`); the notarized release signs the app with
  `com.apple.security.device.audio-input` (`Config/mac.entitlements`), which
  the hardened runtime requires.

## Consequences
- Measured with Live running on the Babyface Pro: stereo `1/2` wrote a
  2-channel, 48 kHz, 24-bit WAV of the 2 s asked for, the meter moving; mono
  `5` a 1-channel one; `15` was refused with `no-input-channel`. (Through a
  harness around `InputRecorder`, not yet REC on the rig through the app.)
- Input from a picked device needs Vamp for Mac running, under `npm run ipad`
  or `npm run dev` as much as from the Dock. Without it REC answers
  `no-input-device` and Settings lists only Live's input and the device as
  not available.
- A device's sample rate is read as the take starts; changing it mid-take is
  not handled.
- Two recorders now: Vamp-Capture for tracks and Live's input, the app for
  devices.

## Tags
`capture`, `rec`, `vamp-for-mac`, `core-audio`, `bridge`, `settings`
