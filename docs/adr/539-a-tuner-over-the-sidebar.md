# ADR-539: A Tuner Over the Sidebar

## Status
**Accepted** (2026-11-13). Extends ADR-533. The page and the bridge take it
on their next start; Vamp for Mac once rebuilt (a checkout rebuilds itself
on the next open from the Dock, ADR-490). No Live restart.

## Context
Ben asked for "a tiny guitar tuner above the capture in the left sidebar,
the same height as the touchosc faders and using the same audio input as
selected". The faders he means are the TotalMix bars in the status strip,
the top margin of Vamp for iPad. The page hears no audio; Vamp for Mac
already has the input device open for the meters (ADR-533).

## Decision
- **The tuner sits in the status strip, over the left sidebar**, directly
  above the sidebar's REC: a bar the TotalMix bars' height, built the same
  way (a well, a hairline border, its word inside, 10px bold). It reads the
  note's name alone (`A`, no octave: Ben, "it doesn't need the
  integer"), a needle that sits on the centre line in tune and moves left
  flat and right sharp (±50 cents across the bar), and a ♭ or ♯ lit on the
  side to turn the peg towards. Within 3 cents the bar and the note turn
  green. When the string stops, the last note stays, dimmed.
- **It tunes the input the sidebar's REC records** (Settings → Recording's
  device and channel, the rig's one choice). A stereo pair is summed. Live's
  own input (no device picked) reaches nothing Vamp for Mac hears, so the
  bar says "Tuner: pick an input"; with the app absent, "Tuner: no Vamp for
  Mac"; without microphone access, "Tuner: no mic access".
- **Vamp for Mac detects the pitch** (`PitchDetector.swift`, YIN, 64 ms
  window, 40–1500 Hz, quieter than −50 dBFS is silence) on a buffer the
  monitor's IO block fills, off the audio thread on its own queue, 15 times
  a second. The tuner holds the monitor like REC does, naming its channel
  as the ask's second argument; the app answers `/capture/input/pitch <uid>
  <channel> <hz> <clarity>`, relayed to every client.

## Consequences
- Measured, the detector on synthesised strings with harmonics at 48 kHz:
  E2 to E4 each within a cent, clarity above 0.8; 440 Hz at 96 kHz within
  0.3 Hz; silence and white noise read nothing. Not yet heard on a real
  guitar through the Babyface.
- The status strip has no height off the iPad app or a notched screen, so
  the tuner, like the TotalMix bars, shows only there.
- The device stays open while the tuner shows, which it already was for
  the sidebar REC's meter.

## Tags
`tuner`, `capture`, `vamp-for-mac`, `core-audio`, `status-strip`
