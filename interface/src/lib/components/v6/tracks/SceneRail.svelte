<script lang="ts">
    /**
     * Scene-launch rail (ADR-415) — the right sidebar's twin of every
     * strip's slot zone.
     *
     * Alignment is the whole point of this component's geometry, and it
     * is structural rather than tuned: the rail is the sidebar's SECOND
     * section and the clip grid is the main area's second section, and
     * the layout gives every visible section an equal share of the
     * height (ADR-416) — so the two boxes match without either measuring
     * the other. Each then divides its own height by
     * `sceneWindowStore.renderedRows` to get its row pitch and both
     * arrive at the same number. Nothing here needs to know about the
     * Solo band — that band lives inside the strips' section.
     *
     * How MANY rows that is scales with the section count: hiding the
     * central view and the FX grid roughly doubles this section's
     * height, and the store spends it on more scenes (4 → 6 → 8) rather
     * than on taller ones. Both sides read the same
     * `sceneWindowStore.visibleCount`, so the two stay in step through
     * a toggle exactly as they do through a scene add.
     *
     * The rail owns its whole section (ADR-416 gave it the full sidebar
     * width, ending ADR-415's split with the groove-quantize slider).
     * Nothing may be added to that row: anything which shortens the
     * rail's box changes its pitch and desyncs it from the grid. The
     * STOP ALL below is the one exception, and only because it is not
     * one-sided — the clip grid has a per-track stop row of exactly one
     * pitch, so both columns lose the same strip and both keep dividing
     * what remains by `renderedRows`. The section switches were briefly
     * hosted in that footer too; scaling the window to 8 rows took the
     * pitch to ~56px and left STOP ALL 2px tall, so they moved to the
     * browser rail, which no main-area geometry depends on.
     *
     * Scrolling is shared: dragging here moves `sceneWindowStore`, which
     * every strip reads, so the rail and all grids travel together.
     */

    import { sceneWindowStore } from '$lib/stores/v6/sceneWindowStore.svelte';
    import { v3Store } from '$lib/stores/v3/normalized.svelte';
    import { session } from '$lib/stores/session.svelte';
    import { useStripGestures } from './composables/useStripGestures.svelte';
    import { sendSceneLaunch, sendSelectClip } from '$lib/services/clipCommands';
    import {
        actionStripWidth,
        isInActionStrip
    } from './TrackStrip/utils/slotActionZone';
    import { logger } from '$lib/utils/logger';
    import { press } from '$lib/actions/press';

    /** The scrolling box — NOT the whole rail, which now also holds
     *  the STOP ALL strip. Measuring this one keeps the row pitch
     *  equal to the clip grid's for free. */
    let rail = $state<HTMLDivElement | null>(null);

    const offset = $derived(sceneWindowStore.offset);
    const visibleCount = $derived(sceneWindowStore.visibleCount);
    const sceneCount = $derived(sceneWindowStore.sceneCount);
    const maxOffset = $derived(sceneWindowStore.maxOffset);

    const firstRow = $derived(Math.floor(offset));
    const fractional = $derived(offset - firstRow);
    const rowIndices = $derived.by(() => {
        const last = Math.min(firstRow + visibleCount + 1, sceneCount);
        const out: number[] = [];
        for (let i = firstRow; i < last; i++) out.push(i);
        return out;
    });

    // Scroll thumb: how much of the grid is on screen, and where.
    const thumbFraction = $derived(sceneWindowStore.visibleFraction);
    const thumbOffset = $derived(maxOffset > 0 ? (offset / maxOffset) * (1 - thumbFraction) : 0);
    const showThumb = $derived(sceneCount > visibleCount);

    // Row pitch, measured rather than authored: the rail is one section
    // of the sidebar tall and divides that section by the number of rows
    // it actually draws — so a set with two scenes gets two tall rows,
    // not two short ones over dead space. Published on the element as
    // --session-row-h (px) so the row styles below and the drag maths
    // read one value. The clip grid measures its own section the same
    // way and lands on the same pitch.
    //
    // The +1 is STOP ALL, which is one more row rather than a bar of
    // chrome — the grid's per-track stop row is the same extra share on
    // its side, so both divisors match and the scene rows stay level.
    let section = $state<HTMLDivElement | null>(null);
    const renderedRows = $derived(sceneWindowStore.renderedRows);
    let sectionHeightPx = $state(0);
    const rowPitchPx = $derived(
        renderedRows > 0 ? sectionHeightPx / (renderedRows + 1) : 0
    );

    $effect(() => {
        const el = section;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const measure = () => {
            const h = el.getBoundingClientRect().height;
            if (h > 0) sectionHeightPx = h;
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    });

    // Persist the window store's read-side clamp whenever the legal range
    // changes — which is on the scene count OR the visible-row count,
    // since maxOffset is the difference of the two. Deleting scenes is the
    // first case; turning a section off is the second (the window grows to
    // 6 or 8 rows, so it already reaches further down the set). Without
    // this a shrink leaves the stored offset stale, and a later regrow (an
    // undo, scenes re-added one at a time, or the section switched back
    // on) walks the grid down on its own. The rail is mounted exactly
    // while the grid is on screen, so it is the right place to own this.
    $effect(() => {
        sceneWindowStore.sceneCount;
        sceneWindowStore.visibleCount;
        sceneWindowStore.clampToSceneCount();
    });

    // The rail is one more claimant on the single shared window — see
    // the note in SlotGrid.
    const dragToken = Symbol('scene-rail-drag');

    /** Scene under the finger right now. Press feedback only — the
     *  rail's buttons are divs inside the gesture zone, so like the
     *  grid's cells they have no `:active` of their own. */
    let pressedScene = $state<number | null>(null);
    /** The press landed on the launch strip, not the button body. */
    let pressedAction = $state(false);

    /** Rail width, for the launch strip's geometry — same measured-once,
     *  shared-formula arrangement the grid's cells use, so the strip the
     *  finger sees and the strip the hit test uses are one edge. */
    let railWidthPx = $state(0);
    const actionWidthPx = $derived(actionStripWidth(railWidthPx));

    $effect(() => {
        const el = rail;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const measure = () => {
            const w = el.getBoundingClientRect().width;
            if (w > 0) railWidthPx = w;
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    });

    const selectedSceneIndex = $derived(session.selectedSceneIndex);

    /**
     * Which track a scene selection is anchored to.
     *
     * Live has no "selected scene" setter on this wire — what exists is
     * `selected_clip [trackPath, sceneIndex]`, which writes the
     * highlighted slot, and a slot needs a column as well as a row. The
     * selected track is the right column (moving the row shouldn't move
     * the column), but it can be the master or a stale index, neither of
     * which resolves to a slot — so fall back to the lowest real track
     * rather than sending a path the surface will reject.
     */
    function anchorTrackIndex(): number | null {
        const selected = session.selectedTrackIndex;
        if (selected >= 0 && v3Store.tracks.has(`tracks/${selected}`)) return selected;
        let lowest: number | null = null;
        for (const path of v3Store.tracks.keys()) {
            const match = /^tracks\/(\d+)$/.exec(path);
            if (!match) continue;
            const idx = Number(match[1]);
            if (lowest === null || idx < lowest) lowest = idx;
        }
        return lowest;
    }

    /** Move the pedal's row. Keeps the column it is already on. */
    function selectScene(sceneIndex: number) {
        if (sceneIndex < 0 || sceneIndex >= sceneCount) return;
        const trackIndex = anchorTrackIndex();
        if (trackIndex === null) {
            logger.warn('Scene select ignored — no tracks to anchor to', {
                component: 'SceneRail',
                sceneIndex
            });
            return;
        }
        logger.debug('Scene select', { component: 'SceneRail', sceneIndex, trackIndex });
        // Paint first, ask second — the arrows are a held-down,
        // repeat-press control, and waiting on Live's echo for each step
        // would make them feel like they were dropping presses.
        session.selectSceneOptimistically(sceneIndex);
        sendSelectClip(`tracks/${trackIndex}`, sceneIndex);
    }

    /** Step the selection one scene, clamped to the set. */
    function stepScene(delta: number) {
        const next = selectedSceneIndex + delta;
        if (next < 0 || next >= sceneCount) return;
        selectScene(next);
    }

    // Keep the pedal's row on screen. The arrows can walk the selection
    // past the window's edge, and a cursor you cannot see is exactly the
    // problem the highlight exists to solve — so the window follows it.
    // Scene-count and visible-count changes are handled by the clamp
    // effect below; this one only reacts to the selection moving.
    $effect(() => {
        sceneWindowStore.ensureRowVisible(session.selectedSceneIndex);
    });

    function sceneIndexAt(y: number): number | null {
        if (!rail || rowPitchPx <= 0) return null;
        const rect = rail.getBoundingClientRect();
        const index = Math.floor(offset + (y - rect.top) / rowPitchPx);
        if (index < 0 || index >= sceneCount) return null;
        return index;
    }

    const gestures = useStripGestures({
        getElement: () => rail,
        onDown: ({ x, y }) => {
            pressedScene = sceneIndexAt(y);
            pressedAction = pressedScene !== null && isInActionZone(x);
        },
        onPressEnd: () => {
            pressedScene = null;
            pressedAction = false;
        },
        // Nothing to scroll sideways in the sidebar — but a horizontal
        // drag still consumes the gesture, so a stray sideways swipe can
        // never fall through and launch a scene.
        horizontalScroll: false,
        // `onDragStart`, NOT `onDown` — the latter fires on every
        // finger-down while `onDragEnd` fires only after a vertical
        // commit, so pairing them latches `isDragging` on any tap.
        onDragStart: () => sceneWindowStore.beginDrag(dragToken),
        onDragMove: ({ dy }) => {
            if (rowPitchPx <= 0) return;
            sceneWindowStore.dragByRows(dy / rowPitchPx, dragToken);
        },
        onDragEnd: () => sceneWindowStore.endDrag(dragToken),
        onTap: ({ x, y }) => dispatchSceneTap(x, y)
    });

    $effect(() => () => gestures.destroy());

    /** Did this press land on the row's launch strip? */
    function isInActionZone(x: number): boolean {
        if (!rail) return false;
        const rect = rail.getBoundingClientRect();
        return isInActionStrip(x, rect.left, rect.right);
    }

    /**
     * Tap selects the row; only the trailing strip launches it — the
     * same split the grid's cells use, so the two columns behave alike.
     *
     * Resolved from the geometry rather than `elementFromPoint` +
     * `data-scene-index`, which is what this used to do: a button is a
     * little shorter than its row, so those gaps were a dead band that
     * swallowed presses. The row owns its whole pitch, exactly as
     * `slotIndexAt` gives a cell its whole row in the grid.
     */
    function dispatchSceneTap(x: number, y: number) {
        const sceneIndex = sceneIndexAt(y);
        if (sceneIndex === null) return;
        if (isInActionZone(x)) {
            const scenePath = `scenes/${sceneIndex}`;
            logger.debug('Scene action tap → launch', { component: 'SceneRail', scenePath });
            sendSceneLaunch(scenePath);
            return;
        }
        selectScene(sceneIndex);
    }
</script>

<div
    bind:this={section}
    class="rail-section"
    data-debug="scene-rail-section"
    style={rowPitchPx > 0 ? `--session-row-h: ${rowPitchPx}px;` : ''}
>
    <div
        bind:this={rail}
        class="scene-rail"
        data-debug="scene-rail"
        onpointerdown={gestures.handlePointerDown}
    >
        <div
            class="rail-column"
            class:is-dragging={sceneWindowStore.isDragging}
            style="transform: translateY(calc({-fractional} * var(--session-row-h)));"
        >
            {#each rowIndices as sceneIndex (sceneIndex)}
                <div
                    class="scene-button"
                    class:is-pressed={sceneIndex === pressedScene && !pressedAction}
                    class:is-selected={sceneIndex === selectedSceneIndex}
                    data-scene-index={sceneIndex}
                    style="--scene-action-w: {actionWidthPx}px;"
                    role="button"
                    tabindex="-1"
                    aria-label="Select scene {sceneIndex + 1}"
                >
                    <!-- Scene names arrive in phase 3; until then the index is
                         the only identity the wire carries. -->
                    <span class="scene-label">SC {sceneIndex + 1}</span>

                    <!-- The only part of the row that launches. Presentational
                         like the grid's cell strips — the gesture machine owns
                         the pointer and splits body from strip by press X, so
                         a drag started here still scrolls scenes. -->
                    {#if actionWidthPx > 0}
                        <span
                            class="scene-action"
                            class:is-pressed={sceneIndex === pressedScene && pressedAction}
                            role="button"
                            tabindex="-1"
                            aria-label="Launch scene {sceneIndex + 1}"
                        >
                            <span aria-hidden="true">▶</span>
                        </span>
                    {/if}
                </div>
            {/each}
        </div>

        {#if showThumb}
            <div class="rail-scrollbar" aria-hidden="true">
                <div
                    class="rail-thumb"
                    style="height: {thumbFraction * 100}%; top: {thumbOffset * 100}%;"
                ></div>
            </div>
        {/if}
    </div>

    <!-- Footer row — one more row at the grid's own pitch, matching the
         grid's per-track stop row exactly. Outside the gesture zone
         above, so these are plain buttons with no drag to disambiguate.

         The two arrows sit SIDE BY SIDE, and that is a constraint rather
         than a preference: this row's height is one pitch, which shrinks
         to ~48px as the scene window grows to 8 rows, so stacking them
         would leave each ~24px tall — under the touch floor, and
         invisibly so, because that floor only applies below the 1024px
         breakpoint and a desktop browser would look fine. Splitting the
         120px width instead gives each ~56px across the full pitch.

         Whatever lands here must stay exactly ONE row: the rail divides
         its section by `renderedRows + 1` and the grid divides its own
         by the same, which is the entire reason their rows line up. -->
    <div class="rail-footer" data-debug="rail-footer">
        <button
            type="button"
            class="rail-step"
            data-debug="rail-step-prev"
            aria-label="Select previous scene"
            disabled={selectedSceneIndex <= 0}
            use:press={{
                onPress: () => stepScene(-1),
                // The rail owns both axes (vertical scrolls scenes,
                // horizontal is swallowed so it cannot become a launch);
                // its footer buttons sit in the same column and take the
                // same policy. They computed `auto` before this — nothing
                // declared it, and touch-action does not inherit.
                touchAction: 'none',
                // A disabled <button> stops firing pointer events on its
                // own in every browser this ships to, but saying so is
                // cheap and makes the gate visible next to the action.
                disabled: selectedSceneIndex <= 0
            }}
        >
            <span aria-hidden="true">▲</span>
        </button>
        <button
            type="button"
            class="rail-step"
            data-debug="rail-step-next"
            aria-label="Select next scene"
            disabled={selectedSceneIndex >= sceneCount - 1}
            use:press={{
                onPress: () => stepScene(1),
                touchAction: 'none',
                disabled: selectedSceneIndex >= sceneCount - 1
            }}
        >
            <span aria-hidden="true">▼</span>
        </button>
    </div>
</div>

<style>
    /* Fills the sidebar's second section, which the layout makes the same
       height as the clip grid's section — see the component comment for
       why that is what makes their rows line up. The section splits into
       the scrolling rail plus one STOP ALL row, exactly as the grid's
       section splits into its scene rows plus one stop row. */
    .rail-section {
        height: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }

    .scene-rail {
        flex: 1 1 0;
        min-height: 0;
        position: relative;
        overflow: hidden;
        /* Owns both axes: vertical scrolls scenes, horizontal is swallowed
           so it cannot become a launch. */
        touch-action: none;
        cursor: grab;
        -webkit-tap-highlight-color: transparent;
    }

    .rail-column {
        will-change: transform;
    }

    .rail-column:not(.is-dragging) {
        transition: transform 140ms var(--ease-precise);
    }

    /* Scenes are a global transport control, not a per-track one, so the
       rail wears the master ink rather than any track's colour.

       Typeset as the grid's twin, not as a sidebar list: same size and
       weight as a SlotCell's label, centred on both axes the same way.
       The 0.6875rem left-aligned label this replaced was sized for
       ADR-415's half-width rail; ADR-416 gave the rail the sidebar's
       full width and the type never followed, which left two rows that
       are the same height and the same pitch reading at two different
       scales. */
    .scene-button {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        height: calc(var(--session-row-h) - var(--session-row-gap));
        margin-bottom: var(--session-row-gap);
        padding: 0 8px;
        /* Keep the label centred in what's left once the launch strip has
           taken the trailing edge — the grid's cells do the same. */
        padding-left: calc(var(--scene-action-w, 0px) + 8px);
        border: 1px solid color-mix(in oklab, var(--act-master) 45%, transparent);
        border-radius: var(--radius-sm);
        background: color-mix(in oklab, var(--act-master) 12%, var(--card));
        color: var(--foreground);
        font-size: 0.9375rem;
        font-weight: var(--font-weight-medium);
        line-height: 1;
        white-space: nowrap;
        overflow: hidden;
        transition:
            background-color 90ms var(--ease-precise),
            transform 90ms var(--ease-precise);
    }

    /* Same press-in the grid's cells use, and for the same reason: a
       scene launch waits for the quantization boundary, so the button
       has to acknowledge the finger itself. */
    .scene-button.is-pressed {
        transform: scale(0.98);
        filter: brightness(1.35);
    }

    @media (prefers-reduced-motion: reduce) {
        .scene-button.is-pressed {
            transform: none;
        }
    }

    /* The selected scene — the row the foot pedal will act on, paired
       with the pedal-target ring the grid draws on the one cell where
       this row meets the selected track. Brighter fill and a full-ink
       border, so the row reads as current without a second colour. */
    .scene-button.is-selected {
        background: color-mix(in oklab, var(--act-master) 32%, var(--card));
        border-color: var(--act-master);
    }

    /* The launch strip — same shape, same reasoning and the same shared
       width formula as the grid's cell strips, so the two columns split
       body-from-action on the identical fraction. `pointer-events: none`
       for the same load-bearing reason: the gesture machine owns every
       pointer in the rail, and a strip that could take the press itself
       would stop a drag started on it from scrolling scenes. */
    .scene-action {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        z-index: 2;
        width: var(--scene-action-w, 0px);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        font-size: 0.8125rem;
        line-height: 1;
        border-right: 1px solid color-mix(in oklab, var(--line-strong) 80%, transparent);
        background: color-mix(in oklab, var(--card) 55%, transparent);
        color: var(--act-master);
        transition:
            background-color 90ms var(--ease-precise),
            filter 90ms var(--ease-precise);
    }

    .scene-action.is-pressed {
        background: color-mix(in oklab, var(--act-master) 30%, var(--card));
        filter: brightness(1.2);
    }

    /* The rail's own extra row, exactly one grid pitch tall — the
       counterpart of the clip grid's stop row. Whatever it holds
       divides THIS box, so the scene rows above are untouched however
       much chrome lands here — but note that "divides" is the catch:
       the pitch shrinks as the window grows, so this row fits ONE row
       of controls, never a stack. Hence `row`: the two arrows split the
       width and each keeps the full pitch. */
    .rail-footer {
        flex: 0 0 var(--session-row-h);
        min-height: 0;
        display: flex;
        flex-direction: row;
        gap: var(--session-row-gap);
        padding-bottom: var(--session-row-gap);
    }

    /* Half the footer each — ~56px of the 120px sidebar, full row pitch
       tall. Glyph-only: at this width there is no room for a label
       beside it, which is why the arrows carry `aria-label`s. */
    .rail-step {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1 1 0;
        min-width: 0;
        min-height: 0;
        padding: 0;
        border: 1px solid color-mix(in oklab, var(--signal-dim) 35%, transparent);
        border-radius: var(--radius-sm);
        background: color-mix(in oklab, var(--signal-dim) 8%, var(--card));
        color: var(--foreground);
        font-size: 0.875rem;
        line-height: 1;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition:
            background-color 90ms var(--ease-precise),
            border-color 90ms var(--ease-precise);
    }

    .rail-step:active:not(:disabled) {
        background: color-mix(in oklab, var(--act-master) 22%, var(--card));
        border-color: color-mix(in oklab, var(--act-master) 60%, transparent);
    }

    /* At the end of the set there is nowhere to step. Dimmed rather than
       hidden — a control that disappears takes its position with it, and
       the footer's geometry must not move. */
    .rail-step:disabled {
        opacity: 0.35;
        cursor: default;
    }

    /* Shrink-to-fit, so the label stays a centred group rather than
       spanning the button — same rule `.slot-name` follows. The ▶ that
       used to sit beside it has moved into `.scene-action`, since the
       row as a whole no longer launches. */
    .scene-label {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* Thin position indicator — thumb length is the visible share of the
       grid, so it doubles as a "how many scenes are there" readout. */
    .rail-scrollbar {
        position: absolute;
        top: 0;
        bottom: var(--session-row-gap);
        right: 0;
        width: 2px;
        border-radius: 1px;
        background: color-mix(in oklab, var(--signal-dim) 20%, transparent);
        pointer-events: none;
    }

    .rail-thumb {
        position: absolute;
        left: 0;
        right: 0;
        border-radius: 1px;
        background: color-mix(in oklab, var(--act-master) 65%, transparent);
    }

    @media (prefers-reduced-motion: reduce) {
        .rail-column:not(.is-dragging) {
            transition: none;
        }
    }

    /* ---- Live skin: scene slots are flat SurfaceBackground buttons with a
       small launch triangle; the selected scene wears Live's
       SelectionBackground with dark text; step arrows are control fields. */
    :global([data-grammar="flat"]) .scene-button {
        background: var(--card);
        border: 1px solid var(--line-strong);
        border-radius: 2px;
        color: var(--foreground);
        font-weight: var(--font-weight-regular);
    }
    :global([data-grammar="flat"]) .scene-button.is-selected {
        background: var(--flat-selection);
        border-color: var(--line-strong);
        color: var(--flat-selection-fg);
    }
    :global([data-grammar="flat"]) .scene-action {
        background: transparent;
        border-right: 1px solid var(--line);
        color: var(--foreground);
    }
    :global([data-grammar="flat"]) .scene-button.is-selected .scene-action {
        color: var(--flat-selection-fg);
        border-right-color: rgba(0, 0, 0, 0.25);
    }
    :global([data-grammar="flat"]) .scene-action.is-pressed {
        background: var(--act-play);
        color: var(--flat-on-fg);
    }
    :global([data-grammar="flat"]) .rail-step {
        background: var(--surface-well);
        border: 1px solid var(--line-strong);
        border-radius: 2px;
    }
    :global([data-grammar="flat"]) .rail-step:active:not(:disabled) {
        background: var(--phosphor);
        border-color: var(--phosphor);
        color: var(--flat-on-fg);
    }
    :global([data-grammar="flat"]) .rail-step:disabled {
        opacity: 1;
        color: var(--flat-disabled-fg);
    }
    :global([data-grammar="flat"]) .rail-scrollbar {
        background: transparent;
    }
    :global([data-grammar="flat"]) .rail-thumb {
        background: #696969; /* ScrollbarInnerHandle */
        border-radius: 0;
    }
</style>
