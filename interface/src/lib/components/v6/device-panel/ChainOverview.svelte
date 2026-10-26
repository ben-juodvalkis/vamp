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
   * refused). A drop is one move; drops made while one is in flight
   * queue behind it and go out against the paths Live reports next. Only
   * a lifted finger drops — a cancelled gesture puts the cell back. The
   * instrument stays put and nothing crosses it (`utils/chainDrop`).
   * A dashed + cell after the last device opens the
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
  import { setContext } from 'svelte';
  import { PICTURE_CONTEXT } from '$lib/components/v6/browser/devicePictures';
  import type { Component } from 'svelte';
  import { FX_GRID_LAYOUT, type DeviceTypeKey } from '$lib/config/fxGridLayout';
  import { provideFxScope } from '$lib/components/v6/central/fxScope';
  import GuitarControl from './GuitarControl.svelte';
  import BassControl from './BassControl.svelte';
  import PitchControl from './PitchControl.svelte';
  import GlitchControl from './GlitchControl.svelte';
  import SquashControl from './SquashControl.svelte';
  import ControlTile from './ControlTile.svelte';
  import RecentEffectButton from './chain/RecentEffectButton.svelte';
  import { recentForChain } from '$lib/services/recentEffects.svelte';
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
  import { drag as dragAction, type DragInfo, type DragEndInfo } from '$lib/actions/drag';
  import { moveDevice } from '$lib/services/deviceMoveService';
  import {
    arrange,
    chainGrid,
    clampChainIndex,
    moved,
    planReorder,
    REORDER_IDLE,
    sameDevices,
    type ReorderState
  } from '$lib/utils/chainDrop';
  import { onDestroy, tick, untrack } from 'svelte';
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
  // The devices' pictures draw here (devicePictures), not on the FX grid.
  setContext(PICTURE_CONTEXT, true);

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

  /**
   * What a cell is: only what changes when the chain does. Live values
   * (Device On, a rack's macros) are read in the markup, so a moving
   * parameter repaints its own cell and never rebuilds the list.
   */
  type Cell = {
    /** Stable across Live's renumbering (paths are positions): name, class, and which of those it is. */
    key: string;
    /** Class and name: what the device is, shared by two of a kind. */
    sig: string;
    /** Where Live has it now. */
    path: string;
    device: DeviceRecord;
    kind: 'instrument' | 'rack' | 'max' | 'plugin' | 'effect';
    presetKey: string | null;
    tile: string | null;
    ink: string;
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
      const sig = `${device.className}|${device.name}`;
      return {
        key: `${sig}|${nth}`,
        sig,
        path: device.devicePath,
        device,
        kind,
        presetKey,
        tile: tileOf.get(device.devicePath) ?? null,
        // The instrument and Permute wear the track's color (Permute: the
        // user, 2026-10-26, as the strip's own Permute section does); a
        // pad's chain, the pad's.
        ink: isInstrument || presetKey === 'sequencer' ? (padChain ? (padInk ?? trackColor) : trackColor) : trackInk(family, paint)
      };
    })
  );

  function isOn(cell: Cell): boolean {
    return (selectedTrackStore.paramValueArmed(selectedTrackStore.paramPath(cell.device, 0)) ?? 1) > 0;
  }

  // A pad's instrument has no records on the wire (they are the
  // virtual-macro layer's), so there is no Device On to show.
  function isPowered(cell: Cell): boolean {
    return selectedTrackStore.paramValue(selectedTrackStore.paramPath(cell.device, 0)) !== undefined;
  }

  /**
   * Devices past which the chain takes a second row. Up to it the cells and
   * the + cell share one row, wide as the track strips get; past it the
   * cells split evenly over two rows (`chainGrid`). Reads like Live's chain:
   * left to right, then the next row. Four since the user's call
   * (2026-10-26; five before). The Recent column counts as a cell.
   */
  const CHAIN_WRAP_AFTER = 4;

  function indexOf(path: string): number {
    const m = /\/devices\/(\d+)$/.exec(path);
    return m ? Number(m[1]) : 0;
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
    selectedTrackStore.setParamValue(path, isOn(cell) ? 0 : 1);
  }

  /*
   * Reordering (2026-10-26). Three layers, each changing only as often as
   * it must:
   *
   * - `reorder` — drops Live has not shown yet (`utils/chainDrop`'s
   *   `planReorder`): the order held on screen, and the one move on the
   *   wire. A move is sent against the paths Live last reported, and the
   *   next waits until Live shows the last, so two quick drops never send
   *   a path the first has shifted.
   * - `drag` — the drag in flight: the order it started from and where it
   *   would land. It changes when the landing changes, not per finger
   *   frame.
   * - The cell itself rides the finger — no copy, no placeholder (the
   *   user's call, 2026-10-26): its own transform is written once a frame,
   *   so the finger never touches reactive state, and it keeps its slot
   *   in the previewed order, which is the gap the others slide around.
   *
   * The list is redrawn only when the order changes, and the cells slide
   * by a FLIP run on exactly those changes (below), not `animate:flip`,
   * which measures every cell on every redraw of the list.
   */
  const MOVE_TIMEOUT_MS = 2000;
  const GRID_GAP = 8;

  let chainEl = $state<HTMLElement | null>(null);
  let reorder = $state<ReorderState>(REORDER_IDLE);

  type Drag = {
    key: string;
    from: number;
    to: number;
    /** The order it started from, as shown then. */
    base: { key: string; sig: string }[];
    /** The instrument's place in that order, or null. */
    instrument: number | null;
    /** The cell's box when lifted, relative to the chain. */
    box: { left: number; top: number; width: number; height: number };
    /** The chain's box in client coordinates, measured once at lift. */
    chain: { left: number; top: number; width: number; height: number };
  };
  let drag = $state<Drag | null>(null);
  /** The dragged cell's own node. */
  let dragNode: HTMLElement | null = null;

  // Drops on the wire follow Live: each report lands the move in flight
  // (or not), and the next goes out.
  $effect(() => {
    const state = reorder;
    if (!state.desired) return;
    const now = Date.now();
    const { state: next, send } = planReorder(state, cells, now, MOVE_TIMEOUT_MS);
    if (send) void moveDevice(send.path, send.to).catch(() => (reorder = REORDER_IDLE));
    if (next !== state) reorder = next;
    if (!next.inflight) return;
    // Wake when the move in flight runs out, if Live never shows it.
    const timer = setTimeout(() => (reorder = { ...reorder }), Math.max(0, next.inflight.until - now));
    return () => clearTimeout(timer);
  });

  // Another track or pad: nothing in flight here means anything there.
  const scopeKey = $derived(`${trackPath}|${padScope?.padPath ?? ''}`);
  let lastScope = '';
  $effect(() => {
    if (scopeKey === lastScope) return;
    lastScope = scopeKey;
    untrack(() => {
      reorder = REORDER_IDLE;
      drag = null;
    });
  });

  // A device added or removed under a drag: its positions mean nothing now.
  $effect(() => {
    if (drag && !sameDevices(cells, drag.base)) untrack(() => (drag = null));
  });

  /** The cells as Live will have them once the drops land. */
  const settled = $derived((reorder.desired && arrange(cells, reorder.desired)) || cells);

  /** The cells in the order to draw them: the drag's preview, else `settled`. */
  const shown = $derived((drag && arrange(cells, moved(drag.base, drag.from, drag.to))) || settled);

  /*
   * The Recent column (ADR-484, the user's call, 2026-10-26): just before
   * the + cell, the last effects added from the browser, grey, a tap adding one
   * here again. Only what fits: no MIDI effect off a MIDI track, nothing
   * this chain already holds. It replaced the suggested ghost devices
   * (ADR-483); the ghost Utility had already left for the right sidebar.
   */
  const recents = $derived(recentForChain(cells.map((c) => c.device.name)));
  const drawn = $derived(shown);

  const grid = $derived(chainGrid(drawn.length + (recents.length > 0 ? 1 : 0), CHAIN_WRAP_AFTER));

  /** The cell position under a point, by the grid's geometry at lift — not the cells, which are sliding. */
  function positionAt(d: Drag, x: number, y: number): number {
    const { cols, rows } = grid;
    const col = Math.max(0, Math.min(cols - 1, Math.floor(((x - d.chain.left) * cols) / (d.chain.width + GRID_GAP))));
    const row = rows === 1 ? 0 : y < d.chain.top + d.chain.height / 2 ? 0 : 1;
    return row * cols + col;
  }

  // The dragged cell's offset from where it was lifted, written once a
  // frame as a transform from wherever the previewed order has put its
  // slot (`offsetLeft`/`offsetTop`, which leave the transform out).
  let offset = { dx: 0, dy: 0 };
  let frame = 0;
  function paintDragged() {
    frame = 0;
    const d = drag;
    if (!d || !dragNode) return;
    const x = d.box.left + offset.dx - dragNode.offsetLeft;
    // One row: the cell slides along it, level, wherever the finger goes
    // up or down (Ben, 2026-10-26). Two rows need the vertical.
    const dy = grid.rows === 1 ? 0 : offset.dy;
    const y = d.box.top - dy - dragNode.offsetTop;
    dragNode.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }
  function scheduleDragged() {
    if (!frame) frame = requestAnimationFrame(paintDragged);
  }

  // FLIP: on a change of order, each cell starts where it was drawn and
  // slides to its new place. Measured only when the order changes.
  const orderKey = $derived(shown.map((c) => c.key).join('\n'));
  let before = new Map<string, DOMRect>();
  $effect.pre(() => {
    void orderKey;
    if (!chainEl) return;
    before = new Map();
    for (const el of chainEl.querySelectorAll<HTMLElement>(':scope > [data-cell-key]')) {
      if (el !== dragNode) before.set(el.dataset.cellKey!, el.getBoundingClientRect());
    }
  });
  $effect(() => {
    void orderKey;
    if (!chainEl || before.size === 0) return;
    for (const el of chainEl.querySelectorAll<HTMLElement>(':scope > [data-cell-key]')) {
      const from = before.get(el.dataset.cellKey!);
      if (!from) continue;
      for (const a of el.getAnimations()) a.cancel();
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 180,
        easing: 'cubic-bezier(0.2, 0, 0, 1)'
      });
    }
    before = new Map();
    // Its slot moved under it: keep the dragged cell under the finger
    // before this frame paints.
    if (drag) paintDragged();
  });
  onDestroy(() => {
    if (frame) cancelAnimationFrame(frame);
  });

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

  function dragStart(cell: Cell, position: number, info: DragInfo) {
    // A drag on a cell's control is that control's, and it opens the
    // device's view as a tap on the cell does — every control here, not
    // only the grid's tiles, which open their own (2026-10-26).
    if (pressInControl) {
      open(cell);
      return;
    }
    if (cell.kind === 'instrument' || !chainEl) return;
    const node = chainEl.querySelector<HTMLElement>(`:scope > [data-cell-key="${CSS.escape(cell.key)}"]`);
    if (!node) return;
    // Where it is drawn, mid-slide included, so it lifts from under the finger.
    const r = node.getBoundingClientRect();
    const c = chainEl.getBoundingClientRect();
    for (const a of node.getAnimations()) a.cancel();
    const instrument = shown.findIndex((x) => x.kind === 'instrument');
    dragNode = node;
    offset = { dx: info.dx, dy: info.dy };
    drag = {
      key: cell.key,
      from: position,
      to: position,
      base: shown.map(({ key, sig }) => ({ key, sig })),
      instrument: instrument >= 0 ? instrument : null,
      box: { left: r.left - c.left, top: r.top - c.top, width: r.width, height: r.height },
      chain: { left: c.left, top: c.top, width: c.width, height: c.height }
    };
    paintDragged();
  }

  function dragMove(info: DragInfo) {
    const d = drag;
    if (!d) return;
    offset = { dx: info.dx, dy: info.dy };
    scheduleDragged();
    // The landing is read at the lifted cell's centre, so it follows the
    // cell wherever it was picked up by.
    const x = d.chain.left + d.box.left + d.box.width / 2 + info.dx;
    const y = d.chain.top + d.box.top + d.box.height / 2 - info.dy;
    const to = clampChainIndex({ from: d.from, to: positionAt(d, x, y), count: d.base.length, instrument: d.instrument });
    if (to !== null && to !== d.to) drag = { ...d, to };
  }

  function dragEnd(info: DragEndInfo) {
    const d = drag;
    const node = dragNode;
    drag = null;
    dragNode = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    // Only a finger lifted drops; a cancel or an unmount puts it back.
    if (d && info.reason === 'up' && d.to !== d.from) {
      reorder = { desired: moved(d.base, d.from, d.to), inflight: reorder.inflight };
    }
    if (node) settle(node);
  }

  /** The let-go cell glides from under the finger into its slot. */
  function settle(node: HTMLElement) {
    const from = node.getBoundingClientRect();
    node.style.transform = '';
    void tick().then(() => {
      if (!node.isConnected) return;
      for (const a of node.getAnimations()) a.cancel();
      const to = node.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 180,
        easing: 'cubic-bezier(0.2, 0, 0, 1)'
      });
    });
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

{#snippet cellBody(cell: Cell, position: number)}
  {@const glyph = glyphOf(cell)}
  {@const tile = cell.kind !== 'instrument' && cell.presetKey ? TILE_COMPONENTS[cell.presetKey] : undefined}
      <!-- The device's name alone, on a band as tall as a strip's mute
           button, so there is room to grab the cell (the user, 2026-10-26);
           then the blue hand and Device On. -->
      <div class="cell-head">
        <span class="name" lang="en">{cell.device.name}</span>
        <span class="head-end">
        {#if fxChainStore.appointed === cell.device.devicePath}
          <span class="hand" aria-label="Selected in Live"><Hand /></span>
        {/if}
        {#if isPowered(cell)}
        {@const on = isOn(cell)}
        <button
          type="button"
          class="power"
          class:on
          aria-label="{on ? 'Turn off' : 'Turn on'} {cell.device.name}"
          aria-pressed={on}
          use:press={{ onPress: () => togglePower(cell), stopPropagation: true }}
        ><Power /></button>
        {/if}
        </span>
      </div>

      {#if cell.presetKey === 'sequencer'}
        <!-- Permute: its mute and pitch steps, on this device. -->
        <div class="cell-control" role="presentation"><PermuteStepsFace device={cell.device} color={cell.ink} /></div>
      {:else if !padScope && cell.kind === 'instrument' && glance.instrumentViewType && FACED_INSTRUMENTS.has(glance.instrumentViewType)}
        <!-- The instrument's signature control, as its view draws it. -->
        <div class="cell-control" role="presentation">
          <InstrumentFace device={cell.device} type={glance.instrumentViewType} color={selectedTrackScheme() ?? schemeFromInk(cell.ink)} />
        </div>
      {:else if !padScope && cell.kind === 'instrument' && cell.device.className === 'DrumGroupDevice'}
        <!-- A Drum Rack: the kit's Trnsp, as its view draws it. -->
        <div class="cell-control" role="presentation">
          <DrumRackFace device={cell.device} color={selectedTrackScheme() ?? schemeFromInk(cell.ink)} />
        </div>
      {:else if !padScope && isMidiWheels(cell.device)}
        <!-- The pitch and mod wheels, as the instrument views draw them:
             Pitch over Mod in a full-height cell, side by side in a
             two-row chain's half-height one. -->
        <div class="cell-control" role="presentation"><MidiWheelsPanel sideBySide={grid.rows > 1} /></div>
      {:else if tile}
        <!-- The grid's own tile, on this device. A touch here is the
             control's: it picks this device and never starts a reorder. -->
        <div class="cell-control" role="presentation">
          <tile.Tile device={cell.device} position={tile.position} />
        </div>
      {:else if controlFor(cell.presetKey)}
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

      {@const macros = cell.kind === 'rack' ? macrosOf(cell.device) : []}
      {#if macros.length > 0}
        <div class="macros" aria-hidden="true">
          {#each macros as m (m.name)}
            <span class="macro" style="--v: {m.value};" title={m.name}></span>
          {/each}
        </div>
      {/if}
{/snippet}

<div class="chain-wrap" class:two-rows={grid.rows > 1} class:pad-scoped={padScope !== null} style={padInk ? `--scope-ink: ${padInk}` : undefined}>
<div
  class="chain"
  style:--chain-cols={grid.cols}
  style:--chain-rows={grid.rows}
  data-debug="chain-overview"
  data-chain-scope={padScope?.note}
  bind:this={chainEl}
>
  {#each drawn as cell, position (cell.key)}
    <div
      class="chain-cell"
      class:off={!isOn(cell)}
      class:dragging={drag?.key === cell.key}
      class:appointed={fxChainStore.appointed === cell.device.devicePath}
      class:instrument={cell.kind === 'instrument'}
      style="--cell-ink: {cell.ink};"
      data-cell-key={cell.key}
      data-device-path={cell.device.devicePath}
      data-kind={cell.kind}
      role="button"
      tabindex="0"
      aria-label="{cell.device.name}{cell.tile ? `, the ${cell.tile} tile's` : ''}"
      use:dragAction={{
        commit: 'either',
        onDown: (info) => pressDown(cell, info),
        onTap: () => {
          if (!pressInControl) open(cell);
        },
        onStart: (info) => dragStart(cell, position, info),
        onMove: dragMove,
        onEnd: dragEnd
      }}
    >
      {@render cellBody(cell, position)}
    </div>
  {/each}
  {#if recents.length > 0}
    <!-- Recent: the last effects added, grey; a tap adds one here again. -->
    <div class="chain-recents" data-debug="chain-recents" role="group" aria-label="Recent effects">
      {#each recents as recent (recent.fullPath)}
        <RecentEffectButton {recent} />
      {/each}
    </div>
  {/if}
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
  {#if padScope}
    <!-- Whose chain this is, as the grid's scope chip says it. -->
    <div class="pad-chip chain-scope-chip" aria-label="Chain of pad {padScope.note}">
      {padTileLabel(padScope.name) || `Pad ${padScope.note}`}
    </div>
  {/if}
</div>
</div>

<style>
  /* As many columns and rows as the chain needs (`chainGrid`), on the FX
     grid's 8px trough. */
  /* The chain's frame: the pad scope's outline and the two-row header. */
  .chain-wrap {
    height: 100%;
    display: flex;
    gap: 8px;
    min-width: 0;
  }
  .chain-wrap.pad-scoped {
    outline: 2px solid var(--scope-ink, var(--track-ink, var(--phosphor)));
    outline-offset: -2px;
    border-radius: var(--radius-sm, 2px);
  }
  .chain {
    flex: 1 1 0;
    min-width: 0;
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
  /* The Recent column: four grey rows, the + cell's height. */
  .chain-recents {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .chain-cell.off > :not(.cell-head) {
    opacity: 0.45;
  }
  /* The cell under the finger rides it, over the others. */
  .chain-cell.dragging {
    z-index: 4;
    will-change: transform;
  }
  /* The blue hand: the device Live's controllers follow. */
  .chain-cell.appointed {
    border-color: var(--cell-ink);
    box-shadow: inset 0 0 0 1px var(--cell-ink);
    background: color-mix(in oklab, var(--cell-ink) 14%, var(--surface-well));
  }

  /* The name, then the hand and the power button in the corner: a band
     the strips' name band's height (--strip-band-h), a handle to drag by. */
  .cell-head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: var(--strip-band-h, 56px);
    flex: 0 0 auto;
    padding-left: 6px;
  }
  /* Two rows of cells: half that, so the controls keep their height
     (the user, the same day). */
  .chain-wrap.two-rows .cell-head {
    height: calc(var(--strip-band-h, 56px) / 2);
  }
  /* The first cell's corner is the FX section's switch (FxPanelSwitch). */
  .chain-cell:first-child .cell-head {
    padding-left: 38px;
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
    width: 18px;
    height: 18px;
  }
  /* Device On. Lit while the device runs, dim when bypassed. */
  .power {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 100%;
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
    width: 20px;
    height: 20px;
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
    font-size: 1rem;
    font-weight: var(--font-weight-medium);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

</style>
