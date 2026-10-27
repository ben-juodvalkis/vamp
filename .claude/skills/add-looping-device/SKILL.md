---
name: add-looping-device
description: >-
  Define a device type in Vamp and give it its control everywhere at once: the
  effect chain's cell, a central view's mount, and the browser's preset
  tiles. Use whenever the request is "add <device>", "give
  <device> a slider/XY/tile", "<device> shows no control in the browser or the
  chain", "put <device> in the <name> view", or "wire <preset>.adv/.amxd into
  the UI". Also use before editing devicePresets.ts, deviceControls.ts,
  fxGridLayout.ts, viewRegistry.ts or anything in components/v6/device-panel/.
---

# Defining a device type

A device type is two entries and nothing else:

1. **`interface/src/lib/config/devicePresets.ts`** — what the device IS: how
   the app finds it on a chain and loads it.
2. **`interface/src/lib/components/v6/device-panel/deviceControls.ts`** — how
   it is PLAYED: its one control (an XY, a slider, a few buttons or the EQ's tone pad), the
   parameters it reads and writes, the math, the values it rests at, and how
   a preset file's saved values read onto it.

Every place a device's control appears draws from that one entry, so they
cannot disagree:

| Where | Draws it through |
|---|---|
| Effect chain cell | `ControlTile`, from the cell's device type (`ChainOverview`) |
| A central view's mount | `ControlTile` (`tapLoads` where a tap should load a ghost) |
| Browser preset tile | `presetControl` → `FaceControl`, at the file's saved values |

**Never write a parameter index, a range or a conversion in a component.**
If a tile or view needs one, it belongs in `deviceControls.ts`. A tile that
draws something of its own (Reverb's portrait, Utility's meter) still takes
its parameters and math from its entry (`ReverbControl`, `UtilityControl`).

## 1. Measure the device in Live (never from docs or the file)

Run the `device-dump` skill on the device loaded in Live: class name, every
parameter's index, range and Live's labels. That is the only source for
indices and ranges.

Then measure how its **preset file** reads onto those parameters. Load one
preset, dump it beside the file's saved values, delete it (it mutates the set:
one load, one delete, both undoable; the probe reports `restored`):

```bash
node owner/probes/preset_measure.js 0 "<abs path to .adv>" "" "" <scratchpad>/m.json
```

- A native device saves its parameters in the LOM's order (Auto Pan Legacy
  and Utility do not: map those by name). Many values save as is.
- The rest save in **display units** (Hz, ms, dB, a linear gain factor) while
  Live reports a 0..1 rail. Check the labels in the dump: a clean curve
  (`0.1 ms · 30000^v`) becomes a formula; anything else gets Live's own rail,
  sampled at 65 points and added to `browser/presetCurves.ts`:

```bash
node owner/probes/preset_rail_sample.js 0 "<abs path>" "" "" <scratchpad>/rail.json <index>:<min>:<max>
```

- A threshold saved as a linear factor goes on `THRESHOLD_DB` (Gate's and
  Compressor's agree). Below a rail's first label Live puts 0.
- Live only loads a preset its browser can see (a ticked Place or the User
  Library), not a Core Library path.
- A Max device's `.amxd` is a header and its patcher JSON (a frozen one,
  `mx@c`, embeds several). Each `live.*` box saves its value as
  `parameter_initial`; Live names the parameter by its
  `parameter_shortname` (Blur's "Loop Rate" is "Rate"). `parseAmxd` reads
  them, so `fromPreset` reads them by that name (`byName`). Check the
  values against the device loaded in Live (`preset_measure.js` takes an
  `.amxd` too); a patch can set a value on load (Blur's Rate opens at 92,
  not the 22 it saves). Reference a Max device's parameters by name with
  the measured index as the fallback (`{ name: 'Dry/Wet', index: 19 }`):
  its indices can shift build to build.

Write each measurement into `docs/reference/live-api-measurements.md` ("A
device preset's saved values") and add the case to
`interface/src/__tests__/unit/deviceControls.presets.test.ts`: the file's
params and what Live reported. Ground truth does not bend: if a mapping
disagrees with Live, the mapping is wrong.

## 2. Register the device: `devicePresets.ts`

```ts
gate: {
  native: true,                 // a Live device, inserted by name
  defaultName: 'Gate',          // Live names a device after the file's basename
  expectedClassName: 'Gate',    // the .adv's root element (Max: MxDeviceAudioEffect)
  padScoped: true,              // may live in a drum pad's chain
  gridSlot: false,              // a virtual slot: the FX grid is gone (ADR-485)
  color: familyScheme('dynamics')
},
```

- The app finds a device by `expectedClassName` AND `defaultName`. A Max
  device's class is shared (`MxDeviceAudioEffect`), so its name is all that
  tells two apart; the browser matches a Max preset or a rack by name too.
- Never invent a hex: one of the `DEVICE_FAMILY_INKS` families through
  `familyScheme(...)` (ADR-400).
- Paths come from `config/constants.json`, never a literal.

## 3. Define its control: `deviceControls.ts`

One entry, keyed by the `devicePresets` key:

```ts
// Measured: Gate (2026-10-26). Threshold a linear factor on Live's dB
// rail (0.000316 → -70 dB → 0); Release ms, 0.1 · 30000^v (15 → 0.486).
gate: {
  control: {
    kind: 'xy',
    title: 'Gate',
    read: (g) => ({ x: g(4) ?? 0.5, y: g(1) ?? 0 }),   // ?? = the rest value
    write: (x, y) => [[4, x], [1, y]]
  },
  fromPreset: (s) =>
    s.params.Threshold === undefined || s.params.Release === undefined
      ? null
      : { 1: thresholdValue(s.params.Threshold), 4: clamp01(Math.log(s.params.Release / 0.1) / Math.log(30000)) }
},
```

- `read` gets each parameter through `g(ref)`, which is `undefined` until the
  device answers: the `??` is what a ghost shows. Choose a rest that does not
  look like a lit state (a fill at the floor; Note Chance rests at 100 because
  0 would read as "mutes the track").
- `write` returns every parameter the gesture moves, in Live's raw units. One
  axis may move several (Glue: threshold and makeup; Saturator: drive, output
  and wet). It may read `g` to skip a write (Shifter sets Ring only when not
  already Ring).
- A slider's `readout` names the parameter whose Live label it shows.
- `picture` names a sketch drawn behind the control on chain cells and
  browser tiles (`browser/devicePictures.ts`: add a kind there, a pure
  function of the control's position, if none fits). Every device should
  read as itself at a glance; `icon` puts a mark beside the title instead.
- An XY may draw a `curve` (Auto Filter) or a `label` (Echo's time).
- `fromPreset` returns LOM values by index for the parameters the control
  uses, or `null` when the file lacks them. Comment the measurement above it.

## 4. Where it shows

- **The chain and the browser need nothing more.** A chain cell draws
  `ControlTile` for any device type with an entry (a type in
  `ChainOverview`'s `TILE_COMPONENTS` uses that tile, which wraps the same
  entry). A browser preset tile draws `presetControl` for any `.adv`, `.adg`
  or `.amxd` whose device type has an entry.
- **No grid tile:** the FX grid is gone (ADR-485). A slot in
  `config/fxGridLayout.ts` is only for a device whose tile draws something
  of its own beyond `ControlTile`.
- **Inside a central view:** mount `ControlTile` with the slot's device
  (`useFxGridSlot('<key>').device`). Pass `disableCentralViewOnTap` (a tap
  must not navigate away from the view it sits in) and `tapLoads` if a tap on
  a ghost should load it.
- **Its own central view:** every device type has one (ADR-478), the view
  a tap on its tile or chain cell opens. Create it in `central/views/`,
  mounting its control as `ControlTile` with the view's own controls around
  it, and register it under the key in `central/viewRegistry.ts`. An
  unregistered type opens the placeholder view.
- A tile whose drag may load a device that belongs at the chain's head arms
  the move with `onGesture` (Pitch and Bass, `useBassChainPosition`).

## 5. Verify, then look

```bash
cd interface && npx vitest run src/__tests__/unit/deviceControls.presets.test.ts
npx svelte-check --threshold error
npm run shot:tour -- chain --only browser-audio-effects --real-data   # the browser's Audio Effects
npm run shot:tour -- chain --only chain-pedal-gate                   # chain cells
npm run shot:tour -- central --only <view>                           # its view, layout checked
```

Send the PNGs with `SendUserFile`. For a new device on the chain, add a
`chain` tour state in `scripts/shot/views.mjs` with the device on the demo
track (`setTrackDevices`, params as `[name, name, min, max, value, label]`).
Never drag a ghost control on the live server to test it: that loads a device
into Ben's set. The surface is untouched by all of this; no Live restart.

## Checklist

- [ ] Device dumped in Live; indices and ranges from the dump
- [ ] Preset measured (`preset_measure.js`), rails sampled where not a formula
- [ ] `devicePresets.ts`: class, name, family color, view
- [ ] `deviceControls.ts`: control, rest values, `fromPreset`, measurement comment
- [ ] Measurement in `live-api-measurements.md`, case in `deviceControls.presets.test.ts`
- [ ] No index, range or conversion written in a component
- [ ] Tests and svelte-check green; browser, chain and view screenshots sent
