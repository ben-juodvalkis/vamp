<script lang="ts">
    import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
    import { paintModeReactive } from '$lib/utils/paintMode.svelte';

    interface Props {
        name: string;
        color: number;
        mute: boolean;
        isMaster?: boolean;
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
        isMaster = false,
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
        isMaster
            ? 'Master'
            : `${trackNumber != null ? trackNumber + ' ' : ''}${decodeTrackName(effectiveName)}`
    );
    let trackColor = $derived(trackInk(rgbToHex(color), paintModeReactive()));
    let isActive = $derived(!mute);

    // GRATICULE (§2.7 identity voice, §5.2): the name IS the music. Selected
    // brightens to white-hot; muted drops to signal-dim; master rides act-master.
    let nameColor = $derived(
        isMaster
            ? 'var(--act-master)'
            : !isActive
                ? 'var(--signal-dim)'
                : isSelected
                    ? `color-mix(in oklab, ${trackColor} 75%, white)`
                    : trackColor
    );
</script>

<!-- Presentational only. The parent TrackStrip owns all pointer gestures
     (strip-wide volume drag + tap dispatch). A tap on THIS band mutes;
     double-tap-anywhere-to-mute was dropped in f176fd0b. -->
<div
    class="track-name-button w-full h-full text-center flex items-center justify-center transition-colors duration-100 touch-manipulation overflow-hidden {isMaster ? 'master-track' : 'regular-track'} {isSelected ? 'is-selected' : ''} {isActive ? '' : 'is-muted'}"
    style="--name-ink: {nameColor};"
    title="{isMaster ? 'Master' : (isActive ? 'Active' : 'Muted') + ': ' + name}"
>
    <span class="name-clamp">{displayName}</span>
</div>

<style>
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
    :global([data-grammar="flat"]) .track-name-button.master-track {
        background: var(--track-color, var(--act-master));
        color: var(--flat-clip-text);
        font-weight: var(--font-weight-medium);
        border-radius: 0;
    }

    /* Master track base styling */
    .master-track {
        height: var(--height-compact);
        color: var(--act-master);
        padding: 0 var(--spacing-sm);
    }

    /* Regular track base styling */
    .regular-track {
        padding: 0 var(--spacing-sm);
        overflow: hidden;
    }

    .name-clamp {
        display: -webkit-box;
        -webkit-line-clamp: 2;
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
        font-size: clamp(0.938rem, 18.5cqi, 1.375rem);
    }

    /* Selected track: heavier weight + slightly larger so it stands out */
    .track-name-button.is-selected {
        font-weight: var(--font-weight-bold);
    }

    .regular-track.is-selected {
        font-size: clamp(1.063rem, 20cqi, 1.5rem);
    }

</style>