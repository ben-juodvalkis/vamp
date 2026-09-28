<script lang="ts">
  /**
   * DeviceEmptyState — shared "no device loaded" placeholder for central views.
   *
   * GRATICULE §5.5: replaces the five+ hand-rolled emoji placeholders scattered
   * across the device views. The glyph rides the device's calibrated ink (pass an
   * already-`trackInk()`-normalized color); the message is sentence-case body text
   * in muted-foreground (never uppercase — it is content, not a control).
   */
  interface Props {
    /** Glyph / emoji shown above the message. */
    glyph?: string;
    /** Sentence-case instruction, e.g. "Load Electric to access controls". */
    message: string;
    /** Glyph ink — pass a trackInk()-normalized color. Defaults to tertiary fg. */
    color?: string;
  }

  let { glyph = '◌', message, color = 'var(--fg-tertiary)' }: Props = $props();
</script>

<div class="h-full flex items-center justify-center">
  <div class="text-center">
    <div class="text-4xl mb-4" style="color: {color}">{glyph}</div>
    <p class="text-sm text-muted-foreground/70">{message}</p>
  </div>
</div>
