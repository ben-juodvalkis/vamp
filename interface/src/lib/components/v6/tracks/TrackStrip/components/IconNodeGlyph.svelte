<script lang="ts">
  /**
   * Draws a lucide icon node, as lucide's own `Icon` does (@lucide/svelte
   * 0.543, ISC). A copy, because the package exports `Icon` only from its
   * index, and importing the index made the build compile all ~1,600 icons.
   */
  import type { IconNode } from '@lucide/svelte';

  let { iconNode = [] }: { iconNode?: IconNode } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  class="lucide-icon lucide"
>
  {#each iconNode as [tag, attrs]}
    <svelte:element this={tag} {...attrs} />
  {/each}
</svg>
