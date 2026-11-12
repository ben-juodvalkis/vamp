<script lang="ts">
  /**
   * An unfolded rack's chains (ADR-529), as Live's chain list: one row per
   * chain in its colour, the chosen one lit. A tap on a row shows that
   * chain's devices beside the list; the dot at its left is the chain's
   * activator (Live's chain mute), lit while the chain plays. The slim
   * fader at its right end is the chain's volume: a sideways drag, a tick
   * at 0 dB.
   */
  import { press } from '$lib/actions/press';
  import { drag } from '$lib/actions/drag';
  import { CHAIN_UNITY, type RackChain } from '$lib/services/rackChains.svelte';
  import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
  import { paintModeReactive } from '$lib/utils/paintMode.svelte';

  interface Props {
    chains: RackChain[];
    selected: number;
    onSelect: (index: number) => void;
    onMute: (index: number, mute: boolean) => void;
    onVolume: (index: number, value: number) => void;
  }

  let { chains, selected, onSelect, onMute, onVolume }: Props = $props();

  /** The fader under a finger: its chain and the value it shows until Live's row catches up. */
  let held = $state<{ index: number; start: number; value: number } | null>(null);
  function volumeOf(chain: RackChain): number {
    return held?.index === chain.index ? held.value : (chain.volume ?? CHAIN_UNITY);
  }

  const paint = $derived(paintModeReactive());
  /** A press on the lamp is the activator; anywhere else on the row chooses
   *  it, the fader included — a drag there is volume, and a drag is no press. */
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
      <span class="chain-main">
      <span class="chain-title">
        <span class="chain-name" lang="en">{chain.name || `Chain ${chain.index + 1}`}</span>
        {#if chain.solo}<span class="solo" aria-label="soloed">S</span>{/if}
      </span>
      <span
        class="chain-fader"
        role="slider"
        tabindex="-1"
        aria-label="{chain.name} volume"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={volumeOf(chain)}
        style="--v: {volumeOf(chain)}; --unity: {CHAIN_UNITY};"
        data-debug="chain-fader"
        use:drag={{
          commit: 'x',
          touchAction: 'none',
          onStart: () => (held = { index: chain.index, start: chain.volume ?? CHAIN_UNITY, value: chain.volume ?? CHAIN_UNITY }),
          onMove: (info) => {
            if (!held) return;
            // Two widths of travel for the whole range: fine enough for a mix.
            const value = Math.max(0, Math.min(1, held.start + info.dx / (info.width * 2 || 120)));
            held = { ...held, value };
            onVolume(chain.index, value);
          },
          onEnd: () => (held = null)
        }}
      ></span>
      </span>
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
    min-height: 26px;
    max-height: 52px;
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
    line-height: 1.1;
    font-size: 0.8125rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* The chain's volume: a slim well, the level in the chain's colour, a
     tick at 0 dB. The target is the row's height; the drawing is 6px. */
  /* Name over fader: the name keeps the row's width, the fader runs
     under it the same width, its target taller than its drawing. */
  .chain-main {
    flex: 1 1 auto;
    min-width: 0;
    align-self: stretch;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .chain-title {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .chain-fader {
    flex: 0 0 12px;
    min-height: 10px;
    position: relative;
    cursor: ew-resize;
  }
  .chain-fader::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: calc(50% - 2px);
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--chain-ink) calc(var(--v) * 100%), var(--surface-well, rgb(0 0 0 / 0.35)) 0);
  }
  .chain-fader::after {
    content: '';
    position: absolute;
    left: calc(var(--unity) * 100%);
    top: calc(50% - 5px);
    width: 1px;
    height: 10px;
    background: var(--fg-tertiary);
  }
  .chain-row.muted .chain-fader::before {
    opacity: var(--opacity-ghost, 0.45);
  }
  .solo {
    flex: 0 0 auto;
    font-size: 0.6875rem;
    font-weight: 700;
    color: var(--act-solo, var(--phosphor));
  }
</style>
