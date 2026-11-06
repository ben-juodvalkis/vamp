<script lang="ts">
  /**
   * The Guitar rack's view (`Guitar.adg`, the `guitar` slot, the Gtr tile).
   * Its own file since the FX chain overview took over from the grid
   * (2026-10-26); it was the Pedal view's `guitar` part, which also drew
   * the Pedal and the Wah (each its own view now).
   *
   * Guitar.adg's six visible macros, read from the saved preset: 1 Gain,
   * 2 Spring, 3 Trem Rate, 4 Trem Amount, 5 Room, 6 Amp Switch (Live labels
   * it 0 below the midpoint and 1 above: Dirty, Clean). Macro 7 is a hidden
   * duplicate Room. Neither the Amp Switch nor Macro 7 has a control here
   * (the Dirty/Clean pair was removed 2026-10-22, the user's call). Macros
   * are 0..127 on the wire.
   *
   * The Gain at the left, full height (the Gtr tile, mounted here with its
   * tap disabled: this is its home), then the Spring (X) / Room (Y) pad over
   * the Tremolo pad, rate (X) / amount (Y) (user, 2026-10-05), side by side
   * since 2026-10-26. On the face grid (ADR-510), sections [1, 2, 2]: Amp,
   * Reverb, Tremolo, in the rack's macro order.
   *
   * NO {#if device} gate - always renders, handles its own state.
   */

  import GuitarControl from '$lib/components/v6/device-panel/GuitarControl.svelte';
  import DeviceXY from '$lib/components/v6/device-panel/DeviceXY.svelte';
  import { useFxGridSlot } from '$lib/components/v6/central/useFxGridSlot.svelte';
  import { trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';
  import FaceGrid from '../FaceGrid.svelte';
  import FaceSection from '../FaceSection.svelte';
  import FaceSeam from '../FaceSeam.svelte';
  import PanelEyebrow from './panel/PanelEyebrow.svelte';

  const guitar = useFxGridSlot('guitar');

  let guitarInk = $derived({
    primary: trackInk(guitar.color.primary, paintModeReactive()),
    secondary: guitar.color.secondary,
    accent: trackInk(guitar.color.accent, paintModeReactive())
  });

  const GTR = { spring: 2, tremRate: 3, tremAmount: 4, room: 5 } as const;
  const MACRO_MAX = 127;
  const gtrValue = (macro: number) => (guitar.paramValue(macro) ?? 0) / MACRO_MAX;
  const sendGtr = (macro: number, normalized: number) => guitar.sendParam(macro, normalized * MACRO_MAX);
</script>

<div class="guitar-layout" data-view="guitar">
  <FaceGrid sections={[1, 2, 2]}>
    <FaceSection span={1}>
      {#snippet head()}<PanelEyebrow title="Amp" color={guitarInk.primary} />{/snippet}
      <div class="gain" class:slot-ghost={guitar.isGhost}>
        <GuitarControl device={guitar.device} disableCentralViewOnTap={true} icon="guitar" />
      </div>
    </FaceSection>
    <FaceSeam ink={guitarInk.primary} />

    <FaceSection span={2}>
      {#snippet head()}<PanelEyebrow title="Reverb" color={guitarInk.primary} />{/snippet}
      <div class="guitar-xy face-span-all" class:slot-ghost={guitar.isGhost}>
        <DeviceXY
          xValue={gtrValue(GTR.spring)}
          yValue={gtrValue(GTR.room)}
          title="Spring/Room"
          icon="reverb"
          isGhost={guitar.isGhost}
          showCurve={false}
          color={guitarInk}
          onTap={() => guitar.loadIfGhost()}
          onInteraction={(x, y) => {
            sendGtr(GTR.spring, x);
            sendGtr(GTR.room, y);
          }}
        />
      </div>
    </FaceSection>
    <FaceSeam ink={guitarInk.primary} />

    <FaceSection span={2}>
      {#snippet head()}<PanelEyebrow title="Tremolo" color={guitarInk.primary} />{/snippet}
      <div class="guitar-xy face-span-all" class:slot-ghost={guitar.isGhost}>
        <DeviceXY
          xValue={gtrValue(GTR.tremRate)}
          yValue={gtrValue(GTR.tremAmount)}
          title="Tremolo"
          icon="tremolo"
          isGhost={guitar.isGhost}
          showCurve={false}
          color={guitarInk}
          onTap={() => guitar.loadIfGhost()}
          onInteraction={(x, y) => {
            sendGtr(GTR.tremRate, x);
            sendGtr(GTR.tremAmount, y);
          }}
        />
      </div>
    </FaceSection>
  </FaceGrid>
</div>

<style>
  /* The face is the FaceGrid (ADR-510): five equal columns, the Gain one,
     each pad two. */
  .guitar-layout {
    height: 100%;
    width: 100%;
  }

  .gain,
  .guitar-xy {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .gain > :global(*),
  .guitar-xy > :global(*) {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
  }
</style>
