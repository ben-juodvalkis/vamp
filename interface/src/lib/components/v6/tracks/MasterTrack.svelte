<script lang="ts">
    import { Card } from '$lib/components/ui/card';
    import MeterVisualization from '$lib/components/v6/looping/MeterVisualizationV6.svelte';
    import { send } from '$lib/api/simpleClient';
    import { setMasterVolume } from '$lib/services/trackCommands';
    import { session } from '$lib/stores/session.svelte';
    import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
    import { browserModeStore } from '$lib/stores/v6/browserModeStore.svelte';
    import { uiPrefsStore } from '$lib/stores/v6/uiPrefsStore.svelte';
    import { v3Store } from '$lib/stores/v3/normalized.svelte';
    import { interceptForGroupGesture } from '$lib/components/v6/tracks/composables/useTrackData.svelte.js';
    import { meterStore } from '$lib/stores/v3/meters.svelte';
    import { drag } from '$lib/components/v6/parameters/actions/dragAction';
    import { press } from '$lib/actions/press';
    import { HOLD_MS } from '$lib/actions';
    import Lock from '@lucide/svelte/icons/lock';
    import { V3_SESSION_SCALE_DETECT_ADDRESS } from '$lib/api/handlers/v3Session';

    interface Props {
        onSelect?: () => void;
    }

    let { onSelect }: Props = $props();

    // Master track uses index -1 consistently
    const MASTER_INDEX = -1;

    // PR-5b: master metadata (name, color, volume) reads off the v3
    // normalized store; MasterComponent on the Python surface owns the
    // listener fires under `/looping/v3/master/<attr>`.
    const masterRecord = $derived(v3Store.tracks.get('master'));

    // PR-5c: meter reads off the v3 meter store. `meterLevel` is the
    // L channel (the scalar this UI renders); MetersComponent on the
    // Python surface pushes `/looping/v3/master/meter [L, R]` at 30 Hz.
    const masterMeter = $derived(meterStore.get('master'));
    const meterLevel = $derived(masterMeter?.left ?? 0);

    // Master strip view model. Falls back to defaults until the first
    // `state/full` populates the master record + the first listener
    // fires for volume.
    const masterTrack = $derived({
        index: MASTER_INDEX,
        name: masterRecord?.name ?? 'Master',
        volume: masterRecord?.volume ?? 0.85,
        meterLevel,
        mute: masterRecord?.mute ?? false,
        color: masterRecord?.color ?? 0xff8800
    });

    // Derive if selected
    let isSelected = $derived(session.selectedTrackIndex === MASTER_INDEX);

    // Scale name abbreviations for compact display
    const SCALE_ABBREVIATIONS: Record<string, string> = {
        'Major': 'Maj',
        'Minor': 'Min',
        'Dorian': 'Dor',
        'Mixolydian': 'Mix',
        'Lydian': 'Lyd',
        'Phrygian': 'Phr',
        'Locrian': 'Loc',
        'Whole Tone': 'WT',
        'Half-whole Dim.': 'HW Dim',
        'Whole-half Dim.': 'WH Dim',
        'Minor Blues': 'Min Bl',
        'Minor Pentatonic': 'Min Pent',
        'Major Pentatonic': 'Maj Pent',
        'Harmonic Minor': 'Harm Min',
        'Harmonic Major': 'Harm Maj',
        'Dorian #4': 'Dor #4',
        'Phrygian Dominant': 'Phr Dom',
        'Melodic Minor': 'Mel Min',
        'Lydian Augmented': 'Lyd Aug',
        'Lydian Dominant': 'Lyd Dom',
        'Super Locrian': 'Sup Loc',
        '8-Tone Spanish': '8T Span',
        'Bhairav': 'Bhai',
        'Hungarian Minor': 'Hung',
        'Hirajoshi': 'Hira',
        'In-Sen': 'InSen',
        'Iwato': 'Iwato',
        'Kumoi': 'Kumoi',
        'Pelog Selisir': 'Pelog S',
        'Pelog Tembung': 'Pelog T',
        'Messiaen 3': 'Mes 3',
        'Messiaen 4': 'Mes 4',
        'Messiaen 5': 'Mes 5',
        'Messiaen 6': 'Mes 6',
        'Messiaen 7': 'Mes 7'
    };

    // PR-5b: name/color/volume/mute arrive via the v3 normalized store.
    // PR-5c: meter arrives via the v3 meter store (see `masterMeter`
    // $derived above). No CustomEvent listeners needed on this
    // component — both stores are fine-grained-reactive.

    // Read directly from the v3 store via `masterRecord.volume`. The
    // store IS the optimistic value during drag — `setMasterVolume`
    // applies locally before sending OSC, so we don't need a parallel
    // `optimisticVolume` field. Outside edits and LOM rejections
    // reconcile via the surface's non-suppressed echo, same shape as
    // `setParamValue`. See ADR for the optimistic-apply contract.
    const currentVolume = $derived(masterRecord?.volume ?? 0.85);

    function handleVolumeChange(value: number) {
        setMasterVolume(value);
    }

    // Single tap to open key signature browser
    /**
     * Key band tap — open the scale browser.
     *
     * The event no longer reaches here: the press action stops the
     * `pointerdown` (see `stopPropagation` on the directive below), which is
     * both earlier and the only place stopping it can still do anything.
     * The old `stopPropagation` on the click was defensive — the key band is
     * a sibling of the Card, not a child of it — but the intent is real and
     * worth keeping where it now belongs.
     */
    function handleHeaderTap() {
        browserModeStore.openScaleBrowser();
    }

    /**
     * Key band hold (ADR-446) — detect the key of what is launched and set
     * it, no browser: the fast path. The band itself shows the answer
     * through the ordinary root / scale echoes; the picker's Detect button
     * is the same verb with the reasons on show.
     */
    function handleHeaderHold() {
        send(V3_SESSION_SCALE_DETECT_ADDRESS, [1]);
    }

    // Handle selection (Python v3 wire — ROW 2-F4)
    function handleSelect() {
        // A group gesture is active: master can't be grouped, so this tap
        // is swallowed rather than switching the central view out from
        // under the gesture.
        if (interceptForGroupGesture(MASTER_INDEX, true)) return;
        session.selectTrackOptimistically(MASTER_INDEX);
        selectedTrackStore.handleTrackSelected(MASTER_INDEX);
        send('/looping/v3/track/select', ['master']);
        onSelect?.();
    }

    // Drag action options — matches TrackVolumeMeter so the master
    // fader feel is identical to regular tracks (8 ms debounce,
    // 0.5 sensitivity, leading+trailing edge emits).
    // Always true (FLIP went 2026-09-26; uiPrefsStore pins it).
    let flipLayout = $derived(uiPrefsStore.flipLayout);


    /**
     * Master select — a tap anywhere on the Card.
     *
     * Attached imperatively rather than as `use:press`, because `<Card>` is
     * a component and Svelte directives only apply to DOM elements. It is
     * the same action given the Card's own root node, so it still owns its
     * `touch-action` and its own teardown; only the binding syntax differs.
     *
     * It has to coexist with the volume drag on the overlay inside the Card,
     * and does, in both directions: the drag claims the pointer it was given
     * and this claims the one it was given, and a press that travels past
     * its slop abandons — so a fader drag no longer also selects the master
     * on release, which the `onclick` this replaces did.
     */
    let masterCard = $state<HTMLDivElement | null>(null);

    $effect(() => {
        const node = masterCard;
        if (!node) return;
        const handle = press(node, { onPress: handleSelect, touchAction: 'none' });
        return () => handle.destroy();
    });

    const dragOptions = $derived({
        orientation: 'vertical' as const,
        min: 0,
        max: 1,
        value: currentVolume,
        sensitivity: 0.5,
        enableJumpToClick: false,
        onChange: handleVolumeChange,
        // No `onTap` — the Card already carries its own `use:press`, so
        // wiring it here too selected the master twice per tap.
        debounceMs: 8
    });

</script>

<div class="master-col">
<Card
    class="glass-card master-track transition-colors duration-100 touch-manipulation cursor-pointer {isSelected ? 'master-selected' : ''}"
    data-debug="master-card"
    bind:ref={masterCard}
    style="--track-color: var(--act-master); flex: 2 2 var(--strip-gap); min-height: 0; padding: 0; border-radius: var(--radius-md); container-type: inline-size; position: relative; overflow: hidden;"
    aria-label="Master Track"
>
    <!-- The Card IS the fader now — meter behind, drag surface over it,
         nothing else in it. Two grow shares against the key band's one,
         the same split the strips use, so the master fader ends on the
         line the track cards end on. -->
    <MeterVisualization
        trackIndex={MASTER_INDEX}
        track={masterTrack}
        topInset={0}
    />

    <!-- Volume control overlay — drag action + optimistic update
         matches TrackVolumeMeter, so master fader behaves like
         a regular track fader (8 ms debounce, 0.5 sensitivity). -->
    <div
        use:drag={dragOptions}
        class="absolute cursor-ns-resize"
        style="inset: 0 0 0 0; z-index: 10;"
        role="slider"
        tabindex={0}
        aria-label="Master volume"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={currentVolume}
    >
        <div
            class="master-vol-handle absolute left-0 right-0 pointer-events-none"
            style="bottom: {currentVolume * 100}%;"
        ></div>
    </div>
</Card>

<!-- Key band — a SIBLING of the Card, the master's answer to the strips'
     name band. It takes the same share of the same third, so the key reads
     on the line the track names read on, and the fader above it stops where
     the track cards stop. Out of the Card it is also out of the volume drag:
     a tap that slid a few pixels used to move the master level instead of
     opening the scale browser.

     Flipped stack (ADR-421): source order is fader-then-key, which is the
     flipped default (key at the foot, nearest the hands, level with the
     track names). Unflipped it takes `order: -1` and leads the column —
     the same idiom `.header-block` uses on a strip. -->
<div class="key-block" class:is-flipped={flipLayout}>
    <button
        class="key-band"
        use:press={{
            onPress: handleHeaderTap,
            onHold: handleHeaderHold,
            holdMs: HOLD_MS,
            touchAction: 'none',
            stopPropagation: true
        }}
        aria-label="Current key: {session.rootNoteName} {session.scaleDisplayName}{session.keyFollowEnabled ? ', following the loops' : ', locked'}. Tap to open key signature browser, hold to detect the key"
    >
        <span class="key-root num">{session.rootNoteName}</span>
        <span class="key-scale">{SCALE_ABBREVIATIONS[session.scaleDisplayName] || session.scaleDisplayName}</span>
        {#if !session.keyFollowEnabled}
            <!-- ADR-447: a hand set this key; Follow is off until the picker says otherwise. -->
            <Lock size={12} class="key-lock" aria-hidden="true" />
        {/if}
    </button>

    <!-- Nothing else in the block: the key band IS the third.

         Two things used to share it. The TotalMix mirror took it whenever
         the transport header wasn't carrying it, and moved to the
         safe-area status strip (`+page.svelte`), which is always on screen
         and costs the layout nothing. A `.key-spacer` held the strips'
         Solo half so the band couldn't grow past their name bands; that
         went too, deliberately — a full-height key readout is worth more
         than the seam under it lining up with the name/Solo split, and the
         readout scales off `cqh` so the extra height becomes bigger type
         rather than more air. With Solo OFF (the default) nothing changes:
         the band already took the whole third. -->
</div>
</div>

<style>
    /* GRATICULE (§5.7): the master rides act-master via --track-color on
       .glass-card; selection is a full-outline highlight — 2px ink border + 1px
       ring + soft glow over the 18% wash, NO hover lift. !important kept so
       selection wins over .glass-card, which lives in app.css — cross-file,
       so source order can't be relied on; the flat override below is
       !important for the same reason. */
    :global(.master-selected) {
        border-width: 2px !important;
        border-color: var(--act-master) !important;
        background: color-mix(in oklab, var(--act-master) 18%, var(--card)) !important;
        box-shadow: 0 0 0 1px var(--act-master),
                    0 0 12px color-mix(in oklab, var(--act-master) 50%, transparent) !important;
    }

    /* Column wrapper — the master's answer to `.strip-col`, and it takes
       that component's gap verbatim (`--spacing-xs`): the master sits in
       the same row as the strips, so the seam between its fader and its
       key band has to be the seam between a strip's card and its name. */
    .master-col {
        --strip-gap: var(--spacing-xs);
        display: flex;
        flex-direction: column;
        width: var(--sidebar-width);
        height: 100%;
        min-width: 0;
        gap: var(--strip-gap);
    }

    /* One third of the column, whether or not the strips are showing Solo —
       the same share `.header-block` takes on a strip. */
    .key-block {
        flex: 1 1 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: var(--strip-gap);
    }

    /* Unflipped (strips on TOP) the key leads the column; the flipped
       default keeps its source order at the foot, nearest the hands.
       UNREACHABLE since 2026-09-26 (flipLayout is pinned on), kept until the flag goes. */
    .key-block:not(.is-flipped) {
        order: -1;
    }

    /* The whole third, always — it is the block's only child now.
       `container-type: size` makes that height queryable, so the readout
       below sizes off it in `cqh` and grows to fill rather than sitting
       small in a taller band. */
    .key-band {
        flex: 1 1 0;
        min-height: 0;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.35em;
        overflow: hidden;
        cursor: pointer;
        border: none;
        background: transparent;
        border-radius: var(--radius-md);
        color: var(--act-master);
        line-height: var(--leading-tight);
        container-type: size;
        -webkit-tap-highlight-color: transparent;
    }

    /* Key readout (§5.7): root note in the display size, scale abbreviation
       beside it, on ONE line. The clamps are what make a full-height band
       safe — the type grows with the container and then stops, so it fills
       the third without turning into signage. Sizes live here (not inline)
       so the flat grammar can re-size them by plain specificity. */
    .key-root {
        font-size: clamp(max(var(--type-min), calc(14 * var(--fluid-px))), 62cqh, 2.25rem);
        font-weight: var(--font-weight-bold);
    }
    .key-band :global(.key-lock) { opacity: 0.7; }
    .key-scale {
        font-size: clamp(0.625rem, 34cqh, 1.125rem);
        font-weight: var(--font-weight-medium);
        opacity: 0.8;
    }

    /* Fader handle: white-hot act-master dash at the volume height. */
    .master-vol-handle {
        height: 2px;
        background: color-mix(in oklab, var(--act-master) 55%, white);
    }

    /* Flat grammar: the master is a flat grey strip; the key readout is a text
       field (no Live analogue — set in Live's control text), the fader
       handle is ControlFillHandle grey, selection is the lighter panel with
       a SelectionBackground frame. */
    :global([data-grammar="flat"] .master-selected) {
        border-width: 1px !important;
        border-color: var(--flat-selection) !important;
        background: var(--popover) !important;
        box-shadow: none !important;
    }
    /* Out of the Card the readout needs a body of its own, or it floats in
       the gap under the fader with nothing behind it. It takes the treatment
       the strips' name band already has in this skin — a solid block in the
       track's own colour with Live's ClipText on it — so the master ends the
       row of name bands rather than interrupting it. */
    :global([data-grammar="flat"]) .key-band {
        background: var(--act-master);
        color: var(--flat-clip-text);
        border-radius: 0;
    }
    :global([data-grammar="flat"]) .key-root {
        font-weight: var(--font-weight-medium);
    }
    :global([data-grammar="flat"]) .key-scale {
        opacity: 0.85;
    }
    :global([data-grammar="flat"]) .master-vol-handle {
        background: var(--flat-handle);
        height: 4px;
    }
</style>