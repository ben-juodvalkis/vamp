# Capture Without Return A: the Recorder Goes on the Track You Play

**Written 2026-10-31**, from a conversation with Ben about the installer
([installer.plan.md](installer.plan.md)). A plan: nothing here is built, and §5's checks come
first. Facts in §1 are read from `main`.

## 1. Capture today

**REC turns what you just played into a Simpler** (README, "What it does"). Underneath:

- **`Vamp Devices/Vamp-Recorder/Vamp-Recorder.amxd`**, a Max audio effect, must sit on
  **Return A**: the user drops it there by hand (INSTALLATION.md §7, "Capture"; the first-run
  checklist's optional step, `firstRunSteps.ts`). Until it does, REC is greyed out with the
  reason, from the device's once-a-second presence signal
  (`interface/bridge/handlers/captureRecorder.js`).
- **It records what reaches Return A**, in Max (`sfrecord~`, `capture-looping.js`): no
  quantization, no beat sync, transport or not. Only what the user sends to Return A can be
  captured.
- **It writes a WAV** next to the set (`LOOPING_CAPTURE_<time>.wav`), or into Live's temporary
  project for an unsaved set, which the bridge finds and hands it before each capture
  (`liveRecordingsDir` in `config/constants.json`).
- **The surface then makes the Simpler**: a new MIDI track, the sample loaded, trimmed to its
  first transient and levelled (ADR-354, ADR-356, `SimplerLoadComponent`).

**For a new user it is the weakest step of setup:** a Max device to find and drop onto the right
track in every set, with sends to set up, before REC does anything. Ben, 2026-10-31: "I feel like
that's not gonna really be workable for people."

## 2. What Capture should do

- Sample **the track being played**, or **the audio interface's input**, or (later) any other
  track or the whole mix.
- Start **the instant REC is pressed**, without the transport or a bar line, as now.
- **Never take the player off the track they are playing**: no change of selected track, no
  change of arm.
- Need **no setup** beyond Vamp being installed.

## 3. The options, and why one wins

1. **The recorder is loaded onto the track you're on (chosen; Ben's idea).** REC loads
   `Vamp-Recorder` at the end of the selected track's chain, where it hears exactly what that
   track plays, after its instrument and effects. Loading a device changes neither selection
   nor arm, so the player keeps playing. The recorder can also take another source through an
   extra input: it already carries Ableton's `BrowseRouting` and `RoutingObjects` abstractions
   (`Vamp-Recorder/BrowseRouting.maxpat`), which list the set's tracks for a multichannel Max
   device's extra inputs, the way a compressor's sidechain lists them. Recording stays in Max,
   so it starts the instant REC is pressed, as now.
2. **Live records it: a temporary audio track.** Vamp creates an audio track whose input is the
   played track (or Resampling, or the interface), records a clip, converts it to a Simpler
   (the existing convert flow) and deletes the track. **Rejected:** Live selects a track as it
   creates it, inside `create_audio_track` (`ExclusiveArmComponent`'s docstring), and Vamp's
   auto-arm then arms the new track and disarms the one being played: the player is taken off
   their instrument mid-phrase (Ben, 2026-10-31). Clip recording also waits for launch
   quantization and may start the transport.
3. **Live records it: one capture track per set, never selected.** Created once (the first REC,
   with the selection put back at once), kept at the end, hidden from Vamp's strips; each
   capture only re-routes and arms it. Avoids the selection problem if arming a track through
   the API leaves other tracks armed and the put-back is fast enough, but still adds a track to
   every set and keeps the quantization and transport questions. **Fallback** if §5 rules out
   option 1.
4. **A recorder inside Vamp for Mac** (AVAudioEngine, an input picker). **Rejected:** it hears
   only the audio interface's inputs, never a track inside Live, so it cannot sample the
   instrument being played; it also needs the microphone permission and must share the
   interface with Live.

## 4. How option 1 would work

- **REC pressed:** Vamp asks the surface to load `Vamp-Recorder` at the end of the selected
  track's chain (`device/load`, as an effect tile loads), unless one is already there. Recording
  starts when the device says it is up (its existing presence signal).
- **The source:** "this track" by default, the device's own input. "The interface" or another
  track through its extra input, chosen in REC's long-press or in Settings.
- **REC pressed again:** the recorder stops and reports the file, and the surface makes the
  Simpler, as today.
- **After:** the recorder stays on the track, idle. Removing it would add an undo step, and
  undoing changes to freshly loaded Max devices has crashed Live before (ADR-437); an idle Max
  device costs next to nothing.
- **Where the file goes:** unchanged (next to the set, or the unsaved set's temporary project).
- **A MIDI track with no instrument, or a group,** has no audio of its own: REC says so instead
  of recording silence.

## 5. To check in Live first

1. **How soon it can record after REC.** A Max device takes a moment to load, longest the first
   time in a set. Measure REC-to-recording with the surface's probes; if it is long, Vamp waits
   for the device and the first notes are lost, or the recorder is loaded when a track is first
   selected for capture.
2. **Whether the audio interface is a source a Max device's extra input may take** ("Ext. In").
   Tracks are, through `BrowseRouting`. If the interface is not, sampling it needs an audio
   track that monitors it, and that path stays weaker.
3. **Loading the recorder leaves selection and arm alone** on the rig (`ExclusiveArmComponent`
   reacts only to selection changes).
4. **A second capture on the same track** reuses the device already there.

## 6. What it changes

- **The setup step goes:** no "drop the recorder onto Return A" in INSTALLATION.md or the
  first-run checklist, and no greyed-out REC waiting for it.
- **The installer's minimal Vamp Devices** (installer.plan.md): Permute (every new track),
  MidiWheels (the on-screen wheels), random-start (every Simpler), the groove
  (`Grooves/Vamp Groove.agr`), and the recorder. The effect tiles' own devices are not in it
  since ADR-498 (2026-11-01): each loads by file name from the user's effects folder, when
  it is there.
- **The Vamp Devices Place may go too** (installer.plan.md §5): copied into the user's User
  Library, which Live's browser already lists, the devices load with no Place to add. That
  needs the loads that name `place:Vamp Devices` and the surface's `live_library` to look in the
  User Library as well; untested in Live.
- **Return A is free** again for whatever the user wants there.

## 7. Size

About a day once §5 passes: the surface's load-then-record step, the source choice in the
interface, the setup step removed, the docs. The recorder itself needs only its source choice
exposed, in Max.
