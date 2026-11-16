<script lang="ts">
  /** The load (ADR-540) the tile inside stands for, or none: see `landingScope`. */
  import type { Snippet } from 'svelte';
  import { provideLanding } from './landingScope';

  let { id, children }: { id?: string | null; children: Snippet } = $props();
  provideLanding(() => id);
</script>

{@render children()}
