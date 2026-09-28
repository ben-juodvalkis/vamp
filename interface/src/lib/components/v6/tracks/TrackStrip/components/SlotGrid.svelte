<script lang="ts">
    /**
     * One track's column of the session clip grid (ADR-415).
     *
     * Renders a viewport showing `sceneWindowStore.visibleCount` scene
     * rows and translates an inner column by the shared window offset, so
     * every track's column and the scene rail scroll as one. That count
     * grows as main-area sections are switched off (4 · 6 · 8) — this
     * section is then taller, and the height buys more scenes rather than
     * taller cells.
     *
     * **It lives in the grid row, not in the strip.** The clip grid is
     * its own third of the main area — the same height as the strips
     * above it, the central view, or the FX grid — rendered by
     * `TracksPanelV6` as a second grid row inside the *same* horizontal
     * scroller as the strips. One scroller is what makes strip and clip
     * column inseparable: there is a single `scrollLeft`, so a column can
     * never drift out from under the track it belongs to.
     *
     * **Gesture-isolated from the strip.** This zone runs its own
     * instance of the ADR-384 machine (`useStripGestures`), so a drag
     * here scrolls scenes rather than setting the track's volume. The
     * zone sets `touch-action: none` because it needs *both* axes on
     * touch (vertical = scenes, horizontal = row scroll), which is why it
     * also asks the machine to drive the scroller on touch.
     *
     * **State comes only from stores.** Launches are fire-and-forget
     * control wires (§4.4), so there is no optimistic write and no echo
     * suppression here: a cell repaints when the surface says so.
     *
     * **A tap SELECTS; only the action strip acts.** The cell body aims
     * the foot pedal at this slot (`selected_clip` → Live's
     * `highlighted_clip_slot`, the exact property the pedal reads); the
     * strip on the cell's trailing edge is the only thing that fires,
     * stops or records. Which of the two a press meant is decided from
     * the press X against the same measured geometry that paints the
     * strip — not by hit-testing the DOM — so a drag started anywhere,
     * the strip included, still scrolls scenes.
     */

    import { v3Store } from '$lib/stores/v3/normalized.svelte';
    import { playingClipsStore, playheadFraction } from '$lib/stores/v6/playingClipsStore.svelte';
    import { sceneWindowStore } from '$lib/stores/v6/sceneWindowStore.svelte';
    import { session } from '$lib/stores/session.svelte';
    import { useStripGestures } from '../../composables/useStripGestures.svelte';
    import { logger } from '$lib/utils/logger';
    import { deriveSlotCellState } from '../utils/slotCellState';
    import type { SlotState } from '$lib/stores/v3/normalized.svelte';
    import { triggeredSlotsStore } from '$lib/stores/v6/triggeredSlotsStore.svelte';
    import SlotCell from './SlotCell.svelte';
    import { actionStripWidth, isInActionStrip } from '../utils/slotActionZone';

    interface Props {
        trackPath: string;
        trackColor: string;
        /** This track's index, for the selection highlight. */
        trackIndex: number;
        /** Group strips get an inert body — their slots are never has_clip. */
        isGroup?: boolean;
        /** Tap on the cell body: aim the pedal here, fire nothing. */
        onSelect: (slotIndex: number, slotPath: string) => void;
        /** Tap on the action strip: record / play / stop, by cell state. */
        onAction: (slotIndex: number, slotPath: string, slotState: SlotState) => void;
        /** Long press: show this slot's clip without launching it. */
        onFocus?: (slotPath: string) => void;
        /**
         * Draw the selected-track column rules on this column.
         *
         * On by default: in the full grid the rules single one column out
         * of eight and carry the selected strip's own treatment down
         * through its clips. A host that only ever shows the selected
         * track (`MiniSessionGrid`) passes `false` — there the rules mark
         * nothing, and in a column that narrow the two edge rules read as
         * stray light lines in the gaps between cells.
         */
        markSelectedTrack?: boolean;
    }

    let {
        trackPath,
        trackColor,
        trackIndex,
        isGroup = false,
        onSelect,
        onAction,
        onFocus,
        markSelectedTrack = true
    }: Props = $props();

    let zone = $state<HTMLDivElement | null>(null);

    const track = $derived(v3Store.tracks.get(trackPath));
    const offset = $derived(sceneWindowStore.offset);
    const visibleCount = $derived(sceneWindowStore.visibleCount);
    const sceneCount = $derived(sceneWindowStore.sceneCount);

    // Live overlay (phase 1): the S-record snapshot says what the grid
    // looked like at the last state/full, but `playingClipsStore` knows
    // what is playing or recording RIGHT NOW (30 Hz playhead + the
    // playing_slot wire). Where they disagree about this track's current
    // slot, the live channel wins — otherwise a clip launched since the
    // last full ride would render as a plain chip.
    // Can a fire on an EMPTY slot of this track actually record? Only
    // if the track is ARMED, right now — `track.arm`, straight off the
    // v3 record (state/full seeds it, `/looping/v3/track/arm` echoes
    // keep it live).
    //
    // Auto-Arm deliberately does NOT count. The strip does select before
    // it launches, so with Auto-Arm on a fire would arm this track on
    // the way past — but "would be armed if you pressed it" is not what
    // a red dot says to a performer scanning the grid. It says THIS
    // TRACK IS ARMED, and with Auto-Arm on (the default rig) treating
    // it as a promise lit every empty slot on every track red, which is
    // exactly the inaccuracy the gate was added to remove. Reading arm
    // literally means the dots follow the armed track as the selection
    // moves, which is the truth the grid should be telling.
    const canRecord = $derived(track?.arm ?? false);

    const liveEntry = $derived(playingClipsStore.get(trackPath));
    const liveStatus = $derived(playingClipsStore.liveStatus(trackPath));

    // Playhead for the one cell that is actually playing. Read from the
    // same high-frequency position channel the strip uses, so the grid's
    // playhead and the strip's move off one source and cannot drift.
    // `position` is deliberately separate from `liveEntry`: it changes at
    // 30 Hz, and reading it here (rather than inside each cell) keeps the
    // per-cell content effects off that path.
    const livePosition = $derived(playingClipsStore.position(trackPath));
    const playingFraction = $derived(
        liveEntry ? playheadFraction(liveEntry, livePosition) : 0
    );
    const playingSlotIdx = $derived(liveEntry?.slotIdx ?? -1);

    /**
     * Only the rows on screen are mounted, plus one below so a drag
     * reveals a real cell rather than blank space. A set with many
     * scenes would otherwise mount scenes × tracks cells for no reason.
     */
    const firstRow = $derived(Math.floor(offset));
    const rowIndices = $derived.by(() => {
        const last = Math.min(firstRow + visibleCount + 1, sceneCount);
        const out: number[] = [];
        for (let i = firstRow; i < last; i++) out.push(i);
        return out;
    });

    /** Sub-row remainder of the offset — the grid follows the finger. */
    const fractional = $derived(offset - firstRow);

    function slotStateFor(slotIndex: number) {
        return deriveSlotCellState(
            track?.slots.get(`${trackPath}/slots/${slotIndex}`)?.state,
            liveEntry ? { slotIdx: liveEntry.slotIdx, status: liveStatus } : undefined,
            slotIndex
        );
    }

    function clipNameFor(slotIndex: number): string {
        return track?.slots.get(`${trackPath}/slots/${slotIndex}`)?.clip?.name ?? '';
    }

    /** Clip path of a slot's clip, or '' when the slot is empty. */
    function clipPathFor(slotIndex: number): string {
        return track?.slots.get(`${trackPath}/slots/${slotIndex}`)?.clip?.clipPath ?? '';
    }

    /** Clip length in beats from the C record — the preview's window. */
    function clipLengthFor(slotIndex: number): number {
        return track?.slots.get(`${trackPath}/slots/${slotIndex}`)?.clip?.length ?? 0;
    }

    // ---- Gestures ------------------------------------------------------
    //
    // Vertical → shared scene scroll. Horizontal → row scroll, exactly as
    // the strip does. Neither → launch the cell under the finger.
    let rowHeightPx = 0;

    /** Slot under the finger right now, or null. Press feedback only. */
    let pressedSlot = $state<number | null>(null);
    /**
     * True when the press landed on the action strip rather than the
     * cell body. Tracked separately from `pressedSlot` because the two
     * commit to different things — lighting the body for a press that
     * is going to FIRE would misreport which half of the branch the
     * finger is on.
     */
    let pressedAction = $state(false);

    /**
     * Column width, measured — the action strip's width derives from it
     * and both the paint and the hit test must use the same number.
     * A ResizeObserver rather than a per-press read because the strip is
     * painted every frame and the value has to be reactive; the press
     * path then reads the live rect, which agrees because both run the
     * same pure `actionStripWidth`.
     */
    let zoneWidthPx = $state(0);
    const actionWidthPx = $derived(actionStripWidth(zoneWidthPx));

    $effect(() => {
        const el = zone;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const measure = () => {
            const w = el.getBoundingClientRect().width;
            if (w > 0) zoneWidthPx = w;
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    });

    // ---- Selection (the pedal's aim) -----------------------------------
    //
    // The highlighted clip slot is the intersection of Live's selected
    // track and selected scene, and it is what a foot press acts on.
    // Both halves already arrive on the wire (`selected_track` /
    // `selected_scene`), so the target needs no channel of its own —
    // which is also why the grid can paint it without waiting for an ack
    // after a tap.
    const selectedSceneIndex = $derived(session.selectedSceneIndex);
    const isSelectedTrack = $derived(markSelectedTrack && session.selectedTrackIndex === trackIndex);

    // Identifies THIS column's drag to the shared window store. Every
    // column runs its own gesture instance and each can own a finger at
    // once, but the window is one thing — the token lets the store hand
    // it to the first claimant and ignore the rest, instead of the
    // second press silently re-anchoring the first one's drag.
    const dragToken = Symbol('slot-grid-drag');

    const gestures = useStripGestures({
        getElement: () => zone,
        scrollOnTouch: true,
        onDown: ({ x, y }) => {
            // `--session-row-h` is published in PX by TracksPanelV6, which
            // owns the third the grid rows divide up and measures it with
            // a ResizeObserver. Reading it here rather than re-measuring
            // keeps every column on the panel's single authoritative
            // pitch instead of each arriving at its own.
            //
            // Read per press (not once) because that third's height
            // changes with the window, the transport header, and the
            // layout mode — any of which can land between two drags.
            rowHeightPx = zone
                ? parseFloat(getComputedStyle(zone).getPropertyValue('--session-row-h')) || 0
                : 0;
            // Light the cell under the finger at TRUE finger-down, not
            // on release: launch quantization means the clip itself may
            // not answer for the best part of a bar, so the press
            // highlight is the only thing that says "the tap landed".
            // Reads the pitch just measured above.
            pressedSlot = slotIndexAt(x, y);
            pressedAction = pressedSlot !== null && isInActionZone(x);
        },
        // Fires on release, on cancel, AND the moment the gesture
        // becomes a scroll — so a swipe across the grid doesn't drag a
        // lit cell along with it.
        onPressEnd: () => {
            pressedSlot = null;
            pressedAction = false;
        },
        // `onDragStart`, NOT `onDown`. `onDown` fires on every
        // finger-down, but `onDragEnd` fires only when a gesture
        // committed to the vertical axis — so opening the drag at press
        // time leaves it open forever on a tap or a horizontal row
        // scroll, and `isDragging` (which suppresses the snap
        // transition on every column and the rail) never clears.
        // `onDragStart` is the exact mirror of `onDragEnd`.
        onDragStart: () => sceneWindowStore.beginDrag(dragToken),
        onDragMove: ({ dy }) => {
            if (rowHeightPx <= 0) return;
            // Finger up reveals later scenes, so a positive dy (up) is a
            // positive offset delta.
            sceneWindowStore.dragByRows(dy / rowHeightPx, dragToken);
        },
        onDragEnd: () => sceneWindowStore.endDrag(dragToken),
        onTap: ({ x, y }) => dispatchCellTap(x, y),
        onLongPress: ({ x, y }) => dispatchCellLongPress(x, y)
    });

    $effect(() => () => gestures.destroy());

    /**
     * Which scene row the point (x, y) is over — geometry, not
     * hit-testing.
     *
     * `elementFromPoint` would only answer for the pixels a cell
     * actually covers, and a cell is deliberately a little smaller than
     * its row (`--session-row-gap` between them). Every one of those
     * gaps was a dead band that swallowed a launch, and there is no
     * "between two clips" meaning for a press in this zone — the whole
     * row belongs to its slot.
     *
     * The maths is the inverse of the render: rows start at `offset`
     * (fractional) and step by the pitch, so the row under a point is
     * `offset + localY / pitch`, floored. Returns null when the pitch
     * hasn't been measured or the point is past the last scene.
     */
    function slotIndexAt(x: number, y: number): number | null {
        // A group's slots are never launchable — its body is inert.
        if (isGroup) return null;
        if (!zone || rowHeightPx <= 0) return null;
        const rect = zone.getBoundingClientRect();
        if (x < rect.left || x > rect.right) return null;
        const index = Math.floor(offset + (y - rect.top) / rowHeightPx);
        if (index < 0 || index >= sceneCount) return null;
        return index;
    }

    /**
     * Did this press land on the cell's action strip?
     *
     * Geometric, like `slotIndexAt` and for the same reason — and it
     * shares `actionStripWidth` with the paint, so the boundary tested
     * here is exactly the edge drawn on screen.
     */
    function isInActionZone(x: number): boolean {
        if (!zone) return false;
        const rect = zone.getBoundingClientRect();
        return isInActionStrip(x, rect.left, rect.right);
    }

    /**
     * A tap selects; only the strip acts.
     *
     * Selecting writes Live's `highlighted_clip_slot`, which is what the
     * foot pedal reads — so aiming the pedal and touching a cell are the
     * same gesture, and there is no second cursor to keep in sync.
     */
    function dispatchCellTap(x: number, y: number) {
        const slotIndex = slotIndexAt(x, y);
        if (slotIndex === null) return;
        const slotPath = `${trackPath}/slots/${slotIndex}`;
        if (isInActionZone(x)) {
            const slotState = slotStateFor(slotIndex);
            logger.debug('Slot action tap', { component: 'SlotGrid', slotPath, slotState });
            onAction(slotIndex, slotPath, slotState);
            return;
        }
        logger.debug('Slot tap → select', { component: 'SlotGrid', slotPath });
        onSelect(slotIndex, slotPath);
    }

    /**
     * Long press → focus, never launch. Empty slots have nothing to
     * show, so they stay a launch-only target (a hold there is a
     * no-op rather than a "record" the performer didn't ask for —
     * the gesture already suppressed the tap).
     */
    function dispatchCellLongPress(x: number, y: number) {
        if (!onFocus) return;
        const slotIndex = slotIndexAt(x, y);
        if (slotIndex === null) return;
        if (slotStateFor(slotIndex) === 'empty') return;
        const slotPath = `${trackPath}/slots/${slotIndex}`;
        logger.debug('Slot long press → focus', { component: 'SlotGrid', slotPath });
        onFocus(slotPath);
    }
</script>

<div
    bind:this={zone}
    class="slot-zone"
    class:is-track-selected={isSelectedTrack}
    data-debug="slot-zone"
    style="--slot-ink: {trackColor};"
    onpointerdown={gestures.handlePointerDown}
>
    <div
        class="slot-column"
        class:is-dragging={sceneWindowStore.isDragging}
        style="transform: translateY(calc({-fractional} * var(--session-row-h)));"
    >
        {#each rowIndices as slotIndex (slotIndex)}
            <SlotCell
                {slotIndex}
                {trackColor}
                slotState={slotStateFor(slotIndex)}
                name={clipNameFor(slotIndex)}
                clipPath={clipPathFor(slotIndex)}
                lengthBeats={clipLengthFor(slotIndex)}
                pressed={slotIndex === pressedSlot && !pressedAction}
                actionPressed={slotIndex === pressedSlot && pressedAction}
                {actionWidthPx}
                sceneSelected={slotIndex === selectedSceneIndex}
                pedalTarget={isSelectedTrack && slotIndex === selectedSceneIndex}
                triggered={triggeredSlotsStore.has(`${trackPath}/slots/${slotIndex}`)}
                isPlayingSlot={slotIndex === playingSlotIdx && liveStatus > 0}
                fraction={slotIndex === playingSlotIdx ? playingFraction : 0}
                loopStartBeats={slotIndex === playingSlotIdx ? (liveEntry?.loopStartBeats ?? 0) : 0}
                loopEndBeats={slotIndex === playingSlotIdx ? (liveEntry?.loopEndBeats ?? 0) : 0}
                looping={slotIndex === playingSlotIdx ? (liveEntry?.looping ?? false) : false}
                inert={isGroup}
                {canRecord}
                />
        {/each}
    </div>
</div>

<style>
    /* Fills its column of the grid row, which is one full third of the
       main area — the same third the strip above it gets. The row pitch
       comes from --session-row-h, which the panel measures off that third
       and publishes in px (see app.css). The zone therefore never needs
       its own height rule to stay aligned with the rail: both are the
       same third divided the same number of ways.

       The zone lives in its own row, outside any strip's Card, so a drag
       here can never reach the strip's volume fader — there is no
       bubbling to stop — and the meter wash and volume edge ticks stay
       confined to the strip for free. */
    .slot-zone {
        height: 100%;
        min-height: 0;
        position: relative;
        overflow: hidden;
        /* The zone owns BOTH axes on touch: vertical scrolls scenes,
           horizontal scrolls the track row (driven by the machine, since
           `none` means the browser won't pan for us). */
        touch-action: none;
        cursor: grab;
        -webkit-tap-highlight-color: transparent;
    }

    /* The selected track's COLUMN, drawn on the zone rather than on its
       cells. Cells already spend their border and background on clip
       state (track ink chip / play green / record red), so tinting them
       would cost the state read to gain the selection read. The zone
       sits behind them and can carry the column for free.

       It wears the TRACK's ink and mirrors the selected strip's own
       treatment directly above it, so strip and column read as one
       continuous selected track rather than two separate highlights.
       Side rules only — the ends are open, because the column continues
       into the stop cell below and shouldn't look capped. */
    .slot-zone.is-track-selected {
        background: color-mix(in oklab, var(--slot-ink) 14%, transparent);
        box-shadow:
            inset 2px 0 0 0 color-mix(in oklab, var(--slot-ink) 75%, transparent),
            inset -2px 0 0 0 color-mix(in oklab, var(--slot-ink) 75%, transparent);
    }

    .slot-column {
        /* Row pitch is the unit of translation — translating by whole
           percent of one row keeps the math independent of how many rows
           are mounted. */
        will-change: transform;
    }

    /* Follow the finger 1:1 while dragging; ease only into the snap, so
       release settles onto a row instead of stopping dead. */
    .slot-column:not(.is-dragging) {
        transition: transform 140ms var(--ease-precise);
    }

    @media (prefers-reduced-motion: reduce) {
        .slot-column:not(.is-dragging) {
            transition: none;
        }
    }

    /* ---- Flat grammar (Live / Hybrid skins, ui-architecture §8.1) ------
       Selection is SelectionBackground, not the track ink, and it is a
       frame rather than a wash: the selected column mirrors the strip
       above it (`.track-selected` = 1px --flat-selection border) with two
       1px selection rails and no fill — the cells carry all the colour. */
    :global([data-grammar="flat"]) .slot-zone.is-track-selected {
        background: transparent;
        box-shadow:
            inset 1px 0 0 0 var(--flat-selection),
            inset -1px 0 0 0 var(--flat-selection);
    }
</style>
