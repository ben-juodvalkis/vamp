# ADR-400: Device Family Inks and Chokepoint Color Calibration

## Status
**Accepted** — implements the color audit's R5 (`documentation/color-audit.md`);
companion to ADR-399 (track role palette).

## Context

The FX device layer carried its own color system: all 27 `DEVICE_PRESETS`
entries hand-authored `{primary, secondary, accent}` RGB triples across ~16
distinct Tailwind hues, per-view sub-palettes re-declared copies, and the
shared `PITCH_COLOR` sat at OKLCH hue 260 — 2° from the reserved
`--act-pitch` signal hue (`MOD_COLOR` orange crowded `--act-master` at Δ12°).

Worse, the system had a **calibration split**: central-view interiors ran
device colors through `trackInk()` at injection, but the fx-grid tiles
(`BaseDeviceControl` → `--accent-primary`, DeviceSlider/DeviceXY tints) and
the CentralDisplay frame border rendered the **raw** literals. Tiles and
their own detail views disagreed.

Eleven views also passed byte-copied fallback colors into `useFxGridSlot()`,
`UtilityControl` hardcoded its own blue, and `MidiWheel`/`MidiWheelsPanel`
re-declared the wheel palettes (uninked). The `contexts/deviceColors.ts`
context and `DeviceColorProvider` had zero mounted consumers.

## Decision

### 1. Eight function-family inks

Device color is *module identity in a fixed grid*, not state — it needs
function families, not a per-device rainbow. `DEVICE_FAMILY_INKS` in
`devicePresets.ts` defines eight families on the same gap-placed hue wheel
as ADR-399 (clear of the GRATICULE signal hues; hexes deliberately
duplicated from — not read out of — `constants.json`, which is user-tunable
*track* config):

| Family | Hue | primary / accent | Devices |
|---|---|---|---|
| `timeSpace` | 183 teal | `#00cfb9` / `#29e1cc` | delay, reverb, variation |
| `filter` | 235 azure | `#12b2f4` / `#33cdff` | filter, eq, wah |
| `dynamics` | 100 gold | `#ceb92d` / `#d9c64d` | compressor, gate, velocity |
| `distortion` | 45 burnt orange | `#ff8244` / `#ff9e60` | saturator, drum buss, pedal, redux, digital, guitar, bass, smudge |
| `modulation` | 322 magenta | `#d57ce3` / `#e79ef3` | tremolo, chorus, comb |
| `pitchSeq` | 281 violet | `#8e90ff` / `#a29fff` | arpeggiator, pitch, sequencer, random, chord |
| `rackVoice` | 348 rose | `#f36fb8` / `#ff97cd` | vocal (+ rack macro theme) |
| `utility` | neutral grey | `#a2acb7` / `#bbc5d1` | utility/gain (fallback — see trackTint) |

Function wins over host view: wah is a `filter` even inside the Guitar view;
Saturn/smudge is `distortion` even inside the Chorus view — the odd tile out
is information. `familyScheme(family)` derives the full
`DeviceColorScheme` (secondary = 10% rgba wash), keeping every existing
consumer byte-compatible. `PITCH_COLOR` → `pitchSeq`, `MOD_COLOR` →
`modulation`, and `CONTROL_COLORS` becomes the full 8-hue gap wheel (grey
slot replaced by the ADR-399 chartreuse so no macro reads disabled).

Every hex is a verified **fixed point** of the ink chain (guarded by a unit
test in `trackFormatters.test.ts`), so re-inking anywhere downstream is a
byte no-op.

### 2. `deviceInk()` — neutral-preserving normalization

`trackInk()`'s chroma floor (cMin 0.14) deliberately colorizes greys; on the
grey utility family that would land the tile on the `--act-pitch` hue.
`deviceInk()` (`trackFormatters.ts`) gates on input chroma: C < 0.05 keeps
the grey (L clamped, C capped at 0.03); chromatic input delegates to
`trackInk`.

### 3. Calibration chokepoints

`useFxGridSlot` (feeds ~20 central views) and `BaseDeviceControl` (tile
chrome + `setView` payloads) now emit `deviceInk`-normalized schemes, and
`CentralDisplay.zoneAccent` defensively inks stray `setView` callers. Tiles,
frame, and view interiors render the same calibrated ink in both themes.
View-side `trackInk()` twins remain (harmless no-ops on fixed points) and
retire incrementally with the phase-3 sub-palette pass.

### 4. `trackTint` — utility wears the track's color

The utility/gain device sets `trackTint: true`: the chokepoints swap in the
**focused track's ink** (`selectedTrackInk()` — same recipe as the
CentralDisplay frame fallback, now a shared util), reading as "the track's
own trim." The grey family scheme remains the no-track fallback.

### 5. Deletions and dedupe

Dead `contexts/deviceColors.ts` + `DeviceColorProvider.svelte` removed. The
11 per-view `useFxGridSlot` fallback copies dropped (the shared
should-never-happen fallback is `familyScheme('pitchSeq')`);
`UtilityControl`'s hardcoded blue and `VocalControl`'s pink copy removed;
`MidiWheel`/`MidiWheelsPanel` import `PITCH_COLOR`/`MOD_COLOR` (the panel
inks them per theme — the Omnisphere wheels were previously uncalibrated).

## Consequences

**Positive:**
- The whole project now shares one gap-placed identity hue wheel (tracks by
  role, devices by function); no device hue can read as a signal state.
- fx tiles finally match their central views; light theme derives correctly
  everywhere via the chokepoints.
- New devices pick a family instead of inventing hexes
  (`docs/reference/extending-devices.md` updated).

**Negative / accepted:**
- Within-view hue collapse (Pedal view all-`distortion`, Arpeggiator mostly
  `pitchSeq`) — correct per function (owner-confirmed for pedal); the
  phase-3 tier mechanism (SystemCentralView `--sys*` color-mix pattern) can
  restore intra-view contrast via lightness if needed on stage.
- Device families alias ADR-399 track-role hues (only ~8 gaps exist); zone
  context disambiguates a teal track strip from a teal fx tile.
- The utility tile changes hue with track selection (by design, trackTint).
- Sub-device semantic palettes (Reverb algorithms, DrumRack modes,
  Omnisphere sections, Simpler mode pair, Echo/FilterCurve dots, the grey
  control defaults, instrument-view themes) were migrated in a follow-up pass
  on the same branch: functionally distinct sub-sections keep distinct hues
  but every hue is now a wheel ink (`familyScheme` / `CHARTREUSE_SCHEME` /
  `DEVICE_FAMILY_INKS`), action colors ride the functional tokens (delete →
  `--act-rec`, shuffle → `--act-quant`), and EQ's ghost grey moved off
  trackInk's chroma boost onto deviceInk. Remaining literals are deliberate:
  PerfOverlay/OSCTester debug palettes, the dormant AlwaysVisibleGrid, and
  the app.css debug guidelines.

## Tags
`colors`, `design-system`, `graticule`, `device-panel`, `fx-grid`
