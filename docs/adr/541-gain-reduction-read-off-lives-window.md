# ADR-541: Gain Reduction, Read Off Live's Window

## Status
**Accepted** (2026-11-16). Extends ADR-539's pattern (the page asks, Vamp
for Mac reads, the bridge relays). The page and the bridge take it on their
next start; Vamp for Mac once rebuilt (ADR-490). No Live restart. Behind
the new `reductionMeter` switch.

## Context
Ben asked for device visualizations like gain reduction on the iPad. Live
puts no gain reduction on the LOM, in Live 12 or 13: measured in the
binaries, its `GainReductionMeterModule` feeds only Live's own drawing and
the Push display. Push gets it as a channel id (Live 12) or a picture Live
renders into shared memory (Live 13's `Push3.app` helper, `ImageRTData`);
neither reaches a Remote Script. A fake Push 2 got as far as the helper
streaming display frames at 57 fps into a stand-in `libusb`, but Live only
launches and links the helper for Push hardware it detects itself, so it
stopped there. Max for Live, Ben's own plugins and loopback routing were
ruled out by Ben.

What remains is the picture Live already draws. Measured on the rig
(Live 13.0b25, 2026-11-16):
- Covered by other windows, Live keeps drawing its meters: ~36 needle moves
  a second on a drum loop, as when visible. On another Space it stops (7
  frames in 2 s, then none).
- The Glue's needle turns about one pivot (five positions meet to 0.03 px)
  on a linear scale, 5° per dB, 10 dB straight up (ticks 25.0° apart).
- Through a −6 dBFS 1 kHz tone at ratio 4, each 6 dB threshold step read
  4.28 / 4.50 / 4.69 dB against 4.50 predicted; the ~0.5 dB under the hard-knee
  figure is the Glue's soft knee, which Live's own needle shows too.
- Capturing the 139×79 pt panel at 60 fps cost the reader 2.4% of a core and
  the window server ~7% more; Live's own load was unchanged.

## Decision
- **Vamp for Mac reads the needle** (`ReductionReader.swift`,
  `ReductionMeter.swift`). It finds the device through Accessibility
  (`TrackDeviceChainView.Device[n]`, Live 13's identifiers), checks that
  Live's device view lists the same top-level device names in the same order
  as the page's track, and captures that device of Live's window with
  ScreenCaptureKit, with a 40 pt margin, at 30 fps and 1
  pixel per point. It finds the meter's dark panel in the picture rather than
  trusting the coordinates, because ScreenCaptureKit's window coordinates and
  Accessibility's differed by the window's origin (33 pt) in a full-height
  window. The needle is Live's accent cyan while Live's window is active and
  near-white while it is not (on stage it usually is not); the centroid of
  either and the pivot give the angle, the angle the dB. Live, 1×, Live in
  the background: 0.20 / 4.27 / 8.53 / 13.03 / 17.65 dB at thresholds 0 /
  −12 / −18 / −24 / −30, about 0.2 dB above the 2× spike, the needle's own
  ballistics followed at ~30 readings a second. A device is matched by name,
  or by Live's "name, type" title for a renamed device or a rack. The device
  view element is found once and only its children re-read each second (a
  full walk of Live's tree
  costs ~170 ms). A device's shape is data (`ReductionMeter.shapes`): the
  Glue's, measured as above, is the only one.
- **The tuner's pattern on the wire** (wire-protocol §2.15b):
  `/meter/reduction/watch` from the page every 2 s while a meter is on screen,
  to the app's socket alone; `/meter/reduction <path> <dB> <status>` back to
  every client, sent on a 0.05 dB move, a status change or every 0.5 s. The
  app stops 5 s after the last ask. A reason instead of a value when there is
  none: `not-shown`, `no-needle`, `no-accessibility`,
  `no-screen-recording`, `no-live`.
- **Inside racks too.** Live shows a Drum Rack pad's (or rack chain's)
  devices under the rack, as `TrackDeviceChainView.Device[0].Device[1]`, so
  the ask walks levels: the track's devices, then the pad's or chain's, each
  checked by its names. Measured on a pad's Glue (Memphis Studio + Plymouth,
  pad 36): 2 to 16 dB with every kick.
- **The page draws it** over the Glue view's Threshold and Makeup, where Live
  draws its own, on Live's 0–20 dB scale (`ReductionMeter.svelte`,
  `reductionMeterStore`), and the Glue's chain cell swings its VU needle with
  it (`ReductionNeedle.svelte`); with no reading the needle shows the
  threshold, as before. A reading older than 1.5 s is not shown.
- **Behind `reductionMeter`**, off by default: it asks for two macOS grants
  and needs Live on the current Space.

## Consequences
- Live must stay on the current Space; covered is fine. The meter says
  "Live is hidden" otherwise, rather than holding a value.
- It reads only what Live's device view shows: the selected track's
  devices, and the selected pad's or chain's inside a rack, unfolded and
  scrolled into view. A device elsewhere
  reads `not-shown`. Track hold (the iPad showing a track Live has not
  selected) is one such case.
- Live's layout is measured, not documented: a UI zoom other than 100% or a
  redesigned Glue changes the panel's size or the pivot, and the
  meter then reads `no-needle` or wrong until re-measured.
- A checkout's Vamp for Mac is ad-hoc signed and rebuilds itself, and macOS
  ties Screen Recording and Accessibility to the build: expect to grant them
  again after a rebuild that changes the app.
- Compressor, Limiter, Gate and Multiband Dynamics each need their own shape;
  until then their cells keep their pictures as they are.

## Tags
ui, wire, vamp-for-mac, devices, measured
