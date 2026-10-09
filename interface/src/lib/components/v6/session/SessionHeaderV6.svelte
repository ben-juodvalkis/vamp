<script lang="ts">
  /**
   * Slim transport header (ADR-415).
   *
   * This component existed but was mounted nowhere. Resurrected for
   * session mode's optional top strip, with its debug chrome removed —
   * the OSC-tester button, error-count badge and "V6" badge all belong
   * to the System view, and a performance header is not the place for
   * them.
   *
   * **Tempo address audit.** The write still goes to
   * `/live/song/set/tempo`. That address is NOT stale: Python's
   * `SessionComponent` implements it with 20–999 validate-and-reject
   * (alongside the legacy `/looping/session/tempo` observer), and
   * `SystemCentralView` writes tempo the same way today. Keeping both
   * tempo controls on one address is the point — they must not diverge.
   *
   * **No STOP ALL.** It lived here (the only global one left after
   * ADR-417 took it off the scene rail) and is now gone from the UI
   * entirely: per-track stop cells sit under every grid column, a
   * playing cell's own action strip reaches `clip/stop`, and a global
   * kill has no place in a bar you read mid-set. `/looping/v3/scene/stop`
   * is still on the wire, unbound.
   */
  import { logger } from '$lib/utils/logger';
  import { session } from '$lib/stores/session.svelte.js';
  import { press } from '$lib/actions/press';
  import { drag as dragAction, type DragInfo, type DragOptions } from '$lib/actions/drag';
  import {
    toggleTransport as sendTransportToggle,
    toggleMetronome as sendMetronomeToggle,
    setTempo as sendTempo,
    setSignatureNumerator,
    setSignatureDenominator
  } from '$lib/services/sessionCommands';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';


  // Control functions
  function toggleTransport() {
    logger.debug(`Transport: ${session.isPlaying ? 'Stopping' : 'Starting'} playback`, { component: 'SessionHeaderV6' });
    sendTransportToggle();
  }

  function toggleMetronome() {
    logger.debug(`Metronome: ${session.metronome ? 'Turning OFF' : 'Turning ON'}`, { component: 'SessionHeaderV6' });
    sendMetronomeToggle();
  }

  function setTempo(bpm: number) {
    if (bpm >= 20 && bpm <= 999) {
      sendTempo(bpm);
    }
  }

  /**
   * Tempo and time-signature drag digits (ADR-427).
   *
   * The header's copies of the same two drags `SystemCentralView` carries,
   * and they had the same `event.touches[0].clientY` bug: the digit
   * followed the first finger on the glass rather than the one dragging
   * it. Both now run on `use:drag`, which owns the pointer filtering and
   * the listener lifetime that four hand-written `$effect` blocks did
   * here before.
   *
   * The two views deliberately keep their own sensitivities — the central
   * view's digits are much larger — but nothing else differs.
   */
  let isDragging = $state(false);
  let dragStartTempo = $state(120);

  let isDraggingTimeSignature = $state(false);
  let dragStartNumerator = $state(4);
  let dragStartDenominator = $state(4);
  let timeSignatureDragMode = $state<'numerator' | 'denominator' | null>(null);
  let lastTimeSignatureValue = $state<number | null>(null);

  const tempoDrag: DragOptions = {
    commit: 'immediate',
    touchAction: 'none',
    onStart: () => {
      isDragging = true;
      dragStartTempo = Math.round(session.tempo);
    },
    /** `dy` is pixels travelled UP from the press point. */
    onMove: ({ dy }: DragInfo) => {
      const sensitivity = 0.5; // BPM per pixel
      const newTempo = Math.max(20, Math.min(999, dragStartTempo + dy * sensitivity));
      // Whole BPM, as the master view writes and as the header reads.
      setTempo(Math.round(newTempo));
    },
    onEnd: () => {
      isDragging = false;
    }
  };

  function applyTimeSignatureDrag(deltaY: number) {
    if (!isDraggingTimeSignature || !timeSignatureDragMode) return;
    const sensitivity = 0.1; // Higher sensitivity to detect integer crossings better

    if (timeSignatureDragMode === 'numerator') {
      const rawValue = dragStartNumerator + deltaY * sensitivity;
      const newNumerator = Math.max(1, Math.min(32, Math.round(rawValue)));

      // Only send when we cross into a new integer AND it's different from last sent
      if (newNumerator !== lastTimeSignatureValue) {
        lastTimeSignatureValue = newNumerator;
        logger.debug(`Setting numerator to ${newNumerator} (integer, from raw: ${rawValue.toFixed(2)})`, { component: 'SessionHeaderV6' });
        setSignatureNumerator(newNumerator);
      }
    } else if (timeSignatureDragMode === 'denominator') {
      // Valid denominators: 1, 2, 4, 8, 16
      const validDenominators = [1, 2, 4, 8, 16];
      const currentIndex = validDenominators.indexOf(dragStartDenominator);
      const rawIndexChange = deltaY * sensitivity * 0.5; // Slower for discrete stepping
      const newIndex = Math.max(0, Math.min(validDenominators.length - 1, Math.round(currentIndex + rawIndexChange)));
      const newDenominator = validDenominators[newIndex];

      // Only send when we step to a new denominator AND it's different from last sent
      if (newDenominator !== lastTimeSignatureValue) {
        lastTimeSignatureValue = newDenominator;
        logger.debug(`Setting denominator to ${newDenominator} (integer, index: ${newIndex})`, { component: 'SessionHeaderV6' });
        setSignatureDenominator(newDenominator);
      }
    }
  }

  function timeSignatureDrag(mode: 'numerator' | 'denominator'): DragOptions {
    return {
      commit: 'immediate',
      touchAction: 'none',
      onStart: () => {
        isDraggingTimeSignature = true;
        timeSignatureDragMode = mode;
        dragStartNumerator = session.timeSignature.numerator;
        dragStartDenominator = session.timeSignature.denominator;
      },
      onMove: ({ dy }: DragInfo) => applyTimeSignatureDrag(dy),
      onEnd: () => {
        isDraggingTimeSignature = false;
        timeSignatureDragMode = null;
        lastTimeSignatureValue = null; // Reset throttling
      }
    };
  }

  const numeratorDrag: DragOptions = $derived(timeSignatureDrag('numerator'));
  const denominatorDrag: DragOptions = $derived(timeSignatureDrag('denominator'));

  /**
   * Song position as `bar.beat` (Ben, 2026-10-09): Live's reading without
   * the sixteenth, which flickered at 10 Hz and is not something to read
   * mid-set.
   */
  const beatsPerBar = $derived(session.timeSignature.numerator || 4);
  const songTime = $derived(Math.max(0, session.currentTime));
  const bar = $derived(Math.floor(songTime / beatsPerBar) + 1);
  const beat = $derived(Math.floor(songTime % beatsPerBar) + 1);

  /**
   * The line sweeping the Position field once a bar. Song time arrives at
   * 10 Hz, which steps visibly, so while the transport runs the line is
   * extrapolated between updates from the tempo (capped at a quarter
   * second past the last one, so a stalled wire freezes rather than runs
   * on). Written straight to the element's transform each frame: one
   * compositor-only property, no reactive churn at 60 Hz.
   */
  let sweepEl = $state<HTMLElement | null>(null);
  let anchorBeats = 0;
  let anchorAt = 0;

  $effect(() => {
    anchorBeats = Math.max(0, session.currentTime);
    anchorAt = performance.now();
  });

  function paintSweep(beats: number) {
    if (!sweepEl) return;
    const phase = (beats % beatsPerBar) / beatsPerBar;
    sweepEl.style.transform = `translateX(${(phase * 100).toFixed(3)}%)`;
  }

  $effect(() => {
    const playing = session.isPlaying;
    const bpm = session.tempo;
    void beatsPerBar;
    if (!sweepEl) return;
    if (!playing) {
      paintSweep(songTime);
      return;
    }
    let raf = 0;
    const frame = () => {
      const elapsed = Math.min((performance.now() - anchorAt) / 1000, 0.25);
      paintSweep(anchorBeats + (elapsed * bpm) / 60);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });

</script>

<!-- Slim transport header (ADR-415), one full-width band in the master
     view's grammar (Ben, 2026-10-09: fit the rest of the UI): values in
     framed fields with their caption beside them, the two switches as
     rows that say their name and wear an On/Off chip, as the System view's
     Click and Follow Key do. Whole numbers only: tempo and position.

     Fixed height so enabling it compresses the flex rows below rather
     than reflowing them. -->
<div class="session-header" class:is-playing={session.isPlaying}>
  <div class="hdr-row">

    <!-- Transport. The one control that changes what you HEAR, so it
         takes the play ink when running. -->
    <button
      type="button"
      class="hdr-btn role-transport"
      class:is-on={session.isPlaying}
      data-on={session.isPlaying}
      data-role="transport"
      use:press={{ onPress: toggleTransport, touchAction: 'none' }}
      aria-label={session.isPlaying ? 'Pause transport' : 'Start transport'}
      title={session.isPlaying ? 'Pause' : 'Play'}
    >
      {#if session.isPlaying}
        <Pause class="hdr-icon" aria-hidden="true" />
      {:else}
        <Play class="hdr-icon" aria-hidden="true" />
      {/if}
      <span class="hdr-btn-label">{session.isPlaying ? 'Pause' : 'Play'}</span>
    </button>

    <!-- Tempo — drag to change, same address the master view writes. -->
    <div
      class="hdr-field"
      class:is-active={isDragging}
      role="slider"
      aria-label="Tempo"
      aria-valuenow={Math.round(session.tempo)}
      aria-valuemin={20}
      aria-valuemax={999}
      tabindex="0"
      use:dragAction={tempoDrag}
      title="Drag up/down to change tempo"
    >
      <span class="hdr-value">{Math.round(session.tempo)}</span>
      <span class="hdr-caption">BPM</span>
    </div>

    <!-- Time signature — two independent drag digits in one field. -->
    <div class="hdr-field is-split">
      <span class="hdr-value">
        <button
          type="button"
          class="hdr-digit is-num"
          class:is-active={isDraggingTimeSignature && timeSignatureDragMode === 'numerator'}
          aria-label="Time signature numerator"
          use:dragAction={numeratorDrag}
          title="Drag up/down to change numerator"
        >{session.timeSignature.numerator}</button>
        <span class="hdr-sep">/</span>
        <button
          type="button"
          class="hdr-digit is-den"
          class:is-active={isDraggingTimeSignature && timeSignatureDragMode === 'denominator'}
          aria-label="Time signature denominator"
          use:dragAction={denominatorDrag}
          title="Drag up/down to change denominator"
        >{session.timeSignature.denominator}</button>
      </span>
      <span class="hdr-caption">Time</span>
    </div>

    <!-- Song position: bar.beat, Live's reading without the sixteenth. -->
    <div class="hdr-field is-readout" aria-label="Song position: bar {bar}, beat {beat}">
      <span class="hdr-value">{bar}.{beat}</span>
      <span class="hdr-caption">Position</span>
      <!-- Where in the bar: a tick per beat along the foot, and a line
           that sweeps the field once a bar. -->
      <span class="hdr-bar" aria-hidden="true">
        {#each { length: beatsPerBar } as _, i (i)}
          <span class="hdr-tick" class:is-downbeat={i === 0} style:left="{(i / beatsPerBar) * 100}%"></span>
        {/each}
        <span class="hdr-sweep" bind:this={sweepEl}><span class="hdr-sweep-line"></span></span>
      </span>
    </div>

    <!-- Metronome: a switch row, the System view's Click. -->
    <button
      type="button"
      class="hdr-switch role-metronome"
      class:is-on={session.metronome}
      data-on={session.metronome}
      data-role="metronome"
      use:press={{ onPress: toggleMetronome, touchAction: 'none' }}
      aria-pressed={session.metronome}
      aria-label={session.metronome ? 'Turn metronome off' : 'Turn metronome on'}
      title="Metronome"
    >
      <span class="hdr-switch-label">Click</span>
      <span class="hdr-chip" aria-hidden="true">{session.metronome ? 'On' : 'Off'}</span>
    </button>

    <!-- Session overdub: an INDICATOR, not a control (nothing here
         writes it) — the same row, but no press, and its On is record red. -->
    <div
      class="hdr-switch role-record is-readonly"
      class:is-on={session.sessionRecord}
      data-on={session.sessionRecord}
      role="status"
      aria-label={session.sessionRecord ? 'Session overdub on' : 'Session overdub off'}
      title="Session overdub"
    >
      <span class="hdr-switch-label">Overdub</span>
      <span class="hdr-chip" aria-hidden="true">{session.sessionRecord ? 'On' : 'Off'}</span>
    </div>

  </div>
</div>

<style>
  /* ~56px: slim enough to cost the rows below almost nothing, tall
     enough that every cell clears the 44px touch floor. */
  .session-header {
    height: 56px;
    flex-shrink: 0;
    width: 100%;
    padding: 0 var(--spacing-sm);
    background: var(--card);
    border-bottom: 1px solid var(--line-strong);
  }

  /* ONE band. Play and the two switches take fixed widths; the three
     readouts share everything left over. */
  .hdr-row {
    height: 100%;
    display: grid;
    grid-template-columns:
      minmax(6.5rem, 0.7fr)
      minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.3fr)
      minmax(8rem, 0.8fr) minmax(9rem, 0.85fr);
    align-items: stretch;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs) 0;
  }

  /* The master view's value field: a well in a 1px frame. */
  .hdr-btn,
  .hdr-field,
  .hdr-switch {
    min-width: 0;
    display: flex;
    align-items: center;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    color: var(--foreground);
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color 90ms var(--ease-precise),
      border-color 90ms var(--ease-precise),
      color 90ms var(--ease-precise);
  }

  .hdr-field {
    justify-content: center;
    gap: 0.5rem;
    background: var(--surface-well);
    cursor: ns-resize;
    user-select: none;
    -webkit-user-select: none;
  }
  .hdr-field.is-readout {
    cursor: default;
    position: relative;
    overflow: hidden;
  }
  /* The value and its caption stay above the sweep. */
  .hdr-field.is-readout > .hdr-value,
  .hdr-field.is-readout > .hdr-caption {
    position: relative;
    z-index: 1;
  }
  .hdr-bar {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .hdr-tick {
    position: absolute;
    bottom: 0;
    width: 1px;
    height: 0.375rem;
    background: var(--line-strong);
  }
  .hdr-tick.is-downbeat {
    display: none; /* the field's own left edge is the downbeat */
  }
  /* A full-width layer translated by the bar's phase, so 100% is the
     field's width; the line rides its left edge. */
  .hdr-sweep {
    position: absolute;
    inset: 0;
    will-change: transform;
  }
  .hdr-sweep-line {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 2px;
    background: var(--playhead);
    opacity: 0.55;
  }
  /* Tempo's whole field is its drag target already; the time signature's
     two digits stretch theirs over the field the same way the master
     view's do — numerator the left half, denominator the right. */
  .hdr-field.is-split {
    position: relative;
  }
  .hdr-field.is-split .hdr-digit::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
  }
  .hdr-field.is-split .hdr-digit.is-num::after {
    left: 0;
    right: 50%;
  }
  .hdr-field.is-split .hdr-digit.is-den::after {
    left: 50%;
    right: 0;
  }
  .hdr-field.is-active,
  .hdr-digit.is-active {
    background: var(--secondary);
  }

  /* Values read like the master view's digits: the body face, regular
     weight, tabular figures so they don't jitter as they change. */
  .hdr-value {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: 1.375rem;
    font-weight: var(--font-weight-regular);
    font-variant-numeric: tabular-nums lining-nums;
    line-height: 1;
    white-space: nowrap;
  }
  .hdr-caption {
    font-size: 0.8125rem;
    font-weight: var(--font-weight-medium);
    line-height: 1;
    color: var(--muted-foreground);
    white-space: nowrap;
  }

  .hdr-digit {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    padding: 0.25rem 0.25rem;
    border-radius: var(--radius-sm);
    cursor: ns-resize;
  }
  .hdr-sep {
    color: var(--muted-foreground);
    font-weight: 200;
  }

  /* Play: an icon and its word, lit in the play ink while running. */
  .hdr-btn {
    justify-content: center;
    gap: 0.5rem;
    padding: 0 var(--spacing-md);
    background: var(--surface-well);
    cursor: pointer;
    font-size: 0.9375rem;
    font-weight: var(--font-weight-medium);
  }
  .hdr-btn :global(.hdr-icon) {
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
  }
  .role-transport.is-on {
    background: var(--act-play);
    border-color: var(--act-play);
    color: var(--flat-on-fg);
  }
  .role-transport.is-on :global(.hdr-icon) {
    fill: currentColor;
  }

  /* Switches: the System view's row — name on the left, On/Off chip on
     the right; On in Live's orange (record red for overdub), Off a well. */
  .hdr-switch {
    justify-content: space-between;
    gap: var(--spacing-md);
    padding: 0 var(--spacing-md);
    background: var(--card);
    font-size: 0.9375rem;
    font-weight: var(--font-weight-medium);
    text-align: left;
    cursor: pointer;
  }
  .hdr-switch.is-readonly {
    cursor: default;
  }
  .hdr-switch-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hdr-chip {
    flex-shrink: 0;
    min-width: 3rem;
    padding: 0.25rem 0.5rem;
    font-size: 0.8125rem;
    font-weight: var(--font-weight-medium);
    text-align: center;
    color: var(--muted-foreground);
    background: var(--surface-well);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
  }
  .role-metronome.is-on .hdr-chip {
    color: var(--flat-on-fg);
    background: var(--phosphor);
    border-color: var(--phosphor);
  }
  .role-record.is-on .hdr-chip {
    color: var(--flat-on-fg);
    background: var(--act-rec);
    border-color: var(--act-rec);
  }

  .hdr-btn:active,
  .hdr-switch:not(.is-readonly):active {
    background: var(--secondary);
  }
  .role-transport.is-on:active {
    background: var(--act-play);
  }
  @media (hover: hover) {
    .hdr-btn:not(.is-on):hover,
    .hdr-switch:not(.is-readonly):hover {
      background: var(--secondary);
    }
  }
  .hdr-btn:focus-visible,
  .hdr-switch:focus-visible,
  .hdr-field:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }

  /* Flat grammar: the rules above are already written in it (fields in a
     1px frame, ON a solid ink with dark text). Light: a lit fill sits
     near the ladder's own luminance, so its frame stays dark. */
  :global(.light[data-grammar="flat"]) .role-transport.is-on,
  :global(.light[data-grammar="flat"]) .hdr-switch.is-on .hdr-chip {
    border-color: var(--line-strong);
  }
</style>
