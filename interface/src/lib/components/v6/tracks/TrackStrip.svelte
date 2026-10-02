<script lang="ts">
    import { Card } from '$lib/components/ui/card';

    // Section components (presentational — all gestures are owned here)
    import TrackHeader from './TrackStrip/components/TrackHeader.svelte';
    import MiniSequencer from './TrackStrip/components/MiniSequencer.svelte';
    import TrackClipView from './TrackStrip/components/TrackClipView.svelte';
    import TrackDeviceView from './TrackStrip/components/TrackDeviceView.svelte';
    import MeterVisualization from '$lib/components/v6/looping/MeterVisualizationV6.svelte';

    // Composables + stores
    import { useTrackData } from './composables/useTrackData.svelte.js';
    import { useTinySequencer } from './composables/useTinySequencer.svelte';
    import { useTrackDevice } from './composables/useTrackDevice.svelte';
    import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
    import { paintModeReactive } from '$lib/utils/paintMode.svelte';
    import { useStripGestures } from './composables/useStripGestures.svelte';
    import { playingClipsStore } from '$lib/stores/v6/playingClipsStore.svelte';
    import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
    import { instrumentDisplayCoordinator } from '$lib/services/instrumentDisplayCoordinator.svelte';
    import { openDeviceView, openScopedPermutePane } from '$lib/services/deviceViewRouter.svelte';
    import { groupGestureStore } from '$lib/stores/v6/groupGestureStore.svelte';

    // Volume write path + throttle (same contract TrackVolumeMeter used)
    import {
        setTrackVolumeByIndex,
        setTrackFoldState,
        setTrackSolo,
        setTrackMute
    } from '$lib/services/trackCommands';
    import {
        shouldRestoreOnRelease,
        MOMENTARY_HOLD_MS
    } from './TrackStrip/utils/momentaryPress';
    import { press, type PressOptions } from '$lib/actions/press';
    import { createSliderThrottle } from '$lib/utils/sliderThrottle';
    import { clipStateStore } from '$lib/stores/v6/clipStateStore.svelte';
    import { uiPrefsStore } from '$lib/stores/v6/uiPrefsStore.svelte';
    import { presetLandingStore, LANDING_PULSE_MS } from '$lib/stores/v6/presetLandingStore.svelte';

    interface Props {
        trackIndex: number;
        isMaster?: boolean;
        onTrackSelect?: (trackIndex: number) => void;
        /**
         * Whether the strips row can actually scroll horizontally, measured
         * by `TracksPanelV6` (which owns the scroller). Decides mute's
         * timing — see `mutePress` below. Defaults false, which is the
         * fast branch: a strip mounted outside that panel has no row to
         * pan.
         */
        rowScrolls?: boolean;
    }

    let { trackIndex, isMaster = false, onTrackSelect, rowScrolls = false }: Props = $props();

    const trackPath = `tracks/${trackIndex}`;

    const trackData = useTrackData({ trackIndex, isMaster, onTrackSelect });

    const seq = useTinySequencer(trackPath);
    let sequencerState = $derived(seq.state);
    // ADR-435: while a pad is scoped on THIS track's Drum Rack the section is
    // that pad's Permute (or the ghost rows, when it has none), framed in the
    // pad's chain colour — the track's own ink where Live left it uncoloured.
    let seqScope = $derived(seq.scope);
    let seqScopeInk = $derived(
        seqScope && seqScope.color !== null ? trackInk(rgbToHex(seqScope.color), paintModeReactive()) : null
    );
    let seqScopeLabel = $derived(seqScope ? (seqScope.name || `Pad ${seqScope.note}`) : null);

    // The device band (third card section). Cheap on every strip: it reads
    // device names, class names and parameter values that the state/full
    // tree already carries for every track, and subscribes to nothing.
    const trackDevice = useTrackDevice(trackPath);
    let deviceGlance = $derived(trackDevice.glance);

    let clipEntry = $derived(playingClipsStore.get(trackPath));
    let hasClip = $derived(!!clipEntry && clipEntry.slotIdx >= 0);

    // Preset-load state for this strip. The browser closes the instant a pick
    // commits rather than waiting for Live, so the strip carries the whole
    // report: the sweep while the load is in flight, then the pulse when the
    // prepare ack lands and the real name follows from Live. For a folder-hold
    // random pick this is the only thing that says WHICH track got the pick.
    let justLanded = $derived(presetLandingStore.landedTrackPath === trackPath);
    let isPending = $derived(presetLandingStore.pendingTrackPath === trackPath);
    // Shown in place of the live track name while pending — the optimistic
    // claim. It is replaced by Live's own name a moment later, or withdrawn
    // (with a banner) if the load fails.
    let pendingName = $derived(isPending ? presetLandingStore.pendingName : null);

    // `--strip-radius` (ADR-413) is set by TracksPanelV6 on a Group Track's
    // column: the group's bracket arm grows out of the strip's top-RIGHT
    // corner, so that corner squares off and arm + strip read as one
    // continuous outline. Unset on every other strip, where the fallback
    // keeps the plain all-round card radius.

    // ---- Group Track variant (ADR-410) ------------------------------------
    //
    // A Group Track is a mixer bus, not a playable track: it holds no clips
    // of its own (Live gives it clip_slots, but they only mirror the row and
    // are never `has_clip`) and never hosts Permute. So the group strip drops
    // both of those sections and keeps what a group genuinely has — a name
    // (tap = mute, which mutes every child), a volume fader, and the
    // fold triangle.
    //
    // The group strip keeps the same three-third geometry as its neighbours
    // (strips sit shoulder-to-shoulder — a name floating to the vertical
    // middle would break the row's read): Name / body / fold. The body is
    // the vacated Clip third and carries the group's select tap, since a
    // group has no clip or Permute section to carry one. The freed Permute
    // third becomes the fold control at full section size — it's the group
    // strip's primary action and gets driven by a finger on an iPad.
    let isGroup = $derived(!isMaster && clipStateStore.isGroupTrack(trackIndex));
    let isFolded = $derived(isGroup && clipStateStore.isGroupFolded(trackIndex));

    function toggleFold() {
        setTrackFoldState(trackPath, !isFolded);
    }

    // Greys the strip's clip/permute when the track's actual mute button is
    // on in Ableton — NOT the per-beat Permute mute-step state.
    let dimmed = $derived(trackData.track.mute);

    // Optional Solo button (uiPrefsStore.showSoloButtons, toggled from
    // SystemCentralView's Sections card). Off by default; never on the
    // master strip — Live's master has no solo.
    let showSolo = $derived(uiPrefsStore.showSoloButtons && !isMaster);

    // In session mode the clip grid draws this track's clips a third
    // below, so the strip's own Clip section drops its preview rather
    // than drawing the same content twice.
    let sessionMode = $derived(uiPrefsStore.sessionMode);
    let isSoloed = $derived(trackData.track.solo === true);
    // The whole strip wears solo, not only the button: the button is off by
    // default, and two fingers on the fader solo with no button to light.
    let stripSoloed = $derived(isSoloed && !isMaster);
    let isGroupTapped = $derived(
        groupGestureStore.active && groupGestureStore.memberPaths.has(trackPath)
    );

    // The device band. A group strip never gets one — it takes the other
    // markup branch below, whose card is already spoken for by body + fold,
    // and a group hosts no devices of its own.
    //
    // `uiPrefsStore.showDeviceBand` is pinned true (the INST switch went
    // 2026-09-26), so this is `!isMaster`: a two-band card on a non-group
    // strip is UNREACHABLE since 2026-09-26, kept until the flag goes.
    let showDeviceBand = $derived(uiPrefsStore.showDeviceBand && !isMaster);

    /**
     * How many bands the Card holds — and, with it, the whole strip's
     * proportions. Every band on the strip is the same height, the Name
     * block below the Card included, so the Card's grow factor is simply
     * its band count and the Name block's stays 1.
     *
     * The flex BASIS is what makes "same height" true rather than
     * approximately true. The Card has one `--strip-gap` between each
     * pair of its own bands, and the column has one more between Card and
     * Name block; a basis of `(bands - 1) * gap` hands the Card exactly
     * its internal gaps up front, so the remaining space divides into
     * equal shares. (Two bands, basis 1 gap — the pre-INST strip — is the
     * same arithmetic, which is where that lone `var(--strip-gap)` came
     * from.)
     *
     * A group strip is always 2: body + fold.
     */
    let cardBands = $derived(showDeviceBand && !isGroup ? 3 : 2);

    // Flipped stack (ADR-421, default ON). The strips row sits at the
    // bottom of the screen, so the Name band moves to the FOOT of the
    // card, landing directly above the Solo button that already lived
    // there — title and its button end up together at the bottom edge,
    // nearest the hands.
    //
    // ONLY the name moves. Clip stays above Permute in both layouts:
    // that pair is a reading order, not a stack — you look at what the
    // clip is doing and then at what Permute is doing to it — and
    // mirroring the card wholesale put Permute on top, which reads
    // backwards. So this is `order` on the one section that moves, not
    // `flex-direction: column-reverse` on the card.
    //
    // `order` also leaves the markup, the tap dispatch below
    // (`elementFromPoint` → `[data-section]`) and every section's flex
    // share untouched. Two more things deliberately do NOT move: the
    // Solo button, which is outside the Card and must stay under the
    // title; and the card's own top-edge treatments (the glass
    // highlight, the REC label), which belong to the card as an object
    // rather than to the running order of its sections.
    //
    // Always true (FLIP went 2026-09-26; uiPrefsStore pins it): every
    // `:not(.is-flipped)` rule below is UNREACHABLE since 2026-09-26, kept until the
    // flag goes.
    let flipLayout = $derived(uiPrefsStore.flipLayout);

    // ---- Standalone Solo button (ADR-414) ---------------------------------
    //
    // The Solo button lives in the header block but outside the Card's
    // gesture machine: a press on it can never become the volume fader or the
    // row scroll, so there is nothing to disambiguate and the toggle fires at
    // TRUE finger-down — zero delay, no intent gate. The press then only
    // decides what release means, read from elapsed time at release (no timer
    // — nothing changes at the threshold itself):
    //   release < MOMENTARY_HOLD_MS → latch: the down-toggle stands
    //   release ≥ MOMENTARY_HOLD_MS → momentary: release restores the captured
    //                            pre-press state (holding a soloed track is
    //                            momentary UNsolo, symmetrically)
    // The restore writes the CAPTURED value, not a second toggle, so a
    // surface echo or another client flipping solo mid-press can't leave
    // the restore inverted. Cancel restores too — safe for a latch meant as
    // a tap (net no-op) and correct for an interrupted hold — and so does an
    // unmount, which is the failure that used to leave a track soloed with
    // no finger on it and nothing left to undo it.
    //
    // ADR-427: this is `use:press` now rather than hand-rolled window
    // listeners. Same model — it was already the correct one — but the
    // action owns the pointerId filtering, the `touch-action: none` that
    // guarantees no pan can ever start here, and the teardown, so none of
    // the three can drift away from the others.
    let soloRestoreTo: boolean | null = null;
    // The two-finger solo on the fader keeps its own: the button and a
    // chord can be held at once, and each must restore what IT found.
    let chordSoloRestoreTo: boolean | null = null;

    const soloPress: PressOptions = $derived({
        // Zero delay. Safe precisely because `touch-action: none` means a
        // row pan can never begin on this button, so a down-toggle is never
        // undone by a cancel the performer didn't ask for.
        fireOn: 'down' as const,
        touchAction: 'none',
        // No slop: the button owns the gesture outright, so travel across it
        // is still this press. A stray abandonment here would read as solo
        // flickering under a hand that never left the button.
        slop: 0,
        // The button sits inside the header block, which is a sibling of the
        // Card — but a press here must never reach anything else either way.
        stopPropagation: true,
        onPress: () => {
            soloRestoreTo = isSoloed;
            setTrackSolo(trackPath, !isSoloed);
        },
        onRelease: ({ reason, elapsedMs }) => {
            if (soloRestoreTo !== null && shouldRestoreOnRelease({ elapsedMs, reason })) {
                setTrackSolo(trackPath, soloRestoreTo);
            }
            soloRestoreTo = null;
        }
    });

    // ---- Mute: timing and momentary hold (ADR-427 addenda 1–3) -----------
    //
    // Mute is Solo's gesture now, on the same threshold: **tap latches,
    // hold releases back**. Holding a track muted for two bars and letting
    // go is the same performance move as holding a Solo, and a hold that
    // means "momentary" on one button and nothing on the button beside it
    // is a distinction the hand cannot keep. `shouldRestoreOnRelease` is
    // the shared rule; the restore writes the CAPTURED value rather than
    // toggling again, so a surface echo or another client flipping mute
    // mid-press cannot invert it.
    //
    // What differs between the two branches below is only WHEN the toggle
    // fires, and that is decided by whether the strips row can actually
    // scroll.
    //
    // The release-wait mute used to have buys exactly one thing: a
    // horizontal pan of the row that BEGINS on a track name scrolls the
    // row instead of muting. It is not a confirm gate or a debounce.
    // Measured on the mock stack with a 90ms tap it costs 103ms from
    // touch-down against Solo's 0ms, on the most-used control on the
    // surface — so it is spent only where it buys something. `rowScrolls`
    // comes from `TracksPanelV6`, which owns the scroller and observes it:
    // below 14 tracks at 1366x1024 the row is not a scroller at all.
    //
    //   row cannot scroll → toggle at TRUE finger-down, `touch-action:
    //     none`. Solo's exact model. Release decides by elapsed time; no
    //     timer runs, because nothing happens at the threshold itself.
    //
    //   row can scroll → `touch-action: pan-x`, so the browser keeps the
    //     pan and cancels us when it claims one. A tap therefore toggles on
    //     RELEASE. The momentary hold still works, and this is the part
    //     worth reading twice: the toggle fires at the HOLD THRESHOLD
    //     instead. By 300ms with the finger still down and no cancel, the
    //     press is definitively not a pan — the browser has long since
    //     decided — so firing then is safe where firing at down was not.
    //     Momentary starts 300ms in rather than instantly, which is the
    //     honest cost of sharing the axis, and a tap is unchanged.
    //
    // Down-firing on a `pan-x` node is the one combination that must never
    // ship: every row pan starting on a name would mute and then unmute the
    // track, which on a playing track is an audible dropout mid-set.
    let muteRestoreTo: boolean | null = null;

    function beginMute() {
        muteRestoreTo = trackData.track.mute;
        trackData.handleMuteToggle();
    }

    function endMute(restore: boolean) {
        if (restore && muteRestoreTo !== null) {
            setTrackMute(trackPath, muteRestoreTo);
        }
        muteRestoreTo = null;
    }

    let mutePress: PressOptions = $derived(
        rowScrolls
            ? {
                  // Tap → toggle on release. Hold → toggle at the threshold,
                  // restore on release.
                  fireOn: 'up',
                  touchAction: 'pan-x',
                  holdMs: MOMENTARY_HOLD_MS,
                  onPress: () => trackData.handleMuteToggle(),
                  onHold: beginMute,
                  onRelease: ({ held }) => {
                      // A press that reported a hold never reaches `onPress`
                      // (the action suppresses it), so this is the whole
                      // momentary path. Restore on EVERY ending — an
                      // interrupted momentary must not stay latched.
                      if (held) endMute(true);
                  }
              }
            : {
                  // Zero delay, Solo's model exactly.
                  fireOn: 'down',
                  touchAction: 'none',
                  // The name band owns the gesture outright, so travel
                  // across it is still this press. Abandoning would read as
                  // mute flickering under a hand that never left it.
                  slop: 0,
                  onPress: beginMute,
                  onRelease: ({ reason, elapsedMs }) =>
                      endMute(shouldRestoreOnRelease({ elapsedMs, reason }))
              }
    );

    // Edge tick: a luminous white-hot dash from the track ink; signal-dim when
    // muted (§5.2). color-mix over --track-color, which the Card sets below.
    let handleColor = $derived(
        trackData.track.mute
            ? 'var(--signal-dim)'
            : 'color-mix(in oklab, var(--track-color) 65%, white)'
    );

    // Record state (§4.3): corner brackets mark the RECORDING strip (act-rec ink
    // + a REC micro-label). Selection no longer uses brackets — it rides the
    // full-outline glow (.track-selected) — so brackets are now record-only.
    // liveStatus is 0 idle / 1 playing / 2 recording — free data, no new wire.
    let isRecording = $derived(playingClipsStore.liveStatus(trackPath) === 2);
    let bracketInk = 'var(--act-rec)';
    let bracketActive = $derived(isRecording);

    // Section taps select the track, then route Central View to that section.
    function selectThen(view: 'permute' | 'clip') {
        instrumentDisplayCoordinator.suppressAutoViewSwitch();
        trackData.handleSelect({ showInstrumentView: false });
        // A pad held or latched on this track's Drum Rack (ADR-435): the
        // Permute tap opens the PAD's Permute inside the Drum Rack view,
        // beside the pad column, so the hold survives and the pad stays in
        // view — the door every effect view takes from a tile. Selecting
        // another track clears every scope first, so this only ever answers
        // for the selected track's own rack.
        if (view === 'permute' && openScopedPermutePane()) return;
        centralDisplayStore.setView(view, undefined, null, view === 'permute' ? 'Permute' : 'Clip');
    }

    /**
     * The device band's tap: select, then open the head device's view.
     *
     * The view is set from the BAND's own glance rather than left to
     * `instrumentDisplayCoordinator`, and both halves of that are
     * deliberate. The coordinator auto-switches only on a *new* track, so
     * it would do nothing at all when the band tapped belongs to the
     * track already selected — and on a new AUDIO track it does the one
     * thing this band must not do, which is show the clip view the Clip
     * section beside it already opens. Its cached `currentInstrument` is
     * a track behind us here anyway: its effect has not re-run yet at the
     * moment of the tap. The glance is per-track and exact, so it answers
     * directly, and the auto-switch is suppressed so the effect that runs
     * a moment later updates `currentInstrumentStore` without overruling
     * the view we just set.
     *
     * With no view to open — a plug-in the rig has no view for, an empty
     * chain — the tap falls back to the clip view: it is what selecting
     * the track would have shown, and a tap that visibly does nothing
     * reads as a tap that missed.
     */
    async function selectThenDevice() {
        const glance = deviceGlance;
        instrumentDisplayCoordinator.suppressAutoViewSwitch();
        await trackData.handleSelect({ showInstrumentView: false });
        if (glance.instrumentViewType) {
            centralDisplayStore.setView('instrument', glance.instrumentViewType, {
                instrument: glance.instrument
            });
            return;
        }
        if (glance.deviceViewType) {
            // Through the router, so a pad held on this track's Drum Rack
            // gets the device as a PANE rather than losing its hold to a
            // top-level view swap — the same door every FX tile takes.
            //
            // No `color` rides along. A device view inks itself from its
            // own slot (`useFxGridSlot`), the same calibrated scheme a tile
            // would hand it, and the views that take a `color` override
            // read `.primary` off one — the head's bare `ink` string here
            // would reach them as no ink at all.
            openDeviceView(glance.deviceViewType);
            return;
        }
        centralDisplayStore.setView('clip', undefined, null, 'Clip');
    }

    // ---- Strip-wide volume fader gesture ----------------------------------
    //
    // The whole strip is a vertical fader. A vertical drag anywhere changes
    // volume (relative: touch-down never jumps the value), and "anywhere"
    // includes the half-gutter beside the Card and the seam above the name
    // (`.fader`). A horizontal drag scrolls the tracks row when there is one
    // to scroll (native pan-x on touch; mouse drives the scroller's
    // scrollLeft here) and is never a tap. A tap dispatches to whichever
    // section was under the finger: clip→select + Clip view,
    // permute→select + Permute view. Neither mute nor Solo is part of this
    // machine — both live in the header block outside the Card.

    // Optimistic local state drives the handle immediately during a drag;
    // store echoes only sync here when not dragging, so they can't snap the
    // handle mid-drag.
    let localVolume = $state(trackData.track.volume ?? 0.85);

    const throttle = createSliderThrottle((value: number) => {
        setTrackVolumeByIndex(trackIndex, value);
    });

    // The fader's TRAVEL is now the whole Card. It used to be two thirds of
    // it — the strip minus the Name section — because the name lived inside
    // the Card and a handle riding up over a mute button read as a level
    // that had left the fader. The header block moved OUT, so the Card is
    // exactly the fader and nothing else.
    //
    // Feel is unchanged: `elementHeight` is the Card, which is now two
    // thirds of the column, so delta-per-pixel is 1/(2H/3) = 1.5/H — the
    // same as the old 1.5 gain over the full column height.
    const VOL_TRAVEL = 1;

    // Value change per fraction of strip height dragged. Set from the
    // travel so the ticks keep pace with the finger: dragging the full
    // strip height moves the handle exactly one full travel, end to end.
    // (Relative — touch-down never jumps the value.)
    const DRAG_GAIN = 1 / VOL_TRAVEL;

    let card = $state<HTMLDivElement | null>(null);
    // Volume at the moment the finger landed. The drag is relative to this,
    // so touch-down never jumps the value.
    let startValue = 0;

    // The ADR-384 machine (see `useStripGestures`): vertical-dominant drag =
    // volume, horizontal-dominant = row scroll, neither = tap dispatched to
    // whichever [data-section] was under the finger. Window-bound listeners
    // and the "a scroll/cancel is never a tap" rule live in the composable.
    //
    // The row scroll only exists while the row can scroll (`rowScrolls`,
    // the same answer mute's timing reads). Below that — every set of up
    // to 13 tracks on the iPad — "horizontal-dominant = row scroll" meant
    // a drag whose first 12px leaned sideways was thrown away whole: no
    // volume, no scroll, nothing on screen. A thumb pushing a fader up
    // arcs, so that was a real share of drags. With no row to scroll the
    // horizontal axis is inert: sideways travel still rules out a tap, and
    // the drag waits for the vertical axis instead of locking it out.
    const gestures = useStripGestures({
        getElement: () => card,
        crossAxisLive: () => rowScrolls,
        onDown: () => {
            startValue = localVolume;
        },
        // Deliberately not started at finger-down: a pure tap never opens an
        // OSC frame loop.
        onDragStart: () => throttle.start(),
        onDragMove: ({ dy, elementHeight }) => {
            const delta = (dy / elementHeight) * DRAG_GAIN;
            localVolume = Math.max(0, Math.min(1, startValue + delta));
            throttle.push(localVolume);
        },
        onDragEnd: () => throttle.flush(),
        onTap: ({ x, y }) => dispatchSectionTap(x, y),
        // Two fingers on the fader = the Solo button, release rule and all.
        // The held Group button outranks it: there two fingers are a tap,
        // and a tap means "add this track to the group".
        onChordStart: () => {
            if (groupGestureStore.active) {
                groupGestureStore.tap(trackPath, trackData.track.name);
                return true;
            }
            if (isMaster) return false;
            chordSoloRestoreTo = isSoloed;
            setTrackSolo(trackPath, !isSoloed);
            return true;
        },
        onChordEnd: ({ reason, elapsedMs }) => {
            if (chordSoloRestoreTo !== null && shouldRestoreOnRelease({ elapsedMs, reason })) {
                setTrackSolo(trackPath, chordSoloRestoreTo);
            }
            chordSoloRestoreTo = null;
        }
    });

    let isDragging = $derived(gestures.isDragging);

    // The fader's `touch-action`, by the rule mute follows (ADR-427
    // addendum 2): `pan-x` only where there is a row to pan. With nothing
    // to scroll, `pan-x` bought nothing and still let the browser claim a
    // drag that set off sideways — Chromium cancels the pointer then
    // whether or not anything can scroll — so the fader would go dead in
    // the browser before the machine above ever saw the vertical travel.
    let faderTouchAction = $derived(rowScrolls ? 'pan-x' : 'none');

    $effect(() => {
        if (!isDragging) {
            localVolume = trackData.track.volume ?? 0.85;
        }
    });

    // Effect teardown, not onDestroy: onDestroy also runs during SSR, where
    // `window` is undefined.
    //
    // Solo is NOT closed here any more. `use:press` owns that: an action's
    // `destroy` runs when its node goes away, and it closes every open press
    // with reason `teardown` before dropping its listeners. That is the whole
    // structural argument for actions over hand-wired handlers — the teardown
    // cannot be forgotten, because it is not a separate thing to remember.
    $effect(() => () => {
        throttle.cancel();
        gestures.destroy();
    });

    // Tap: dispatch to the section under the finger immediately.
    //
    // `elementFromPoint` alone left DEAD BANDS. The Card is a flex column
    // with `gap-2`, so there are two 8px seams between the three sections
    // (plus the 1px border ring) where the topmost element is the Card
    // itself — no `[data-section]` ancestor, so the tap resolved to
    // nothing and the strip visibly did nothing. Measured on a 1366x1024
    // iPad layout that is ~16px of a 331px strip: roughly one tap in
    // twenty, and concentrated exactly at the seams a finger aims for.
    //
    // So the seam belongs to its nearest neighbour: fall back to the
    // section closest on the Y axis. Same move ADR-417 made in the slot
    // grid, where `--session-row-gap` was swallowing clip launches — a
    // gap is spacing, not a meaning. A tap on the fader's slop beside the
    // Card (`.fader::before`) is outside every section by construction and
    // resolves the same way.
    function sectionAt(x: number, y: number): string | null {
        const hit = document
            .elementFromPoint(x, y)
            ?.closest('[data-section]')
            ?.getAttribute('data-section');
        if (hit) return hit;
        if (!card) return null;
        let best: string | null = null;
        let bestDistance = Infinity;
        for (const el of card.querySelectorAll('[data-section]')) {
            const rect = el.getBoundingClientRect();
            const distance =
                y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = el.getAttribute('data-section');
            }
        }
        return best;
    }

    function dispatchSectionTap(x: number, y: number) {
        const section = sectionAt(x, y);

        // The Group button is held: every ordinary "select this track" tap
        // means "toggle this track into the pending group" instead, on
        // every section that would otherwise select (including a group
        // strip's own 'group-body' — grouping the group itself, i.e.
        // merging into it, is exactly the gesture's other job). Fold is left
        // alone: it changes what is visible, not the selection.
        if (groupGestureStore.active && section !== 'fold' && section !== null) {
            groupGestureStore.tap(trackPath, trackData.track.name);
            return;
        }

        switch (section) {
            // Fold occupies the Permute third on a group strip.
            case 'fold':
                toggleFold();
                break;
            // No 'header' or 'solo' case: both live OUTSIDE the Card now,
            // so their presses never reach this dispatch. A release that
            // drifts off the Card onto the header falls through to the
            // nearest-section rule below rather than muting by accident.
            case 'clip':
                selectThen('clip');
                break;
            case 'permute':
                selectThen('permute');
                break;
            case 'device':
                selectThenDevice();
                break;
            // Group body: the group's only select affordance (it has no
            // clip or permute section). No view routing — a group has no
            // instrument and no clip, so Central View stays put.
            case 'group-body':
                trackData.handleSelect({ showInstrumentView: false });
                break;
            // Taps on the background (no [data-section]) have no action.
        }
    }
</script>

<div class="strip-col" style="--track-color: {trackData.trackColor};">
<!-- The fader's hit box: the Card, plus the empty space beside it that
     belongs to nobody else. It owns the gesture rather than the Card, for
     its `::before` — see `.fader::before`. Measured on the 12-track iPad
     layout before it: of every 90px of strips row, 16px was gutter where a
     press reached no strip at all, and the volume ticks (the only drawn
     handle) sit flush against that gutter — a finger aimed at a tick
     landed off the strip often enough to read as "the drag did nothing".
     The flex share lives here now; the Card fills it. -->
<div
    class="fader"
    class:is-flipped={flipLayout}
    style="flex: {cardBands} {cardBands} calc(var(--strip-gap) * {cardBands - 1}); touch-action: {faderTouchAction};"
    onpointerdown={gestures.handlePointerDown}
>
<Card
    bind:ref={card}
    class="glass-card hud-bracket touch-manipulation min-h-0 py-0 {trackData.isSelected ? 'track-selected' : ''} {bracketActive ? 'is-active' : ''} {trackData.permuteMutedNow ? 'permute-silenced' : ''} {isPending ? 'is-loading' : ''} {justLanded ? 'is-landed' : ''} {isGroupTapped ? 'group-tapped' : ''}"
    data-debug="track-card"
    style="min-width: 0; flex: 1 1 0; gap: var(--strip-gap); --bracket-ink: {bracketInk}; --landing-pulse-ms: {LANDING_PULSE_MS}ms; padding: 0; border-radius: var(--strip-radius, var(--radius-md)); container-type: inline-size; position: relative; overflow: hidden; display: flex; flex-direction: column; touch-action: {faderTouchAction};"
    role="slider"
    aria-label="Track {trackIndex + 1} volume"
    aria-orientation="vertical"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(localVolume * 100)}
>
    <!-- Meter visualization — animated background behind all sections -->
    <div class="meter-bg">
        <MeterVisualization {trackIndex} track={trackData.track} color={trackData.trackColor} />
    </div>

    <!-- Solo tint: a wash over the meter and a ring inside the border, so it
         composes with selection and permute-silenced instead of fighting
         their backgrounds. Follows Live's solo state, however it was set. -->
    {#if stripSoloed}
        <div class="solo-tint" aria-hidden="true"></div>
    {/if}
    {#if isGroupTapped}
        <div class="group-tint" aria-hidden="true"></div>
    {/if}

    {#if isGroup}
        <!-- Group body: no clip. Tap selects the group. -->
        <div class="strip-section group-body" data-section="group-body"></div>

        <!-- Fold control (ADR-410) takes the Permute third. A group has no
             Permute, so the freed section becomes a full-size touch target
             instead of a corner triangle — this is the group strip's primary
             action and it's driven by a finger on an iPad. Chevron points
             down when open (children below), right when closed, matching
             Live's own group header. -->
        <div
            class="strip-section section-padded section-permute fold-section"
            data-section="fold"
            role="button"
            tabindex="-1"
            aria-label="{isFolded ? 'Unfold' : 'Fold'} group {trackData.track.name}"
            aria-expanded={!isFolded}
        >
            <div class="fold-glyph" class:is-folded={isFolded}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                        d={isFolded ? 'M8 3 L18 12 L8 21' : 'M3 8 L12 18 L21 8'}
                        fill="none"
                        stroke="var(--track-color)"
                        stroke-width="3"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                </svg>
            </div>
        </div>
    {:else}
        <!-- Clip notes / waveform. Suppressed in session mode (ADR-415):
             the grid below already draws every clip on this track,
             including the playing one, so repeating it here would be the
             same content twice. The section stays — it is the strip's
             select-and-show-Clip-view tap target either way. -->
        <div class="strip-section section-padded" data-section="clip">
            {#if hasClip && !sessionMode}
                <TrackClipView {trackPath} color={trackData.trackColor} {dimmed} />
            {:else}
                <div class="clip-empty"></div>
            {/if}
        </div>

        <!-- Device band: the instrument's central view in miniature —
             the controls it leads with, read off the same tree, plus
             Live's own name for the device. Between Clip and Permute
             because that is where the performer's eye wants it: what is
             playing, what is making the sound, what is being done to it.
             Under the flipped default the four bands then read Clip ·
             Inst · Permute · Name down the strip. -->
        {#if showDeviceBand}
            <div class="strip-section section-padded section-device" data-section="device">
                <TrackDeviceView glance={deviceGlance} color={trackData.trackColor} {dimmed} />
            </div>
        {/if}

        <!-- Permute mini sequencer — the held pad's while one is scoped (ADR-435). -->
        <div class="strip-section section-padded section-permute" data-section="permute">
            <MiniSequencer
                {sequencerState}
                color={seqScopeInk ?? trackData.trackColor}
                {dimmed}
                scopeLabel={seqScopeLabel}
                scopeInk={seqScope ? (seqScopeInk ?? trackData.trackColor) : null}
            />
        </div>

    {/if}

    <!-- Load veil. A preset is on its way to this track and the browser that
         sent it is already gone, so the strip has to carry the whole report
         itself: the card breathes, the content sits back behind a thin scrim,
         and one small ring says the wait is real work rather than a stall.
         Retired by the ack — `.is-landed` flares once and settles. -->
    {#if isPending}
        <div class="load-veil" aria-hidden="true">
            <div class="load-spinner"></div>
        </div>
    {/if}

    <!-- Volume edge ticks: left + right rails at the volume height. They
         span the TRAVEL band — the strip below the Name section — not the
         whole strip, so the handle never rides up over the name. `bottom`
         interpolates within an inset range [handle-h, travel - handle-h]
         so the ticks stay fully visible at both ends instead of clipping
         off at max. The ink rides `--tick-ink` (read by .vol-tick) so the
         flat grammar can swap it for the grey handle without fighting an
         inline background. -->
    <div
        class="vol-tick left"
        class:transition-none={isDragging}
        style="bottom: calc(var(--vol-base) + var(--handle-h) + {localVolume} * (var(--vol-travel) - 2 * var(--handle-h))); --tick-ink: {handleColor};"
    ></div>
    <div
        class="vol-tick right"
        class:transition-none={isDragging}
        style="bottom: calc(var(--vol-base) + var(--handle-h) + {localVolume} * (var(--vol-travel) - 2 * var(--handle-h))); --tick-ink: {handleColor};"
    ></div>

    <!-- Record HUD label (§4.3) — pointer-events:none, no data-* so it never
         intercepts the [data-section] hit-test. Authored mixed-case; the
         Graticule rule upper-cases it, the flat grammar shows it as set. -->
    {#if isRecording}
        <div class="rec-label" aria-hidden="true">Rec</div>
    {/if}
</Card>
</div>

<!-- Header block (name/mute + Solo) — a SIBLING of the Card, not a section
     inside it, taking the strip's remaining third. Out here it is outside
     the volume fader: the Card owns "drag anywhere = volume", and while the
     name lived inside it a mute tap that slid 6px silently changed the level
     instead of muting — on the strip's most-used control. Now the fader is
     the Card (Clip + Permute) and the header is plain buttons, the same
     separation ADR-414 made for Solo, applied to the whole band.

     Mute fires at TRUE FINGER-DOWN, exactly like Solo (ADR-427, amended
     2026-09-03 after playing it).

     It used to fire on `click`, and briefly on `pointerup`, so that a
     horizontal pan of the strips row that *started on a name* would scroll
     the row rather than mute the track. That was the only thing the wait
     bought — it was never a confirm gate or a debounce — and it was
     measured on the mock stack at **103ms from touch-down** against Solo's
     0ms, on the single most-used control on the surface. 90ms of that was
     simply waiting for the finger to lift.

     The trade, stated plainly: a row pan can no longer BEGIN on the name
     band. It still begins anywhere on the Card above it — Clip and Permute
     are two thirds of every strip and take `touch-action: pan-x` whenever
     the row can scroll (`faderTouchAction`; with no row to pan they take
     `none`, by this same rule), so the row still pans natively from the
     large part of the strip. What is lost
     is the bottom third, which in the flipped layout is the band nearest
     the hands. That band was already half non-pannable: Solo has sat in it
     with `touch-action: none` since ADR-414.

     Down-toggling with `pan-x` and reverting on cancel was the other way to
     get zero latency, and is the one thing that must NOT be done here: a
     row pan starting on a name would mute and then unmute the track, which
     on a playing track is an audible dropout mid-set. `touch-action: none`
     is what makes the down-fire safe — no pan can start on this node, so
     the browser never claims the gesture and there is nothing to revert.
     That is the same reason Solo could always afford it.

     There is no revert on cancel, and deliberately: mute has no momentary
     behaviour (unlike Solo), so a press that the system interrupts still
     read as a press.

     The rule this leaves for the rest of the surface: **fire at
     finger-down wherever the control sets `touch-action: none` and has no
     drag meaning of its own.** The per-track stop cell and the group fold
     arm keep `pan-x` and therefore keep firing on release — there the wait
     really does buy the pan. The master card keeps firing on release for a
     different reason: it has a volume drag underneath it, and a down-fire
     would select the master on every fader move.

     (The original bug, for the record: `.header-name` computed
     `touch-action: auto` — nothing declared it, and touch-action does not
     inherit, so the `manipulation` on `html, body` never reached it. Inside
     a horizontally-scrolling panel `auto` hands the gesture to the browser,
     which is then free to suppress the click. iOS also synthesizes at most
     one click per gesture, so two names tapped together produced one mute.
     `use:press` writes the touch-action onto the same node it binds the
     handler to, which is why those two cannot drift apart again.) -->
<div class="header-block" class:is-flipped={flipLayout} class:is-selected={trackData.isSelected}>
    <div
        class="header-name"
        class:is-soloed={stripSoloed}
        role="button"
        tabindex="-1"
        aria-label="{trackData.track.mute ? 'Unmute' : 'Mute'} track {trackData.track.name}"
        aria-pressed={trackData.track.mute}
        use:press={mutePress}
    >
        <TrackHeader
            name={trackData.track.name}
            color={trackData.track.color}
            mute={trackData.track.mute}
            isSelected={trackData.isSelected}
            {isPending}
            {pendingName}
            {isMaster}
            trackNumber={trackIndex + 1}
        />
    </div>

    <!-- Solo shares the header third with the name when it is shown: a
         column beside the name rather than a band of its own height, so
         turning solos on never moves Clip and Permute. Narrow strips hide
         it (see the style block). -->
    {#if showSolo}
        <button
            type="button"
            class="solo-button"
            class:is-soloed={isSoloed}
            aria-label="{isSoloed ? 'Unsolo' : 'Solo'} track {trackData.track.name}"
            aria-pressed={isSoloed}
            use:press={soloPress}
        >S</button>
    {/if}
</div>
</div>

<style>
    /* Equal bands inside the Card — Clip / Device / Permute, or Clip /
       Permute with the device band off. `flex: 1 1 0` + `min-height: 0`
       divides the Card evenly regardless of content; the Card's own
       grow + basis (see `cardBands`) is what makes a band inside it
       exactly as tall as the Name block below it, so the whole strip is
       four equal bands (three with INST off). The volume fader spans the
       full Card (gesture on the Card), and the meter visualization fills
       the full height behind these sections. */
    .strip-section {
        flex: 1 1 0;
        min-height: 0;
        position: relative;
        overflow: hidden;
        /* Gestures are owned by the parent Card (events bubble up from here),
           but sections must keep pointer-events:auto so elementFromPoint can
           resolve which [data-section] a tap landed on — it ignores any
           element with pointer-events:none. */
        z-index: 1;
    }

    /* Header fills its half instead of enforcing its own min-height. */
    .header-block :global(.track-name-button) {
        min-height: 0;
        height: 100%;
    }

    /* Clip + Permute clear the left/right edge volume ticks (10px wide). */
    .section-padded {
        padding-left: 14px;
        padding-right: 14px;
    }

    /* At the narrow end the 28px of clearance is nearly half the strip, so
       give the clip and the sequencer back everything that isn't the tick
       itself plus 2px. Only below 100px, so nothing moves in a set that
       fits comfortably. */
    @container (max-width: 100px) {
        .section-padded {
            padding-left: 12px;
            padding-right: 12px;
        }
    }

    /* Lift the card's last band off the strip's bottom edge. Permute is
       that band in every layout — the device band sits between Clip and
       Permute, not after it — and the fold arm is its counterpart on a
       group strip, which shares the class. */
    .section-permute {
        padding-bottom: 8px;
    }

    /* The device band buys back 4px a side off `.section-padded`'s 14px:
       its content is a name, and at ~100px of strip a twelve-track set
       spends every pixel of that on legible characters. 10px is exactly
       the tick's own width, so the well's edge meets the tick instead of
       clearing it — which the clip render and the sequencer wells cannot
       do (they are content under a moving handle; this is a frame beside
       one). */
    .section-device {
        padding-left: 10px;
        padding-right: 10px;
    }

    @container (max-width: 100px) {
        .section-device {
            padding-left: 10px;
            padding-right: 10px;
        }
    }


    .clip-empty {
        width: 100%;
        height: 100%;
    }

    /* Group strip (ADR-410) keeps the regular three-third geometry so it
       lines up with its neighbours: Name / body / fold. The body is the
       vacated Clip third — empty on purpose, it carries the group's select
       tap and leaves the meter wash visible. */
    .group-body {
        flex: 1 1 0;
    }


    /* Fold control occupies the Permute third. A group has no Permute, so
       the whole section is the touch target rather than a corner glyph —
       this is the group strip's primary action, driven by a finger. */
    .fold-section {
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .fold-glyph {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        /* Cap so the chevron stays a glyph on a wide strip instead of
           stretching into a wall, but let it scale down on a narrow one. */
        max-width: 46px;
        max-height: 46px;
        margin-inline: auto;
        opacity: 0.9;
        transition: opacity 90ms var(--ease-precise);
    }

    .fold-glyph svg {
        width: 100%;
        height: 100%;
    }

    /* Folded reads as the louder state — it's hiding tracks, and the
       chevron is the only way to get them back. */
    .fold-glyph.is-folded {
        opacity: 1;
    }

    /* Column wrapper: Card on top (takes the leftover height), standalone
       Solo button below. min-width:0 keeps the column shrinkable inside
       TracksPanelV6's grid, exactly as the Card root was. */
    /* The strip is three equal thirds again, but only two of them are in
       the Card: Clip and Permute (the fader) inside it, the header block
       (mute + Solo) outside as a sibling. One `--strip-gap` for both levels
       so the three read as one regular stack rather than two systems. */
    .strip-col {
        /* The browser rail beside the strips stacks one `.button-group` per
           content row, and the group level with the strips row holds THREE
           buttons at `--spacing-xs`. The strip is also three blocks, so it
           takes the rail's gap verbatim: the seams run straight across the
           screen instead of the strip keeping its own rhythm. */
        --strip-gap: var(--spacing-xs);
        display: flex;
        flex-direction: column;
        height: 100%;
        min-width: 0;
        gap: var(--strip-gap);
        /* Size container for the whole strip. The header block below asks
           this how wide the strip is to decide whether Solo fits beside the
           name at all — the answer has to be the STRIP's width,
           not the header's, or the query would be self-referential (the
           block's own width is what the query changes).

           A strip's width is set by how many tracks are in the set, so this
           is genuinely a container question and not a viewport one: eight
           tracks are wide on any screen, eighteen are narrow on all of
           them. */
        container-type: inline-size;
    }

    /* The fader: the Card, and the gesture (see the markup note). */
    .fader {
        position: relative;
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        cursor: ns-resize;
    }

    /* The hit slop. A press that lands here targets `.fader`, so it runs
       the same machine as a press on the Card: a drag is this strip's
       volume, and a tap goes to the nearest section by `sectionAt`'s
       fallback, exactly as a tap in a seam INSIDE the Card already does.
       It paints nothing.

       Sideways it takes half the gutter on each side — the neighbour
       takes the other half, so the two meet in the middle and never
       overlap. The widths come from `TracksPanelV6`, which owns the
       gutter: it zeroes them at the row's two outer edges, where there is
       no neighbour, and where a box hanging past the last column would
       count as scrollable overflow — the row would scroll by half a
       gutter and `rowScrolls` would flip. Unset (a strip mounted anywhere
       else) they fall back to no slop at all.

       Towards the header block it takes the whole `--strip-gap` seam, up
       to the name's edge and no further: that seam was the other dead
       band, and the header is its own control. Nothing is added on the
       Card's far side, where the neighbour is another section of the
       screen rather than a gap in this one. A group's bracket arm still
       wins where it reaches into a gutter: it is `z-index: 1`, this is
       not. */
    .fader::before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: calc(-1 * var(--fader-slop-left, 0px));
        right: calc(-1 * var(--fader-slop-right, 0px));
    }

    .fader.is-flipped::before {
        bottom: calc(-1 * var(--strip-gap));
    }

    /* UNREACHABLE since 2026-09-26 (flipLayout is pinned on). */
    .fader:not(.is-flipped)::before {
        top: calc(-1 * var(--strip-gap));
    }

    /* One third of the column, whether or not Solo is in it. Mute and Solo
       sit side by side, each the FULL height of the third: both keep the
       dimension a thumb actually misses on. */
    .header-block {
        flex: 1 1 0;
        min-height: 0;
        display: flex;
        flex-direction: row;
        align-items: stretch;
        gap: var(--strip-gap);
    }

    /* Solo takes a fixed column rather than a half: it is one glyph and the
       name is a word, so an even split would waste the strip's spare width
       on the "S". Floored at the 36px the session grid's action strip uses
       for the same reason, capped so a four-track set doesn't hand it a
       90px slab. */
    .header-block .solo-button {
        flex: 0 0 clamp(36px, 28%, 56px);
    }

    /* Narrow strips drop Solo instead of making room for it.

       110px is where the name still has a box worth reading once Solo has
       taken its column: it catches eight tracks (~119px columns with both
       rails showing). Ten or more would leave the name ~50px beside the
       button. The old answer was to stack Solo above the name, which halved
       both into ~33px bands — under the touch floor on the busiest control
       of the strip, to keep a secondary one. The name (mute) keeps the
       whole third; Solo comes back as soon as the strips widen.

       Hidden, not unmounted: a Solo held while the row reflows still
       releases, since `use:press` listens for the release on `window`. */
    @container (max-width: 109.98px) {
        .header-block .solo-button {
            display: none;
        }
    }

    /* An open group's arm grows sideways out of the group strip's foot (its
       head, unflipped), and in that corner Solo — the trailing column — is
       what it would run into. `--arm-clearance` is set by TracksPanelV6 on
       the group's column only (the arm's height plus the gap its members
       keep under it), so Solo ends level with the member strips and clears
       the arm by the same gap they do. The name keeps its full height: it
       is the part of the strip the arm's outline continues from. */
    .header-block.is-flipped .solo-button {
        margin-bottom: var(--arm-clearance, 0px);
    }

    /* UNREACHABLE since 2026-09-26 (flipLayout is pinned on). */
    .header-block:not(.is-flipped) .solo-button {
        margin-top: var(--arm-clearance, 0px);
    }

    /* Unflipped (strips on TOP) the header leads the column; the flipped
       default keeps its source order at the foot, nearest the hands.
       UNREACHABLE since 2026-09-26 (flipLayout is pinned on). */
    .header-block:not(.is-flipped) {
        order: -1;
    }

    /* The name takes whatever width Solo's column leaves; with Solo off (or
       hidden on a narrow strip) it is the only child and takes the whole
       third. The block's footprint is the same either way, which is the
       point: turning solos on must not push Clip and Permute around. */
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
           the right one in both header layouts: when Solo takes a column
           beside it the name box shrinks and the type follows it down,
           with no second rule to keep in sync. */
        container-type: inline-size;
    }

    /* ---- Selection, outside the Card ------------------------------------
       The Card carries the selection edge (`.track-selected`), but the
       Card is only the fader — mute and Solo are siblings below it, and
       until now they wore nothing. A selected strip was therefore outlined
       for two thirds of its height and bare for the last third, which is
       exactly the third the eye goes to (the name is how you identify a
       track). Both blocks take the same ink at the same weight, so the
       column reads as one lit object top to bottom.

       `inset` box-shadow rather than a real border: the name block is a
       solid track-colour slab in the shipped skin and the Solo button is a
       1px outline, so a border swap would move their contents by a pixel
       every time the selection changed. An inset ring is drawn inside the
       existing box and costs no layout. */
    .header-block.is-selected .header-name {
        box-shadow: inset 0 0 0 2px var(--sel-ink);
    }

    .header-block.is-selected .solo-button {
        box-shadow: inset 0 0 0 2px var(--sel-ink);
        border-color: var(--sel-ink);
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

    /* A lit Solo already fills with --act-solo; a selection ring in the
       neutral ink on top of it muddies both signals. Selection is legible
       from the name slab and the Card either side, so let Solo keep saying
       the one thing only it can say. */
    .header-block.is-selected .solo-button.is-soloed {
        box-shadow: none;
        border-color: var(--act-solo);
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

    /* Solo button (ADR-414) — now a column of the header third rather than
       a sibling below the Card. It runs `use:press` and stops the
       pointer event before the Card sees it, so it is still outside the
       gesture machine in every way that matters: no volume drag, no row
       scroll, no section tap. Solo is a global mixer state, so it wears the
       act-solo ink, not the track ink — a soloed strip must read the same
       across every track color.

       `touch-action` is NOT declared here. The action writes it onto this
       node (`none`, so no pan ever starts on the button, which is also what
       keeps pointercancel away in normal use), and a second declaration in
       the stylesheet is exactly the drift that broke mute: CSS and handler
       authored in different places, agreeing until one of them moved. One
       author, one place. */
    .solo-button {
        /* Width comes from `.header-block .solo-button` above; height is
           the whole header third. */
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--line-strong);
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--signal-dim);
        font-size: 0.9375rem;
        font-weight: var(--font-weight-bold);
        line-height: 1;
        -webkit-tap-highlight-color: transparent;
        transition: background-color 90ms var(--ease-precise),
                    border-color 90ms var(--ease-precise),
                    color 90ms var(--ease-precise);
    }

    .solo-button.is-soloed {
        background: var(--act-solo-wash);
        border-color: var(--act-solo);
        color: color-mix(in oklab, var(--act-solo) 70%, white);
    }

    /* Light theme: the white-hot mix lightens the glyph INTO the light
       wash. The lit S must darken on paper, so it rides the full ink
       (light --act-solo is calibrated dark, L 0.55). */
    :global(.light) .solo-button.is-soloed {
        color: var(--act-solo);
    }

    /* Soloed strip: an act-solo wash laid OVER the sections (z 2, under
       the volume ticks, which follow it in the DOM) plus an inset ring.
       Over, not under: the clip, device and permute wells are opaque, so a
       wash beneath them only showed in the seams. Translucent, so the
       content still reads through it, and it composes with selection and
       permute-silenced rather than fighting their backgrounds. */
    .solo-tint {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 2;
        border-radius: inherit;
        background: color-mix(in oklab, var(--act-solo) 32%, transparent);
        box-shadow: inset 0 0 0 2px var(--act-solo);
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

    /* Meter visualization sits behind everything. */
    .meter-bg {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 0;
    }

    /* Volume handle ticks pinned to the strip edges. `--tick-ink` is set
       inline per tick (white-hot track mix, or signal-dim when muted). */
    .vol-tick {
        --handle-h: 3px;
        /* The travel is the whole Card, because the Card is now exactly the
           fader — the name band that used to be subtracted here moved out
           to its own block. One rule in both skins, and no flipped variant:
           there is no longer a control inside the Card for the handle to
           ride up over. */
        --vol-travel: 100%;
        --vol-base: 0px;
        position: absolute;
        height: var(--handle-h);
        width: 10px;
        border-radius: 2px;
        background: var(--tick-ink);
        pointer-events: none;
        z-index: 2;
        transition: bottom 75ms;
    }
    .vol-tick.left {
        left: 0;
    }
    .vol-tick.right {
        right: 0;
    }
    .vol-tick.transition-none {
        transition: none;
    }

    /* Selected track (§5.2): full-outline highlight in the track ink — 2px
       border + 1px ring + soft colored glow over the 18% wash. The glow is what
       separates a selected strip from the muted/idle one; it rides --track-color
       so it never reads white. Corner brackets are now the record-only signal.
       !important kept so selection keeps winning over .glass-card, which
       lives in app.css — cross-file, so source order can't be relied on;
       the flat override of this class (app.css) is !important for the same
       reason. */
    /* ── LOAD STATE ────────────────────────────────────────────────────────
       A preset is in flight toward this strip, or has just arrived. The
       browser closes the instant a pick commits and does not wait for Live, so
       these two states carry the entire report — including, for a folder-hold
       random pick, the only answer to "which track got it".

       Both live at STRIP level rather than on the name cell. The strip is the
       unit the eye actually tracks across a row of eight on an iPad; a mark
       small enough to sit inside the name is small enough to miss. */

    /* WAITING — the card breathes in its own colour. Slow (1.8s) and shallow on
       purpose: this runs for as long as Live takes, and anything faster or
       harder would read as an alarm rather than as work in progress. */
    :global(.is-loading) {
        animation: stripBreathe 1.8s ease-in-out infinite;
    }
    @keyframes stripBreathe {
        0%, 100% {
            box-shadow:
                0 0 0 1px color-mix(in oklab, var(--track-color) 35%, transparent),
                0 0 10px color-mix(in oklab, var(--track-color) 18%, transparent);
        }
        50% {
            box-shadow:
                0 0 0 1px color-mix(in oklab, var(--track-color) 75%, transparent),
                0 0 22px color-mix(in oklab, var(--track-color) 45%, transparent);
        }
    }

    /* The scrim sets the strip's own content back so the ring reads without
       having to shout over clip notes. Thin enough that the track stays
       identifiable — this is a track that is busy, not a track that is gone. */
    .load-veil {
        position: absolute;
        inset: 0;
        z-index: 20;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        background: color-mix(in oklab, var(--background) 62%, transparent);
        border-radius: inherit;
    }

    /* A tapered arc, not a segmented ring: one conic sweep faded to nothing at
       its own tail, masked to a 2px stroke. It carries the track colour, so
       eight simultaneous loads would still be eight distinguishable strips. */
    .load-spinner {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background: conic-gradient(
            from 0turn,
            transparent 0deg,
            color-mix(in oklab, var(--track-color) 25%, transparent) 120deg,
            var(--track-color) 330deg,
            transparent 360deg
        );
        mask: radial-gradient(
            farthest-side,
            transparent calc(100% - 2.5px),
            #000 calc(100% - 2.5px)
        );
        animation: stripSpin 1.1s linear infinite;
    }
    @keyframes stripSpin {
        to { transform: rotate(1turn); }
    }

    /* ARRIVED — one flare that decays and settles, the resolution of the
       breathing above. Finite by design: it reports an event, it is not a
       status light. `--landing-pulse-ms` is bound inline from the store's own
       constant so the fade cannot outlive the class that carries it. */
    :global(.is-landed) {
        animation: stripLanded var(--landing-pulse-ms, 1200ms) ease-out forwards;
    }
    @keyframes stripLanded {
        from {
            box-shadow:
                0 0 0 2px var(--track-color),
                0 0 30px color-mix(in oklab, var(--track-color) 70%, transparent);
        }
        to {
            box-shadow:
                0 0 0 0 transparent,
                0 0 0 transparent;
        }
    }

    /* Reduced motion keeps the mark and drops the ramp — the same bargain the
       browser's charge ring and its loading bar strike. The card holds a steady
       lit outline instead of breathing, and the ring stops turning: still
       clearly "busy", with nothing in motion. */
    @media (prefers-reduced-motion: reduce) {
        :global(.is-loading) {
            animation: none;
            box-shadow:
                0 0 0 1px color-mix(in oklab, var(--track-color) 70%, transparent),
                0 0 16px color-mix(in oklab, var(--track-color) 35%, transparent);
        }
        :global(.is-landed) { animation: none; }
        .load-spinner { animation: none; }
    }

    :global(.track-selected) {
        border-width: 2px !important;
        border-color: var(--track-color) !important;
        background: color-mix(in oklab, var(--track-color) 18%, var(--card)) !important;
        box-shadow: 0 0 0 1px var(--track-color),
                    0 0 12px color-mix(in oklab, var(--track-color) 50%, transparent) !important;
        transition: background-color 75ms var(--ease-precise),
                    border-color 75ms var(--ease-precise),
                    box-shadow 75ms var(--ease-precise);
    }

    /* A track pending in the held Group gesture: `--act-group` green,
       the Group button's own ink, deliberately distinct from `.track-selected`'s
       track-colored ring — this is "will be grouped", not "this is the
       track you're looking at", and the two can be true at once (the anchor
       is usually both). No transition: taps should feel immediate, matching
       Live's own real-time selection this mirrors. */
    :global(.group-tapped) {
        border-width: 2px !important;
        border-color: var(--act-group) !important;
        box-shadow: 0 0 0 1px var(--act-group),
                    0 0 10px color-mix(in oklab, var(--act-group) 50%, transparent) !important;
    }

    /* And a green wash, laid over the sections like the solo tint, so a
       gathered strip reads from across the row and not only by its ring.
       After .solo-tint in the DOM: grouping is the gesture in progress. */
    .group-tint {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 2;
        border-radius: inherit;
        background: var(--act-group-wash);
    }

    /* Light theme: the same recipe reads much weaker on paper than on
       near-black — a soft colored glow barely blooms against white, and
       the 18%-vs-12% wash delta over --track-color (already darkened into
       the light ink envelope, so it's closer to the surrounding wash to
       begin with) isn't enough contrast to read as "selected" rather than
       "this track's own color". Darken the ring instead of just glowing
       it, and widen the wash gap so the fill is clearly heavier too.
       GRATICULE only — `:not([data-grammar="flat"])` on the root keeps this
       off the hybrid/flat skin, which has its own light-selection recipe
       in app.css (`--flat-selection`) at equal specificity; without the
       exclusion, whichever rule lands later in the bundle wins the tie. */
    :global(html.light:not([data-grammar='flat']) .track-selected) {
        border-width: 3px !important;
        border-color: color-mix(in oklab, var(--track-color) 80%, black) !important;
        background: color-mix(in oklab, var(--track-color) 30%, var(--card)) !important;
        box-shadow: 0 0 0 1px color-mix(in oklab, var(--track-color) 80%, black),
                    0 2px 8px color-mix(in oklab, var(--track-color) 40%, transparent) !important;
    }

    /* Permute-silenced (§4.4): the strip visibly drops out on the muted beat —
       dashed signal-dim identity, dimmed meter region. Beat-rate class on the
       cold Card; settles static. Whitelist props only; placed after
       .track-selected so a silenced selected strip still reads as dropped-out. */
    :global(.permute-silenced) {
        border-style: dashed !important;
        border-color: color-mix(in oklab, var(--signal-dim) 45%, transparent) !important;
        background: color-mix(in oklab, var(--signal-dim) 10%, var(--card)) !important;
        transition: border-color 90ms var(--ease-precise),
                    background-color 90ms var(--ease-precise);
    }
    :global(.permute-silenced) .meter-bg {
        opacity: 0.3;
        transition: opacity 90ms var(--ease-precise);
    }

    /* ---- Flat grammar: flat mixer strip. Selection is the panel body
       lightening (handled in app.css .track-selected override); the
       fader handle is Live's grey ControlFillHandle; Solo lit = solid
       ChosenPreListen blue with dark glyph; no tracked micro-labels. */
    :global([data-grammar="flat"]) .vol-tick {
        background: var(--flat-handle);
        width: 14px;
        --handle-h: 4px; /* height AND the inline inset range read this */
        border-radius: 0;
    }
    /* !important kept: it overrides the Graticule .permute-silenced rule
       above, which is itself !important (see the note there). */
    :global([data-grammar="flat"] .permute-silenced) {
        border-style: solid !important;
        border-color: var(--line-strong) !important;
        background: color-mix(in srgb, var(--card) 70%, var(--background)) !important;
    }
    :global([data-grammar="flat"]) .solo-button {
        border-radius: 2px;
        background: var(--surface-well);
        border-color: var(--line-strong);
        color: var(--foreground);
        font-weight: var(--font-weight-medium);
    }
    :global([data-grammar="flat"]) .solo-button.is-soloed {
        background: var(--act-solo);
        border-color: var(--line-strong);
        color: var(--flat-solo-fg);
    }
    :global([data-grammar="flat"]) .rec-label {
        text-transform: none;
        letter-spacing: 0;
        font-weight: 500;
    }

    /* REC micro-label (HUD voice, §4.3). Upper-cased here from the
       mixed-case literal, as every Graticule micro-label is. */
    .rec-label {
        position: absolute;
        top: 4px;
        left: 6px;
        z-index: 3;
        pointer-events: none;
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.10em;
        text-transform: uppercase;
        color: var(--act-rec);
    }
</style>
