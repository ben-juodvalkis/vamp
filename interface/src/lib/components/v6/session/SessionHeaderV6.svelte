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
  import { send } from '$lib/api/simpleClient.js';
  import { press } from '$lib/actions/press';
  import { drag as dragAction, type DragInfo, type DragOptions } from '$lib/actions/drag';
  import {
    V3_SESSION_PLAY_CMD_ADDRESS,
    V3_SESSION_STOP_CMD_ADDRESS,
    V3_SESSION_METRONOME_ADDRESS,
    V3_SESSION_SIGNATURE_NUM_ADDRESS,
    V3_SESSION_SIGNATURE_DEN_ADDRESS
  } from '$lib/api/handlers/v3Session';

  /**
   * Metronome / session-record marks.
   *
   * Text characters in BOTH skins now, not emoji under GRATICULE. An
   * emoji ignores `color`, so the OFF metronome rendered as a bright
   * white ⚪ — the loudest thing in a bar full of dim captions, saying
   * "off" in the visual language of "on". These take currentColor, so
   * off is signal-dim and on is the control's own ink.
   *
   * A note rather than a second circle for the metronome: it sat beside
   * the record indicator, both drawn as circles, and at a glance the
   * pair was unreadable.
   */
  const METRONOME_GLYPH = '\u266a';
  const RECORD_GLYPH = '\u25cf';

  // Control functions
  function toggleTransport() {
    const address = session.isPlaying ? V3_SESSION_STOP_CMD_ADDRESS : V3_SESSION_PLAY_CMD_ADDRESS;
    logger.debug(`Transport: ${session.isPlaying ? 'Stopping' : 'Starting'} playback via ${address}`, { component: 'SessionHeaderV6' });
    session.toggleTransportOptimistically();
    send(address, []);
  }

  function toggleMetronome() {
    const newState = session.metronome ? 0 : 1;
    logger.debug(`Metronome: ${session.metronome ? 'Turning OFF' : 'Turning ON'} via ${V3_SESSION_METRONOME_ADDRESS} [${newState}]`, { component: 'SessionHeaderV6' });
    session.toggleMetronomeOptimistically();
    send(V3_SESSION_METRONOME_ADDRESS, [newState]);
  }

  function setTempo(bpm: number) {
    if (bpm >= 20 && bpm <= 999) {
      session.setTempoOptimistically(bpm);
      send('/live/song/set/tempo', [bpm]);
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
      dragStartTempo = session.tempo;
    },
    /** `dy` is pixels travelled UP from the press point. */
    onMove: ({ dy }: DragInfo) => {
      const sensitivity = 0.5; // BPM per pixel
      const newTempo = Math.max(20, Math.min(999, dragStartTempo + dy * sensitivity));
      // Round to 1 decimal place
      setTempo(Math.round(newTempo * 10) / 10);
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
        send(V3_SESSION_SIGNATURE_NUM_ADDRESS, [newNumerator]);
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
        send(V3_SESSION_SIGNATURE_DEN_ADDRESS, [newDenominator]);
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

</script>

<!-- Slim transport header (ADR-415), rebuilt as ONE full-width band.
     It used to be three shadcn clusters — left, centre, right — marooned
     in whitespace, wearing variant colours (`default` = a slate fill)
     that carry no meaning in either palette. Now it is a row of cells at
     one height and one grammar, the same value-over-caption idiom the
     master view's Transport card uses, so the bar reads as part of the
     instrument rather than a toolbar bolted to the top of it.

     Fixed height so enabling it compresses the flex rows below rather
     than reflowing them. -->
<div class="session-header" class:is-playing={session.isPlaying}>
  <div class="hdr-row">

    <!-- Transport. The one control that changes what you HEAR, so it
         takes the play ink when running (never a neutral fill). -->
    <button
      type="button"
      class="hdr-btn hdr-glyph role-transport"
      class:is-on={session.isPlaying}
      data-on={session.isPlaying}
      data-role="transport"
      use:press={{ onPress: toggleTransport, touchAction: 'none' }}
      aria-label={session.isPlaying ? 'Pause transport' : 'Start transport'}
      title={session.isPlaying ? 'Pause' : 'Play'}
    >
      <span class="hdr-value">{session.isPlaying ? '⏸' : '▶'}</span>
      <span class="hdr-caption">{session.isPlaying ? 'Pause' : 'Play'}</span>
    </button>

    <!-- Tempo — drag to change, same address the master view writes. -->
    <div
      class="hdr-field"
      class:is-active={isDragging}
      role="slider"
      aria-label="Tempo"
      aria-valuenow={session.tempo}
      aria-valuemin={20}
      aria-valuemax={999}
      tabindex="0"
      use:dragAction={tempoDrag}
      title="Drag up/down to change tempo"
    >
      <span class="hdr-value num">{session.tempo.toFixed(1)}</span>
      <span class="hdr-caption">BPM</span>
    </div>

    <!-- Time signature — two independent drag digits in one field. -->
    <div class="hdr-field is-split">
      <span class="hdr-value num">
        <button
          type="button"
          class="hdr-digit"
          class:is-active={isDraggingTimeSignature && timeSignatureDragMode === 'numerator'}
          aria-label="Time signature numerator"
          use:dragAction={numeratorDrag}
          title="Drag up/down to change numerator"
        >{session.timeSignature.numerator}</button>
        <span class="hdr-sep">/</span>
        <button
          type="button"
          class="hdr-digit"
          class:is-active={isDraggingTimeSignature && timeSignatureDragMode === 'denominator'}
          aria-label="Time signature denominator"
          use:dragAction={denominatorDrag}
          title="Drag up/down to change denominator"
        >{session.timeSignature.denominator}</button>
      </span>
      <span class="hdr-caption">Time</span>
    </div>

    <!-- Song position. The one readout that moves on its own, so it
         takes the width the old layout spent on empty space. -->
    <div class="hdr-field is-wide">
      <span class="hdr-value num">{session.currentTimeString}</span>
      <span class="hdr-caption">Position</span>
    </div>

    <!-- Metronome: a state, not a value — phosphor when on, the same
         neutral accent the section switches use. -->
    <button
      type="button"
      class="hdr-btn hdr-glyph role-metronome"
      class:is-on={session.metronome}
      data-on={session.metronome}
      data-role="metronome"
      use:press={{ onPress: toggleMetronome, touchAction: 'none' }}
      aria-pressed={session.metronome}
      aria-label={session.metronome ? 'Turn metronome off' : 'Turn metronome on'}
      title="Metronome"
    >
      <span class="hdr-value">{METRONOME_GLYPH}</span>
      <span class="hdr-caption">Click</span>
    </button>

    <!-- Session overdub: an INDICATOR, not a control (nothing here
         writes it), so it is a lit field rather than a button — record
         red when armed, dark when not. -->
    <div
      class="hdr-btn hdr-glyph role-record is-readonly"
      class:is-on={session.sessionRecord}
      data-on={session.sessionRecord}
      role="status"
      aria-label={session.sessionRecord ? 'Session overdub on' : 'Session overdub off'}
      title="Session overdub"
    >
      <span class="hdr-value">{RECORD_GLYPH}</span>
      <span class="hdr-caption">Rec</span>
    </div>

  </div>
</div>

<style>
  /* ~56px: slim enough to cost the rows below almost nothing, tall
     enough that every cell clears the 44px touch floor app.css enforces
     under max-width:1024px. */
  .session-header {
    height: 56px;
    flex-shrink: 0;
    width: 100%;
    padding: 0 var(--spacing-sm);
    background: var(--card);
    border-bottom: 1px solid var(--line);
  }

  /* ONE band, not three clusters. Glyph buttons take a fixed touch
     square; the three readouts share everything left over, so the bar
     fills the width at any window size instead of leaving a lake of
     empty chrome down the middle. Position gets the biggest share — it
     is the only thing here that moves on its own. */
  .hdr-row {
    height: 100%;
    display: grid;
    grid-template-columns:
      minmax(var(--height-touch), 0.75fr)
      minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1.3fr)
      minmax(var(--height-touch), 0.75fr) minmax(var(--height-touch), 0.65fr);
    align-items: stretch;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs) 0;
  }

  /* Shared cell chrome: a field in a 1px frame, the same material the
     master view's Transport card uses. No shadcn variants — their slate
     `default` fill means nothing in either palette, which is how the
     play button ended up reading as a pale grey pill. */
  .hdr-btn,
  .hdr-field {
    min-width: 0;
    display: flex;
    flex-direction: row;
    /* Centred, not baseline-aligned: `baseline` puts the flex line at
       the top of a 44px cell, which left every value hugging the cell's
       upper edge. */
    align-items: center;
    justify-content: center;
    gap: 0.4em;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--foreground);
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color 90ms var(--ease-precise),
      border-color 90ms var(--ease-precise),
      color 90ms var(--ease-precise);
  }

  .hdr-btn {
    cursor: pointer;
    padding: 0;
  }

  .hdr-btn.is-readonly {
    cursor: default;
  }

  /* Transport glyphs are text characters, and at shadcn's `sm` they came
     out ~8px tall. Live's transport marks are the largest thing in its
     bar; these are sized to be legible from a stand. */
  .hdr-glyph {
    font-size: 1.125rem;
    line-height: 1;
  }

  .hdr-btn:hover:not(.is-readonly) {
    background: color-mix(in oklab, var(--foreground) 8%, transparent);
  }

  /* A value over its caption — the master view's readout idiom, so the
     header and the System card teach the same thing twice. The label
     sits BESIDE the value, not under it: the bar is 56px tall and a
     stacked pair spent that height on two small things, where one line
     lets the value read at size. The glyph cells wear a label too — a
     bar of seven cells where two are unlabelled circles is two cells
     you have to remember rather than read. */
  .hdr-field {
    cursor: ns-resize;
    user-select: none;
    -webkit-user-select: none;
  }

  .hdr-field.is-wide {
    cursor: default;
  }

  .hdr-field.is-active,
  .hdr-digit.is-active {
    background: color-mix(in oklab, var(--foreground) 12%, transparent);
  }

  .hdr-value {
    font-size: 1rem;
    font-weight: var(--font-weight-medium);
    line-height: 1;
    display: flex;
    align-items: center;
    gap: 2px;
    white-space: nowrap;
  }

  /* Inside a LIT cell the caption rides the control's own ink — on the
     flat skin's solid ChosenPlay fill the dim token was grey text on
     green, the one unreadable thing in the bar. */
  .hdr-btn.is-on .hdr-caption {
    color: inherit;
    opacity: 0.8;
  }

  .hdr-caption {
    font-size: 0.5625rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    line-height: 1;
    color: var(--signal-dim);
  }

  /* The two time-signature digits drag independently, so each is its own
     target inside the one field rather than the field being split into
     two boxes (which is what made the old header's centre cluster read
     as four unrelated chips). */
  .hdr-digit {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    padding: 0 3px;
    border-radius: 2px;
    cursor: ns-resize;
  }

  .hdr-sep {
    color: var(--signal-dim);
  }


  /* State inks, matching the rest of the surface: play = act-play,
     metronome = the neutral phosphor the section switches use, session
     overdub = act-rec. Each is a wash + full-ink frame, never a fill
     that swallows the glyph. */
  .role-transport.is-on {
    background: color-mix(in oklab, var(--act-play) 22%, transparent);
    border-color: var(--act-play);
    color: color-mix(in oklab, var(--act-play) 70%, white);
  }

  .role-metronome.is-on {
    background: color-mix(in oklab, var(--phosphor) 18%, transparent);
    border-color: color-mix(in oklab, var(--phosphor) 60%, transparent);
    color: color-mix(in oklab, var(--phosphor) 75%, white);
  }

  .role-record.is-on {
    background: color-mix(in oklab, var(--act-rec) 22%, transparent);
    border-color: var(--act-rec);
    color: color-mix(in oklab, var(--act-rec) 75%, white);
  }

  /* Off-state overdub is a dim mark, not a lit one — the glyph should
     not compete with the metronome beside it when nothing is armed. */
  .role-record:not(.is-on) {
    color: var(--signal-dim);
  }

  :global(.light) .role-transport.is-on {
    color: var(--act-play);
  }
  :global(.light) .role-metronome.is-on {
    color: var(--phosphor);
  }
  :global(.light) .role-record.is-on {
    color: var(--act-rec);
  }

  /* Flat grammar: Live's control bar. Every cell is a ControlBackground
     field in a 1px frame with 2px corners and no shadow; a lit control
     is a SOLID ink with a dark glyph (Live has no washes), which is the
     one place this skin and GRATICULE genuinely diverge. */
  :global([data-grammar="flat"]) .session-header {
    background: var(--card);
    border-bottom: 1px solid var(--line-strong);
  }

  :global([data-grammar="flat"]) .hdr-btn,
  :global([data-grammar="flat"]) .hdr-field {
    background: var(--surface-well);
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    color: var(--foreground);
  }

  :global([data-grammar="flat"]) .hdr-caption {
    letter-spacing: 0;
    text-transform: none;
    color: var(--muted-foreground);
    font-size: 0.625rem;
  }

  :global([data-grammar="flat"]) .hdr-btn.is-on .hdr-caption {
    color: inherit;
    opacity: 0.85;
  }

  :global([data-grammar="flat"]) .hdr-field.is-active,
  :global([data-grammar="flat"]) .hdr-digit.is-active {
    background: var(--secondary);
  }

  :global([data-grammar="flat"]) .role-transport.is-on {
    background: var(--act-play);
    border-color: var(--act-play);
    color: var(--flat-on-fg);
  }

  :global([data-grammar="flat"]) .role-metronome.is-on {
    background: var(--phosphor);
    border-color: var(--phosphor);
    color: var(--flat-on-fg);
  }

  :global([data-grammar="flat"]) .role-record.is-on {
    background: var(--act-rec);
    border-color: var(--act-rec);
    color: var(--flat-on-fg);
  }

  /* Light flat: a lit fill sits near the ladder's own luminance, so the
     frame stays dark or the control loses its boundary. */
  :global(.light[data-grammar="flat"]) .role-transport.is-on,
  :global(.light[data-grammar="flat"]) .role-metronome.is-on,
  :global(.light[data-grammar="flat"]) .role-record.is-on {
    border-color: var(--line-strong);
  }
</style>
