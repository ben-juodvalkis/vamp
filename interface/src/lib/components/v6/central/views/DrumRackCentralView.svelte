<script lang="ts">
  import DeviceXY from '../../device-panel/DeviceXY.svelte';
  import DeviceSlider from '../../device-panel/DeviceSlider.svelte';
  import DrumRackMacroGrid from './DrumRackMacroGrid.svelte';
  import SamplerControlsRow from './SamplerControlsRow.svelte';
  import SimplerControlsRow from './SimplerControlsRow.svelte';
  import DrumPadGrid from './DrumPadGrid.svelte';
  import SectionDivider from '../SectionDivider.svelte';
  import HostedSwapPill from '../HostedSwapPill.svelte';
  import { useSwapHost } from '../swapHost.svelte';
  import VmSlot from './drum/VmSlot.svelte';
  import DrumCellControlsRow from './drum/DrumCellControlsRow.svelte';
  import RackMacrosRow from './drum/RackMacrosRow.svelte';
  import PadFxPane from './drum/PadFxPane.svelte';
  import PadNotesStrip from './drum/PadNotesStrip.svelte';
  import PadMixerColumn from './drum/PadMixerColumn.svelte';
  import { fxScopeFor } from '../fxScope';
  import { useDrumVm } from '../useDrumVm.svelte';
  import { usePadChainRows } from '../usePadChainRows.svelte';
  import { instrumentDevicePath } from '$lib/services/deviceViewRouter.svelte';
  import { useClipPads } from './drum/useClipPads.svelte';
  import { usePadSequencers } from './drum/usePadSequencers.svelte';
  import { drumPadScope } from '$lib/stores/v6/drumPadScope.svelte';
  import { uiPrefsStore } from '$lib/stores/v6/uiPrefsStore.svelte';
  import type { InstrumentInfo } from '$lib/services/instrumentService';
  import { deviceInk, rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import { selectedTrackScheme } from '$lib/utils/selectedTrackInk';
  import { familyScheme, schemeFromInk } from '$lib/config/devicePresets';
  import DeviceEmptyState from '../DeviceEmptyState.svelte';
  import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
  import {
    VM,
    VM_PITCH_MIN,
    VM_PITCH_MAX,
    combineVmStates,
    kitClassSummary,
    mappedMacroIndices,
    PAD_MIXER_FUNCTIONS,
    padGridNotes,
    profileFunctions,
    profileForPadClass,
    rackMacroLayout,
    type SamplerRowControl,
    type SimplerRowControl,
    type VmState
  } from '$lib/services/drumVirtualMacros';
  import type { MomentaryReleaseReason } from '$lib/components/v6/tracks/TrackStrip/utils/momentaryPress';

  /**
   * DrumRackCentralView — one view for every DrumGroupDevice (ADR-428).
   *
   * The composition root, since 2026-09-10 (issue #491 E0): the pad grid
   * on the left, and on the right a row chosen by the kit's profile plus
   * the Filter pad and the Gain slider that every kit shape shares. The
   * rows are dumb (`drum/DrumCellControlsRow`, `drum/RackMacrosRow`,
   * `SimplerControlsRow`, `SamplerControlsRow`): values, states and badges
   * in, a write out. What a value IS under the current pad scope, and
   * where a write goes, is `useDrumVm`'s one rule — shared with the FX
   * grid's Pitch slider, which lives in another component tree and obeys
   * the same hold. The playing clip's pads and the flash are
   * `useClipPads`'s.
   *
   * ADR-428: the controls are *virtual macros* on the DrumGroupDevice —
   * surface-owned properties `vm.*` over the property channel — instead
   * of rack macros written by index. The surface fans each write out to
   * every pad's instrument by parameter name (or, while a kit is still
   * mapped, writes the legacy macro), so the view is unit-free: XY axes
   * and Start are 0..1, FX type is the 0..8 button index, Trnsp is whole
   * semitones.
   *
   * Milestone 1b: the surface's `vm.members` census says what this kit is
   * and can do, and the view answers with one of six profiles (by the
   * dominant pad class) and three control states — plugin-hosted pads
   * (Komplete Kontrol) → the macro grid; DrumCell pads → the full row;
   * Simpler pads → the Simpler row; Sampler pads → the Sampler row;
   * nested Instrument Rack pads carrying named macros → one control per
   * macro name; any other native class → Trnsp plus a label naming the
   * pad class. Within the controls a function the kit has no member for
   * is dimmed and inert, and one every member of which is macro-held is
   * read-only, badged "macro" (or "31/32 macro" when only some are held
   * and the free ones still move). Until the census arrives every
   * control is `unknown` = live and the profile is `full`.
   *
   * The pad grid and hold-to-scope (2026-09-08): touch nothing and the
   * controls move the kit; hold one or more pads (or tap to latch one,
   * 2026-09-09) and the controls read from and write to the held pads
   * only — touch-down selects the pad in Live (`vm.selectedPad`) and
   * scopes the view (`data-vm-scope`); lift returns it to the kit. The
   * holds live in `drumPadScope`, never on the surface, so two clients
   * cannot fight over a scope each keeps for itself. While a pad is
   * scoped the controls wear its chain colour (2026-09-09); the pad grid
   * keeps the track ink, because its `--pad-ink` paints the pads Live
   * left uncoloured.
   *
   * The grid is always drawn: its PADS switch went on 2026-09-26
   * (`uiPrefsStore.showDrumPads` reads true). The pads-off branch below is
   * unreachable until it is removed.
   */

  interface Props {
    instrument?: InstrumentInfo | null;
  }

  let { instrument }: Props = $props();

  // The rack's device path — the instrument's own when the census carried
  // it, else the chain-order index into the v3 tree (PR-3.5.2a); the one
  // rule the router, the instrument slider and this view share.
  // `undefined` on cold start — same "show ghost" posture as before.
  let devicePath = $derived(instrumentDevicePath(instrument));

  // Fallback body scheme (distortion family) — used only on cold start,
  // before a track ink resolves.
  const drumRackColor = familyScheme('distortion');

  // FX Type mode names for the picker. Modes are distinguished by label
  // + active state (ADR-402: the whole view wears the track's ink, so mode
  // is no longer carried by hue).
  const FX_TYPES = ['Stretch', 'Loop', 'Pitch', 'Punch', '8-Bit', 'FM', 'Ring', 'Sub', 'Noise'] as const;

  // The whole view wears the focused track's ink (ADR-402); falls back to
  // the distortion-family scheme only on cold start. This is the PAD
  // GRID's ink — the controls take `controlInk` below, which is the same
  // colour until a pad is held.
  let drumRackInk = $derived(selectedTrackScheme() ?? {
    primary: deviceInk(drumRackColor.primary, paintModeReactive()),
    secondary: drumRackColor.secondary,
    accent: deviceInk(drumRackColor.accent, paintModeReactive())
  });

  // Always true (PADS went 2026-09-26; uiPrefsStore pins it). The clear
  // below and the markup's no-pads path are UNREACHABLE since 2026-09-26,
  // kept until the flag goes.
  let showPads = $derived(uiPrefsStore.showDrumPads);
  $effect(() => {
    if (!showPads) drumPadScope.clear();
  });

  // The playing clip's pads and the flash, off the track's own channels.
  let trackPath = $derived(devicePath ? devicePath.split('/devices/')[0] : undefined);
  const clip = useClipPads(() => trackPath);

  // The kit under the current scope, and every row it needs open — the
  // grid's pads included, so a pressed tile has its own values the
  // instant the finger lands. The rows drawn follow the SCOPED pad's own
  // class (issue #491): the Jazz kit's Sampler pad gets the Sampler row
  // while held, so its rows are what is opened.
  const vm = useDrumVm(() => devicePath, {
    padNotes: () => clip.clipNotes ?? [],
    functions: () => [...profileFunctions(scopedProfile, vm.macroNames), ...PAD_MIXER_FUNCTIONS]
  });

  let members = $derived(vm.members);
  let profile = $derived(vm.profile);
  let heldNotes = $derived(vm.heldNotes);
  let scopeNote = $derived(vm.scopeNote);
  let selectedNote = $derived(vm.selectedNote);

  // The pads on the grid that carry a Permute of their own (ADR-435), with
  // what each is doing — the grid draws a step strip on those tiles. The
  // notes are the grid's own rule (the clip's, Live's selection, the held).
  const padSeqs = usePadSequencers(
    () => devicePath,
    () => padGridNotes(clip.clipNotes, [selectedNote, ...heldNotes], members?.pads ?? [])
  );
  let kitSummary = $derived(kitClassSummary(members));
  let macroLayout = $derived(rackMacroLayout(members));
  let mappedMacros = $derived(mappedMacroIndices(members));

  // A rack hot-swapped in place keeps its device path, so a latch could
  // outlive the pad it named. Prune it whenever the census changes.
  $effect(() => {
    const path = devicePath;
    const notes = (members?.pads ?? []).map((p) => p.note);
    if (path && notes.length) drumPadScope.retainLatched(path, notes);
  });

  // The controls wear the held pad's colour (2026-09-09) — through
  // `trackInk`, the same envelope the track's own colour goes through, so
  // a pad's ink is exactly as legible as a track's. Nothing held, or a
  // pad Live left uncoloured, and they are the track's again.
  let scopedPadColor = $derived(vm.scopedPad?.color ?? null);
  let controlInk = $derived(
    scopedPadColor === null
      ? drumRackInk
      : schemeFromInk(trackInk(rgbToHex(scopedPadColor), paintModeReactive()))
  );

  // ---- The pane (issue #491, 2026-09-10) -----------------------------------
  //
  // The right side of the view follows the scope: nothing scoped, the
  // kit's row as always; a pad scoped, THAT pad's own class row (the
  // Jazz kit's Sampler pad gets the Sampler row while held, not the kit's
  // Simpler row with ghosted slots); a pad scoped and an effect chosen —
  // a tile touched under the hold — that effect's central view for that
  // pad, in place of the controls, Filter and Gain included. The pane
  // holds a device TYPE (`drumPadScope.pane`); the scoped pad supplies
  // the instance, and its lifetime is the scope's. Effect presence for
  // the FX grid's flip (`vm.padFx`) is subscribed here too, so the pane
  // works with the grid section switched off.
  let scopedProfile = $derived(
    scopeNote !== null && vm.scopedPad ? profileForPadClass(vm.scopedPad.className, profile) : profile
  );
  let paneType = $derived(devicePath ? drumPadScope.pane(devicePath) : null);
  // The notes strip shows while a pad is scoped and its controls, not an
  // effect's pane, are up (2026-10-24).
  let showStrip = $derived(scopeNote !== null && paneType === null);
  let fxScope = $derived(
    devicePath && scopeNote !== null ? fxScopeFor(devicePath, scopeNote, vm.scopedPad) : null
  );
  // The rack's presence row and the scoped pad's own records, for the
  // pane's controls (refcounted with the FX grid, which holds the same
  // rows for its tiles).
  usePadChainRows(() => devicePath, () => scopeNote);
  function closePane() {
    if (devicePath) drumPadScope.setPane(devicePath, null);
  }
  let paneOpen = $derived(paneType !== null && fxScope !== null);

  // ---- The face (ADR-510) -------------------------------------------------
  //
  // A DrumCell, Sampler or Simpler kit draws its row as a face: one grid of
  // equal columns right of the pads, eight columns on every kit, whose
  // first column is the view's Gain over Trnsp — so they land on the same
  // spot whichever kit is loaded (user, 2026-09-27: "make them more uniform
  // so the muscle memory sticks"). Every other profile, and an effect's
  // pane, keeps the flex row. The swap pill lies over the pads on every
  // kit (it lay across the pads and the kit's first sliders from
  // 2026-09-16); a pads-alone pill sets the column's FLOOR, because the
  // pill's name is the door to the browser (ADR-442) — see
  // `.vm-pads-with-pill`.
  const swapHost = useSwapHost();
  let lead = $derived<'full' | 'sampler' | 'simpler' | null>(
    paneOpen
      ? null
      : scopedProfile === 'full' || scopedProfile === 'sampler' || scopedProfile === 'simpler'
        ? scopedProfile
        : null
  );

  // The held pads' own mixer strip (2026-09-29): drawn right of the pads
  // while anything is scoped, the scoped pad's rows read and every held
  // pad written through the scope rule.
  function padMixerRaw(fn: 'chainVolume' | 'chainMute'): number | null | undefined {
    return scopeNote === null ? undefined : vm.padRaw(scopeNote, fn);
  }

  function onPadPress(note: number, pointerId: number) {
    if (!devicePath) return;
    drumPadScope.press(devicePath, note, pointerId);
    selectedTrackStore.setPropertyValue(devicePath, VM.selectedPad, note);
  }

  function onPadRelease(pointerId: number, reason: MomentaryReleaseReason = 'up') {
    drumPadScope.release(pointerId, reason);
  }

  // ---- The rows' inputs, from the one scope-aware source -----------------

  let cellValues = $derived({
    fx1: vm.value('fx1'),
    fx2: vm.value('fx2'),
    fxType: vm.value('fxType'),
    attack: vm.value('attack'),
    decay: vm.value('decay'),
    start: vm.value('start'),
    pitch: vm.value('pitch')
  });
  let cellStates = $derived({
    fx1: vm.state('fx1'),
    fx2: vm.state('fx2'),
    fxType: vm.state('fxType'),
    attack: vm.state('attack'),
    decay: vm.state('decay'),
    start: vm.state('start'),
    pitch: vm.state('pitch')
  });
  let cellBadges = $derived({
    fx: vm.badge('fx1', 'fx2'),
    fxType: vm.badge('fxType'),
    time: vm.badge('attack', 'decay'),
    start: vm.badge('start'),
    pitch: vm.badge('pitch')
  });

  const SAMPLER_ROW = ['oscAmount', 'oscCoarse', 'pitchEnvAmount', 'pitchEnvAttack', 'attack', 'release', 'decay', 'sustain', 'spread', 'selector', 'pitch'] as const;
  let samplerValues = $derived(
    Object.fromEntries(SAMPLER_ROW.map((fn) => [fn, vm.value(fn)])) as Partial<Record<SamplerRowControl, number>>
  );
  let samplerStates = $derived(
    Object.fromEntries(SAMPLER_ROW.map((fn) => [fn, vm.state(fn)])) as Record<SamplerRowControl, VmState>
  );
  let samplerBadges = $derived({
    osc: vm.badge('oscAmount', 'oscCoarse'),
    pitchEnv: vm.badge('pitchEnvAmount', 'pitchEnvAttack'),
    attack: vm.badge('attack'),
    decay: vm.badge('decay'),
    sustain: vm.badge('sustain'),
    release: vm.badge('release'),
    spread: vm.badge('spread'),
    selector: vm.badge('selector'),
    pitch: vm.badge('pitch')
  });

  let simplerValues = $derived({
    attack: vm.value('attack'),
    release: vm.value('release'),
    pitch: vm.value('pitch')
  } as Partial<Record<SimplerRowControl, number>>);
  let simplerStates = $derived({ attack: vm.state('attack'), release: vm.state('release'), pitch: vm.state('pitch') });
  let simplerBadges = $derived({
    time: vm.badge('attack', 'release'),
    pitch: vm.badge('pitch')
  });

  // The three slots outside the profile switch.
  let filterState = $derived(combineVmStates(vm.state('filterFreq'), vm.state('filterRes')));
  let gainState = $derived(vm.state('gain'));
  let pitchState = $derived(vm.state('pitch'));

</script>

{#snippet filterSlot()}
  <!-- The filter as one pad (2026-09-09, user's request): cutoff across,
       resonance up. `filterFreq` carries the filter's own switch, which a
       write turns on and never off — cutoff at the floor with the filter
       ON is closed and silent, and switching it off there would open it
       wide instead. The pad is relative and suppresses taps, so the
       filter comes out of bypass on the first DRAG rather than on the
       touch — which is where the user left it (2026-09-09), the write
       that enables it being the same write that moves cutoff. Bound by
       NAME on each pad class: `Filter On` / `Filter Freq` / `Filter Res`
       on a DrumCell, `F On` and the same two on a Simpler and a Sampler. -->
  <VmSlot state={filterState} class="min-w-0 h-full" fn="filterFreq|filterRes" badge={vm.badge('filterFreq', 'filterRes')}>
    <DeviceXY
      xValue={vm.value('filterFreq') ?? 1}
      yValue={vm.value('filterRes') ?? 0}
      title="Filter"
      icon="filter"
      color={controlInk}
      isGhost={filterState === 'none'}
      onInteraction={(x, y) => {
        vm.write('filterFreq', x);
        vm.write('filterRes', y);
      }}
    />
  </VmSlot>
{/snippet}

{#snippet gainSlot(knob = false)}
  <!-- How loud the kit is — or, with pads held, how loud those pads are
       (2026-09-08, user's request). One `t` slider over three different
       measurements: DrumCell's Volume is 0..1, a Sampler's and a
       Simpler's is −36..36 dB, and a kit of nested Instrument Racks has
       no Volume to reach at all, so there the surface moves each pad's
       CHAIN volume instead. The fan-out spans each member's own range,
       so a mixed kit moves together and keeps its balance. -->
  <VmSlot state={gainState} class="flex-1 flex flex-col" fn="gain" badge={vm.badge('gain')}>
    <DeviceSlider
      value={vm.value('gain') ?? 0.5}
      labelOrientation="horizontal"
      title="Gain"
      icon="gain"
      face={knob ? 'knob' : 'slider'}
      knobSize="l"
      knobFit
      knobCaption={!knob}
      color={controlInk}
      isGhost={gainState === 'none'}
      onInteraction={(value) => vm.write('gain', value)}
    />
  </VmSlot>
{/snippet}

{#snippet trnspSlot()}
  <!-- The one control every native kit gets: whole semitones on ±48, the
       surface fanning the value out to every pad's Transpose by name. -->
  <VmSlot state={pitchState} class="flex-1 flex flex-col" badge={vm.badge('pitch')}>
    <DeviceSlider
      value={vm.value('pitch') ?? 0}
      labelOrientation="horizontal"
      title="Trnsp"
      icon="transpose"
      color={controlInk}
      min={VM_PITCH_MIN}
      max={VM_PITCH_MAX}
      centerOrigin={true}
      centerValue={0}
      isGhost={pitchState === 'none'}
      onInteraction={(value) => vm.write('pitch', Math.round(value))}
    />
  </VmSlot>
{/snippet}

<div
  class="h-full w-full flex flex-col relative"
  data-density="compact"
  data-vm-mode={instrument ? profile : undefined}
  data-vm-scope={scopeNote ?? undefined}
  data-vm-pane={paneType ?? undefined}
>
  {#if instrument}
  <div
    class="flex-1 min-h-0 flex gap-(--central-gap) p-(--central-inset) vm-with-pads"
    class:vm-with-strip={showStrip}
    data-vm-lead={lead ?? undefined}
  >
    <!-- Live's pad view: hold to scope the controls to a pad (2026-09-08).
         Always on since its PADS switch went (2026-09-26). -->
    {#if showPads}
      <!-- `display: contents`: the pads and the seam sit in the row. -->
      <div class="vm-pads-cell">
      <!-- The swap pill lies over the pads on every kit (ADR-510) — as wide
           as the pad column, except where the pill's own name needs more
           (see `.vm-pads-with-pill`). -->
      <div class="vm-pads-stack" class:vm-pads-with-pill={swapHost?.present ?? false}>
        <div class="vm-pads-pill">
          <HostedSwapPill />
        </div>
        <DrumPadGrid
          pads={members?.pads ?? []}
          {selectedNote}
          {heldNotes}
          clipNotes={clip.clipNotes}
          litNotes={clip.litNotes}
          padSequencers={padSeqs.map}
          color={drumRackInk}
          onPress={onPadPress}
          onRelease={onPadRelease}
        />
      </div>
      {#if scopeNote !== null}
        <PadMixerColumn
          volume={padMixerRaw('chainVolume')}
          muted={padMixerRaw('chainMute')}
          color={controlInk}
          onVolume={(value) => vm.write('chainVolume', value)}
          onMute={(value) => vm.write('chainMute', value)}
        />
      {/if}
      <!-- The pads pick WHAT you are moving; everything right of the seam
           moves it. Without the hairline the tiles ran straight into Gain
           at the same gap that separates two sliders, so nothing said the
           two halves were different kinds of thing (2026-09-13). With a
           central gap either side it is the face's own seam. -->
      <SectionDivider orientation="vertical" ink={drumRackInk.primary} />
      </div>
    {/if}
    {#if paneType !== null && fxScope !== null}
      <!-- An effect's view for the scoped pad, in place of every control. -->
      <PadFxPane deviceType={paneType} scope={() => fxScope} onBack={closePane} />
    {:else if lead !== null}
    <!-- A DrumCell, Sampler or Simpler kit: its face (ADR-510), one grid
         of equal columns right of the pads, eight on every kit. Each row
         draws the same first column, the view's Gain over Trnsp (user,
         2026-09-27: "gain to be the same on both, and it to be the
         leftmost slider"), so they sit on the same pixels whichever kit
         is loaded; the view's Filter is the row's last section (under
         the Time pad on a DrumCell kit). -->
    <div class="flex-1 min-w-0 min-h-0 flex flex-col gap-(--central-gap) vm-controls vm-face-col" class:vm-face-strip={showStrip}>
      {#if scopedProfile === 'sampler'}
        <!-- Sampler kits: the Sampler row, every control a function fanned
             out to each pad's Sampler by name (SamplerControlsRow). -->
        <SamplerControlsRow
          values={samplerValues}
          states={samplerStates}
          badges={samplerBadges}
          color={controlInk}
          hidden={['decay', 'sustain']}
          onWrite={(control, value) => vm.write(control, value)}
          gain={gainSlot}
          filter={filterSlot}
        />
      {:else if scopedProfile === 'simpler'}
        <!-- Simpler kits: the Simpler row, every control a function fanned
             out to each pad's Simpler by name (SimplerControlsRow). -->
        <SimplerControlsRow
          values={simplerValues}
          states={simplerStates}
          badges={simplerBadges}
          color={controlInk}
          onWrite={(control, value) => vm.write(control, value)}
          gain={gainSlot}
          filter={filterSlot}
        />
      {:else}
        <!-- DrumCell kits: Gain over Trnsp and Start, the FX pad over the
             FX-type grid, the Time pad over Filter. -->
        <DrumCellControlsRow
          values={cellValues}
          states={cellStates}
          badges={cellBadges}
          color={controlInk}
          fxTypes={FX_TYPES}
          onWrite={(control, value) => vm.write(control, value)}
          gain={gainSlot}
          filter={filterSlot}
        />
      {/if}
      {#if showStrip && scopeNote !== null}
        <!-- The scoped pad's notes in the playing clip, under the face, from
             Gain to the right edge (2026-10-24, the user's call). -->
        <div class="vm-strip">
          <PadNotesStrip trackPath={trackPath ?? ''} clipPath={clip.playingClipPath} clipWindow={clip.clipWindow} note={scopeNote} ink={controlInk.primary} />
        </div>
      {/if}
    </div>
    {:else}
    <!-- The kits off the face: a nested-rack kit's macros and a plugin
         kit's mapped macros come and go with the kit, so their count is
         the kit's, not a face's; a pitch-only kit is Gain over Trnsp and
         a card. A nested-rack or pitch-only kit draws Gain itself, over
         Trnsp (ADR-477); a macro-grid kit draws neither Gain nor Filter:
         the rack's mapped macros are its controls. -->
    <div class="flex-1 min-w-0 min-h-0 flex flex-col vm-controls">
    {#if scopedProfile === 'macro-grid'}
      <!-- A rack with mapped macros (or plugin-hosted pads): one slider per
           mapped macro, and nothing else. -->
      <DrumRackMacroGrid {instrument} mapped={mappedMacros} />
    {:else if scopedProfile === 'rack-macros'}
      <!-- Nested-rack kits: one slider per pad-rack macro name. Each writes
           vm.macro.<name>. -->
      <RackMacrosRow
        layout={macroLayout}
        value={(name) => vm.value(`macro.${name}`) ?? 0}
        state={(name) => vm.macroState(name)}
        badge={(...names) => vm.macroBadge(...names)}
        coverage={(...names) => vm.macroCoverage(...names)}
        color={controlInk}
        onWrite={(name, t) => vm.writeMacro(name, t)}
        trnsp={members?.pitchMacro ? trnspSlot : undefined}
        gain={gainSlot}
      />
    {:else}
      <!-- Any other native class: Gain over Trnsp, where every kit keeps
           them (ADR-477), then the pad class. -->
      <div class="flex-1 grid grid-cols-4 gap-(--central-gap) min-h-0">
        <div class="flex flex-col gap-(--central-gap) h-full min-w-0">
          {@render gainSlot()}
          {@render trnspSlot()}
        </div>
        <div class="vm-kit-card col-span-3 min-w-0" style="--kit-ink: {controlInk.primary};">
          <div class="vm-kit-class">{kitSummary?.label ?? ''}</div>
          <div class="vm-kit-detail">{kitSummary?.detail ?? ''}</div>
        </div>
      </div>
    {/if}
    {#if showStrip && scopeNote !== null}
      <!-- The scoped pad's notes in the playing clip, the column's foot. -->
      <div class="vm-strip">
        <PadNotesStrip trackPath={trackPath ?? ''} clipPath={clip.playingClipPath} clipWindow={clip.clipWindow} note={scopeNote} ink={controlInk.primary} />
      </div>
    {/if}
    </div>
    <!-- The Filter pad closes the row on these kits (on the face kits it is
         the row's own last section). -->
    {#if scopedProfile !== 'macro-grid'}
      {#if scopedProfile === 'rack-macros'}
        <!-- A nested-rack kit's controls are the macros its author named;
             Filter is a function every kit gets. Same ink, same size — only
             a seam says where one set ends (2026-09-13). -->
        <SectionDivider orientation="vertical" />
      {/if}
      <div class="flex h-full vm-filter-col">
        {@render filterSlot()}
      </div>
    {/if}
    {/if}
  </div>
  {:else}
    <!-- Default state when no drum rack is present -->
    <DeviceEmptyState glyph="🥁" message="Load a Drum Rack to access controls" color={controlInk.primary} />
  {/if}
</div>

<style>
  /* ---- Filter: a PAD, not a slider, so it takes a pad's share rather
     than a fixed width — but capped, because it sits OUTSIDE the profile
     switch and so splits the row with `.vm-controls` as a whole rather
     than flexing against the pads inside it. Uncapped that made it the
     widest thing in the row: measured 220px against the FX and Time pads'
     147px each on a DrumCell kit at 1366px. 160px reads as their peer
     without needing the view to know how many pads each profile draws.
     One token if it wants tuning per profile later (2026-09-09). */
  .vm-filter-col {
    flex: 1 1 0;
    min-width: 0;
    max-width: var(--vm-filter-max-w, 160px);
    min-height: 0;
  }
  .vm-filter-col > :global(.vm-slot) {
    flex: 1 1 0;
    min-width: 0;
  }

  /* ---- The pad column, with the swap pill over it on every kit (ADR-510;
     from 2026-09-16 it lay across the pads and the kit's first sliders on
     the DrumCell, Sampler and Simpler kits, which a face's header line
     cannot hold). A column, so the pad grid's own flex basis (its WIDTH,
     written for a row) is overridden to take the height instead; its
     `width` keeps the column as wide as the pads. The pill contributes no
     width of its own (`width: 0`, then stretched to the column by
     `min-width: 100%`), or its name would widen the pad column to fit — a
     single pad is 68px. */
  .vm-pads-cell {
    display: contents;
  }
  .vm-pads-stack {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--central-gap);
    min-height: 0;
  }
  .vm-pads-stack > :global(.pad-grid) {
    flex: 1 1 0;
  }
  .vm-pads-pill {
    display: flex;
    flex-direction: column;
    width: 0;
    min-width: 100%;
  }
  /* With the pill over them, the pads' column never goes narrower than the
     pill's NAME needs — because that name is the door to the browser
     (ADR-442), and `SwapControl` hides it outright on a flat pill under
     6.5rem and caps it at the pill less a touch target per arrow. A single
     pad is 68px, which is under both, so the door vanished exactly where a
     drum track sits at rest: nothing playing draws one pad.
     Three touch targets is the honest floor: one for each arrow and one for
     the name between them. Two pad columns are already 140px, so this only
     ever moves the ONE-column case, and the width comes out of the face
     beside it — on every kit alike, so Gain and Trnsp still sit on the
     same pixels from kit to kit. The pads keep their own 68px (`.pad-grid`
     sets an explicit width) and stay anchored at the column's leading
     edge, so a pad does not move under the finger when another comes into
     play. */
  .vm-pads-stack.vm-pads-with-pill {
    min-width: calc(3 * var(--height-touch, 44px));
  }

  /* ---- The face (ADR-510): a DrumCell, Sampler or Simpler kit's row is a
     FaceGrid right of the pads' seam. The row's own padding gives way to
     the view's (the inset is the view's, and the seam's central gap either
     side is the face's own seam), so the face fills the column. */
  .vm-face-col > :global(.face-grid) {
    flex: 1 1 0;
    height: auto;
    padding: 0;
  }
  /* The scoped pad's notes strip (2026-10-24): under the face, from Gain
     to the right edge, one pad row tall (the user's call) — a quarter of
     the column, the face taking the other three. */
  .vm-face-col.vm-face-strip > :global(.face-grid) {
    flex-grow: 3;
  }
  .vm-strip {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .vm-face-col > .vm-strip {
    flex: 1 1 0;
  }
  /* In the flex row (the kits off the face) it is the controls column's
     foot, one pad row tall: a quarter of the column less the pads' three
     4px gaps, past the view's gap. */
  .vm-controls:not(.vm-face-col) > .vm-strip {
    flex: 0 0 calc((100% - 12px) / 4);
    margin-top: var(--central-gap);
  }

  /* ---- Kit card (pitch-only profile) --------------------------------
     A kit names its pad class where the FX and Time controls would sit: a
     flat well in the track's ink, the class large, the pad count (or the
     mixed histogram) small beneath. */
  .vm-kit-card {
    container-type: size;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-well);
    box-shadow: inset 0 1px 0 oklch(0 0 0 / 0.5);
    color: var(--kit-ink, var(--foreground));
    font-family: var(--font-sans);
    text-align: center;
    padding: 0.5rem;
  }
  .vm-kit-class {
    font-size: clamp(max(var(--type-min), calc(24 * var(--fluid-px))), 12cqh, 3rem);
    font-weight: var(--font-weight-medium);
    letter-spacing: 0.02em;
    line-height: 1.1;
  }
  .vm-kit-detail {
    font-size: 0.75rem;
    font-weight: var(--font-weight-medium);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--signal-dim);
  }

  /* ---- Live skin (flat grammar) ------------------------------------
     The FX-type buttons wear the focused track's ink (ADR-402) and keep it
     under the flat grammar — as label and solid fill, never as the
     GRATICULE wash/glow: an unselected pad is a control field (1px dark
     frame, from the shared .physical-button flat base in app.css) with
     the ink as its label; the selected pad is a solid block of the ink
     with Live's ClipText, like a session slot. Tailwind `font-semibold`
     comes down to medium — Live never bolds a pad. */
  :global([data-grammar="flat"]) .physical-button {
    font-weight: var(--font-weight-medium);
    color: var(--btn-tint, var(--foreground));
  }
  :global([data-grammar="flat"]) .physical-button.active {
    background: var(--btn-tint, var(--phosphor));
    border-color: var(--btn-tint, var(--phosphor));
    color: var(--flat-clip-text);
  }
  /* Light: the ink's fill envelope is too pale for TEXT on paper — pull
     the OFF label toward the foreground (hue kept), and keep the ON
     frame dark so the block's boundary survives at ~1:1 luminance. */
  :global(.light[data-grammar="flat"]) .physical-button:not(.active) {
    color: color-mix(in oklab, var(--btn-tint, var(--foreground)) 55%, var(--foreground));
  }
  :global(.light[data-grammar="flat"]) .physical-button.active {
    border-color: var(--line-strong);
  }
</style>
