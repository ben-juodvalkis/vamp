<script lang="ts" module>
  /** The rack's `variations` row: how many, and which is selected (-1 none). */
  export function parseVariations(raw: unknown): { count: number; selected: number } | null {
    if (typeof raw !== 'string') return null;
    try {
      const v = JSON.parse(raw) as { count?: unknown; selected?: unknown };
      const count = typeof v.count === 'number' && v.count >= 0 ? v.count : 0;
      const selected = typeof v.selected === 'number' ? v.selected : -1;
      return { count, selected };
    } catch {
      return null;
    }
  }

  /** What a variation's button says: its name from the preset file, else its number. */
  export function variationLabels(count: number, names: string[] | null): string[] {
    return Array.from({ length: count }, (_, i) => (names && names.length === count && names[i]?.trim()) || String(i + 1));
  }

  /** How long a variation's button is held to delete it. */
  export const DELETE_HOLD_MS = 800;
</script>

<script lang="ts">
  /**
   * A rack's macro variations (ADR-531), as Live's variation panel: one
   * button per stored variation, the one last recalled lit; a tap recalls
   * it, a hold deletes it. Store keeps the macros as a new variation, Rand
   * randomizes them. Live's Python API names none of them, so the names
   * are read from the preset file the rack is named after
   * (`/api/rack-variations`), and only while it holds as many variations
   * as Live does; otherwise they are numbered.
   */
  import { untrack } from 'svelte';
  import { press } from '$lib/actions/press';
  import { selectedTrackStore, type DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';
  import Dices from '@lucide/svelte/icons/dices';
  import Plus from '@lucide/svelte/icons/plus';

  interface Props {
    rack: DeviceRecord;
    ink: string;
  }

  let { rack, ink }: Props = $props();

  const path = $derived(rack.devicePath);
  $effect(() => selectedTrackStore.subscribeProperty(path, 'variations'));

  const vars = $derived(parseVariations(selectedTrackStore.propertyValue(path, 'variations')));
  const count = $derived(vars?.count ?? 0);
  const selected = $derived(vars?.selected ?? -1);

  // The names, fetched again whenever the rack or its count changes.
  let names = $state<string[] | null>(null);
  $effect(() => {
    const name = rack.name;
    const n = count;
    untrack(() => (names = null));
    if (n <= 0) return;
    let live = true;
    fetch(`/api/rack-variations?name=${encodeURIComponent(name)}&count=${n}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { names?: string[] | null } | null) => {
        if (live) names = body?.names ?? null;
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  });
  const labels = $derived(variationLabels(count, names));

  const write = (key: string, value: number) => void selectedTrackStore.setPropertyValue(path, key, value);

  // A hold deletes; its release must not also recall.
  let held = -1;
</script>

<div class="rack-variations" style="--var-ink: {ink};" role="group" aria-label="Macro variations" data-debug="rack-variations">
  <span class="caption">Variations</span>
  <div class="buttons">
    {#each labels as label, i (i)}
      <button
        type="button"
        class="variation"
        class:on={i === selected}
        aria-pressed={i === selected}
        data-variation-index={i}
        title="{label} — hold to delete"
        use:press={{
          holdMs: DELETE_HOLD_MS,
          onDown: () => (held = -1),
          onHold: () => {
            held = i;
            write('variation.delete', i);
          },
          onPress: () => {
            if (held !== i) write('variation.recall', i);
          }
        }}
      >{label}</button>
    {/each}
    {#if count === 0}<span class="none">None stored</span>{/if}
  </div>
  <button type="button" class="action" data-debug="variation-store" aria-label="Store the macros as a new variation" use:press={{ onPress: () => write('variation.store', 1) }}>
    <Plus size={16} /> Store
  </button>
  <button type="button" class="action" data-debug="variation-randomize" aria-label="Randomize the macros" use:press={{ onPress: () => write('variation.randomize', 1) }}>
    <Dices size={16} /> Rand
  </button>
</div>

<style>
  .rack-variations {
    display: flex;
    align-items: stretch;
    gap: var(--central-gap);
    min-height: var(--height-touch, 44px);
    flex: 0 0 auto;
  }
  .caption {
    align-self: center;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .buttons {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    gap: 6px;
    overflow-x: auto;
  }
  .none {
    align-self: center;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
  .variation,
  .action {
    min-height: var(--height-touch, 44px);
    padding: 0 0.75rem;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--surface-well);
    color: var(--var-ink);
    font-size: 0.875rem;
    white-space: nowrap;
  }
  .variation {
    flex: 0 1 auto;
    min-width: 3rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .variation.on {
    background: var(--var-ink);
    color: var(--flat-on-fg, #111);
    border-color: var(--var-ink);
  }
  .action {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--foreground);
  }
</style>
