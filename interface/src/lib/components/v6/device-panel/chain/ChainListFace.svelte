<script lang="ts">
  /**
   * An unfolded rack's chains (ADR-529), as Live's chain list: one row per
   * chain in its colour, the chosen one framed. A tap on a row shows that
   * chain's devices beside the list; a tap on the lamp at its left is the
   * chain's activator (Live's chain mute), lit while the chain plays. Each
   * row shows the chain's volume as a fill from its left edge, a tick at
   * 0 dB, and a drag up or down anywhere on the row sets it, as a track
   * strip's fader does: relative, never a jump on touch-down.
   */
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

  /** Finger travel (px) for the whole range, 0 to full: fine enough for a mix on a short row. */
  const VOLUME_TRAVEL = 160;

  /** The row under a finger: its chain and the value it shows until Live's row catches up. */
  let held = $state<{ index: number; start: number; value: number } | null>(null);
  function volumeOf(chain: RackChain): number {
    return held?.index === chain.index ? held.value : (chain.volume ?? CHAIN_UNITY);
  }

  const paint = $derived(paintModeReactive());
  /** A tap on the lamp is the activator; anywhere else on the row chooses it. */
  function tap(chain: RackChain, x: number, y: number) {
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
      class:held={held?.index === chain.index}
      style="--chain-ink: {inkOf(chain)}; --v: {volumeOf(chain)}; --unity: {CHAIN_UNITY};"
      role="option"
      tabindex="-1"
      aria-selected={chain.index === selected}
      data-chain-index={chain.index}
      use:drag={{
        commit: 'y',
        touchAction: 'none',
        onTap: (info) => tap(chain, info.downX, info.downY),
        onStart: () => {
          const start = chain.volume ?? CHAIN_UNITY;
          held = { index: chain.index, start, value: start };
        },
        onMove: (info) => {
          if (!held) return;
          // dy counts up: up is louder.
          const value = Math.max(0, Math.min(1, held.start + info.dy / VOLUME_TRAVEL));
          held = { ...held, value };
          onVolume(chain.index, value);
        },
        onEnd: () => (held = null)
      }}
    >
      <span class="level" aria-hidden="true"></span>
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
    position: relative;
    flex: 1 1 0;
    min-height: 28px;
    max-height: 52px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding-inline: 4px 8px;
    border-radius: 3px;
    border: 1px solid var(--line-strong, transparent);
    background: var(--surface-well, rgb(0 0 0 / 0.35));
    color: var(--muted-foreground);
    cursor: ns-resize;
    overflow: hidden;
    -webkit-tap-highlight-color: transparent;
  }
  .chain-row.chosen {
    border-color: var(--chain-ink);
    color: var(--foreground);
  }
  /* The chain's volume: a wash in its colour from the left edge to the
     level, its edge a line, and a tick at 0 dB. */
  .level {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(to right, transparent calc(var(--unity) * 100% - 1px), var(--fg-tertiary) 0, var(--fg-tertiary) calc(var(--unity) * 100%), transparent 0) bottom / 100% 6px no-repeat,
      linear-gradient(to right, color-mix(in oklab, var(--chain-ink) 34%, transparent) calc(var(--v) * 100%), transparent 0);
  }
  .level::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--v) * 100% - 1px);
    width: 2px;
    background: var(--chain-ink);
  }
  .chain-row.held .level {
    background:
      linear-gradient(to right, transparent calc(var(--unity) * 100% - 1px), var(--fg-tertiary) 0, var(--fg-tertiary) calc(var(--unity) * 100%), transparent 0) bottom / 100% 6px no-repeat,
      linear-gradient(to right, color-mix(in oklab, var(--chain-ink) 50%, transparent) calc(var(--v) * 100%), transparent 0);
  }
  .chain-row.muted .level,
  .chain-row.muted .chain-name {
    opacity: var(--opacity-ghost, 0.45);
  }
  /* The activator: a 28px target, a 12px lamp in the chain's colour. */
  .activator {
    position: relative;
    flex: 0 0 28px;
    align-self: stretch;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
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
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    line-height: 1.1;
    font-size: 0.8125rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .solo {
    position: relative;
    flex: 0 0 auto;
    font-size: 0.6875rem;
    font-weight: 700;
    color: var(--act-solo, var(--phosphor));
  }
</style>
