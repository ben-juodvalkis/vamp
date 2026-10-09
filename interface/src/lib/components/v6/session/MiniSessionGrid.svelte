<script lang="ts">
    /**
     * Mini session view — the selected track's clip column, in the right
     * sidebar beside the track strips (it lived in the CLIP central view
     * until the master strip joined the strips row and freed this box).
     *
     * The full clip grid (ADR-415) is a whole section of the main-area
     * stack, so switching CLIPS off buys back a third of the screen and
     * costs you every clip on it: no launch targets, no playhead, no
     * idea what is armed. This is the trade in miniature. It shows ONE
     * track's column — the selected one — in the LEADING column of
     * `ClipCentralView`'s control rail, at twice a rail column's width, and it
     * appears exactly when the full grid is hidden
     * (`uiPrefsStore.miniSessionActive`).
     *
     * **Why the clip view and not the FX grid.** Everything else in that
     * rail is already about the clip you are looking at: Chance, Temp
     * and Shuffle shape it, REC and Delete replace it, Loop X2 and the
     * transpose pair edit it. What the rail could not say was WHICH clip
     * — the selection lived only in the grid a section away, or, with
     * CLIPS off, nowhere at all. The mini answers that and makes it
     * changeable in the same place, which the FX grid (a rack of
     * insert effects on the track) had no claim to.
     *
     * **It is the same `SlotGrid`, not a lookalike.** Cells, states,
     * previews, the leading action strip, the press highlight, the
     * playhead and every gesture come from the component the full grid
     * uses, and the taps route through `composables/slotActions` — the
     * module `TracksPanelV6` calls too. A cell therefore cannot come to
     * mean one thing here and another there, which matters more than it
     * looks: the body tap aims the FOOT PEDAL, and a mini view that
     * aimed it differently would be worse than no mini view.
     *
     * **One shared scene window.** `sceneWindowStore` is the same
     * offset the full grid and the scene rail use, so scrolling here and
     * scrolling there are the same act, and flipping CLIPS on lands on
     * the row you were already looking at. Two of the store's chores are
     * owned by whichever of the two is mounted — the offset clamp and
     * keeping the pedal's row on screen — and `SceneRail` (session mode
     * only) can't do them here, so this component runs those effects for
     * the layouts it owns.
     *
     * **Its own row pitch.** Nothing on screen has to line up with these
     * rows — there is no rail beside them and no strip above them — so
     * the box is simply divided by the rows drawn plus one for the stop
     * row, exactly as `TracksPanelV6` and `SceneRail` each divide their
     * own section. The rows-drawn count still comes from the shared
     * store, so the mini shows the same window the full grid would at
     * this section count — the central view's section and the clip
     * grid's are the same height, so that lands right without either
     * measuring the other.
     */

    import SlotGrid from '$lib/components/v6/tracks/TrackStrip/components/SlotGrid.svelte';
    import { sceneWindowStore } from '$lib/stores/v6/sceneWindowStore.svelte';
    import { session } from '$lib/stores/session.svelte';
    import { uiPrefsStore } from '$lib/stores/v6/uiPrefsStore.svelte';
    import { v3Store } from '$lib/stores/v3/normalized.svelte';
    import { clipStateStore } from '$lib/stores/v6/clipStateStore.svelte';
    import { groupGestureStore } from '$lib/stores/v6/groupGestureStore.svelte';
    import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
    import { paintModeReactive } from '$lib/utils/paintMode.svelte';
    import { press } from '$lib/actions/press';
    import {
        selectSlot,
        actOnSlot,
        focusSlot,
        stopTrack
    } from '$lib/components/v6/tracks/composables/slotActions';


    // The selected track IS the subject — no prop, for the same reason
    // the clip rail's other columns take none: everything in this view
    // is about whatever the performer last touched.
    const trackIndex = $derived(session.selectedTrackIndex);
    // -1 is the master track, which has no clip slots. There is nothing
    // to draw then, and an empty grid of dashed cells would read as "the
    // set is empty" rather than "you are on master".
    const hasTrack = $derived(trackIndex >= 0);

    // A body tap here aims the pedal exactly as the full grid's does, and
    // on a slot holding a clip it also focuses that clip, so the clip
    // view's editor shows it. An empty slot has nothing to show and only
    // selects.
    function openSlot(slotIndex: number, slotPath: string) {
        selectSlot(trackIndex, slotIndex);
        // Mid group gesture the tap only toggles the track into the group.
        if (groupGestureStore.active) return;
        const state = v3Store.tracks.get(trackPath)?.slots.get(slotPath)?.state;
        if (!state || state === 'empty') return;
        focusSlot(trackIndex, slotPath);
    }
    const trackPath = $derived(`tracks/${trackIndex}`);
    const record = $derived(hasTrack ? v3Store.tracks.get(trackPath) : undefined);
    const trackName = $derived(record?.name ?? (hasTrack ? `Track ${trackIndex + 1}` : 'Master'));
    const ink = $derived(trackInk(rgbToHex(record?.color ?? 0x808080), paintModeReactive()));
    const isGroup = $derived(hasTrack && clipStateStore.isGroupTrack(trackIndex));

    // ---- Row pitch ------------------------------------------------------
    //
    // Measured, not authored — same recipe as the full grid's section and
    // the rail's. The +1 is the stop row: it is one more row at the
    // grid's own pitch, not a bar of chrome, so it aims exactly like a
    // clip cell.
    let gridBoxEl = $state<HTMLDivElement | null>(null);
    let gridBoxHeightPx = $state(0);

    /**
     * Finger-down acknowledgement for the stop button.
     *
     * A stop is quantized — at one bar the clip can keep playing for most
     * of a bar after you press — so without a mark on the button a press
     * that landed looks exactly like one that missed, and the reflex is to
     * press again. Same argument, and the same treatment, as the cells
     * above it (ADR-417).
     */
    let stopPressed = $state(false);
    const renderedRows = $derived(sceneWindowStore.renderedRows);
    // The stop button is no longer a row of this box (it is the column's
    // name band, below), so the scene rows divide the whole of it.
    const rowPitchPx = $derived(renderedRows > 0 ? gridBoxHeightPx / renderedRows : 0);

    // The strips' own split (TrackStrip's `cardBands`): the clips take the
    // bands a strip's Card takes, the stop takes the name band's one, so
    // the stop lands level with the track names and the master's key.
    const cardBands = $derived(uiPrefsStore.showDeviceBand ? 3 : 2);

    $effect(() => {
        const el = gridBoxEl;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const measure = () => {
            const h = el.getBoundingClientRect().height;
            if (h > 0) gridBoxHeightPx = h;
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    });

    // ---- The window chores SceneRail owns in session mode ---------------
    //
    // Both are copied deliberately rather than hoisted into the store:
    // they are effects, and the store is a plain module whose `$effect`s
    // would need an `$effect.root` and a lifetime nobody owns. The rule
    // is "whichever scene viewport is mounted runs them", and exactly one
    // of the two ever is (see `uiPrefsStore.miniSessionActive`).

    // Persist the store's read-side clamp whenever the legal range moves
    // — on the scene count OR the visible-row count, since maxOffset is
    // their difference. Without it a shrink leaves the stored offset
    // stale and a later regrow walks the window down on its own.
    $effect(() => {
        sceneWindowStore.sceneCount;
        sceneWindowStore.visibleCount;
        sceneWindowStore.clampToSceneCount();
    });

    // Keep the pedal's row on screen. The selection can move from Live,
    // from a strip tap, or from the pedal itself, and a cursor you cannot
    // see is exactly what the highlight exists to prevent.
    $effect(() => {
        sceneWindowStore.ensureRowVisible(session.selectedSceneIndex);
    });

    // ---- Position readout -----------------------------------------------
    //
    // The full grid has the scene rail beside it to say where in the set
    // the window is sitting; the mini has no room for one, so it carries
    // the rail's thumb alone — length is the visible share, so it doubles
    // as a "how many scenes are there" readout.
    const offset = $derived(sceneWindowStore.offset);
    const maxOffset = $derived(sceneWindowStore.maxOffset);
    const thumbFraction = $derived(sceneWindowStore.visibleFraction);
    const thumbOffset = $derived(maxOffset > 0 ? (offset / maxOffset) * (1 - thumbFraction) : 0);
    const showThumb = $derived(sceneWindowStore.sceneCount > sceneWindowStore.visibleCount);
</script>

<div class="mini-col">
<div
    class="mini-session"
    data-debug="mini-session"
    style="--mini-ink: {ink}; flex: {cardBands} {cardBands} calc(var(--strip-gap) * {cardBands - 1});"
>
    {#if hasTrack}
        <div
            class="mini-body"
            bind:this={gridBoxEl}
            style={rowPitchPx > 0 ? `--session-row-h: ${rowPitchPx}px;` : ''}
        >
            <div class="mini-grid">
                <SlotGrid
                    {trackPath}
                    trackColor={ink}
                    {trackIndex}
                    {isGroup}
                    markSelectedTrack={false}
                    onSelect={openSlot}
                    onAction={(slotIndex, slotPath, slotState) =>
                        actOnSlot(trackIndex, slotIndex, slotPath, slotState)}
                    onFocus={(slotPath) => focusSlot(trackIndex, slotPath)}
                />

                {#if showThumb}
                    <div class="mini-scrollbar" aria-hidden="true">
                        <div
                            class="mini-thumb"
                            style="height: {thumbFraction * 100}%; top: {thumbOffset * 100}%;"
                        ></div>
                    </div>
                {/if}
            </div>
        </div>
    {:else}
        <!-- Master has no clip slots. Say so rather than drawing an empty
             grid, which reads as "this set has no clips". -->
        <div class="mini-empty">
            <span>No clip slots on Master</span>
        </div>
    {/if}
</div>

<!-- The stop, as the column's name band: the same share of the section
     a strip's name takes, so it sits level with the track names. Outside
     the gesture zone above, so it is a plain button with no drag to
     disambiguate. -->
{#if hasTrack}
    <button
        type="button"
        class="mini-stop"
        class:is-pressed={stopPressed}
        style="--mini-ink: {ink};"
        data-debug="mini-session-stop"
        aria-label="Stop clips on {trackName}"
        use:press={{
            onPress: () => stopTrack(trackIndex),
            touchAction: 'none',
            // Acknowledge the finger: WebKit drops `:active` the moment
            // anything else claims an interest in the press. The cells
            // above light the same way (`is-pressed`, SlotCell).
            onDown: () => (stopPressed = true),
            onRelease: () => (stopPressed = false)
        }}
    >
        <span aria-hidden="true">■</span>
    </button>
{:else}
    <div class="mini-stop-spacer" aria-hidden="true"></div>
{/if}
</div>

<style>
    /* Sized by its host — the right sidebar's box level with the track
       strips. The frame is the slots' own. No title row: the cells wear
       the track ink, so naming the track again spent a row of height on
       something the strips already say. */
    /* The strip's column, at the strip's gap (`.strip-col`), so the seam
       above the stop is the seam above a track name. */
    .mini-col {
        --strip-gap: var(--spacing-xs);
        height: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: var(--strip-gap);
    }

    .mini-session {
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 4px;
        border: 1px solid color-mix(in oklab, var(--mini-ink) 30%, transparent);
        border-radius: var(--radius-md);
        background: color-mix(in oklab, var(--mini-ink) 6%, transparent);
        overflow: hidden;
    }

    /* The measured box: the scene rows. Nothing else may go in here —
       anything that shortens it changes the pitch. */
    .mini-body {
        flex: 1 1 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }

    .mini-grid {
        position: relative;
        flex: 1 1 0;
        min-height: 0;
    }

    /* The name band's share of the column (one, against the clips'
       `cardBands`), so it is exactly as tall as a track's name/mute. */
    .mini-stop,
    .mini-stop-spacer {
        flex: 1 1 0;
        min-height: 0;
    }

    .mini-stop {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        padding: 0;
        border: 1px solid color-mix(in oklab, var(--mini-ink) 40%, transparent);
        border-radius: var(--radius-sm);
        /* The track's ink at low saturation, not the transport red: this
           is where a clip goes quiet, not a danger control. */
        background: color-mix(in oklab, var(--mini-ink) 10%, var(--card));
        color: color-mix(in oklab, var(--mini-ink) 70%, var(--foreground));
        font-size: 1.25rem;
        line-height: 1;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition:
            background-color 90ms var(--ease-precise),
            border-color 90ms var(--ease-precise);
    }

    /* `:active` is kept for the mouse; `.is-pressed` is what a finger
       actually gets — see the press action on the button. */
    .mini-stop:active,
    .mini-stop.is-pressed {
        background: color-mix(in oklab, var(--mini-ink) 26%, var(--card));
        border-color: color-mix(in oklab, var(--mini-ink) 70%, transparent);
    }

    /* The cells' own press language, so the column answers a touch in one
       voice: a small scale-in plus a lift, big enough to catch
       peripherally and small enough that the rail doesn't look like it
       moved. */
    .mini-stop.is-pressed {
        transform: scale(0.96);
        filter: brightness(1.35);
    }

    /* The rail's thumb, on the mini's own trailing edge. Rides over the
       cells rather than beside them — there is no width to spare for a
       gutter, and it is a readout, not a target. */
    .mini-scrollbar {
        position: absolute;
        top: 0;
        bottom: var(--session-row-gap);
        right: 0;
        width: 2px;
        border-radius: 1px;
        background: color-mix(in oklab, var(--signal-dim) 20%, transparent);
        pointer-events: none;
    }

    .mini-thumb {
        position: absolute;
        left: 0;
        right: 0;
        border-radius: 1px;
        background: color-mix(in oklab, var(--mini-ink) 65%, transparent);
    }

    .mini-empty {
        flex: 1 1 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 8px;
        color: var(--signal-dim);
        font-size: 0.75rem;
        text-align: center;
    }

    /* ---- Flat grammar (Live / Hybrid skins, ui-architecture §8.1) ------
       Device tiles lose their tint and colored ring in the flat skins;
       the mini is one of those tiles, so it follows. The cells inside
       carry their own flat rules already. */
    :global([data-grammar='flat']) .mini-session {
        border: 1px solid var(--line-strong);
        border-radius: 2px;
        background: transparent;
    }

    :global([data-grammar='flat']) .mini-stop {
        background: var(--card);
        border: 1px solid var(--line-strong);
        border-radius: 2px;
        color: var(--foreground);
    }
</style>
