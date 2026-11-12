<script lang="ts">
import { logger } from '$lib/utils/logger';
  import type { DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
  import type { Snippet } from 'svelte';
  import type { PositionKey, DeviceTypeKey } from '$lib/config/fxGridLayout';
  import { slotRegistry } from '$lib/stores/v6/slotRegistry.svelte';
  import { DEVICE_PRESETS, schemeFromInk } from '$lib/config/devicePresets';
  import { deviceInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackInk } from '$lib/utils/selectedTrackInk';
  import { selectDevice } from '$lib/services/deviceMoveService';
  import { openDeviceView } from '$lib/services/deviceViewRouter.svelte';
  import { sendParam } from '$lib/services/deviceParams';
  import { readFxScope } from '$lib/components/v6/central/fxScope';
  import { trackHoldScope } from '$lib/stores/v6/trackHoldScope.svelte';
  import { fxChainStore } from '$lib/stores/v6/fxChainStore.svelte';

  interface Props {
    // Either position (for grid devices) OR slotKey (for virtual devices - backward compat)
    position?: PositionKey;
    slotKey?: DeviceTypeKey;
    device?: DeviceRecord | null;  // Optional - derived from slot when not provided
    title: string;
    disableCentralViewOnTap?: boolean;
    /** Off by default — the top-center device micro-label (the {title} headline). */
    showHeadline?: boolean;
    children: Snippet<[{
      device: DeviceRecord | null;
      sendParam: (paramIndex: number, value: number) => void;
      storePendingParam: (paramIndex: number, value: number) => void;
      isGhost: boolean;
      isLoading: boolean;
      triggerLoad: () => void;
      handleTap: () => void;
      /** Open this device's central view (the pane under a pad scope). Safe per drag frame. */
      openView: () => void;
      color: typeof DEVICE_PRESETS[DeviceTypeKey]['color'];
    }]>;
  }

  let { position, slotKey, device: deviceProp, title, disableCentralViewOnTap = false, showHeadline = false, children }: Props = $props();

  // Determine the key to use (position for grid devices, slotKey for virtual devices)
  const keyOrUndefined = position || slotKey;
  if (!keyOrUndefined) {
    throw new Error(`[BaseDeviceControl] Must provide either position or slotKey`);
  }
  const key = keyOrUndefined; // TypeScript now knows this is defined

  // For grid devices, we have position → deviceType lookup
  // For virtual devices, slotKey IS the deviceType
  let deviceType = $derived.by(() => {
    if (position) {
      const foundDeviceType = slotRegistry.getDeviceTypeForPosition(position);
      if (!foundDeviceType) {
        throw new Error(`[BaseDeviceControl] No device type found for position: ${position}`);
      }
      return foundDeviceType;
    } else {
      // Virtual device - slotKey IS the device type
      return slotKey!;
    }
  });

  // Calibration chokepoint (ADR-400): the tile chrome (--accent-primary),
  // the snippet-provided color, and both setView payloads all derive from
  // this — deviceInk-normalized so tiles match view interiors. trackTint
  // devices (utility/gain) wear the focused track's ink instead.
  let color = $derived.by(() => {
    if (DEVICE_PRESETS[deviceType]?.trackTint) {
      const ink = selectedTrackInk();
      if (ink) return schemeFromInk(ink);
    }
    let raw;
    if (position) {
      raw = slotRegistry.getSlot(position).color;
    } else {
      const config = DEVICE_PRESETS[slotKey!];
      if (!config) {
        throw new Error(`[BaseDeviceControl] No config found for device type: ${slotKey}`);
      }
      raw = config.color;
    }
    const mode = paintModeReactive();
    return {
      primary: deviceInk(raw.primary, mode),
      secondary: raw.secondary,
      accent: deviceInk(raw.accent, mode)
    };
  });

  // Issue #491: while a pad is held on the selected track's Drum Rack the
  // FX grid scopes every tile below it to that pad — the slot is the
  // pad's chain, a load lands in it, a drag moves the pad's copy. The
  // getter is read at init; the scope itself is reactive. A device this
  // preset says cannot live on a pad (`padScoped` unset) dims and goes
  // inert under a scope. Since ADR-435 (2026-09-14) only OTT is unset,
  // and it is master's fx1 column, not a tile on a drum track's grid —
  // so in practice every tile a scope can reach is scopable; the branch
  // is the rule, kept for the preset that opts out next.
  const getFxScope = readFxScope();
  let fxScope = $derived(getFxScope());
  // A held track strip (track hold) scopes the tile to that track when no
  // pad does: a pad pane's scope is the narrower one and wins.
  let trackHeld = $derived(fxScope === null && trackHoldScope.active);
  let scopeKey = $derived(fxScope?.padPath ?? trackHoldScope.scopeKey());
  let unscopable = $derived(fxScope !== null && !DEVICE_PRESETS[deviceType]?.padScoped);

  // Get slot state from selectedTrackStore (works for both position and device type)
  let slot = $derived(selectedTrackStore.getFxGridSlot(key, scopeKey));
  // Device can be passed as prop (backward compat) or derived from slot.
  // Under a pad scope the slot's own answer wins: the prop is the FX
  // grid's track-level lookup.
  let device = $derived(deviceProp !== undefined && !scopeKey ? deviceProp : slot.device);
  // A device handed in is a real one (a chain cell's, a device inside a
  // rack's chain included, ADR-529): never a ghost, whatever the track's
  // slot says — or a drag on a rack's Reverb would load one on the track.
  let given = $derived(!!deviceProp && !scopeKey);
  let isGhost = $derived(!given && slot.state === 'ghost');
  let isLoading = $derived(!given && slot.state === 'loading');

  // Open this device's central view — the pane inside the Drum Rack view
  // under a pad scope, the top-level device view otherwise. The router
  // is a no-op when the right view is already up, so the tiles may call
  // it on every drag frame (they used to swap the view 30×/sec).
  function openView() {
    appoint();
    if (disableCentralViewOnTap) return;
    openDeviceView(deviceType, { device, color });
  }

  // Every gesture on a tile appoints its device (Live's blue hand), so a
  // knob controller following the hand follows the iPad. Deduped in the
  // store: the tiles call openView on every drag frame. Not under a track
  // hold: selecting a device on another track would select that track in
  // Live, which is exactly what the hold is there to avoid.
  function appoint(force = false) {
    if (device && !trackHeld) fxChainStore.appoint(device.devicePath, { force });
  }

  // Trigger device loading on first interaction and conditionally switch to
  // central view. Duplicate-load de-dup is the slot's job (`loadState`), not
  // ours — a slot can have several live consumers (this control plus a
  // central view mounted mid-drag), and a private flag here would let each
  // one re-enter the load and silently drop it. See fxGridStore.loadDevice.
  function triggerLoad() {
    if (unscopable) return;
    if (isGhost) {
      selectedTrackStore.loadFxGridDevice(key, scopeKey);
      if (trackHeld) trackHoldScope.loadOnFollowers(key);
      openView();
    }
  }

  // Handle tap: conditionally switch view, select device, load device only if ghost
  async function handleTap() {
    if (unscopable) return;
    openView();
    // A deliberate tap re-sends the selection even when it is already ours.
    appoint(true);
  }

  // Send parameter change (services/deviceParams). No slot argument: a
  // tile with no device drops the write and stores pending values itself.
  async function writeParam(paramIndex: number, value: number) {
    await sendParam({ device }, paramIndex, value);
  }

  // Store a pending parameter that will be applied when device loads —
  // in the scope's own slot table, so a pad load's values drain into the
  // device that arrives on the pad.
  function storePendingParam(paramIndex: number, value: number) {
    if (unscopable) return;
    selectedTrackStore.storePendingParam(key, paramIndex, value, scopeKey);
    if (trackHeld) trackHoldScope.storePendingOnFollowers(key, paramIndex, value);
  }

  // Pending parameters are drained by FXGridState's $effect.root watcher,
  // which fires checkLoadingCompletion() on each newly-arrived device.

</script>

<div
  class="device-control glass-colored w-full h-full relative rounded-lg"
  class:device-ghost={isGhost}
  class:device-unscoped={unscopable}
  data-fx-scope={fxScope ? fxScope.note : undefined}
  style="--accent-primary: {color.primary};"
>
    {@render children({ device, sendParam: writeParam, storePendingParam, isGhost, isLoading, triggerLoad, handleTap, openView, color })}

  <!-- Device micro-label (§5.6 — the FX zone's instrument signature). Off by
       default; opt in per-control via showHeadline. -->
  {#if showHeadline}
    <div class="device-headline" aria-hidden="true">{title}</div>
  {/if}

  {#if isLoading}
    <!-- Unified loading shimmer (state-bounded). -->
    <div class="loading-overlay absolute inset-0 flex items-center justify-center">
      <div class="loading-pulse"></div>
    </div>
  {/if}

</div>

<style>
  /* Issue #491: a device that cannot live on a pad, while a pad is scoped —
     the same ghost dim an empty slot wears, and no pointer input. */
  .device-control.device-unscoped {
    opacity: var(--opacity-ghost);
    pointer-events: none;
  }

  /* Material is .glass-colored (app.css) over --accent-primary; here we only add
     the enumerated transition + states (no transition:all, no hover lift/shadow). */
  .device-control {
    transition: background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .device-control:hover:not(.device-ghost) {
    border-color: color-mix(in oklab, var(--accent-primary) 75%, transparent);
  }

  /* Ghost (§5.6): 5% desaturated wash + dashed hairline — categorically distinct.
     NO blanket opacity here: each control's own ghost CSS already dims just its
     body (DeviceXY dims the curve/handle, DeviceSlider the fill/line/handle) and
     keeps its device NAME label at full tint. A slot-wide opacity would be a
     second dim that sinks the label with everything else (opacity is a
     compositing group — a child can't out-brighten a dimmed ancestor), so the
     ghost name label now rides at full brightness.
     !important: this fights app.css `.glass-colored` (same specificity, other
     file — bundle order between app.css and component CSS isn't guaranteed). */
  .device-ghost {
    background: color-mix(in oklab, var(--accent-primary) 5%, var(--card)) !important;
    border-style: dashed !important;
    border-color: var(--line) !important;
  }

  /* Always-on device micro-label (HUD voice, §5.6), top-center. */
  .device-headline {
    position: absolute;
    top: 4px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9; /* pointer-events:none, so this is paint order only */
    pointer-events: none;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: var(--fg-tertiary);
  }

  /* Flat grammar: a device slot is a flat DetailViewBackground module in a 1px
     dark frame; the family ink stays in the control's fill/arc, not the
     panel. Ghost = the same module, dimmed, solid border. Micro-label reads
     like a Live device title: small, normal case, light grey. The ghost
     !important is required to beat the Graticule .device-ghost !important
     above (which in turn exists to beat app.css .glass-colored). */
  :global([data-grammar="flat"]) .device-control:hover:not(.device-ghost) {
    border-color: var(--line-strong);
  }
  :global([data-grammar="flat"]) .device-ghost {
    background: var(--card) !important;
    border-style: solid !important;
    border-color: var(--line-strong) !important;
  }
  :global([data-grammar="flat"]) .device-headline {
    letter-spacing: 0;
    text-transform: none;
    font-size: 11px;
    font-weight: 500;
    color: var(--foreground);
    opacity: 0.85;
  }

  .loading-overlay {
    pointer-events: none;
    z-index: 13;
  }

  .loading-pulse {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: color-mix(in oklab, var(--accent-primary) 30%, transparent);
    animation: undulate 2s ease-in-out infinite;
  }

  @keyframes undulate {
    0%, 100% {
      opacity: 0.2;
      transform: scale(0.8);
    }
    50% {
      opacity: 0.5;
      transform: scale(1.1);
    }
  }

</style>
