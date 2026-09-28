# ADR-370: Auto-Color Tracks and Clips on Preset Load

## Status
**Accepted**

## Context

Tracks had no automatic color scheme — every new track started with Live's
default color and stayed that way unless the user manually recolored it in
Live. The browser's vendor buttons are already color-coded by category
(drum / bass / fx / inst / key / synth), but the tracks themselves gave no
visual feedback about what was loaded on them.

## Decision

On every preset load, auto-color the target track and all its existing clips
to match the category color from `constants.json:vendors.types`. The category
is derived from the second path segment of the preset's library-relative path
(`<Vendor>/<Category>/...`). Audio-vendor loads use the audio button color
from `constants.json:vendors.special.audio`.

**Always recolor**: loading a preset from the UI is an explicit intent signal,
so the new color is applied unconditionally — no gate on the track's current
color or whether the track was newly created. This matches user expectation:
"if I tap the bass button and pick a bass, the track should turn bass-colored."

**Clip coloring**: after writing the track color, every existing clip on the
track is recolored via the new `/looping/v3/clip/set/color` wire. New clips
born after the recolor inherit the track color from Live automatically.

**Wire bug fix**: the OSC bridge encodes plain JS numbers as float32, so
`0x52b788` arrived at the Python surface as `5420936.0` (a float). All three
color handlers (`TrackMetadataComponent._coerce_from_wire`,
`MasterComponent._coerce_from_wire`, `ClipsComponent.handle_set_color`) had
`isinstance(value, int)` guards that rejected floats outright. Fixed by
accepting whole-number floats and coercing with `int()` before the range
check, mirroring how `pan` already accepts int-typed zeros via `float()`.

## Consequences

- Track and clip colors now visually reflect the loaded category, matching the
  sidebar button palette.
- The synonym table in `trackColoring.ts` covers common folder-name variants
  (drums→drum, instruments→inst, leads/pads→synth, etc.) for libraries that
  use plurals or alternatives.
- No listener echo for clip color writes — the next `state/full` re-emit
  rehydrates clip records. Optimistic track-color apply via `applyTrackMetadata`
  keeps the UI consistent without waiting for the surface.
- The float-coercion fix is a latent correctness improvement for all future
  integer color writes from JS (track, master, clips).

## Tags
`ui`, `track-color`, `preset-load`, `osc-wire`, `python-surface`
