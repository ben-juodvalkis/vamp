<script lang="ts">
  /**
   * The pitch and mod wheels in a chain cell: side by side, as the
   * instrument views draw them, unless the cell is too narrow for two,
   * where Pitch stacks over Mod (user, 2026-10-28; ADR-492). It was the
   * chain's row count: stacked in a one-row chain.
   */
  import MidiWheelsPanel from '$lib/components/v6/midi/MidiWheelsPanel.svelte';
  import { useCellSize } from './cellSize';

  const cellSize = useCellSize();
</script>

<MidiWheelsPanel sideBySide={cellSize()?.widthClass !== 'narrow'} />
