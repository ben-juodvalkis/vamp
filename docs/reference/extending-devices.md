# Extending devices

> **Cleanup in flight (2026-04-21).** This doc reflects the
> Python-surface-only model. The old "regenerate Max config + reload
> M4L device" flow is gone — the surface reads
> `data/device-configs.json` at `__init__`; no Max codegen step
> remains in the path.

Three kinds of extension land in this doc:

1. **Adding a new device control to the UI** — XY pad, slider grid,
   or custom view in the FX Grid or central display.
2. **Adding a new device class's parameters** — extending the LOM
   parameter metadata the surface emits.
3. **Adding a new device property** — extending the allowlist of
   LOM attributes reachable through `/looping/v3/property/*`.

Companion: [ui-architecture.md](ui-architecture.md) covers the
layout; [wire-protocol.md §2.6](wire-protocol.md#26-device-property-operations)
covers the property wire contract.

## 1. Adding a new UI device control

### 1.1 Grid vs virtual

**Grid devices** appear in the 12-slot FX Grid (`fx1`–`fx12`, two
rows, six columns). Best for primary effects users reach frequently.
Each position maps to a device type in
`interface/src/lib/config/fxGridLayout.ts`.

**Virtual devices** appear only in a central view — they extend
capacity beyond the grid, grouped by function. Use them for
specialized effects.

### 1.2 Step 1 — add device config

Edit `interface/src/lib/config/devicePresets.ts`:

```typescript
// Grid device
delay: {
  presetPath: 'ableton/Presets/Effect Patches/Delay.adv',
  defaultName: 'Delay',
  expectedClassName: 'Delay',        // Must match Ableton's class_name exactly
  curveType: 'none'
}

// Virtual device
chorus: {
  presetPath: 'ableton/Presets/Effect Patches/Chorus.adv',
  defaultName: 'Chorus',
  expectedClassName: 'Chorus2',
  gridSlot: false,
  centralViewGroup: 'smudge',
  color: familyScheme('modulation')
}
```

**Color**: never invent a hex. Pick the function family the device belongs
to and set `color: familyScheme('…')` — the eight families
(`timeSpace`/`filter`/`dynamics`/`distortion`/`modulation`/`pitchSeq`/
`rackVoice`/`utility`) live in `DEVICE_FAMILY_INKS` in `devicePresets.ts`
(ADR-400). Devices that should wear the focused track's color instead
(gain-style utilities) additionally set `trackTint: true`.

Device detection matches on **both** `expectedClassName` AND
`defaultName` — ensures AU plugins (generic `AuPluginDevice:Saturn`)
and Max devices (`MxDeviceAudioEffect:Sequencer`) resolve
correctly.

**`padScoped`** (issue #491, 2026-09-10): `true` says the device may
live inside a drum pad's chain. While a pad is held on the selected
track's Drum Rack, its tile is that pad's — ghost where the pad has no
such effect, active where it has one, a touch loads it into the pad's
chain, a drag moves the pad's copy — and its view opens in the Drum
Rack view's pane. Every preset but Permute sets it (2026-09-11): a
native device is inserted by name, a rack or plug-in preset loads
through the browser and is moved into the chain, and a MIDI effect goes
in after the MIDI effects already at the chain's head, directly before
the pad's instrument — which the surface finds by type, so a Random ahead of a DrumCell leaves the kit census
and every `vm.*` row exactly as they were.

**A tile for a single native Live device is `native: true`, with no
preset file** (protocol 3.12.0). The surface inserts it by name (one
call, one undo step), so each user gets the device as their own Live
default has it; its class must be in the surface's
`NATIVE_DEVICE_NAMES`. A rack, a plug-in preset or a Max device is a
file and loads through the browser. See
`docs/reference/preset-library.md` §7.

Authoritative class names live in `data/device-configs.json` — grep
the top-level keys before guessing (Simpler is `OriginalSimpler`,
AutoFilter is `AutoFilter2`, etc.).

### 1.3 Step 2 — pin the parameter indices (there is no registry)

`data/device-configs.json` no longer carries per-class `parameters`
(cut 2026-09-02 — see `data/CLAUDE.md`). The surface emits every
parameter regardless, and a view binds by **index** with a literal
written in the component. So the step is: read the indices off the
running device (§5) and pin them as named constants at the top of the
view, with the name Live reports beside each one — as
`OperatorCentralView.svelte` does (2026-09-07):

```ts
const AE_ATTACK = 29;  // 'Ae Attack'   0..1
const TIME = 120;      // 'Time'     -100..100 (global envelope-time scale)
```

Key points:
- **className** must match `expectedClassName` from
  `devicePresets.ts` exactly.
- **Parameter index — verify at runtime, never from the `.adv` or the
  docs.** LOM inserts hidden prefix params on many devices and orders
  nested sections differently from the file (Operator's XML nests every
  section, so document order is not LOM order). Observed +2 shift on
  Permute (see `memory/project_permute_param_indices.md`).
- **Ranges** come off the same dump (`min` / `max`). The wire carries
  raw Live units (Operator `Time` is −100..100, `Tone` 0..1; DrumCell's
  continuous params are normalized 0..1), so the view converts, not
  the surface.

### 1.4 Step 3 — create the control component

`interface/src/lib/components/v6/device-panel/DelayControl.svelte`:

```svelte
<script lang="ts">
  import type { Device } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import BaseDeviceControl from './BaseDeviceControl.svelte';
  import DeviceXY from './DeviceXY.svelte';

  let { device, position }: { device: Device | null; position: PositionKey } = $props();

  const PARAM_CONFIG = {
    time:     { index: 8,  min: 0, max: 7, type: 'int'   as const },
    feedback: { index: 12, min: 0, max: 1, type: 'float' as const }
  };

  let timeValue     = $derived(
    device ? selectedTrackStore.getParameterValue(device.id, PARAM_CONFIG.time.index)     ?? 0.5 : 0.5
  );
  let feedbackValue = $derived(
    device ? selectedTrackStore.getParameterValue(device.id, PARAM_CONFIG.feedback.index) ?? 0.3 : 0.3
  );
</script>

<BaseDeviceControl {position} {device} title="Delay" showMoveToTop={true}>
  {#snippet children({ sendParam, storePendingParam, triggerLoad, handleTap, isGhost, isLoading, color })}
    <DeviceXY
      xValue={timeValue}
      yValue={feedbackValue}
      title="DELAY"
      {isGhost}
      {color}
      onTap={handleTap}
      onInteraction={(x, y) => {
        if (isGhost || isLoading) {
          if (isGhost) triggerLoad();
          storePendingParam(PARAM_CONFIG.time.index, x);
          storePendingParam(PARAM_CONFIG.feedback.index, y);
        } else {
          sendParam(PARAM_CONFIG.time.index, x);
          sendParam(PARAM_CONFIG.feedback.index, y);
        }
      }}
    />
  {/snippet}
</BaseDeviceControl>
```

Rules:
- `$derived` reads from the selected-track store (which proxies to
  the v3 normalized store). Never hold a `$state` snapshot that
  shadows the store.
- Use `BaseDeviceControl` — it handles tap-to-load, ghost state,
  move-to-top, and central-view transitions.
- Normalize to 0–1 for display; multiply by `max-min` when sending
  to Ableton. `sendParam` forwards a 0–1 value — the device
  metadata in `data/device-configs.json` rescales on the UI side.

### 1.5 Step 4 — wire into the FX grid

Edit `interface/src/lib/config/fxGridLayout.ts`:

```typescript
import DelayControl from '$lib/components/v6/device-panel/DelayControl.svelte';

export const FX_GRID_LAYOUT: FXGridSlotConfig[] = [
  { position: 'fx1', deviceType: 'filter', component: AutoFilterControl, col: 1, span: 2, row: 1 },
  { position: 'fx3', deviceType: 'delay',  component: DelayControl,      col: 3, span: 2, row: 1 },
  { position: 'fx7', deviceType: 'utility', component: UtilityControl,   col: 12, span: 1, rowSpan: 2, row: 1 },
  // ...
];
```

Grid rendering is data-driven from this file. `FXGrid.svelte`
doesn't need editing.

### 1.6 Step 4-alt — virtual device

For `gridSlot: false` devices, skip the `fxGridLayout.ts` entry and
instead drop the control into the central view for its
`centralViewGroup`:

```svelte
<!-- SmudgeCentralView.svelte -->
<script lang="ts">
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { getCentralViewDevices } from '$lib/config/devicePresets';
  import ChorusControl from '../../device-panel/ChorusControl.svelte';

  const virtualSmudgeDevices = getCentralViewDevices('smudge').filter(k => k !== 'smudge');
</script>

<div class="virtual-devices-layout">
  {#each virtualSmudgeDevices as deviceType}
    {@const device = selectedTrackStore.getFxGridSlot(deviceType).device}
    {#if deviceType === 'chorus'}<ChorusControl {device} />{/if}
  {/each}
</div>
```

Virtual device controls:
- Use `slotKey` instead of `position`.
- Set `disableCentralViewOnTap={true}` — the user is already in the
  right view, re-triggering navigation would loop.
- Set `showMoveToTop={true}` to get the reorder arrow.

### 1.7 Step 5 — (optional) central display view

If your device wants more controls than fit in a grid slot, create a
central view in `interface/src/lib/components/v6/central/views/`:

```svelte
<!-- DelayCentralView.svelte -->
<script lang="ts">
  import GenericParameter from '$lib/components/v6/parameters/GenericParameter.svelte';
  let { device }: { device: Device | null } = $props();
</script>

<div class="h-full flex flex-col items-center justify-center p-6">
  {#if device}
    <GenericParameter
      path={`tracks/${trackIdx}/devices/${device.index}/params/15`}
      min={0} max={1}
      orientation="horizontal"
      displayName="TONE"
      valueFormat="percentage"
    />
  {/if}
</div>
```

Register in `interface/src/lib/components/v6/central/viewRegistry.ts`:

```typescript
import DelayCentralView from './views/DelayCentralView.svelte';
// ...
case 'delay': return DelayCentralView;
```

The main device control navigates there via `centralDisplayStore.setView()`
(grid devices only; virtual devices skip this).

### 1.8 Instruments — no FX-grid slider any more (ADR-438)

Instruments aren't FX-grid devices, and since the ten-column cut
(2026-09-15) they have no tile on the grid either. The `fx1` slot's top
half used to hold a track-coloured instrument slider that drove one
expressive parameter and tapped to the instrument's central view; both
jobs moved. The **track strip's device band** (`TrackDeviceView`, PR #496)
opens the view, and the parameter is reached in the view itself.

So adding a new instrument type needs no grid work: register its central
view (§2) and give it a glance entry in
`interface/src/lib/config/instrumentGlanceMap.ts` so the strip's band
draws its four leading controls. `instrumentSliderMap.ts` is gone — see
ADR-438 for what replaced it.

### 3.1 Step 1 — extend the allowlist

Edit `surface/components/PropertyComponent.py`,
`ALLOWLIST` dict. Keys are `(deviceClassName, propertyName)` tuples;
values are `PropertySpec` entries naming the listener target,
attribute name, value type, and read/write flag.

```python
ALLOWLIST: Dict[Tuple[str, str], PropertySpec] = {
    # existing entries...

    # New device — Roar
    ("Roar", "color_index"): PropertySpec(
        listener_target="device",      # bind on the device itself (or "sample" for nested)
        attr_name="color_index",
        value_type=int,
        writable=True,
    ),
}
```

Rules:
- **Closed allowlist.** Anything outside this dict rejects with
  `write-rejected detail="property-not-allowed"`.
- **Dict-valued properties** (like Compressor2's routing pair) set
  `coerce_dict_to_json=True` and ride as JSON strings on the wire.
- **Read-only properties** set `writable=False`; writes reject with
  `write-rejected detail="property-read-only"`.
- **Listener-less attributes** — some Live 12 attrs (e.g. Groove's
  `base`) expose no `add_<attr>_listener`. The write handler must
  emit `/property/value` directly after a successful `setattr`.
  Pattern: check `attr_name not in self._<attr>_listeners`, echo
  after write.
- **Listener-less *recompute* attributes** — some attributes are
  observable on paper but Live never invokes the listener when their
  value changes as a *side-effect* of a different attribute's
  mutation. `Sample.slices` is the canonical case: `slicing_sensitivity`
  and `playback_mode` writes recompute the slice list, but the
  `slices` listener doesn't fire. Use `cascade_to=("sample.slices",)`
  on the *source* spec; `_emit_cascades` re-reads + re-emits each
  cascade target on both fire AND set, with a deferred 150 ms
  re-read for cases where Live's recompute lands on a later tick
  (e.g., `playback_mode` write → slice compute on the next tick).
  See ADR-354.

  ```python
  ("OriginalSimpler", "sample.slicing_sensitivity"): PropertySpec(
      listener_path="sample", attr_name="slicing_sensitivity", writable=True,
      cascade_to=("sample.slices",),
  ),
  ```

  Each name in `cascade_to` must itself be in the allowlist for the
  same `deviceClassName`; missing targets log WARN and are skipped.
- **List-shaped values** ride the same JSON-string lane as dicts.
  `Sample.slices` (list of int frame positions) sets
  `coerce_dict_to_json=True`; `_jsonable` recursively serializes
  iterables of primitives, so `[0, 12345]` → `"[0, 12345]"` on the
  wire. UI consumers `JSON.parse` to a typed array.
- **Computed rows (ADR-428)** — a property with **no LOM attribute
  behind it**. `PropertySpec(listener_path="", attr_name=<key>,
  writable=…, computed="<provider>")` names a provider registered on
  the component (`computed_providers` at construction, or
  `register_computed_provider`). The provider owns read / set /
  subscribe, and the surface itself emits the `property/value` echo
  after a successful set — nothing in the LOM fires for it. A cold read
  with no value is `nil` (OSC typetag `N`, JSON `null` in the UI). A
  row whose provider is not wired rejects with
  `write-rejected detail="computed-provider-missing"`. Precedent: the
  Drum Rack's `vm.*` functions and its read-only `vm.members` census,
  provided by `DrumVirtualMacroComponent`.

### 3.2 Step 2 — restart Live fully

Live caches Remote Script bytecode in `__pycache__`. After editing
`PropertyComponent.py`:

```bash
# Quit Live, not just re-select the surface
osascript -e 'tell application "Ableton Live 12 Suite" to quit'

# Optional — force-clear the bytecode cache
rm -rf surface/__pycache__

# Start Live again
open -a "Ableton Live 12 Suite"
```

Check Live's log for `INFO:looping: - Vamp surface init`.

### 3.3 Step 3 — subscribe + read in the UI

Subscribe once (typically in the component that owns the property):

```svelte
<script lang="ts">
  import { simpleClient } from '$lib/api/simpleClient';
  import { propertyStore } from '$lib/stores/v3/propertySubscriptions.svelte';

  let { device }: { device: Device | null } = $props();
  let devicePath = $derived(device?.path);

  $effect(() => {
    if (!devicePath) return;
    simpleClient.sendOsc('/looping/v3/property/subscribe', [devicePath, 'voice_mode_index']);
    return () => simpleClient.sendOsc('/looping/v3/property/unsubscribe', [devicePath, 'voice_mode_index']);
  });

  let voiceMode = $derived(
    devicePath ? propertyStore.getValue(devicePath, 'voice_mode_index') ?? 0 : 0
  );

  function setVoiceMode(value: number) {
    if (!devicePath) return;
    simpleClient.sendOsc('/looping/v3/property/set', [devicePath, 'voice_mode_index', value, generation.current]);
  }
</script>
```

Subscribe is idempotent — re-subscribing the same pair is a no-op.
The first reply from the surface is the current value (acts as the
cold read).

### 3.4 Step 4 — allowlist rejects gracefully

If you try to subscribe to an unsupported pair, the surface replies
with `/looping/v3/error` carrying
`write-rejected detail="property-not-allowed"`. The UI error banner
store surfaces this as a toast. There is no silent drop.

## 4. Move-to-top arrows

All device controls should enable `showMoveToTop={true}` on
`BaseDeviceControl`. The arrow appoints the device (blue-hand in
Ableton) and moves it to position 0 in the chain.

- **Grid devices** — use `position` prop; arrow goes top-left.
- **Virtual devices** — use `slotKey` prop; arrow goes top-left.

Implementation lives in `BaseDeviceControl.svelte`; it uses
`deviceMoveService.ts` which fires `/looping/v3/device/move`
(addresses carry `devicePath`, not int IDs).

Exception: **Digital LFO** does not get an arrow because it controls
the same device as Digital.

## 5. Parameter index verification

Never hardcode parameter indices from the docs, from the `.adv`, or
from a device's patcher declaration order. LOM inserts hidden prefix
params on many devices and orders nested sections differently from the
file. Verify by name off the running device (Live open, the device
first on track N):

```bash
node owner/probes/lom_probe_driver.js '[{"kind":"introspect","path":"tracks/N/devices/0","attrs":"parameters.*name"}]'
```

The reply lists every parameter name in LOM order; ask for the few
ranges you need by index (`parameters[29].min,parameters[29].max`)
rather than the whole list — a reply is one UDP datagram under darwin's
9,216 B cap. `state/full`'s P records carry the same names if you would
rather read them in the UI's parsed tree. The rest of the probe family
is in `surface/CLAUDE.md` §"LOM probes".

## 6. Control types available

| Control         | Shape | Best for |
| --------------- | ----- | -------- |
| `DeviceXY`      | 2-axis pad | Delay (time/feedback), Filter (freq/res), Reverb (decay/mix). |
| `DeviceSlider`  | Single axis | Utility (gain), Compressor (threshold). |
| `GenericParameter` | Labeled horizontal slider | Extended controls in central views. |
| Custom         | Anything | EQ (frequency curve), Drum Buss (meters). |

Custom controls must implement tap detection manually and call
`triggerLoad()` / `storePendingParam()` for ghost-state handling —
see `BaseDeviceControl.svelte` for reference.

## 7. Testing

1. Load the device via the GestureBrowser or the new grid slot.
2. Verify `DeviceControl` transitions from ghost → active.
3. Move a parameter on the touch control → Live responds.
4. Move the same parameter in Live → UI responds (bidirectional sync).
5. Switch tracks → returns to ghost.
6. For properties: verify subscribe-reply carries the current value;
   verify listener fires when you edit the property in Live.

## 8. Common pitfalls

| Symptom | Cause |
| ------- | ----- |
| UI shows default values, not Live's. | Device not in `data/device-configs.json` → param metadata missing on UI side. |
| Wrong device matches (generic plugin). | `defaultName` too generic — must match Ableton's reported name exactly. Both `expectedClassName` AND `defaultName` must match. |
| Parameter indices off by 1 or 2. | Trusted device docs instead of runtime dump. LOM inserts hidden prefix params. |
| Property write silently does nothing. | Missing from `PropertyComponent.py` `ALLOWLIST`; surface rejects with `property-not-allowed`. Check the error banner. |
| Live log says `Address already in use`. | Remote Script bytecode cache is stale. Quit Live fully, delete `__pycache__`, relaunch. |
| `ArgumentError` in surface log. | LOM handle invalidated (device / clip deleted). Listener needs to catch `_LOM_ERRORS` tuple (includes `TypeError`), not `(RuntimeError, AttributeError)`. |
