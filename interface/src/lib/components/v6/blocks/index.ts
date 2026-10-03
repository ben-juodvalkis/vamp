/**
 * The blocks: the interface's reusable controls, one import away.
 *
 * Generic pieces only, the ones a new view or layout is assembled from.
 * The views of one Live device (`central/views/*`, the FX-grid tiles) are
 * not here: they are what blocks get assembled into. Each export carries
 * one paragraph: what it reads, what it writes, and the one constraint a
 * caller would otherwise get wrong. `npm run blocks:catalog` turns these
 * paragraphs into `docs/reference/blocks.md`; edit them here, never there.
 *
 * Every paragraph is a single JSDoc block directly above its export, and
 * every export has one: the generator fails on an export without.
 */

// ---- Input --------------------------------------------------------------

/**
 * `use:press`, the discrete pointer action (ADR-427): the replacement for `onclick` on anything a performer touches. Reads one pointer by its `pointerId` from down to release, and Enter / Space as the keyboard path. Writes nothing itself: `onPress` does, and it should call a service command, never `send`. It writes `touch-action` onto the node from its own `touchAction` option (default `manipulation`), so set it there and not in CSS, where it does not inherit and drifts away from the handler. Fire on `down` only together with `touchAction: 'none'`; anything else inside the horizontally scrolling tracks row needs the default `up` with `touchAction: 'pan-x'`, or every pan across the control fires it and un-fires it.
 */
export { press } from '$lib/actions/press';

/**
 * `use:drag`, the continuous pointer action (ADR-427). Reads one pointer and reports `dx` / `dy` from the press point (`dy` positive UP) with the node's box measured once at press. Writes nothing itself: `onMove` does, normally through `createSliderThrottle`. The deltas are from the press point, not from the last move, so add them to the value captured in `onStart`, never to the live value, or the control runs away from the finger. `touch-action` defaults to `none`; pass `pan-x` for a vertical drag inside a horizontally scrolling row.
 */
export { drag } from '$lib/actions/drag';

/**
 * `createSliderThrottle(onSend)`, the outbound rate limit every gestural write shares. Reads the values a gesture `push`es; writes by calling `onSend` with only the latest, at most 60 times a second (issue #384), and the final value on `flush`. Call `start` on finger-down, `push` per move, `flush` on release and `cancel` in `onDestroy`: a release that never arrives otherwise leaves its rAF loop running (#392). Two values that must leave as one call (an XY pair) cannot share two throttles; `DeviceXY` hand-rolls the same loop against `MIN_SEND_INTERVAL_MS` for that reason.
 */
export { createSliderThrottle } from '$lib/utils/sliderThrottle';

// ---- Faders and pads ----------------------------------------------------

/**
 * `DeviceSlider`, the fader: one value along one axis, vertical or horizontal, relative to where the finger lands (a touch never jumps it). Reads `value` between `min` and `max`; with `track` it becomes a meter with a handle line instead of a fill, which is how the Gain tile is the track's meter. Writes through `onInteraction(value)`, at most 60 Hz, which a tile or view wires to its `sendParam` (`services/deviceParams`); `onRelease` fires once where a drag ended, for a write that should land once. It copies `value` into its own state every time the prop changes, even mid-drag, so pass the armed value (`useFxGridSlot`'s `paramValue`, `selectedTrackStore.paramValueArmed`), not the raw store echo, or a quantizing parameter snaps the fill back under the finger.
 */
export { default as DeviceSlider } from '$lib/components/v6/device-panel/DeviceSlider.svelte';

/**
 * `DeviceXY`, the pad: two values on one square, relative to where the finger lands. Reads `xValue` / `yValue` in 0..1 and ignores them while a finger is down, so an echo cannot move the dot mid-drag. Writes through `onInteraction(x, y)`, both axes in one call at most 60 Hz, and `onRelease(x, y)`; mapping 0..1 onto each parameter's range is the caller's job. Write both parameters inside that one handler, synchronously: the outbound batcher then sends them in one frame, where an `await` or a timer between them sends two.
 */
export { default as DeviceXY } from '$lib/components/v6/device-panel/DeviceXY.svelte';

/**
 * `BaseDeviceControl`, the shell every FX-grid tile is built in: it resolves its `position` or `slotKey` to an FX-grid slot and hands its snippet the device, the ghost and loading state, and the actions. Reads the slot (`slotRegistry`, `selectedTrackStore`) and the pad scope a held Drum Rack pad sets. Writes through what it hands down: `sendParam` (`services/deviceParams`, which drops a write while there is no device), `storePendingParam`, `triggerLoad`, `handleTap` (opens the view, selects the device) and move-to-top / end (`deviceMoveService`). A tap never loads a ghost tile: call `triggerLoad` from the first drag frame (ADR-167). It reads `position` / `slotKey` once at mount, so a host that changes slot must re-key the component.
 */
export { default as BaseDeviceControl } from '$lib/components/v6/device-panel/BaseDeviceControl.svelte';

/**
 * `MidiWheel`, a pitch or mod wheel. Reads nothing from a store; it keeps its own value, pitch 0..16383 around 8192 and mod 0..127. Writes integers through `onInteraction` at most 60 Hz, which a view wires to `sendPitchWheel` / `sendModWheel` (`$lib/api/midiWheels`): MIDI to the MidiWheels device the surface loads on first touch, not a parameter of the instrument beside it. Pitch springs back to centre on release and on `pointercancel`, so a host must not hold its own copy of the value; and views draw a `SectionDivider` between the wheels and the device's controls, because they are not the device's.
 */
export { default as MidiWheel } from '$lib/components/v6/midi/MidiWheel.svelte';

// ---- Clip ---------------------------------------------------------------

/**
 * `ClipPreview`, one clip drawn: an audio waveform or MIDI note lanes, cut to the loop, with an optional playhead. The track strip's clip third and every session-grid cell are this one renderer. Reads plain props (`isAudio`, `filePath` or `clipPath`, lengths, loop, the file's span) and fetches peaks from `clipWaveformService` or notes by clip path. Writes nothing. Pass values that change only when the clip is edited: `fraction` is the one prop meant to change at 30 Hz, and handing it an object that is new every tick redraws the canvas every tick. `bins` is part of the peaks cache key: 256 for a strip, 64 for a grid cell, so the two share nothing.
 */
export { default as ClipPreview } from '$lib/components/v6/tracks/TrackStrip/components/ClipPreview.svelte';

/**
 * `paintPeaks(ctx, peaks, width, height, opts)`, the waveform painter behind `ClipPreview`, the clip editor and the Simpler overview. Reads a `/api/sample-peaks` array and places each bar by TIME: `opts.span` is the time the peaks cover, `opts.view` the time the canvas shows, `opts.place` a warped file's layout. Writes bars onto the caller's canvas and does not clear it. The peaks cover the whole audio file, not `clip.length`, which on a looping clip is the loop's length: take `span` from `peakSpan` with the wire's file start and end, and `view` from `clipViewWindow` (both in `$lib/utils/waveformPaint`), never `[0, length]`, or a loop past the clip's start draws nothing.
 */
export { paintPeaks } from '$lib/utils/waveformPaint';

/**
 * `VerticalLoopControl`, the loop brace: drag either end of the focused clip's loop. Reads the focused clip (`song.view.detail_clip`) and its loop through `clipPropertiesStore`; with nothing focused it focuses the clip running on the selected track. Writes `setClipLoopStart` / `setClipLoopEnd` (`services/clipCommands`), frame-throttled and snapped to bars, or half and quarter bars on a short clip. It needs the clip's loop before it can drag, so the first touch on an unfocused track only aims it and the drag after that moves the loop; and it never reaches to another track's playing clip.
 */
export { default as VerticalLoopControl } from '$lib/components/v6/clips/VerticalLoopControl.svelte';

/**
 * `VerticalQuantizeControl`, Q: the focused clip's groove quantization amount as a vertical slider. Reads the groove (`clipGrooveStore`) of the focused clip, falling back to the clip running on the selected track. Writes `setClipGrooveQuantizationAmount` (`services/clipCommands`), frame-throttled, and on a clip with no groove first puts it on the Groove view's first tile at Amount 0 (`grooveChooser`). The clip it writes to is resolved once at touch-down and held for the gesture, so a focus echo landing mid-drag cannot move the rest of the drag onto another clip.
 */
export { default as VerticalQuantizeControl } from '$lib/components/v6/clips/VerticalQuantizeControl.svelte';

/**
 * `RecordButton`, capture: hold to record, tap to toggle, a single dot that blinks while recording. Reads `captureStore` and whether the bridge has heard the Vamp-Recorder device on Return A (`bridgeStatus.feature('captureRecorder')`). Writes `captureStore.start` / `stop`; with `armTrackIndex` also that track's Send A (`setTrackSend`, turned back down if the recorder refuses); with `prepareOnHold` it prepares a MIDI track on the hold (`prepareForPreset`) so the capture has somewhere to land. Until the recorder has said hello it is greyed out and says why, and a negative `armTrackIndex` means no valid track and makes it inert: pass `null`, not `-1`, where there is no track to arm.
 */
export { default as RecordButton } from '$lib/components/v6/controls/RecordButton.svelte';

// ---- Layout and display -------------------------------------------------

/**
 * `SectionDivider`, the hairline between two groups of controls in a central view, fading at both ends. Reads `orientation` (`vertical` between side-by-side columns, the usual case) and `ink`. Writes nothing. It carries no text by decision: a group that needs a name gets an upright eyebrow at the top of the group itself. Leave `ink` neutral for a seam inside one device and pass a scheme's primary only where the seam divides one device from another.
 */
export { default as SectionDivider } from '$lib/components/v6/central/SectionDivider.svelte';

/**
 * `DeviceEmptyState`, the "no device loaded" placeholder a central view shows in place of its controls. Reads `glyph`, `message` and `color`. Writes nothing. The colour must already be a track ink (`trackInk()`), since the glyph is drawn in it as given, and the message is sentence-case body text, content rather than a control: "Load Electric to access controls".
 */
export { default as DeviceEmptyState } from '$lib/components/v6/central/DeviceEmptyState.svelte';

/**
 * `HostedSwapPill`, the swap pill (ADR-439) laid flat inside a view, above the controls it belongs over. Reads the pill `CentralDisplay` hosts for the track's instrument or audio clip (`swapHost`). Writes through the pill's own model: folder-next (`presetSwap`), similar samples (`similarSwap`, `clipSimilarSwap`), or the browser on a tap of the name. Mounting it takes the pill from `CentralDisplay`'s left column for as long as it is mounted, so a view that shows it on one profile and not another gets the column back on the others without saying so. It draws nothing outside `CentralDisplay`, or while there is nothing to step: no guard is needed around it.
 */
export { default as HostedSwapPill } from '$lib/components/v6/central/HostedSwapPill.svelte';

/**
 * `MeterVisualization`, a level meter. Reads `track.meterLevel` (Live's raw 0..1, drawn linearly) and `track.mute`; with `color` the fill is tinted to the track instead of the green-to-red ramp. Writes nothing and takes no pointer events, which is what lets it sit under a fader: `DeviceSlider` in meter mode mounts it. Its host owns the level: pass a record that updates with the meters (`meterStore`), not a snapshot taken at mount.
 */
export { default as MeterVisualization } from '$lib/components/v6/looping/MeterVisualizationV6.svelte';

// ---- Owner's rig --------------------------------------------------------

/**
 * Owner-only (TotalMix): `TotalMixStrip`, five read-only bars mirroring the RME mixer's monitor levels in the safe-area status strip. Reads `totalmixStore`, in dB (`dbToFraction` makes the fill), and `unavailableReason`, which greys the bars and says why. Writes nothing: the mixer is driven from TotalMix and the Move's knobs. Mount it only while `bridgeStatus.isFeatureOn('totalmix')`. It is `display: contents`, so its bars become children of the host, which must be a grid on the FX grid's own 12-column ruler for each bar to sit over the tile it monitors.
 */
export { default as TotalMixStrip } from '$lib/components/v6/looping/TotalMixStrip.svelte';

/**
 * Owner-only (Permute): `MiniSequencer`, the Permute thumbnail in a track strip's bottom third, its mute row and pitch row with the current step lit. Reads a `TinySequencerState` from `useTinySequencer`, which derives the steps from the Permute's parameters and the position from `/looping/v3/permute/step`. Writes nothing; the strip's tap selects the track and opens the Permute view. Pass `null` (or an inactive state) for a track with no Permute and it draws the ghost rows; while a Drum Rack pad is held, pass `scopeLabel` and `scopeInk` too, or it titles the pad's Permute as the track's.
 */
export { default as MiniSequencer } from '$lib/components/v6/tracks/TrackStrip/components/MiniSequencer.svelte';
