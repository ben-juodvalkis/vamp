<script lang="ts">
    /**
     * A strip's header block: the name band, which is the mute button.
     *
     * A SIBLING of the strip's Card, not a section inside it, taking the
     * strip's last band. Out here it is outside the volume fader: the Card
     * owns "drag anywhere = volume", and while the name lived inside it a
     * mute tap that slid 6px silently changed the level instead of muting.
     *
     * The press is the strip's (`mutePress`, built by `createMomentaryMute`
     * in `../utils/momentaryMutePress.ts`, whose header says when mute fires
     * and why). `use:press` writes the touch-action onto the node it binds
     * the handler to, so the two cannot drift apart (the original mute bug:
     * `.header-name` computed `touch-action: auto`, and inside a scrolling
     * panel the browser was free to suppress the click).
     */
    import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
    import { paintModeReactive } from '$lib/utils/paintMode.svelte';
    import { press, type PressOptions } from '$lib/actions/press';

    interface Props {
        name: string;
        color: number;
        mute: boolean;
        /** The name band's press: mute (see `createMomentaryMute`). */
        mutePress: PressOptions;
        /** The track is soloed: the band wears the solo wash. */
        isSoloed?: boolean;
        /** Flipped stack (ADR-421): the block sits at the column's foot. */
        flipLayout?: boolean;
        isSelected?: boolean;
        /**
         * A preset is in flight toward this track. The visible load state (glow
         * + spinner) belongs to the whole strip — see TrackStrip — so all this
         * does here is license the provisional name below.
         */
        isPending?: boolean;
        /** Provisional name to show while `isPending`; null keeps the live one. */
        pendingName?: string | null;
        trackNumber?: number;
    }

    let {
        name,
        color,
        mute,
        mutePress,
        isSoloed = false,
        flipLayout = true,
        isSelected = false,
        isPending = false,
        pendingName = null,
        trackNumber
    }: Props = $props();

    // Decode HTML entities and remove quotes from track names
    // Handles both standard (&#39;) and escaped (&#39\;) variants
    function decodeTrackName(trackName: string): string {
        return trackName
            .replace(/&#39\\?;/g, "'")
            .replace(/&quot\\?;/g, '"')
            .replace(/&amp\\?;/g, '&')
            .replace(/&lt\\?;/g, '<')
            .replace(/&gt\\?;/g, '>')
            .replace(/["']/g, '');
    }

    // While a load is in flight the strip shows the preset that's coming, not
    // the name still sitting on the track — the browser is already gone, so
    // this is the only place the pick is named. Live's own name replaces it a
    // moment later; a failed load withdraws it, and the error banner says why.
    let effectiveName = $derived(isPending && pendingName ? pendingName : name);
    let displayName = $derived(
        `${trackNumber != null ? trackNumber + ' ' : ''}${decodeTrackName(effectiveName)}`
    );
    let trackColor = $derived(trackInk(rgbToHex(color), paintModeReactive()));
    let isActive = $derived(!mute);

    // GRATICULE (§2.7 identity voice, §5.2): the name IS the music. Selected
    // brightens to white-hot; muted drops to signal-dim.
    let nameColor = $derived(
        !isActive
            ? 'var(--signal-dim)'
            : isSelected
                ? `color-mix(in oklab, ${trackColor} 75%, white)`
                : trackColor
    );
</script>

<div class="header-block" class:is-flipped={flipLayout} class:is-selected={isSelected}>
    <div
        class="header-name"
        class:is-soloed={isSoloed}
        role="button"
        tabindex="-1"
        aria-label="{mute ? 'Unmute' : 'Mute'} track {name}"
        aria-pressed={mute}
        use:press={mutePress}
    >
        <div
            class="track-name-button w-full h-full text-center flex items-center justify-center transition-colors duration-100 touch-manipulation overflow-hidden regular-track {isSelected ? 'is-selected' : ''} {isActive ? '' : 'is-muted'}"
            style="--name-ink: {nameColor};"
            title="{isActive ? 'Active' : 'Muted'}: {name}"
        >
            <span class="name-clamp">{displayName}</span>
        </div>
    </div>
</div>

<style>
    /* Header fills its half instead of enforcing its own min-height. */
    .header-block .track-name-button {
        min-height: 0;
        height: 100%;
    }

    /* One third of the column: the name (mute), full height. */
    .header-block {
        flex: 1 1 0;
        min-height: 0;
        display: flex;
        flex-direction: row;
        align-items: stretch;
        gap: var(--strip-gap);
    }

    /* Unflipped (strips on TOP) the header leads the column; the flipped
       default keeps its source order at the foot, nearest the hands.
       UNREACHABLE since 2026-09-26 (flipLayout is pinned on). */
    .header-block:not(.is-flipped) {
        order: -1;
    }

    .header-name {
        flex: 1 1 0;
        min-height: 0;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        /* Anchors the solo tint's ::after. */
        position: relative;
        /* Inner size container, for TrackHeader's fluid name size alone.
           The name has always been authored in `cqi` ("scales with its
           container") but has had no container since it moved out of the
           Card — `cqi` with no container falls back to the VIEWPORT, so
           every name sat pinned at its clamp maximum no matter how narrow
           its strip. This is the box it is actually painted in, and it is
           the right one in both header layouts. */
        container-type: inline-size;
    }

    /* ---- Selection, outside the Card ------------------------------------
       The Card carries the selection edge (`.track-selected`), but the
       Card is only the fader — the name (mute) is a sibling below it, and
       until now it wore nothing. A selected strip was therefore outlined
       for two thirds of its height and bare for the last third, which is
       exactly the third the eye goes to (the name is how you identify a
       track). Both blocks take the same ink at the same weight, so the
       column reads as one lit object top to bottom.

       `inset` box-shadow rather than a real border: the name block is a
       solid track-colour slab in the shipped skin, so a border swap would
       move its contents by a pixel
       every time the selection changed. An inset ring is drawn inside the
       existing box and costs no layout. */
    .header-block.is-selected .header-name {
        box-shadow: inset 0 0 0 2px var(--sel-ink);
    }

    /* Graticule wears the track's own ink, matching that skin's
       `.track-selected`; the flat/hybrid skin wears Live's neutral
       selection colour, matching its own. Declared as one variable so the
       two rules above stay skin-agnostic. */
    .header-block {
        --sel-ink: var(--track-color);
    }

    :global([data-grammar='flat']) .header-block {
        --sel-ink: var(--flat-selection);
    }

    /* GRATICULE only: the title is transparent ink, so once it left the Card
       it read as text floating under the strip with nothing behind it. Give
       it the Card's own glass recipe (it inherits `--track-color` from
       `.strip-col`) so the three blocks read as one family, and so it sits
       as a slab beside the browser rail's slabs. The flat skin needs none of
       this — there the title already IS a solid track-colour block, and a
       border under it would show as a hairline inset. */
    :global(html:not([data-grammar='flat'])) .header-name {
        background: color-mix(in oklab, var(--track-color, var(--card)) 12%, var(--card));
        border: 1px solid color-mix(in oklab, var(--track-color, var(--line)) 55%, transparent);
        box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.04);
        border-radius: var(--strip-radius, var(--radius-md));
    }

    .header-name.is-soloed::after {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        border-radius: var(--strip-radius, var(--radius-md));
        background: color-mix(in oklab, var(--act-solo) 45%, transparent);
        box-shadow: inset 0 0 0 2px var(--act-solo);
    }

    /* Identity voice (§2.7): SF Pro 700, tightly tracked — names are the music. */
    .track-name-button {
        color: var(--name-ink);
        font-weight: var(--font-weight-bold);
        letter-spacing: -0.01em;
        line-height: var(--leading-tight);
        border-radius: var(--radius-sm);
        min-width: 0;
        border: none;
        background: transparent;
    }

    /* Live skin: the title block IS the track colour — a solid fill with
       black text (Live's ClipText), the way a Session-view track header
       reads. Muted dims the fill toward the panel; the name stays regular
       weight and mixed case, as Live sets it. */
    :global([data-grammar="flat"]) .track-name-button.regular-track {
        background: var(--track-color);
        color: var(--flat-clip-text);
        font-weight: var(--font-weight-medium);
        letter-spacing: 0;
        border-radius: 0;
    }
    :global([data-grammar="flat"]) .track-name-button.regular-track.is-muted {
        background: var(--flat-deactivated);      /* DeactivatedClipHeader */
        color: var(--flat-deactivated-fg);        /* DeactivatedClipHeaderForeground */
    }
    /* Regular track base styling */
    .regular-track {
        padding: 0 var(--spacing-sm);
        overflow: hidden;
    }

    .name-clamp {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    /* Fluid font: scales smoothly with the name box's width, clamped
       between 15px and 22px.

       Coefficient retuned when `.header-name` became a real size container
       (TrackStrip): before that there was no container above this element
       at all, `cqi` fell back to the viewport, and every name — on a
       four-track set or an eighteen-track one — resolved to the clamp
       MAXIMUM. 18.5% is the value that reproduces today's 22px on the
       ~119px strip an eight-track set gets in the busiest layout, so the
       common case is unchanged and only the narrow strips, which were
       shouting, now scale down. */
    .regular-track {
        font-size: clamp(max(var(--type-min), calc(15.008 * var(--fluid-px))), 18.5cqi, 1.375rem);
    }

    /* Selected track: heavier weight + slightly larger so it stands out */
    .track-name-button.is-selected {
        font-weight: var(--font-weight-bold);
    }

    .regular-track.is-selected {
        font-size: clamp(max(var(--type-min), calc(17.008 * var(--fluid-px))), 20cqi, 1.5rem);
    }

</style>