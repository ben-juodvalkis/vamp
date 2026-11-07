<script lang="ts" module>
  import type { BoardRow } from '../../InstrumentBoard.svelte';

  /**
   * Roar at full screen (ADR-515), in the order of Live's expanded Roar:
   * what feeds the stages (Input, Routing) and what follows them
   * (Feedback, Global) on top, the three stages side by side, then the four
   * modulation sources. About 16 face columns a row (ADR-512's budget).
   */
  export const ROAR_BOARD: readonly BoardRow[] = [
    { tiles: [{ id: 'input', cols: 3 }, { id: 'routing', cols: 3 }, { id: 'feedback', cols: 5 }, { id: 'global', cols: 4 }], weight: 1 },
    { tiles: [{ id: 'stage-1', cols: 6 }, { id: 'stage-2', cols: 6 }, { id: 'stage-3', cols: 6 }], weight: 1.25 },
    { tiles: [{ id: 'lfo-1', cols: 4 }, { id: 'lfo-2', cols: 4 }, { id: 'env', cols: 4 }, { id: 'noise', cols: 3 }], weight: 1 }
  ];
</script>

<script lang="ts">
  /**
   * Roar's pages (ADR-515): the band's one face (`face`) and the full
   * screen's tiles, each laid on the face grid (ADR-510) and bound by
   * Live's parameter names through `usePanelParams`, read off the running
   * Roar (`roarParams.ts`). The chain cell's XY moves Drive and Dry/Wet, so
   * the face leaves them out (ADR-510); the board, where everything is,
   * has them in Input and Global.
   *
   * The routing mode decides which stages run (Live 12 manual, 29.33.1):
   * a stage the mode does not use ghosts, Blend shows only where the mode
   * blends two stages, and Multi Band's crossovers only under Multi Band.
   * Its stages take the mode's names (Low, Mid, High; Mid, Side).
   */
  import DeviceSlider from '../../../device-panel/DeviceSlider.svelte';
  import LfoGraph from '../../LfoGraph.svelte';
  import FaceGrid from '../../FaceGrid.svelte';
  import FaceSection from '../../FaceSection.svelte';
  import FaceSeam from '../../FaceSeam.svelte';
  import ChoicePicker from '../../ChoicePicker.svelte';
  import type { PanelParams } from '../panel/usePanelParams.svelte';
  import type { DeviceColorScheme } from '$lib/config/devicePresets';
  import {
    ROAR_ROUTINGS,
    ROAR_SHAPERS,
    ROAR_FILTERS,
    ROAR_FB_MODES,
    ROAR_RATE_MODES,
    ROAR_LFO_WAVES,
    ROAR_NOISES,
    roarStagesFor,
    roarHasBlend,
    roarStageNames,
    roarFilterExtra,
    roarFilterHasRes,
    roarRateParam,
    roarFeedbackTimeParam
  } from '../../../device-panel/roarParams';

  interface Props {
    /** `face` (the band), or a board tile's id (`ROAR_BOARD`). */
    page: string;
    params: PanelParams;
    ink: DeviceColorScheme;
    /** `routing_mode_index`, or undefined until the property answers. */
    routing: number | undefined;
    setRouting: (index: number) => void;
  }

  let { page, params, ink, routing, setRouting }: Props = $props();

  /** Rails that are 0..1 with their zero in the middle (the dump's labels). */
  const BIPOLAR = /^(Drive|Tone Amt|Shaper \d (Bias|Level)|Flt \d Peak|LFO \d Morph)$/;

  const lo = (p: string) => params.range(p)?.min ?? 0;
  const hi = (p: string) => params.range(p)?.max ?? 1;
  const step = (p: string) => {
    const v = params.raw(p);
    return v === undefined ? -1 : Math.round(v - lo(p));
  };
  const isOn = (p: string) => params.has(p) && (params.raw(p) ?? 0) >= 0.5;

  let stages = $derived(roarStagesFor(routing));
  let names = $derived(roarStageNames(routing));
  let blend = $derived(roarHasBlend(routing));
  let multiBand = $derived(routing === 3);

  /** A rate knob's caption by its mode: a rate in Hz, a count of sixteenths, or a division. */
  function rateTitle(mode: number): string {
    return mode === 0 ? 'Rate' : mode === 4 ? '16ths' : 'Sync';
  }
</script>

<!-- A knob bound by name. A parameter whose range is integers wider than a
     switch (a synced division, a note, a count of sixteenths) steps. -->
{#snippet knob(param: string, title: string, size: 's' | 'm' | 'l' = 'm', ghost = false)}
  {@const l = lo(param)}
  {@const h = hi(param)}
  {@const bipolar = BIPOLAR.test(param) || (l < 0 && h > 0)}
  {@const steps = h - l > 1 && Number.isInteger(l) && Number.isInteger(h) ? h - l : undefined}
  <div class="cell" data-param={param}>
    <DeviceSlider
      value={params.raw(param) ?? l}
      {title}
      face="knob"
      knobSize={size}
      min={l}
      max={h}
      centerOrigin={bipolar}
      centerValue={bipolar ? (l < 0 && h > 0 ? 0 : (l + h) / 2) : undefined}
      {steps}
      orientation="vertical"
      labelSize="small"
      isGhost={ghost || !params.has(param)}
      color={ink}
      readout={params.display(param)}
      onInteraction={(v) => params.write(param, steps ? Math.round(v) : v)}
    />
  </div>
{/snippet}

<!-- An on/off parameter: one touch-height button, lit while on. -->
{#snippet sw(param: string, title: string)}
  {@const on = isOn(param)}
  <div class="cell sw-cell">
    <button
      class="physical-button btn-toggle switch"
      class:active={on}
      aria-pressed={on}
      disabled={!params.has(param)}
      style="--btn-tint: {ink.primary};"
      data-param={param}
      onclick={() => params.write(param, on ? lo(param) : hi(param))}
    >{title}</button>
  </div>
{/snippet}

<!-- A pick of named values: a button naming the value, the list opening over the view. -->
{#snippet pick(param: string, labels: readonly string[], title: string)}
  <div class="cell sw-cell" data-param={param}>
    <ChoicePicker options={labels} selected={params.has(param) ? step(param) : undefined} onSelect={(i) => params.write(param, lo(param) + i)} label={title} tint={ink.primary} ghost={!params.has(param)} />
  </div>
{/snippet}

{#snippet routingPick()}
  <div class="cell sw-cell" data-roar-routing>
    <ChoicePicker options={ROAR_ROUTINGS} selected={routing} onSelect={setRouting} label="Routing" tint={ink.primary} ghost={routing === undefined} />
  </div>
{/snippet}

{#snippet title(text: string)}<span class="sub" style="color: {ink.primary};">{text}</span>{/snippet}

<!-- The routing: its pick across two columns, then what the mode adds:
     Blend between two stages, or Multi Band's two crossovers. -->
{#snippet routingTile()}
  <div class="span-2-cell">{@render routingPick()}</div>
  {#if multiBand}
    <div class="stack">{@render knob('Low Mid X-Over', 'Low', 's')}{@render knob('Mid High X-Over', 'High', 's')}</div>
  {:else}
    {@render knob('Blend', 'Blend', 'm', !blend)}
  {/if}
{/snippet}

<!-- One stage, as Live lays it: the shaper's half on the left, the
     filter's on the right, each its type across three columns over three
     knobs over its switches. On the board the stage's own switch and the
     filter's Pre join them; the band keeps the shaper's and filter's. -->
{#snippet stage(n: number, board: boolean)}
  {@const type = step(`Flt ${n} Type`)}
  {@const extra = roarFilterExtra(type)}
  <div class="face-span-all stage-grid" data-roar-stage-grid={n}>
    <div class="span-3">{@render pick(`Shaper ${n} Type`, ROAR_SHAPERS, `${names[n - 1]} shaper`)}</div>
    <div class="span-3">{@render pick(`Flt ${n} Type`, ROAR_FILTERS, `${names[n - 1]} filter`)}</div>
    {@render knob(`Shaper ${n} Amt`, 'Amt', board ? 'l' : 'm')}
    {@render knob(`Shaper ${n} Bias`, 'Bias', board ? 'l' : 'm')}
    {@render knob(`Shaper ${n} Level`, 'Level', board ? 'l' : 'm')}
    {@render knob(`Flt ${n} Freq`, 'Freq', board ? 'l' : 'm')}
    {@render knob(`Flt ${n} Res`, 'Res', board ? 'l' : 'm', !roarFilterHasRes(type))}
    {#if extra}{@render knob(`Flt ${n} ${extra}`, extra, board ? 'l' : 'm')}{:else}<div class="cell"></div>{/if}
    {@render sw(`Shaper ${n} On`, 'Shaper')}
    {#if board}{@render sw(`Stage ${n} On`, 'Stage')}{:else}<div class="cell"></div>{/if}
    <div class="cell"></div>
    {@render sw(`Flt ${n} On`, 'Filter')}
    {#if board}{@render sw(`Flt ${n} Pre On`, 'Pre')}{:else}<div class="cell"></div>{/if}
    <div class="cell"></div>
  </div>
{/snippet}

<!-- An LFO: its wave as Live draws it (ADR-514), rate across, over its
     wave and rate mode, rate, morph and smoothing. Roar's LFOs have no
     amount of their own (the matrix sets how far they reach), so the
     picture is drawn full height. -->
{#snippet lfo(n: 1 | 2)}
  {@const prefix = `LFO ${n}` as const}
  {@const mode = step(`${prefix} Mode`)}
  {@const rate = roarRateParam(prefix, mode)}
  <div class="face-span-all graph-board" style="--graph-rows: minmax(0, 0.9fr) minmax(0, 1.4fr);">
    <div class="graph"><LfoGraph {params} ink={ink.primary} shape={ROAR_LFO_WAVES[step(`${prefix} Wave`)]} {rate} label={prefix} /></div>
    <div class="stack">{@render pick(`${prefix} Wave`, ROAR_LFO_WAVES, `${prefix} wave`)}{@render pick(`${prefix} Mode`, ROAR_RATE_MODES, `${prefix} rate mode`)}</div>
    {@render knob(rate, rateTitle(mode))}
    {@render knob(`${prefix} Morph`, 'Morph')}
    {@render knob(`${prefix} Smooth`, 'Smooth')}
  </div>
{/snippet}

<div class="roar-page" data-roar-page={page}>
{#if page === 'face'}
  <!-- The band (ADR-513: one face): Input's tone, the routing, the first
       stage, the feedback and the compressor. -->
  <FaceGrid sections={[2, 3, 6, 2, 2]}>
    <FaceSection span={2}>
      {#snippet head()}{@render title('Input')}{/snippet}
      <div class="stack">{@render knob('Tone Amt', 'Tone', 's')}{@render sw('Color On', 'Color')}</div>
      {@render knob('Tone Freq', 'Freq')}
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={3}>
      {#snippet head()}{@render title('Routing')}{/snippet}
      {@render routingTile()}
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={6}>
      {#snippet head()}{@render title(names[0])}{/snippet}
      {@render stage(1, false)}
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render title('Feedback')}{/snippet}
      {@render knob('Feedback', 'Amount')}
      {@render knob(roarFeedbackTimeParam(step('FB Time Mode')), step('FB Time Mode') === 4 ? 'Note' : 'Time')}
    </FaceSection>
    <FaceSeam ink={ink.primary} />
    <FaceSection span={2}>
      {#snippet head()}{@render title('Global')}{/snippet}
      {@render knob('Comp Amt', 'Comp')}
      {@render knob('Output', 'Output')}
    </FaceSection>
  </FaceGrid>
{:else if page === 'input'}
  <FaceGrid sections={[3]}>
    <FaceSection span={3}>
      {#snippet head()}{@render title('Input')}{/snippet}
      {@render knob('Drive', 'Drive', 'l')}
      <div class="stack">{@render knob('Tone Amt', 'Tone', 's')}{@render sw('Color On', 'Color')}</div>
      {@render knob('Tone Freq', 'Freq')}
    </FaceSection>
  </FaceGrid>
{:else if page === 'routing'}
  <FaceGrid sections={[3]}>
    <FaceSection span={3}>
      {#snippet head()}{@render title('Routing')}{/snippet}
      {@render routingTile()}
    </FaceSection>
  </FaceGrid>
{:else if page === 'feedback'}
  {@const mode = step('FB Time Mode')}
  <FaceGrid sections={[5]}>
    <FaceSection span={5}>
      {#snippet head()}{@render title('Feedback')}{/snippet}
      <div class="stack">{@render pick('FB Time Mode', ROAR_FB_MODES, 'Feedback mode')}{@render sw('FB Invert', 'Invert')}{@render sw('Fb Gate On', 'Gate')}</div>
      {@render knob('Feedback', 'Amount', 'l')}
      {@render knob(roarFeedbackTimeParam(mode), mode === 4 ? 'Note' : 'Time')}
      {@render knob('FB Freq', 'Freq')}
      {@render knob('FB Width', 'Width')}
    </FaceSection>
  </FaceGrid>
{:else if page === 'global'}
  <FaceGrid sections={[4]}>
    <FaceSection span={4}>
      {#snippet head()}{@render title('Global')}{/snippet}
      <div class="stack">{@render knob('Comp Amt', 'Comp', 's')}{@render sw('Comp Hp On', 'Comp HP')}</div>
      {@render knob('Output', 'Output')}
      {@render knob('Dry/Wet', 'Dry/Wet')}
      {@render knob('Global Mod Amt', 'Mod Amt')}
    </FaceSection>
  </FaceGrid>
{:else if page.startsWith('stage-')}
  {@const n = Number(page.slice(6))}
  <FaceGrid sections={[6]}>
    <FaceSection span={6} ghost={n > stages} data-roar-stage={n} data-roar-stage-used={n <= stages}>
      {#snippet head()}{@render title(names[n - 1])}{/snippet}
      {@render stage(n, true)}
    </FaceSection>
  </FaceGrid>
{:else if page === 'lfo-1' || page === 'lfo-2'}
  <FaceGrid sections={[4]}>
    <FaceSection span={4}>
      {#snippet head()}{@render title(page === 'lfo-1' ? 'LFO 1' : 'LFO 2')}{/snippet}
      {@render lfo(page === 'lfo-1' ? 1 : 2)}
    </FaceSection>
  </FaceGrid>
{:else if page === 'env'}
  <!-- The envelope follower: its sensitivity, its response, the band it listens to. -->
  <FaceGrid sections={[4]}>
    <FaceSection span={4}>
      {#snippet head()}{@render title('Envelope')}{/snippet}
      <div class="stack">{@render knob('Env Thresh', 'Thresh', 's')}{@render knob('Env Gain', 'Gain', 's')}</div>
      <div class="stack">{@render knob('Env Attack', 'Attack', 's')}{@render knob('Env Release', 'Release', 's')}</div>
      <div class="stack">{@render knob('Env Freq', 'Freq', 's')}{@render knob('Env Width', 'Width', 's')}</div>
      <div class="stack">{@render sw('Env Hold On', 'Hold')}<div class="cell"></div></div>
    </FaceSection>
  </FaceGrid>
{:else if page === 'noise'}
  {@const mode = step('Noise Mode')}
  <FaceGrid sections={[3]}>
    <FaceSection span={3}>
      {#snippet head()}{@render title('Noise')}{/snippet}
      <div class="stack">{@render pick('Noise Type', ROAR_NOISES, 'Noise type')}{@render pick('Noise Mode', ROAR_RATE_MODES, 'Noise rate mode')}</div>
      {@render knob(roarRateParam('Noise', mode), rateTitle(mode))}
      {@render knob('Noise Smooth', 'Smooth')}
    </FaceSection>
  </FaceGrid>
{/if}
</div>

<style>
  .roar-page {
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  /* A column of controls sharing its height evenly. */
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    min-height: 0;
    min-width: 0;
  }
  .stack > :global(*) {
    flex: 1 1 0;
    min-height: 0;
  }
  .cell {
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  /* A switch or a pick is one touch-height row, centred in its cell, so it
     lines up with the knob beside it rather than filling the column. */
  .sw-cell {
    display: flex;
    align-items: center;
  }
  .switch {
    width: 100%;
    height: var(--height-touch);
    font-size: 0.8125rem;
  }
  /* A stage: types, knobs, switches, three rows on the section's columns. */
  .stage-grid {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: var(--height-touch) minmax(0, 1fr) var(--height-touch);
    row-gap: var(--spacing-sm);
    min-height: 0;
  }
  .stage-grid > :global(*) {
    min-width: 0;
    min-height: 0;
  }
  .span-3 {
    grid-column: span 3;
    display: flex;
    align-items: center;
  }
  .span-3 > :global(*),
  .span-2-cell > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
  .span-2-cell {
    grid-column: span 2;
    display: flex;
    align-items: center;
  }
  .sub {
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1rem;
    white-space: nowrap;
  }
</style>
