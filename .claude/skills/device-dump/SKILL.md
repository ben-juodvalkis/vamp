---
name: device-dump
description: Read everything the running Ableton Live reports about one device — class name, display name, every parameter with its index, range, current and default value and Live's own value labels, every other property (a Simpler's sample, warp and slicing settings, etc.) with whether it is settable and observable, and which properties the surface already exposes on the wire. Use before adding or changing a device's tile or central view, before pinning parameter indices, or whenever someone asks what a device's parameters, ranges, labels or properties are.
---

# Device dump

Measure the device; never take indices, ranges or labels from docs, the
`.adv` file, or memory. This dumps them off the running Live in one command.

## Run it

Live must be running with the Vamp surface (its LOM probes answer on UDP
11020). The probe talks UDP to localhost, so in Claude Code run the command
**outside the Bash sandbox** (`dangerouslyDisableSandbox: true`) — inside it
every request times out.

```bash
node owner/probes/device_dump.js --find "auto pan"             # first device whose name or class matches, any track
node owner/probes/device_dump.js tracks/1/devices/2            # by path (0-based track and device)
node owner/probes/device_dump.js tracks/1/devices/2 --json <scratchpad>/dump.json   # full dump as JSON too
node owner/probes/device_dump.js tracks/1/devices/2 --no-labels                      # skip label sampling
```

`--find` prints every match and dumps the first. It looks at top-level
devices on regular tracks only; for a device inside a rack or a drum pad,
use the probe grammar directly (`node owner/probes/lom_probe_driver.js`,
chains like `drum_pads[36].chains[0].devices[0]`, see `surface/CLAUDE.md`
"LOM probes").

If the device is not in the set, ask the user to add it, or insert it
yourself and remove it after (`lom_probe_driver.js` `invoke` →
`insert_device` with the display name, then `delete_device`). Both mutate the
set; say so.

It reads only: introspection and `str_for_value`. A 60-parameter device
takes about 5 s.

## Reading the output

- **Identity:** `class_name` is what `expectedClassName` in
  `devicePresets.ts` must match. `class_display_name` is the name
  `Track.insert_device` accepts, so it is the value for a
  `NATIVE_DEVICE_NAMES` row in `surface/components/DeviceLoadComponent.py`
  (Auto Pan Legacy: `insert_device("Auto Pan")` fails,
  `"Auto Pan Legacy"` works). An inserted device may take another name
  (Auto Pan Legacy arrives as "Tremolo (Legacy)"); the surface renames it to
  the tile's `defaultName`.
- **Parameters:** `index: name [original_name] min..max = value (default) q`.
  The index is the LOM index a view pins as a named constant. Values on the
  wire are raw Live units in `min..max`, so the view converts. `q` means
  quantized.
- **Labels:** Live's own text via `str_for_value`, at every step of a
  quantized or small integer range, and otherwise at 0/25/50/75/100% plus
  the current value. Fit a curve from these points for a continuous rate or
  frequency (Auto Pan's Frequency is `0.05 · 1800^v` Hz). For a quantized
  parameter, the step labels are the option names. A parameter that is not
  quantized but has an integer range (Auto Pan's Sync Rate, 0..21) is
  listed step by step too.
- **Other attributes:** `S` = settable (the property has a setter, read
  from Live's own class, which is exact). `L` = Live offers a listener, so the
  surface can observe it. The dump descends one level into objects the device
  holds (`sample.*` on a Simpler). A settable attribute reaches the UI only
  through the `PropertyComponent` allowlist
  (`docs/reference/extending-devices.md` §3). An attribute with no `L` needs
  the surface to echo after a write.
- **On the wire:** the allowlist rows that already exist for this class.

## Then

Pin the indices you use at the top of the component with Live's names
beside them, and put ranges and labels in a shared params module when a tile
and a view both use them (`device-panel/echoParams.ts`,
`device-panel/autoPanParams.ts`). Quote the dumped labels in a unit test, so
the test asserts Live's strings rather than a guess at them.
