<script lang="ts">
  /**
   * HostedSwapPill — the swap pill (ADR-439) lying flat inside a view, above
   * the group of controls the view puts it over. Mounting it takes the pill
   * from `CentralDisplay`'s column (`swapHost.svelte.ts`); it draws nothing
   * while there is nothing to step, and nothing outside `CentralDisplay`.
   *
   * No inset of its own: the view's gap is what sits between it and the
   * controls below.
   */
  import SwapControl from './SwapControl.svelte';
  import { claimSwapHost } from './swapHost.svelte';

  interface Props {
    /** Let a long name wrap to two lines (SwapControl's `wrap`). */
    wrap?: boolean;
  }

  let { wrap = false }: Props = $props();

  const host = claimSwapHost();
  let pill = $derived(host?.pill ?? null);
</script>

{#if pill?.model}
  <SwapControl
    orientation="horizontal"
    {wrap}
    scopeLabel={pill.model.scopeLabel}
    label={pill.model.label}
    detail={pill.model.detail}
    working={pill.model.working}
    disabled={pill.model.disabled}
    error={pill.model.error}
    ink={pill.ink}
    onPrev={() => pill?.act('prev')}
    onNext={() => pill?.act('next')}
    onOpen={pill.open ? () => pill?.open?.() : null}
  />
{/if}
