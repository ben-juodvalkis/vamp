<script lang="ts">
  /**
   * An unfolded rack's chains (ADR-529), as Live's chain list: one row per
   * chain in its colour, the chosen one lit. A tap on a row shows that
   * chain's devices beside the list; the dot at its left is the chain's
   * activator (Live's chain mute), lit while the chain plays.
   */
  import { press } from '$lib/actions/press';
  import type { RackChain } from '$lib/services/rackChains.svelte';
  import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';

  interface Props {
    chains: RackChain[];
    selected: number;
    onSelect: (index: number) => void;
    onMute: (index: number, mute: boolean) => void;
  }

  let { chains, selected, onSelect, onMute }: Props = $props();

  const paint = $derived(paintModeReactive());
  /** A press on the lamp is the activator; anywhere else on the row chooses it. */
  function hit(chain: RackChain, x: number, y: number) {
    const el = document.elementFromPoint(x, y);
    if (el instanceof Element && el.closest('.activator')) onMute(chain.index, !chain.mute);
    else onSelect(chain.index);
  }

  function inkOf(chain: RackChain): string {
    return chain.color !== null ? trackInk(rgbToHex(chain.color), paint) : 'var(--cell-ink)';
  }
</script>

<div class="chain-list" role="listbox" aria-label="Chains" data-debug="chain-list">
  {#each chains as chain (chain.index)}
    <div
      class="chain-row"
      class:chosen={chain.index === selected}
      class:muted={chain.mute}
      style="--chain-ink: {inkOf(chain)};"
      role="option"
      tabindex="-1"
      aria-selected={chain.index === selected}
      data-chain-index={chain.index}
      use:press={{ onPress: (info) => hit(chain, info.x, info.y), touchAction: 'none' }}
    >
      <span class="activator" role="switch" tabindex="-1" aria-checked={!chain.mute} aria-label="{chain.name} on"></span>
      <span class="chain-name" lang="en">{chain.name || `Chain ${chain.index + 1}`}</span>
      {#if chain.solo}<span class="solo" aria-label="soloed">S</span>{/if}
    </div>
  {/each}
</div>

<style>
  .chain-list {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  }
  .chain-row {
    flex: 1 1 0;
    min-height: 20px;
    max-height: 48px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding-inline: 4px 8px;
    border-radius: 3px;
    border: 1px solid transparent;
    color: var(--muted-foreground);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .chain-row.chosen {
    background: color-mix(in oklab, var(--chain-ink) 22%, transparent);
    border-color: color-mix(in oklab, var(--chain-ink) 60%, transparent);
    color: var(--foreground);
  }
  .chain-row.muted .chain-name {
    opacity: var(--opacity-ghost, 0.45);
  }
  /* The activator: a 28px target, a 12px lamp in the chain's colour. */
  .activator {
    flex: 0 0 28px;
    align-self: stretch;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .activator::before {
    content: '';
    width: 12px;
    height: 12px;
    border-radius: 2px;
    background: var(--chain-ink);
    border: 1px solid var(--chain-ink);
  }
  .chain-row.muted .activator::before {
    background: transparent;
    border-color: var(--fg-tertiary);
  }
  .chain-name {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .solo {
    flex: 0 0 auto;
    font-size: 0.6875rem;
    font-weight: 700;
    color: var(--act-solo, var(--phosphor));
  }
</style>
