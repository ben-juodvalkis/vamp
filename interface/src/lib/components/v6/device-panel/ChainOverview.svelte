<script lang="ts">
  /**
   * ChainOverview — the FX section's second face: every device on the
   * selected track, in chain order, as wide as their number allows: one
   * row while the chain is short, two once it is long (`chainGrid`).
   *
   * A tap appoints the device (Live's blue hand) and opens its controls in
   * the central view, which stays up beside this list — so choosing
   * between two Auto Filters, or among racks, is a tap each with both on
   * screen. A device a grid tile can control takes that tile's view, and
   * becomes what the tile controls (the pick). A rack opens the rack view
   * on that rack; anything with no view of its own opens the generic one.
   *
   * Each cell says which tile controls it, when one does, so the grid's
   * choice is visible here too.
   *
   * The power button in a cell's corner turns the device on and off
   * (Device On, parameter 0). A cell dragged moves the device in Live's
   * chain (`device/move`): the cell rides the finger, the others slide
   * aside to show where it will land, and the new order holds after the
   * drop until Live's republish shows it (or 2 s pass, Live having
   * refused). The instrument stays put and nothing crosses it
   * (`utils/chainDrop`). A dashed + cell after the last device opens the
   * browser on its Effect segment (`openEffectsBrowser`), as the strips
   * row's add buttons end the tracks; a pick joins this chain, the pad's
   * under a pad scope.
   *
   * **A cell carries its tile's control** (2026-10-25): a device the FX
   * grid has a tile for shows that tile — its XY or slider, the grid's own
   * component handed this cell's device — so whatever the grid can do the
   * chain can too. A touch on it drives the device and makes it the pick
   * (the one its tile and view control), and never starts a reorder. Under
   * a pad scope the overview provides the pad's `fxScope`, as the grid
   * does, so the tiles resolve against the pad's chain. MidiWheels carries
   * the pitch and mod wheels (`MidiWheelsPanel`); the wheels' wire names
   * the selected track, so a pad's chain draws its mark instead. A
   * Permute carries its mute and pitch steps (`chain/PermuteStepsFace`),
   * the track's instrument the control its view is known by
   * (`chain/InstrumentFace`: Omnisphere's ORB, Drift's filter), and a
   * Drum Rack its kit's Trnsp (`chain/DrumRackFace`, `vm.pitch`).
   *
   * **A pad follows the Drum Rack view.** While a pad is held or latched
   * on the selected track's Drum Rack, the overview is that pad's chain —
   * its instrument, then its effects (`vm.padFx`, with the records the
   * pad's `vm.padChain` row brings) — framed and chipped in the pad's
   * ink like the grid, and a tap opens the effect's view in the Drum Rack
   * view's pane, as a tile does under the same scope.
   */
  import Box from '@lucide/svelte/icons/box';
  import Hand from '@lucide/svelte/icons/hand';
  import Plug from '@lucide/svelte/icons/plug';
  import Power from '@lucide/svelte/icons/power';
  import Plus from '@lucide/svelte/icons/plus';
  import { browserModeStore } from '$lib/stores/v6/browserModeStore.svelte';
  import { drumPadScope } from '$lib/stores/v6/drumPadScope.svelte';
  import type { Component } from 'svelte';
  import { FX_GRID_LAYOUT, type DeviceTypeKey } from '$lib/config/fxGridLayout';
  import { provideFxScope } from '$lib/components/v6/central/fxScope';
  import GuitarControl from './GuitarControl.svelte';
  import BassControl from './BassControl.svelte';
  import PitchControl from './PitchControl.svelte';
  import GlitchControl from './GlitchControl.svelte';
  import SquashControl from './SquashControl.svelte';
  import ControlTile from './ControlTile.svelte';
  import { controlFor } from './deviceControls';
  import MidiWheelsPanel from '$lib/components/v6/midi/MidiWheelsPanel.svelte';
  import PermuteStepsFace from './chain/PermuteStepsFace.svelte';
  import InstrumentFace, { FACED_INSTRUMENTS } from './chain/InstrumentFace.svelte';
  import DrumRackFace from './chain/DrumRackFace.svelte';
  import { schemeFromInk } from '$lib/config/devicePresets';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import constants from '$config/constants.json';
  import Music from '@lucide/svelte/icons/music';
  import { press } from '$lib/actions/press';
  import { swallowNextClick } from '$lib/utils/swallowNextClick';
  import { drag, type DragInfo } from '$lib/actions/drag';
  import { moveDevice } from '$lib/services/deviceMoveService';
  import { chainGrid, clampChainIndex, moved } from '$lib/utils/chainDrop';
  import { flip } from 'svelte/animate';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
  import { fxChainStore } from '$lib/stores/v6/fxChainStore.svelte';
  import { DEVICE_PRESETS, DEVICE_FAMILY_INKS } from '$lib/config/devicePresets';
  import ControlGlyph from './ControlGlyph.svelte';
  import { DEVICE_CLASS_GLYPHS, DEVICE_KEY_GLYPHS, glyphForName, type ControlGlyphName } from '$lib/config/controlGlyphMap';
  import { pickSlotDevice } from '$lib/utils/deviceSlotMatch';
  import { activeDrumRackScope, selectedDrumRack } from '$lib/services/deviceViewRouter.svelte';
  import { effectTypeOf, openEffectView } from '$lib/services/effectView.svelte';
  import { trackHoldScope } from '$lib/stores/v6/trackHoldScope.svelte';
  import { usePadChainRows } from '$lib/components/v6/central/usePadChainRows.svelte';
  import { DEVICE_TYPE_INSTRUMENT, VM_PAD_FX, parseVmPadFx, padTileLabel } from '$lib/services/drumVirtualMacros';
  import { trackDeviceGlance } from '$lib/components/v6/tracks/composables/useTrackDevice.svelte';
  import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackInk } from '$lib/utils/selectedTrackInk';
  import TrackDeviceView from '$lib/components/v6/tracks/TrackStrip/components/TrackDeviceView.svelte';
  import type { DeviceRecord } from '$lib/stores/v3/normalized.svelte';

  /** The tiles that control a device, by preset key, and what each is called on the grid. */
  const TILE_LABELS: Record<string, string> = {
    random: 'Rand Oct',
    octave: 'Pitch',
    eq: 'EQ',
    filter: 'Filter',
    drum: 'Drum',
    chorus: 'Chorus',
    glitchLoop: 'Glitch',
    squash: 'Glue',
    guitar: 'Gtr',
    bass: 'Bass',
    saturator: 'Drive',
    tremolo: 'Tremolo',
    echo: 'Echo',
    reverb: 'Reverb',
    variation: 'Stutter',
    utility: 'Gain',
    sequencer: 'Permute'
  };

  /** The grid's tile for a device type, by `DEVICE_PRESETS` key: the layout's slots, then the tiles placed outside it. */
  const TILE_COMPONENTS: Record<string, { Tile: Component<any>; position?: string }> = {
    ...Object.fromEntries(FX_GRID_LAYOUT.map((slot) => [slot.deviceType, { Tile: slot.component, position: slot.position }])),
    guitar: { Tile: GuitarControl },
    bass: { Tile: BassControl },
    octave: { Tile: PitchControl },
    glitchLoop: { Tile: GlitchControl },
    squash: { Tile: SquashControl }
  };

  /** MidiWheels, re-found as the surface finds it: class + the name Live gives the loaded `.amxd`. */
  const MIDI_WHEELS = constants.devices.midiWheels;
  const isMidiWheels = (d: DeviceRecord) => d.className === MIDI_WHEELS.className && d.name === MIDI_WHEELS.deviceName;

  /** Live's class as a person would say it, for a device renamed away from its type. */
  const TYPE_LABELS: Record<string, string> = {
    AutoFilter2: 'Auto Filter',
    Hybrid: 'Hybrid Reverb',
    StereoGain: 'Utility',
    AudioEffectGroupDevice: 'Effect Rack',
    InstrumentGroupDevice: 'Instrument Rack',
    MidiEffectGroupDevice: 'MIDI Rack',
    DrumGroupDevice: 'Drum Rack',
    MxDeviceAudioEffect: 'Max Effect',
    MxDeviceMidiEffect: 'Max MIDI',
    MxDeviceInstrument: 'Max Instrument',
    AuPluginDevice: 'Plug-in',
    PluginDevice: 'Plug-in',
    InstrumentVector: 'Wavetable',
    OriginalSimpler: 'Simpler',
    MultiSampler: 'Sampler',
    UltraAnalog: 'Analog',
    InstrumentMeld: 'Meld',
    GlueCompressor: 'Glue',
    Compressor2: 'Compressor',
    ChannelEq: 'Channel EQ',
    Chorus2: 'Chorus',
    PhaserNew: 'Phaser',
    Redux2: 'Redux',
    BeatRepeat: 'Beat Repeat'
  };


  type Cell = {
    /** Stable across Live's renumbering (paths are positions): name, class, and which of those it is. */
    key: string;
    device: DeviceRecord;
    order: number;
    kind: 'instrument' | 'rack' | 'max' | 'plugin' | 'effect';
    presetKey: string | null;
    tile: string | null;
    typeLabel: string | null;
    ink: string;
    on: boolean;
    powered: boolean;
    macros: { name: string; value: number }[];
  };

  const trackPath = $derived(selectedTrackStore.selectedTrackPath);

  // The pad the Drum Rack view has scoped, as the FX grid reads it: not
  // under a track hold, whose grid is another track's.
  const padScope = $derived(trackHoldScope.active ? null : activeDrumRackScope());
  usePadChainRows(() => selectedDrumRack()?.rackPath, () => padScope?.note);
  // The tiles in the cells resolve against the pad's chain while one is scoped.
  provideFxScope(() => padScope);

  /** The pad's chain in order: its instrument and effects, the records where the pad's row has sent them. */
  const padChain = $derived.by(() => {
    if (!padScope) return null;
    const fx = parseVmPadFx(selectedTrackStore.propertyValue(padScope.rackPath, VM_PAD_FX))?.get(padScope.note) ?? [];
    const records = new Map(selectedTrackStore.padDevices(padScope.padPath).map((d) => [d.devicePath, d]));
    return fx.map((d) => {
      const devicePath = `${padScope.padPath}/devices/${d.index}`;
      const device: DeviceRecord = records.get(devicePath) ?? {
        devicePath,
        name: d.name,
        className: d.className,
        params: new Map(),
        properties: new Map()
      };
      return { device, instrument: d.type === DEVICE_TYPE_INSTRUMENT };
    });
  });

  /** Picks are the pad's under a pad scope, as the grid's tiles read them. */
  const pickScope = $derived(padScope?.padPath ?? trackPath);

  const devices = $derived(
    padChain
      ? padChain.map((c) => c.device)
      : [...selectedTrackStore.devicesByPath].sort((a, b) => indexOf(a.devicePath) - indexOf(b.devicePath))
  );
  const padInk = $derived(padScope && padScope.color !== null ? trackInk(rgbToHex(padScope.color), paintModeReactive()) : null);
  const glance = $derived(trackDeviceGlance(trackPath));
  const paint = $derived(paintModeReactive());
  const trackColor = $derived(selectedTrackInk() ?? 'var(--signal-dim)');

  /** devicePath → the grid tile that controls it, under the type-first rule and the picks. */
  const tileOf = $derived.by(() => {
    const out = new Map<string, string>();
    for (const [key, label] of Object.entries(TILE_LABELS)) {
      const config = DEVICE_PRESETS[key];
      if (!config) continue;
      const chosen = pickSlotDevice(devices, config, fxChainStore.pickFor(pickScope, key));
      if (chosen && !out.has(chosen.devicePath)) out.set(chosen.devicePath, label);
    }
    return out;
  });

  const cells = $derived<Cell[]>(
    devices.map((device, i, all) => {
      const nth = all.slice(0, i).filter((d) => d.name === device.name && d.className === device.className).length;
      const presetKey = presetKeyFor(device);
      const isInstrument = padChain
        ? padChain[i].instrument
        : glance.kind === 'instrument' && glance.headPath === device.devicePath;
      const kind: Cell['kind'] = isInstrument
        ? 'instrument'
        : device.className === 'AudioEffectGroupDevice' && !presetKey
          ? 'rack'
          : device.className.startsWith('MxDevice') && !presetKey
            ? 'max'
            : device.className.endsWith('PluginDevice')
              ? 'plugin'
              : 'effect';
      const family = presetKey ? DEVICE_PRESETS[presetKey].color.primary : kind === 'rack' ? DEVICE_FAMILY_INKS.rackVoice.primary : DEVICE_FAMILY_INKS.utility.primary;
      const typeLabel = TYPE_LABELS[device.className] ?? splitCamel(device.className);
      return {
        key: `${device.className}|${device.name}|${nth}`,
        device,
        order: i + 1,
        kind,
        presetKey,
        tile: tileOf.get(device.devicePath) ?? null,
        typeLabel: typeLabel.toLowerCase() === device.name.toLowerCase() ? null : typeLabel,
        ink: isInstrument ? (padChain ? (padInk ?? trackColor) : trackColor) : trackInk(family, paint),
        on: (selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, 0)) ?? 1) > 0,
        // A pad's instrument has no records on the wire (they are the
        // virtual-macro layer's), so there is no Device On to show.
        powered: selectedTrackStore.paramValue(selectedTrackStore.paramPath(device, 0)) !== undefined,
        macros: kind === 'rack' ? macrosOf(device) : []
      };
    })
  );

  /**
   * Devices past which the chain takes a second row. Up to it the cells and
   * the + cell share one row, wide as the track strips get; past it the
   * cells split evenly over two rows (`chainGrid`). Reads like Live's chain:
   * left to right, then the next row.
   */
  const CHAIN_WRAP_AFTER = 5;
  const grid = $derived(chainGrid(cells.length, CHAIN_WRAP_AFTER));

  function indexOf(path: string): number {
    const m = /\/devices\/(\d+)$/.exec(path);
    return m ? Number(m[1]) : 0;
  }

  function splitCamel(s: string): string {
    return s.replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  const presetKeyFor = (device: DeviceRecord) => effectTypeOf(device);

  function macrosOf(device: DeviceRecord): { name: string; value: number }[] {
    const names = selectedTrackStore.paramNamesForDevice(device as never);
    const out: { name: string; value: number }[] = [];
    for (let i = 1; i < names.length && out.length < 8; i++) {
      const name = names[i];
      if (!name || /^Macro \d+$/.test(name)) continue;
      const value = selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(device, i)) ?? 0;
      out.push({ name, value: Math.max(0, Math.min(1, value / 127)) });
    }
    return out;
  }

  function togglePower(cell: Cell) {
    const path = selectedTrackStore.paramPath(cell.device, 0);
    selectedTrackStore.setParamValue(path, cell.on ? 0 : 1);
  }

  // A drag in flight: which cell, where it started, where it would land
  // now, and the box it rides from (relative to the chain).
  let dragging = $state<{
    key: string;
    path: string;
    from: number;
    to: number;
    dx: number;
    dy: number;
    box: { left: number; top: number; width: number; height: number };
  } | null>(null);
  let chainEl = $state<HTMLElement | null>(null);
  // After a drop: the order we expect Live to report, shown until it does.
  let pending = $state<{ order: string[]; until: number } | null>(null);

  const instrumentIndex = $derived(cells.findIndex((c) => c.kind === 'instrument'));
  const naturalOrder = $derived(cells.map((c) => c.key));

  // Live's republish shows the move (or something else happened, or it
  // never came): the chain as Live reports it takes over again.
  $effect(() => {
    if (!pending) return;
    const now = naturalOrder.join('\n');
    if (now === pending.order.join('\n')) {
      pending = null;
      return;
    }
    const timer = setTimeout(() => (pending = null), Math.max(0, pending.until - Date.now()));
    return () => clearTimeout(timer);
  });

  /** The cells in the order to draw them: the drag's preview, else a drop Live has not shown yet. */
  const shown = $derived.by(() => {
    if (dragging) return moved(cells, dragging.from, dragging.to);
    if (pending) {
      const byKey = new Map(cells.map((c) => [c.key, c]));
      const order = pending.order.map((k) => byKey.get(k));
      if (order.every(Boolean) && order.length === cells.length) return order as Cell[];
    }
    return cells;
  });

  /** The cell position under a point, by the grid's own geometry — not the cells, which are sliding. */
  function positionAt(x: number, y: number): number | null {
    if (!chainEl) return null;
    const box = chainEl.getBoundingClientRect();
    const gap = 8;
    const { cols, rows } = grid;
    const col = Math.max(0, Math.min(cols - 1, Math.floor(((x - box.left) * cols) / (box.width + gap))));
    const row = rows === 1 ? 0 : y < box.top + box.height / 2 ? 0 : 1;
    return row * cols + col;
  }

  // A press that lands on a cell's tile is the tile's: it picks the device
  // and the cell neither reorders nor taps. Read at finger-down, from the
  // press's own target — Svelte delegates the tiles' pointer handlers to
  // the root, so stopping the event on the way up would starve them.
  let pressInControl = false;
  function pressDown(cell: Cell, info: DragInfo) {
    const target = info.event?.target;
    pressInControl = target instanceof Element && target.closest('.cell-control') !== null;
    if (pressInControl && cell.presetKey) fxChainStore.pick(pickScope, cell.presetKey, cell.device.devicePath);
  }

  function dragStart(cell: Cell, index: number, info: DragInfo) {
    // A drag on a cell's control is that control's, and it opens the
    // device's view as a tap on the cell does — every control here, not
    // only the grid's tiles, which open their own (2026-10-26).
    if (pressInControl) {
      open(cell);
      return;
    }
    if (cell.kind === 'instrument' || !chainEl) return;
    const node = chainEl.querySelector<HTMLElement>(`[data-cell-key="${CSS.escape(cell.key)}"]`);
    const origin = chainEl.getBoundingClientRect();
    const r = node?.getBoundingClientRect();
    if (!r) return;
    pending = null;
    dragging = {
      key: cell.key,
      path: cell.device.devicePath,
      from: index,
      to: index,
      dx: info.dx,
      dy: info.dy,
      box: { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height }
    };
  }

  function dragMove(info: DragInfo) {
    if (!dragging) return;
    const at = positionAt(info.x, info.y);
    const to =
      at === null
        ? dragging.to
        : (clampChainIndex({
            from: dragging.from,
            to: at,
            count: cells.length,
            instrument: instrumentIndex >= 0 ? instrumentIndex : null
          }) ?? dragging.to);
    dragging = { ...dragging, to, dx: info.dx, dy: info.dy };
  }

  function dragEnd() {
    const d = dragging;
    dragging = null;
    if (!d || d.to === d.from) return;
    pending = { order: moved(naturalOrder, d.from, d.to), until: Date.now() + 2000 };
    void moveDevice(d.path, d.to);
  }

  /** What the device does, drawn (`ControlGlyph`): by the app's own device, its class, else its name. */
  function glyphOf(cell: Cell): ControlGlyphName | null {
    const { device } = cell;
    return (
      (cell.presetKey ? DEVICE_KEY_GLYPHS[cell.presetKey] : undefined) ??
      DEVICE_CLASS_GLYPHS[device.className] ??
      glyphForName(device.name) ??
      null
    );
  }

  /**
   * + Effect: the browser on its Effect segment. Under a pad scope the pad
   * is latched first (user, 2026-10-26): the browser covers the Drum Rack
   * view, a held pad's tile unmounts and its hold ends, and the pick must
   * still land in the pad the chain was showing.
   */
  function addEffect() {
    swallowNextClick();
    if (padScope) drumPadScope.latch(padScope.rackPath, padScope.note);
    browserModeStore.openEffectsBrowser();
  }

  function open(cell: Cell) {
    const { device } = cell;
    if (cell.kind === 'instrument') {
      // The pad's instrument is what the Drum Rack view already shows.
      if (padScope) return;
      fxChainStore.appoint(device.devicePath, { force: true });
      if (glance.instrumentViewType) {
        centralDisplayStore.setView('instrument', glance.instrumentViewType, { instrument: glance.instrument });
        return;
      }
    }
    // An effect: its view, as a browser load's (`services/effectView`).
    openEffectView(device, { pickScope, padScoped: !!padScope });
  }
</script>

{#snippet cellBody(cell: Cell, position: number, live = true)}
  {@const glyph = glyphOf(cell)}
  {@const tile = cell.kind !== 'instrument' && cell.presetKey ? TILE_COMPONENTS[cell.presetKey] : undefined}
      <!-- One row says it all, so the control below gets the height: the
           position, the name and its type, the tile that drives it, the
           blue hand, Device On. -->
      <div class="cell-head">
        <span class="order">{position + 1}</span>
        <span class="name" lang="en">{cell.device.name}</span>
        {#if cell.typeLabel}
          <span class="type">{cell.typeLabel}</span>
        {/if}
        {#if cell.tile}
          <span class="pad-chip tile-chip">{cell.tile}</span>
        {/if}
        <span class="head-end">
        {#if fxChainStore.appointed === cell.device.devicePath}
          <span class="hand" aria-label="Selected in Live"><Hand /></span>
        {/if}
        {#if cell.powered}
        <button
          type="button"
          class="power"
          class:on={cell.on}
          aria-label="{cell.on ? 'Turn off' : 'Turn on'} {cell.device.name}"
          aria-pressed={cell.on}
          use:press={{ onPress: () => togglePower(cell), stopPropagation: true }}
        ><Power /></button>
        {/if}
        </span>
      </div>

      {#if live && cell.presetKey === 'sequencer'}
        <!-- Permute: its mute and pitch steps, on this device. -->
        <div class="cell-control" role="presentation"><PermuteStepsFace device={cell.device} color={cell.ink} /></div>
      {:else if live && !padScope && cell.kind === 'instrument' && glance.instrumentViewType && FACED_INSTRUMENTS.has(glance.instrumentViewType)}
        <!-- The instrument's signature control, as its view draws it. -->
        <div class="cell-control" role="presentation">
          <InstrumentFace device={cell.device} type={glance.instrumentViewType} color={selectedTrackScheme() ?? schemeFromInk(cell.ink)} />
        </div>
      {:else if live && !padScope && cell.kind === 'instrument' && cell.device.className === 'DrumGroupDevice'}
        <!-- A Drum Rack: the kit's Trnsp, as its view draws it. -->
        <div class="cell-control" role="presentation">
          <DrumRackFace device={cell.device} color={selectedTrackScheme() ?? schemeFromInk(cell.ink)} />
        </div>
      {:else if live && !padScope && isMidiWheels(cell.device)}
        <!-- The pitch and mod wheels, as the instrument views draw them:
             Pitch over Mod in a full-height cell, side by side in a
             two-row chain's half-height one. -->
        <div class="cell-control" role="presentation"><MidiWheelsPanel sideBySide={grid.rows > 1} /></div>
      {:else if tile && live}
        <!-- The grid's own tile, on this device. A touch here is the
             control's: it picks this device and never starts a reorder. -->
        <div class="cell-control" role="presentation">
          <tile.Tile device={cell.device} position={tile.position} />
        </div>
      {:else if live && controlFor(cell.presetKey)}
        <!-- No grid tile: the device's control (deviceControls), the one its
             browser preset tiles and its view draw, on this device. -->
        <div class="cell-control" role="presentation">
          <ControlTile type={cell.presetKey as DeviceTypeKey} device={cell.device} />
        </div>
      {:else}
      <div class="mark" aria-hidden="true">
        {#if cell.kind === 'instrument'}
          <!-- The strip's own mark for the instrument, so the two agree. -->
          <span class="instrument-mark"><TrackDeviceView {glance} color={cell.ink} /></span>
        {:else if glyph}
          <span class="glyph"><ControlGlyph name={glyph} /></span>
        {:else if cell.kind === 'max'}
          <Box />
        {:else if cell.kind === 'plugin'}
          <Plug />
        {:else}
          <Music />
        {/if}
      </div>
      {/if}

      {#if cell.macros.length > 0}
        <div class="macros" aria-hidden="true">
          {#each cell.macros as m (m.name)}
            <span class="macro" style="--v: {m.value};" title={m.name}></span>
          {/each}
        </div>
      {/if}
{/snippet}

<div
  class="chain"
  style:--chain-cols={grid.cols}
  style:--chain-rows={grid.rows}
  class:pad-scoped={padScope !== null}
  data-debug="chain-overview"
  data-chain-scope={padScope?.note}
  style={padInk ? `--scope-ink: ${padInk}` : undefined}
  bind:this={chainEl}
>
  {#each shown as cell, position (cell.key)}
    {@const index = cells.indexOf(cell)}
    <div
      class="chain-cell"
      class:off={!cell.on}
      class:placeholder={dragging?.key === cell.key}
      class:appointed={fxChainStore.appointed === cell.device.devicePath}
      class:instrument={cell.kind === 'instrument'}
      style="--cell-ink: {cell.ink};"
      data-cell-key={cell.key}
      data-device-path={cell.device.devicePath}
      data-kind={cell.kind}
      role="button"
      tabindex="0"
      aria-label="{cell.device.name}{cell.tile ? `, the ${cell.tile} tile's` : ''}"
      animate:flip={{ duration: 160 }}
      use:drag={{
        commit: 'either',
        onDown: (info) => pressDown(cell, info),
        onTap: () => {
          if (!pressInControl) open(cell);
        },
        onStart: (info) => dragStart(cell, index, info),
        onMove: dragMove,
        onEnd: dragEnd
      }}
    >
      {@render cellBody(cell, position)}
    </div>
  {/each}
  <!-- Add an effect: the browser on Effect, landing on this chain. -->
  <button
    type="button"
    class="chain-add"
    aria-label="Add an effect"
    data-debug="chain-add"
    use:press={{ onPress: addEffect, touchAction: 'none' }}
  >
    <span class="chain-add-icons" aria-hidden="true"><Plus /><ControlGlyph name="rack" /></span>
    <span class="chain-add-label">Effect</span>
  </button>
  {#if dragging}
    {@const cell = cells.find((c) => c.key === dragging?.key)}
    {#if cell}
      <!-- The cell under the finger, riding it; its place in the list is the gap. -->
      <div
        class="chain-cell lifted"
        class:off={!cell.on}
        class:appointed={fxChainStore.appointed === cell.device.devicePath}
        style="--cell-ink: {cell.ink}; left: {dragging.box.left + dragging.dx}px; top: {dragging.box.top - dragging.dy}px; width: {dragging.box.width}px; height: {dragging.box.height}px;"
        aria-hidden="true"
      >
        {@render cellBody(cell, dragging.to, false)}
      </div>
    {/if}
  {/if}
  {#if padScope}
    <!-- Whose chain this is, as the grid's scope chip says it. -->
    <div class="pad-chip chain-scope-chip" aria-label="Chain of pad {padScope.note}">
      {padTileLabel(padScope.name) || `Pad ${padScope.note}`}
    </div>
  {/if}
</div>

<style>
  /* As many columns and rows as the chain needs (`chainGrid`), on the FX
     grid's 8px trough. */
  .chain {
    height: 100%;
    display: grid;
    grid-template-columns: repeat(var(--chain-cols, 10), minmax(0, 1fr));
    grid-template-rows: repeat(var(--chain-rows, 2), minmax(0, 1fr));
    gap: 8px;
  }
  /* A pad's chain wears the pad's frame and chip, as the scoped grid does
     (FXGrid's .fx-scoped: drawn inside, since the section clips). */
  .chain {
    position: relative;
  }
  .chain.pad-scoped {
    outline: 2px solid var(--scope-ink, var(--track-ink, var(--phosphor)));
    outline-offset: -2px;
    border-radius: var(--radius-sm, 2px);
  }
  .chain-scope-chip {
    --chip-ink: var(--scope-ink, var(--track-ink));
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 3;
    pointer-events: none;
  }
  /* The + cell: the strips row's add buttons' dashed ghost (NewTrackButtons). */
  .chain-add {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
    min-height: 0;
    padding: 0;
    border: 1px dashed var(--line-strong);
    border-radius: 2px;
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .chain-add > span {
    opacity: var(--opacity-ghost);
  }
  .chain-add:active {
    background: var(--secondary);
    color: var(--foreground);
  }
  .chain-add:active > span {
    opacity: 1;
  }
  .chain-add-icons {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .chain-add-icons :global(svg) {
    width: 22px;
    height: 22px;
  }
  .chain-add-label {
    font-size: 0.8125rem;
    font-weight: var(--font-weight-medium);
  }

  .chain-cell {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--surface-well);
    color: var(--cell-ink);
    cursor: pointer;
    user-select: none;
  }
  .chain-cell.off > :not(.cell-head) {
    opacity: 0.45;
  }
  /* The cell under the finger rides it, out of the grid's flow. */
  .chain-cell.lifted {
    position: absolute;
    z-index: 4;
    pointer-events: none;
    box-shadow: 0 8px 22px oklch(0 0 0 / 0.55);
    scale: 1.04;
  }
  /* Where it will land: its own place in the previewed order, emptied. */
  .chain-cell.placeholder {
    border-style: dashed;
    border-color: color-mix(in oklab, var(--cell-ink) 60%, transparent);
    background: transparent;
    box-shadow: none;
  }
  .chain-cell.placeholder > :global(*) {
    visibility: hidden;
  }
  /* The blue hand: the device Live's controllers follow. */
  .chain-cell.appointed {
    border-color: var(--cell-ink);
    box-shadow: inset 0 0 0 1px var(--cell-ink);
    background: color-mix(in oklab, var(--cell-ink) 14%, var(--surface-well));
  }

  /* Order, then the hand beside it, the power button in the corner. */
  .cell-head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 28px;
    flex: 0 0 auto;
    padding-left: 2px;
  }
  /* The first cell's corner is the FX section's switch (FxPanelSwitch). */
  .chain-cell:first-child .cell-head {
    padding-left: 38px;
  }
  .order {
    flex: 0 0 auto;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: var(--muted-foreground);
  }
  /* The hand and Device On close the row. */
  .head-end {
    flex: 0 0 auto;
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .hand {
    display: flex;
  }
  .hand :global(svg) {
    width: 16px;
    height: 16px;
  }
  /* Device On. Lit while the device runs, dim when bypassed. */
  .power {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 28px;
    margin-right: -2px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .power.on {
    color: var(--cell-ink);
  }
  .power :global(svg) {
    width: 16px;
    height: 16px;
  }

  .mark {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }
  .mark :global(svg) {
    width: 30px;
    height: 30px;
    stroke-width: 1.25;
  }
  /* A tile in a cell: the grid's XY or slider, minus its reorder arrows
     (the cell's drag moves the device here). */
  .cell-control {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    margin: 0 -2px;
  }
  .cell-control > :global(*) {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }
  .cell-control :global(.move-btn) {
    display: none;
  }
  .glyph {
    display: flex;
    width: 44px;
    height: 44px;
  }
  .glyph :global(svg) {
    width: 100%;
    height: 100%;
    stroke-width: 1.75;
  }
  .instrument-mark {
    width: 100%;
    height: 56px;
  }

  /* A rack is a box of macros: its named ones, as a tiny meter each. */
  .macros {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 22px;
  }
  .macro {
    flex: 1 1 0;
    height: 100%;
    background: linear-gradient(to top, var(--cell-ink) calc(var(--v) * 100%), color-mix(in oklab, var(--cell-ink) 15%, transparent) 0);
    border-radius: 1px;
  }

  /* The name keeps its room; the type takes only what is left. */
  .name {
    flex: 0 1 auto;
    min-width: 0;
    font-size: 0.8125rem;
    font-weight: var(--font-weight-medium);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .type {
    flex: 1 1 0;
    min-width: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Which grid tile controls this device. */
  .tile-chip {
    --chip-ink: var(--cell-ink);
    flex: 0 0 auto;
    font-size: 10px;
    padding: 1px 6px;
  }
</style>
