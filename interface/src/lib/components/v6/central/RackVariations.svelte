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
   * A rack's macro variations (ADR-531), as Live's variation panel, a
   * column down the left of the rack's view: one option per stored
   * variation in one segmented tab, the one last recalled ON's block and
   * every name plain ink (ADR-544; the names were the rack's ink and the
   * chosen one a block of it). A few share the column's height, many keep
   * a touch row each and scroll. A rack with none stored draws no column:
   * it held a caption over "None stored" and nothing to press, and the
   * macros take its width. A tap recalls
   * it, a hold deletes it (no Store or Rand here: Ben, 2026-11-12, though
   * the surface keeps both verbs). Live's Python API names none of them, so the names
   * are read from the preset file the rack is named after
   * (`/api/rack-variations`), and only while it holds as many variations
   * as Live does; otherwise they are numbered.
   */
  import { untrack } from 'svelte';
  import { press } from '$lib/actions/press';
  import { selectedTrackStore, type DeviceRecord } from '$lib/stores/v6/selectedTrackStore.svelte';

  interface Props {
    rack: DeviceRecord;
    /** Not read: the tab is drawn in the role tokens (ADR-544). Kept for the hosts that still pass it. */
    ink?: string;
  }

  let { rack }: Props = $props();

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

{#if count > 0}
<div class="rack-variations" role="group" aria-label="Macro variations" data-debug="rack-variations">
  <span class="caption">Variations</span>
  <div class="buttons device-segmented seg-grid">
    {#each labels as label, i (i)}
      <button
        type="button"
        class="variation device-segment"
        class:active={i === selected}
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
  </div>
</div>
{/if}

<style>
  /* A column down the left of the rack's view (Ben, 2026-11-12): the caption,
     the variations top to bottom. */
  .rack-variations {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    width: 8.5rem;
    flex: 0 0 auto;
    min-height: 0;
  }
  /* The house eyebrow, as a face's section name. */
  .caption {
    font-size: 0.8125rem;
    font-weight: var(--font-weight-medium);
    line-height: 1rem;
    color: var(--value);
    text-align: center;
  }
  /* One tab down the column. Its options share the height while each has a
     touch row; more than fit keep that row and the tab scrolls. */
  .buttons {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
  .variation {
    flex: 1 0 var(--height-touch, 44px);
    max-height: 5.5rem;
    padding: 0 0.5rem;
    font-size: 0.9375rem;
    font-weight: var(--font-weight-medium);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
