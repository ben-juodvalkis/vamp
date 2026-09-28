<script lang="ts">
    /**
     * One clip slot in a strip's session grid (ADR-415).
     *
     * Purely presentational — every gesture belongs to the slot zone's
     * instance of the ADR-384 machine, exactly as the strip's own
     * sections belong to the Card.
     *
     * The zone resolves which row a press landed on from the geometry
     * (press Y against the window offset and the row pitch), not by
     * hit-testing this element: a cell is deliberately a little
     * shorter than its row, and those gaps used to swallow launches.
     * `data-slot-index` is kept as the cell's identity for tests and
     * debugging.
     */

    import ClipPreview from './ClipPreview.svelte';
    import { slotActionGlyph } from '../utils/slotCellState';
    import {
        requestSample,
        peekSample,
        invalidateSample,
        type ClipSample
    } from '$lib/services/clipSampleService';
    import { logger } from '$lib/utils/logger';

    interface Props {
        /** Slot state after the live overlay — see SlotGrid.
         *  NOT named `state`: a variable of that name in scope makes the
         *  compiler read the `$state` rune as a store subscription of it,
         *  which fails at runtime with `store_invalid_shape`. */
        slotState: 'empty' | 'has_clip' | 'playing' | 'recording';
        /** Clip name from the C record; empty for an empty slot. */
        name?: string;
        /** Strip ink, so a clip chip reads as belonging to its track. */
        trackColor: string;
        /** Index within the track, for the tap hit-test. */
        slotIndex: number;
        /** Group strips render an inert body — no launchable affordance. */
        inert?: boolean;
        /**
         * The track is ARMED — so an empty slot here is a slot you can
         * record into, and only then does it wear the record dot.
         * Deliberately literal: Auto-Arm would arm this track on the way
         * past (the strip selects before it launches), but a red dot on
         * every empty slot of every track says nothing about where a
         * take will land. Defaults false — an unknown arm state should
         * under-promise.
         */
        canRecord?: boolean;
        /** Clip path of this slot's clip, for the preview pull. */
        clipPath?: string;
        /** Clip length in beats, from the C record. */
        lengthBeats?: number;
        /**
         * Active loop window, forwarded straight to `ClipPreview`.
         *
         * These must travel with `fraction`: `playheadFraction`
         * normalises the playhead against the LOOP window, so a preview
         * rendering `[0, lengthBeats]` would place it against a
         * different span and the marker would land in the wrong place.
         * Only the playing slot has them (they ride `playing_slot`, not
         * the C record); every other cell keeps the not-looping default
         * and shows its whole file — the span `clip/sample` answered —
         * which is right because its `fraction` is 0 anyway.
         */
        loopStartBeats?: number;
        loopEndBeats?: number;
        looping?: boolean;
        /** Playhead fraction — only meaningful while this slot plays. */
        fraction?: number;
        /** True when THIS slot is the track's playing slot. */
        isPlayingSlot?: boolean;
        /**
         * Finger is down on this cell. Driven by the zone's gesture
         * machine, because a cell is not a button and has no `:active`
         * of its own — and a launch can be a bar away, so without this
         * a tap looks like nothing happened.
         */
        pressed?: boolean;
        /**
         * Fired, but the transport hasn't reached the launch
         * quantization boundary yet — Live's blinking clip. Orthogonal
         * to `slotState`: an EMPTY slot queued to record is triggered
         * while still empty, which is the case that needs it most.
         */
        triggered?: boolean;
        /**
         * Finger is down on the action strip specifically, rather than
         * on the cell body. Separate from `pressed` because the two do
         * different things and the feedback has to say which one the
         * finger is about to commit.
         */
        actionPressed?: boolean;
        /**
         * Width of the action strip in px, measured by the zone and
         * passed down so the painted strip and the geometric hit-test
         * agree exactly. A CSS-authored width would drift from the
         * hit-test by the cell's border, and a press landing one pixel
         * outside the button it visibly hit is the worst kind of bug on
         * a performance surface.
         */
        actionWidthPx?: number;
        /** This slot's scene row is the selected one. */
        sceneSelected?: boolean;
        /**
         * This is the highlighted clip slot — what the foot pedal will
         * act on. The intersection of the selected track and the
         * selected scene, so at most one cell in the whole grid.
         */
        pedalTarget?: boolean;
    }

    let {
        slotState,
        name = '',
        trackColor,
        slotIndex,
        inert = false,
        canRecord = false,
        clipPath = '',
        lengthBeats = 0,
        loopStartBeats = 0,
        loopEndBeats = 0,
        looping = false,
        fraction = 0,
        isPlayingSlot = false,
        pressed = false,
        triggered = false,
        actionPressed = false,
        actionWidthPx = 0,
        sceneSelected = false,
        pedalTarget = false
    }: Props = $props();

    let label = $derived(slotState === 'empty' ? '' : name || `Clip ${slotIndex + 1}`);
    let hasClip = $derived(!inert && slotState !== 'empty');

    // ---- Action strip -------------------------------------------------
    //
    // The cell body selects; this strip is the only thing that acts. What
    // it does depends on what is in the slot, and the glyph says which:
    //
    //   empty      ●  record — the track is armed, so a fire takes here
    //   empty      –  the track is not armed: `fire()` on this slot
    //                 records nothing (Auto-Arm can still arm it on the
    //                 way past, but the mark reports the state the grid
    //                 is in, not one a press might create). The dot used
    //                 to show on every empty slot regardless.
    //   stopped    ▶  play
    //   recording  ▶  end the take and launch it as a loop
    //   playing    ■  stop
    //
    // Note the recording case is ▶ rather than ■: firing a recording
    // session clip is how a looper CLOSES a take (you keep what you
    // played), where stopping would end it without ever looping it.
    let actionGlyph = $derived(slotActionGlyph(slotState, canRecord));
    let actionLabel = $derived(
        slotState === 'empty'
            ? canRecord
                ? `Record into slot ${slotIndex + 1}`
                : `Slot ${slotIndex + 1} — arm the track to record here`
            : slotState === 'playing'
              ? `Stop ${label}`
              : slotState === 'recording'
                ? `End take and loop ${label}`
                : `Play ${label}`
    );
    let showAction = $derived(!inert && actionWidthPx > 0);

    // ---- Preview (ADR-415) ------------------------------------------
    //
    // A cell draws the same waveform / note lanes the track strip draws,
    // through the same `ClipPreview`. What differs is where the data
    // comes from: the strip has a `PlayingClipEntry` (which carries a
    // sample path) for its playing clip, and a grid cell does not — the
    // wire never sent a path for a slot that isn't playing. So the cell
    // asks, via `clip/sample/get`.
    //
    // The reply also tells us audio-vs-MIDI, which the C record doesn't
    // carry. MIDI needs no second query: `clip/notes/get` is path-keyed,
    // so `ClipPreview` pulls notes itself from `clipPath`.
    //
    // Fetched only when the cell actually holds a clip, and answers are
    // cached by clipPath in the service — so scrolling the scene window
    // back and forth doesn't re-query. `peekSample` seeds from that
    // cache synchronously so a re-scrolled cell paints its final state
    // on the first frame instead of flashing a placeholder.
    let sample = $state<ClipSample | null>(null);

    /**
     * Retry budget for a failed pull.
     *
     * A `clipPath` is a position, so nothing about a failure changes
     * this cell's props — without an explicit nudge the effect has no
     * reason to re-run and one dropped datagram or one 5 s timeout
     * would blank the cell until a scene scroll unmounted it. Both the
     * service ("a cell that timed out will ask again") and the surface
     * ("the UI draws the chip without a waveform and asks again")
     * document a re-ask; this is it. Bounded and backed off so a slot
     * the surface genuinely can't resolve settles instead of looping.
     */
    const MAX_SAMPLE_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 1200;

    /**
     * Identity of the clip currently in this slot. The path alone can't
     * carry it — a replaced clip keeps its slot, and a track insert
     * slides the same path onto a different track's clip — so the cell
     * watches the C record fields it already has and drops the service's
     * cached answer when they move under a stable path.
     */
    let clipIdentity = $derived(`${clipPath}::${name}::${lengthBeats}`);
    let lastIdentity: string | null = null;

    $effect(() => {
        const path = clipPath;
        const identity = clipIdentity;

        if (!hasClip || !path) {
            sample = null;
            lastIdentity = null;
            return;
        }

        // Same slot, different clip in it: the cached answer describes
        // the clip that just left.
        if (lastIdentity !== null && lastIdentity !== identity) {
            invalidateSample(path);
        }
        lastIdentity = identity;

        const cached = peekSample(path);
        if (cached) {
            sample = cached;
            return;
        }

        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        let attempt = 0;

        const ask = () => {
            attempt += 1;
            requestSample(path)
                .then((result) => {
                    if (!cancelled) sample = result;
                })
                .catch((err: Error) => {
                    // Degrade to the plain chip — a cell without a preview
                    // is still fully launchable, so this is cosmetic.
                    if (cancelled) return;
                    sample = null;
                    if (attempt >= MAX_SAMPLE_ATTEMPTS) {
                        logger.debug('SlotCell: sample fetch failed, giving up', {
                            clipPath: path,
                            attempts: attempt,
                            error: err.message
                        });
                        return;
                    }
                    logger.debug('SlotCell: sample fetch failed, retrying', {
                        clipPath: path,
                        attempt,
                        error: err.message
                    });
                    retryTimer = setTimeout(ask, RETRY_DELAY_MS);
                });
        };
        ask();

        return () => {
            cancelled = true;
            if (retryTimer !== undefined) clearTimeout(retryTimer);
        };
    });

    // A provisional reply (audio, no path yet — the take is still
    // flushing) needs no poll of its own: the service refuses to cache
    // it, and when the recording finalises the C record's `length`
    // lands, which moves `clipIdentity` and re-runs the effect above
    // into a fresh query. Identity change IS the retrigger.

    // Recording clips have no stable content to draw yet; the state
    // glyph carries that. Length 0 means the C record hasn't landed, in
    // which case there is no window to slice against.
    // Ink for the clip content. GRATICULE draws it in the TRACK's ink,
    // which reads because the cell behind it is only a 26% wash of that
    // ink over the dark card. The flat skin fills the whole cell with
    // the track colour (Live's ClipSlot), so the same ink would be the
    // content painted on itself — invisible, which is exactly how it
    // looked. Live's own answer is near-black content on the coloured
    // clip, the same ink its clip NAME uses (--flat-clip-text), so the
    // preview takes that. Literal, not `var()`: the waveform half of
    // this is a canvas, and `fillStyle` cannot resolve a custom property.
    // The flat grammar puts black text on the coloured clip fill, always.
const previewInk = '#000000';

    let showPreview = $derived(
        hasClip && sample !== null && slotState !== 'recording' && lengthBeats > 0
    );

    let statusCode = $derived(
        slotState === 'recording' ? 2 : slotState === 'playing' ? 1 : 0
    );
</script>

<div
    class="slot-cell state-{slotState}"
    class:is-inert={inert}
    class:is-pressed={pressed && !inert}
    class:is-triggered={triggered && !inert}
    class:is-scene-selected={sceneSelected && !inert}
    class:is-pedal-target={pedalTarget && !inert}
    data-slot-index={inert ? undefined : slotIndex}
    style="--slot-ink: {trackColor}; --slot-action-w: {actionWidthPx}px;"
    role={inert ? undefined : 'button'}
    tabindex={inert ? undefined : -1}
    aria-label={inert ? undefined : `Select slot ${slotIndex + 1}${label ? ` — ${label}` : ''}`}
>
    {#if !inert}
        {#if slotState === 'empty'}
            <!-- Nothing is drawn: an empty slot reads as empty. The body
                 is still a target, but it only SELECTS — it aims the foot
                 pedal at this slot and fires nothing (see `selectSlot`).
                 Recording lives on the action strip's ● alone, so the
                 body has nothing to announce, and a marker here only
                 added noise to a grid that is mostly empty. -->
        {:else}
            {#if showPreview && sample}
                <!-- Clip content behind the label, same renderer the strip
                     uses. Fewer bins than the strip's 256: a cell is a
                     fraction of its width. Note this is a SEPARATE peaks
                     cache entry, not a shared one — the key is
                     `${filePath}:${bins}` — which is why CACHE_MAX is
                     sized for both counts.
                     The playhead only draws on the slot that is actually
                     playing — every other cell is static content. -->
                <div class="slot-preview" aria-hidden="true">
                    <ClipPreview
                        isAudio={sample.isAudioClip}
                        filePath={sample.filePath}
                        {clipPath}
                        {lengthBeats}
                        {loopStartBeats}
                        {loopEndBeats}
                        {looping}
                        fileStartBeats={sample.fileStartBeats}
                        fileEndBeats={sample.fileEndBeats}
                        status={statusCode}
                        {fraction}
                        showPlayhead={isPlayingSlot}
                        bins={64}
                        showLoopBand={false}
                        color={previewInk}
                    />
                </div>
            {/if}
            <!-- No state glyph, and no NAME either. The glyph used to sit
                 in the top-left corner saying what the clip IS, which read
                 as the inverse of the action strip saying what a press
                 DOES — a stopped clip showed ■ in the corner and ▶ in the
                 strip, a playing one the reverse. Two opposed glyphs 40px
                 apart is a coin toss under a finger mid-set.

                 The name went the same way. A cell is small, and its
                 label had to be legible on top of the very thing that
                 identifies the clip better than a name does — the
                 waveform or the note lanes. Every ink tried (near-black,
                 white, haloed) was a compromise between reading the word
                 and reading the content. The cell already says which
                 track (its fill), what is in it (the preview) and what it
                 is doing (fill + ring), so the name is the part that can
                 go. It survives where there is room for it: the strip's
                 own clip view, the clip central view, and this cell's
                 `aria-label`. -->
        {/if}

        <!-- The one part of the cell that acts. Presentational like
             everything else here: the zone's gesture machine owns the
             pointer and decides body-vs-strip from the press geometry,
             so this carries no handler and no `pointer-events` of its
             own. That is what keeps a drag STARTED on the strip still
             scrolling scenes, instead of being swallowed by a button. -->
        {#if showAction}
            <span
                class="slot-action state-{slotState}"
                class:cannot-record={slotState === 'empty' && !canRecord}
                class:is-pressed={actionPressed}
                role="button"
                tabindex="-1"
                aria-label={actionLabel}
            >
                <span aria-hidden="true">{actionGlyph}</span>
            </span>
        {/if}
    {/if}
</div>

<style>
    /* Content sits BEHIND the glyph and label, dimmed so the label stays
       the thing you read first — the preview is orientation, not the
       primary signal at this size. */
    .slot-preview {
        position: absolute;
        inset: 0;
        /* Content starts where the action strip ends. A waveform running
           under the strip put clip content behind a button — the one part
           of the cell that is not the clip — so the glyph sat on top of
           notes and the peaks looked clipped by an edge that is really a
           control. The name already dodges the strip with its own
           padding; this is the same rule for the layer behind it.
           Collapses to the full cell when there is no strip (inert cells,
           pre-measurement), since the var is 0 then. */
        left: var(--slot-action-w, 0px);
        z-index: 0;
        pointer-events: none;
        opacity: 0.5;
    }

    .slot-cell {
        position: relative;
        display: flex;
        align-items: center;
        /* Centered, not left-aligned: a cell is now a full grid row tall
           and wide (the grid owns a whole third), so a small label pinned
           to the left edge read as debris in a large box. */
        justify-content: center;
        gap: var(--spacing-xs);
        height: calc(var(--session-row-h) - var(--session-row-gap));
        margin-bottom: var(--session-row-gap);
        padding: 4px 4px;
        /* Keep the cell's content centred in what is left once the
           action strip has taken its edge. Collapses to the plain gutter
           when there is no strip (inert cells, pre-measurement). */
        padding-left: calc(var(--slot-action-w, 0px) + 4px);
        border-radius: var(--radius-sm);
        border: 1px solid var(--line-strong);
        overflow: hidden;
        /* Reaches the action glyph — the cell carries no text of its
           own any more. */
        font-size: 0.9375rem;
        font-weight: var(--font-weight-medium);
        line-height: 1;
        -webkit-tap-highlight-color: transparent;
        /* Colour/border only — never height, or a state change would
           reflow the grid and break the rail alignment. `transform` is
           safe alongside them: it paints, it doesn't lay out. */
        transition: background-color 90ms var(--ease-precise),
                    border-color 90ms var(--ease-precise),
                    transform 90ms var(--ease-precise);
    }

    /* Empty: dashed and dim. Present but quiet. */
    .slot-cell.state-empty {
        border-style: dashed;
        border-color: color-mix(in oklab, var(--signal-dim) 45%, transparent);
        background: transparent;
        justify-content: center;
        color: var(--signal-dim);
    }

    /* Holds a clip: a chip in the track's ink. */
    .slot-cell.state-has_clip {
        background: color-mix(in oklab, var(--slot-ink) 26%, var(--card));
        border-color: color-mix(in oklab, var(--slot-ink) 55%, transparent);
        color: var(--foreground);
    }

    /* PLAYING is a ring, not a fill (and the playhead sweeping the
       preview is the live half of the signal). A green wash over the
       cell hid the waveform or note lanes underneath — the thing that
       tells you WHICH clip is running — to say something the moving
       playhead already says. So the cell keeps its clip fill and takes
       an act-play ring: the transport ink still reads identically on
       every track colour, which is the rule the Solo band follows
       (ADR-414), but it no longer paints over the content.

       RECORDING keeps its fill: a take has no content to show yet, and
       a red cell is the loudest thing in the grid on purpose. */
    .slot-cell.state-playing {
        background: color-mix(in oklab, var(--slot-ink) 26%, var(--card));
        border-color: var(--act-play);
        color: var(--foreground);
        box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--act-play) 85%, transparent);
    }

    .slot-cell.state-recording {
        background: color-mix(in oklab, var(--act-rec) 30%, var(--card));
        border-color: var(--act-rec);
        color: var(--foreground);
        animation: slot-rec-pulse 1.1s ease-in-out infinite;
    }

    /* Group strips: no clips ever (LOM — a group's clip_slots mirror the
       scene row but are never has_clip). Render an inert body rather
       than cells that look launchable but do nothing. */
    .slot-cell.is-inert {
        border-color: color-mix(in oklab, var(--signal-dim) 20%, transparent);
        background: color-mix(in oklab, var(--signal-dim) 6%, transparent);
    }

    /* ---- Interaction states -------------------------------------
       After the content states, so a press or a queued launch reads
       on top of whatever the cell already is. */

    /* Press feedback, at finger-down rather than on release.
       Presses IN — scales down and brightens — which is the touch
       convention; growing on press reads as a desktop hover. This is
       load-bearing rather than decorative: at 1-bar quantization the
       clip itself may not answer for the best part of a bar, so
       without it a tap that landed looks exactly like a tap that
       missed, and the reflex is to tap again (which cancels the
       launch). 2% is enough to catch peripherally and small enough
       that the grid doesn't look like it moved. */
    .slot-cell.is-pressed {
        transform: scale(0.98);
        filter: brightness(1.35);
    }

    /* An empty cell has no fill to brighten, so it gets one — in the
       track's ink, since what a press here does is record onto that
       track. */
    .slot-cell.state-empty.is-pressed {
        background: color-mix(in oklab, var(--slot-ink) 18%, transparent);
        border-color: color-mix(in oklab, var(--slot-ink) 60%, transparent);
    }

    /* Launch queued: fired, waiting for the quantization boundary.
       Live blinks its clip button here and so do we — a steady mark
       would read as a state the clip is IN, rather than as one it is
       on its way to.

       An INSET ring, not an outer glow: the cell's own `overflow:
       hidden` and the zone's clip would eat anything outside the box,
       and an inset ring costs no layout. It wears `--act-play` like
       the playing state, because what is queued IS a launch, and it
       stays legible over an empty cell, a chip, or a playing one.

       Declared after `.state-recording` so a re-triggered recording
       clip reads as queued — the newer information wins. */
    .slot-cell.is-triggered {
        animation: slot-queued-blink 500ms var(--ease-precise) infinite;
    }

    .slot-cell.state-empty.is-triggered {
        background: color-mix(in oklab, var(--act-play) 12%, transparent);
    }

    @keyframes slot-queued-blink {
        0%,
        100% {
            box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--act-play) 85%, transparent);
        }
        50% {
            box-shadow: inset 0 0 0 2px transparent;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .slot-cell.is-pressed {
            transform: none;
        }

        /* Keep the mark, drop the blink. */
        .slot-cell.is-triggered {
            animation: none;
            box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--act-play) 85%, transparent);
        }
    }


    /* ---- Action strip ---------------------------------------------
       A full-height tab on the cell's trailing edge rather than a
       corner button. The row pitch is only 48–56px, so a square target
       big enough to hit would eat half of a minimum-width cell; taking
       the full height instead buys the same area from the axis that
       has room to spare, and leaves the cell's middle — the part you
       aim at to select — the largest thing in the box.

       `pointer-events: none` is deliberate and load-bearing: the zone's
       gesture machine owns every pointer in the grid and resolves
       body-vs-strip from the press X. If this element could take the
       press itself, a drag starting on it would stop scrolling scenes,
       and we would be back to needing a `stopPropagation` on every
       path — the thing ADR-415 removed by keeping the zone outside the
       Card in the first place. */
    .slot-action {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        z-index: 2;
        width: var(--slot-action-w, 0px);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        font-size: 0.8125rem;
        line-height: 1;
        border-right: 1px solid color-mix(in oklab, var(--line-strong) 80%, transparent);
        background: color-mix(in oklab, var(--card) 55%, transparent);
        color: var(--act-play);
        transition:
            background-color 90ms var(--ease-precise),
            filter 90ms var(--ease-precise);
    }

    /* Ink says what the press does, matching the glyph: record is the
       transport red, stop is the neutral dim, play/end-take is the play
       green. Same global action inks the cell states use, so the strip
       reads identically on every track colour. */
    .slot-action.state-empty {
        color: var(--act-rec);
    }

    /* Nothing to promise: the dash rides the dim signal ink, so the
       strip still reads as a control without reading as "records here". */
    .slot-action.cannot-record {
        color: var(--signal-dim);
    }

    .slot-action.state-playing {
        color: color-mix(in oklab, var(--signal-dim) 70%, var(--foreground));
    }

    /* The strip acknowledges its own finger — the cell body's press
       state must not light when the press is going to ACT rather than
       select, or the feedback lies about which of the two happens. */
    .slot-action.is-pressed {
        background: color-mix(in oklab, currentColor 30%, var(--card));
        filter: brightness(1.2);
    }

    /* ---- Selection ------------------------------------------------
       Three things, deliberately drawn in three different channels so
       they can all be true of one cell at once and still be read apart:

         column (track)  → the ZONE's side rules, in the TRACK's ink
         row (scene)     → this cell's top/bottom rules, in MASTER ink
         intersection    → a neutral ring (the foot pedal's target)

       Axis carries as much of the signal as colour does: vertical rules
       mean column, horizontal rules mean row. That is what lets the
       crossing cell wear both without turning to mud.

       Painted in a pseudo-element rather than as a box-shadow on the
       cell itself, because the queued-launch blink owns `box-shadow`
       here — and inset rather than a border, which would change the
       cell's box and move the grid. */
    .slot-cell.is-scene-selected::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 0;
        pointer-events: none;
        background: color-mix(in oklab, var(--act-master) 18%, transparent);
        box-shadow:
            inset 0 2px 0 0 color-mix(in oklab, var(--act-master) 85%, transparent),
            inset 0 -2px 0 0 color-mix(in oklab, var(--act-master) 85%, transparent);
    }

    /* The pedal target is ONE cell in the whole grid — the highlighted
       clip slot, which is what a foot press acts on. It gets a crisp
       neutral ring rather than a colour: every ink in this component is
       already spoken for by a transport state, and the one thing this
       marker must never do is read as "playing" or "armed". `outline`
       rather than `box-shadow` for the same reason as above. */
    .slot-cell.is-pedal-target {
        outline: 2px solid color-mix(in oklab, var(--foreground) 92%, transparent);
        outline-offset: -2px;
        /* Lifted off the row band and the column rules it sits inside,
           so the ONE cell a foot press will act on is unmistakably the
           brightest thing in the grid rather than merely the busiest. */
        z-index: 3;
    }

    /* ---- Live skin -----------------------------------------------
       Session View literalism: a filled slot is a SOLID block of the
       track colour with black text (Live's ClipText); an empty slot is
       the dark ClipSlotButton well with the small stop-square Live
       draws there; playing/recording fill in ChosenPlay/ChosenRecord;
       the leading action tab is a translucent black band so its glyph
       reads black-on-colour like Live's launch triangle. Clip content
       (waveform / note lanes) draws in BOTH skins: Live itself shows no
       content in a session slot, but this grid is the only place a
       performer sees what is in a clip before firing it, and the flat
       palette is not a reason to give that up. */
    :global([data-grammar="flat"]) .slot-cell {
        border-radius: 2px;
        border: 1px solid var(--flat-clip-border);
        font-weight: var(--font-weight-regular);
    }
    /* Content on a filled clip, not behind a dark wash: near-black at
       full-ish strength, the way Live paints it. The GRATICULE 0.5 was
       calibrated for a bright ink on a dark cell. */
    :global([data-grammar="flat"]) .slot-preview {
        opacity: 0.72;
    }
    :global([data-grammar="flat"]) .slot-cell.state-empty {
        border-style: solid;
        border-color: var(--flat-clip-border);
        background: var(--card); /* SurfaceBackground — the track column */
        color: var(--flat-slot-glyph);
    }
    :global([data-grammar="flat"]) .slot-cell.state-empty.is-triggered {
        background: color-mix(in srgb, var(--act-play) 22%, var(--card));
    }
    :global([data-grammar="flat"]) .slot-cell.state-has_clip {
        background: var(--slot-ink);
        border-color: var(--flat-clip-border);
        color: var(--flat-clip-text);
    }
    /* Same rule in the flat skin: the clip's own colour, ringed in
       ChosenPlay rather than flooded with it. */
    :global([data-grammar="flat"]) .slot-cell.state-playing {
        background: var(--slot-ink);
        border-color: var(--act-play);
        color: var(--flat-clip-text);
        box-shadow: inset 0 0 0 2px var(--act-play);
    }
    :global([data-grammar="flat"]) .slot-cell.state-recording {
        background: var(--act-rec);
        border-color: var(--flat-clip-border);
        color: var(--flat-clip-text);
    }
    :global([data-grammar="flat"]) .slot-cell.is-inert {
        background: var(--card);
        border-color: var(--flat-clip-border);
        opacity: 1;
    }
    :global([data-grammar="flat"]) .slot-action {
        background: rgba(0, 0, 0, 0.16);
        border-right: 1px solid rgba(0, 0, 0, 0.35);
        color: var(--flat-clip-text);
    }
    :global([data-grammar="flat"]) .slot-action.state-empty {
        background: transparent;
        border-right-color: var(--line);
        color: var(--act-rec);
    }
    /* Not armed: Live's own disabled foreground, never an opacity dim. */
    :global([data-grammar="flat"]) .slot-action.cannot-record {
        color: var(--flat-disabled-fg);
    }
    :global([data-grammar="flat"]) .slot-cell.state-empty.is-pressed {
        background: var(--secondary);
        border-color: var(--line-strong);
    }
    :global([data-grammar="flat"]) .slot-cell.is-pedal-target {
        outline-width: 1px;
        outline-offset: -1px;
    }
    :global([data-grammar="flat"]) .slot-cell.is-scene-selected::after {
        background: color-mix(in srgb, var(--flat-selection) 14%, transparent);
        box-shadow:
            inset 0 1px 0 0 var(--flat-selection),
            inset 0 -1px 0 0 var(--flat-selection);
    }
    :global([data-grammar="flat"]) .slot-cell.is-pedal-target {
        outline: 2px solid var(--flat-selection);
    }

    @keyframes slot-rec-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
    }

    @media (prefers-reduced-motion: reduce) {
        .slot-cell.state-recording {
            animation: none;
        }
    }
</style>
