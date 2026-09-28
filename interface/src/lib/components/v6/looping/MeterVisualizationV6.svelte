<script lang="ts">
    // V6: Pure meter visualization component - no interaction
    import constants from '$config/constants.json';

    // Minimal track interface - only the properties this component uses
    interface MeterTrack {
        meterLevel: number;
        mute: boolean;
    }

    interface Props {
        trackIndex: number;
        track: MeterTrack | null;
        topInset?: number;
        // When set, the meter fill is tinted to the track color (dark at the
        // bottom → bright at the level) instead of the default green→red ramp.
        color?: string;
    }

    let { trackIndex, track, topInset = 0, color }: Props = $props();

    // Get meter data from track object
    let meterLevel = $derived(track?.meterLevel || 0);
    let isTrackActive = $derived(!track?.mute);

    // Simple linear meter height (raw values from Ableton)
    let meterHeight = $derived.by(() => {
        const level = typeof meterLevel === 'number' ? meterLevel : 0;
        // Just use the raw 0.0-1.0 value directly as percentage
        return level * 100;
    });
</script>

<div
    class="meter-visualization w-full h-full"
    style="--meter-opacity: {constants.ui.meters.opacity}; --top-inset: {topInset}px;"
>
    <!-- Background meter display -->
    <div class="meter-background">
        <div
            class="meter-fill"
            class:tinted={!!color}
            style="--clip-top: {100 - meterHeight}%; {color ? `--track-color: ${color};` : ''}"
            class:muted={!isTrackActive}
        ></div>
    </div>
</div>

<style>
    .meter-visualization {
        position: absolute;
        inset: 0;
        background-color: transparent;
        overflow: hidden;
        pointer-events: none;
        z-index: 0;
    }

    /* Calibration well (§4.1) — recessed surface. This div never updates,
       so it costs nothing on the hot path. */
    .meter-background {
        position: absolute;
        top: var(--top-inset, 0px);
        bottom: 0;
        left: 0;
        width: 100%;
        opacity: var(--meter-opacity);
        background-color: var(--surface-well);
        box-shadow: inset 0 1px 0 oklch(0 0 0 / 0.5);
    }

    /* .meter-fill is one of the five 30Hz node families (§7 #1): NO filter,
       box-shadow, backdrop-filter, or transition beyond the existing 100ms
       clip-path smoothing (the ceiling). All richness is STATIC pre-painted
       gradient that the --clip-top write merely reveals.

       Default ramp (master / browser / TrackVolumeMeter — no track color set):
       act-master family with the act-rec headroom band in the top 6%. */
    .meter-fill {
        position: absolute;
        bottom: 0;
        left: 0;
        width: 100%;
        background: linear-gradient(
            to top,
            color-mix(in srgb, var(--act-master), black 55%) 0%,
            var(--act-master) 70%,
            color-mix(in oklab, var(--act-master) 75%, white) 88%,
            var(--act-rec) 94%,
            var(--act-rec) 100%
        );
        height: 100%;
        clip-path: inset(var(--clip-top) 0 0 0);
        transition: clip-path 0.1s ease-out;
    }

    /* Strip meters (track color set): ambient wash → track ink → white-hot tip,
       then the hard act-rec headroom warning in the top 6%. A rising meter
       literally heats up against its own ambient wash — no extra nodes, no JS. */
    .meter-fill.tinted {
        background: linear-gradient(
            to top,
            color-mix(in srgb, var(--track-color), black 55%) 0%,
            var(--track-color) 70%,
            color-mix(in oklab, var(--track-color) 75%, white) 88%,
            var(--act-rec) 94%,
            var(--act-rec) 100%
        );
    }

    /* MUTE (§4.1) — instant class swap to a pre-painted grey ramp; replaces the
       grayscale(1) filter. This removes the LAST filter from a 30Hz node family
       → net hot-path filters: zero. Mute is a kill switch, so 0ms (no transition).
       Placed last so it wins over both the base ramp and .tinted. */
    .meter-fill.muted {
        background: linear-gradient(
            to top,
            color-mix(in srgb, var(--signal-dim), black 40%) 0%,
            var(--signal-dim) 100%
        );
    }

    /* Live skin: the strip is a flat SurfaceBackground panel — no recessed
       calibration well. Meters with NO track colour (master, browser,
       TrackVolumeMeter) ride Live's StandardVuMeter ramp: green → yellow,
       red in the top 6%. */
    :global([data-grammar="flat"]) .meter-background {
        background-color: transparent;
        box-shadow: none;
    }
    :global([data-grammar="flat"]) .meter-fill {
        background: linear-gradient(
            to top,
            #00f758 0%,
            #00f758 72%,
            #ffd100 84%,
            #ffd100 94%,
            #ff0a0a 94%,
            #ff0a0a 100%
        );
    }

    /* Strip meters follow their TRACK's colour in this skin too — eight
       identical green columns say nothing about which track is loud, and
       the strips are already colour-coded end to end (name, clip chips,
       Permute). Live's own ramp survives where it earns its keep: the
       hard red headroom band in the top 6%, so clipping still reads as
       clipping and not as "this track happens to be reddish". Flat, so
       no white-hot tip — one step from the ink to the warning. */
    :global([data-grammar="flat"]) .meter-fill.tinted {
        background: linear-gradient(
            to top,
            var(--track-color) 0%,
            var(--track-color) 94%,
            #ff0a0a 94%,
            #ff0a0a 100%
        );
    }
    :global([data-grammar="flat"]) .meter-fill.muted {
        background: linear-gradient(to top, #6e6e6e 0%, #828282 100%);
    }
</style>