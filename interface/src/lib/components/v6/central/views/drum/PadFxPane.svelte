<script module lang="ts">
  import type { Component as CachedComponent } from 'svelte';
  // One cache for every pane ever mounted: the pane lives exactly as long as
  // the scope, so a per-instance cache would be empty every time it mattered.
  const componentCache = new Map<string, CachedComponent<any>>();
</script>

<script lang="ts">
  /**
   * PadFxPane — an effect's central view INSIDE the Drum Rack view, for the
   * scoped pad (issue #491, 2026-09-10).
   *
   * A pad's effect view cannot be a top-level view swap: swapping unmounts
   * the Drum Rack view and its pad column, the held finger gets a pointer
   * cancel, the scope clears and the grid snaps back to the track
   * mid-gesture. So the view opens here, beside the pad column, where the
   * hold survives opening it.
   *
   * It holds a device TYPE, never an instance: the scoped pad supplies
   * the instance through the `fxScope` context this pane provides — the
   * same effect view component the registry serves at the top level,
   * unchanged, resolving its slot against the pad's chain through
   * `useFxGridSlot`. A momentary hold over a standing latch therefore
   * shows the held pad's instance of the same type, ghosted if that pad
   * lacks it, which is the tile behaviour applied to a view.
   *
   * The header is a chip with the pad's name in its chain colour, the
   * device's name, and the way back. The effect keeps its family ink
   * inside (ADR-400: device colour is module identity); the pad's ink is
   * on the chip only. Lazy component loading follows `CentralDisplay`'s
   * idiom, with one module-level cache (the `<script module>` above — an
   * instance-level Map would die with the pane, whose lifetime is the
   * scope's, so a type opened twice mounts synchronously the second time
   * only because the cache outlives the component).
   *
   * The way back is a `use:press`, not an `onclick`: this pane is open
   * because a pad is held, so the finger that reaches for the button is
   * the SECOND finger on the glass — the multi-pointer case ADR-427
   * exists for, where iOS does not reliably synthesize a click.
   */
  import type { Component } from 'svelte';
  import { resolveViewComponent } from '../../viewRegistry';
  import { PANE_PERMUTE } from '$lib/services/deviceViewRouter.svelte';
  import { provideFxScope, type FxScope } from '../../fxScope';
  import { DEVICE_PRESETS } from '$lib/config/devicePresets';
  import { padTileLabel } from '$lib/services/drumVirtualMacros';
  import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { logger } from '$lib/utils/logger';
  import { press } from '$lib/actions';

  interface Props {
    /** The registry's device subtype (`reverb`, `delay`, …). */
    deviceType: string;
    /** The scoped pad; the view's slot resolves against its chain. Reactive. */
    scope: () => FxScope | null;
    onBack: () => void;
  }

  let { deviceType, scope, onBack }: Props = $props();

  provideFxScope(scope);

  let ViewComponent = $state<Component<any> | null>(null);
  let latest = '';

  $effect(() => {
    const type = deviceType;
    latest = type;
    const cached = componentCache.get(type);
    if (cached) {
      ViewComponent = cached;
      return;
    }
    // Nothing to show until the import resolves: the header already names
    // the new type, and the old type's view standing under it would be a
    // Reverb labelled Delay for however long the import takes.
    ViewComponent = null;
    // The Permute view is a top-level registry entry, not a device view
    // (ADR-435 follow-up, 2026-09-14): under a pad scope the strip's
    // Permute tap opens it HERE, for the pad, so the pad column stays.
    const loader = type === PANE_PERMUTE ? resolveViewComponent(PANE_PERMUTE) : resolveViewComponent('device', type);
    if (!loader) return;
    loader()
      .then((module) => {
        if (latest !== type) return;
        componentCache.set(type, module.default);
        ViewComponent = module.default;
      })
      .catch((error) => {
        logger.error('PadFxPane: failed to load view', { component: 'PadFxPane', type, error: error?.message });
      });
  });

  let current = $derived(scope());
  let padInk = $derived(
    current && current.color !== null ? trackInk(rgbToHex(current.color), paintModeReactive()) : null
  );
  let padLabel = $derived(current ? padTileLabel(current.name) || `Pad ${current.note}` : '');
  let deviceLabel = $derived(
    deviceType === PANE_PERMUTE
      ? DEVICE_PRESETS.sequencer.defaultName
      : (DEVICE_PRESETS[deviceType]?.defaultName ?? deviceType)
  );
</script>

<div class="pad-fx-pane" data-vm-pane={deviceType} style={padInk ? `--chip-ink: ${padInk}` : undefined}>
  <div class="pad-fx-header">
    <button
      type="button"
      class="pad-fx-back physical-button"
      aria-label="Back to the pad's controls"
      use:press={{ onPress: onBack, touchAction: 'none' }}
    >‹</button>
    <span class="pad-chip pad-fx-chip" aria-label="pad">{padLabel}</span>
    <span class="pad-fx-device">{deviceLabel}</span>
  </div>
  <div class="pad-fx-body">
    {#if ViewComponent}
      <ViewComponent />
    {/if}
  </div>
</div>

<style>
  .pad-fx-pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
    flex: 1 1 0;
    gap: 6px;
  }
  .pad-fx-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    min-height: 28px;
  }
  .pad-fx-back {
    width: 44px;
    height: 28px;
    border-radius: var(--radius-sm, 2px);
    font-size: 18px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  /* The chip's face is the global `.pad-chip` (app.css). */
  .pad-fx-chip {
    padding: 2px 10px;
  }
  .pad-fx-device {
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: var(--font-weight-medium);
    letter-spacing: 0.04em;
    color: var(--signal-dim);
    white-space: nowrap;
  }
  .pad-fx-body {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    position: relative;
  }
  /* The effect views size themselves to their host; give them one. */
  .pad-fx-body > :global(*) {
    height: 100%;
  }
</style>
