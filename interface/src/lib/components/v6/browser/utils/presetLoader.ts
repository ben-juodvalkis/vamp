/**
 * Preset loading utilities — thin wrapper around the atomic
 * /looping/v3/track/prepare_for_preset flow.
 *
 * The browser opens a track via ``TrackPrepManager.prepareTrack``,
 * which fires an empty-preset prepare so the user sees a fresh track
 * up-front. Each tap then routes through ``loadPresetWithVariant`` →
 * ``prepareForPreset(type, presetPath)`` for the actual atomic
 * create-or-reuse + load.
 *
 * Permute placement is owned by the Python ``TrackPrepareComponent``:
 * every successful prep ensures Permute on the resolved track (skipped
 * idempotently when already present). The UI no longer fires a
 * follow-up ``/looping/v3/device/load`` after the prepare ack.
 */

import { placeArgs } from '$lib/services/placesLive';
import {
    prepareForPreset,
    type TrackType,
    type PrepareResult,
} from '$lib/services/trackPreparation';
import { loadFileIntoSlot } from '$lib/services/clipCommands';
import { selectTrack, setTrackName } from '$lib/services/trackCommands';
import { loadCaptureIntoSimpler } from '$lib/services/clipOperations';
import {
    applyAutoColorOnPrepareAck,
    applyAutoRoleOnPrepareAck
} from '$lib/services/trackColoring';
import { presetLandingStore } from '$lib/stores/v6/presetLandingStore.svelte';
import type { Preset } from '$lib/services/adapters';
import { recentInstrumentsStore } from '$lib/stores/v6/recentInstrumentsStore.svelte';
import { browserNavigationStore } from '$lib/stores/v6/browserNavigationStore.svelte';
import { instrumentDisplayCoordinator } from '$lib/services/instrumentDisplayCoordinator.svelte';
import { logger } from '$lib/utils/logger';

export type PrepStatus = 'idle' | 'preparing' | 'ready';

const AUDIO_FILE_EXTENSIONS = [
    '.wav', '.aif', '.aiff', '.mp3', '.flac',
    '.ogg', '.m4a', '.wma', '.aac',
    // .alc = Ableton Live Clip (gzipped XML wrapping an audio ref). Routed
    // as audio so the Python surface can resolve it to the underlying
    // sample — for both the clip load and the Simpler load.
    '.alc',
] as const;

function isAudioFile(path: string): boolean {
    const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
    return AUDIO_FILE_EXTENSIONS.includes(ext as any);
}

/**
 * Track preparation state manager.
 *
 * Front-loads an empty-preset prepare when the browser opens so the
 * UI has visual feedback (a fresh track) before the user picks a
 * preset. The actual instrument load happens later via
 * ``loadPresetWithVariant``, which calls the atomic endpoint a second
 * time with the chosen preset path — Python reuses the empty track
 * the open-up-front prep created, or creates a fresh one if the user
 * dirtied it in between.
 */
export class TrackPrepManager {
    private prepStatus: PrepStatus = 'idle';
    private prepPromise: Promise<PrepareResult | undefined> | null = null;
    private trackPreparedForCurrentVendor = false;
    // Set by skipPrepAndMarkReady() for vendors that deliberately do NOT
    // pre-prep (Audio vendor, replace mode). Unlike
    // trackPreparedForCurrentVendor, this is NOT cleared by markAsUsed() —
    // only by reset() on a fresh vendor selection. Without it, the 2nd+
    // load in a session would re-enable up-front prep and orphan a track
    // (the .alc load makes its own track via the Browser).
    private prepSkipped = false;
    private preparedTrackIndex: number | undefined = undefined;
    private preparedTrackType: TrackType | undefined = undefined;

    getStatus(): PrepStatus {
        return this.prepStatus;
    }

    isPrepared(): boolean {
        return this.trackPreparedForCurrentVendor;
    }

    /**
     * Track index resolved by the most recent successful prep.
     * Consumed by ``loadPresetWithVariant`` so the subsequent load
     * targets the exact track Python prepared.
     */
    getTrackIndex(): number | undefined {
        return this.preparedTrackIndex;
    }

    /** Track type the manager is currently prepared for (if any). */
    getTrackType(): TrackType | undefined {
        return this.preparedTrackType;
    }

    async prepareTrack(trackType: 'instrument' | 'audio' | 'drums'): Promise<number | undefined> {
        this.prepStatus = 'preparing';
        this.trackPreparedForCurrentVendor = false;
        this.preparedTrackIndex = undefined;
        this.preparedTrackType = undefined;

        // Map legacy track types to simplified midi/audio.
        const simplifiedType: TrackType = trackType === 'audio' ? 'audio' : 'midi';

        this.prepPromise = prepareForPreset(simplifiedType, '')
            .then((result) => {
                this.prepStatus = 'ready';
                this.trackPreparedForCurrentVendor = true;
                this.preparedTrackIndex = result.trackIndex;
                this.preparedTrackType = simplifiedType;
                logger.debug('Track ready:', {
                    component: 'presetLoader',
                    trackType,
                    trackIndex: result.trackIndex,
                    wasCreated: result.wasCreated,
                });
                return result;
            })
            .catch((err) => {
                logger.error('Track preparation failed', { component: 'presetLoader', err });
                // Unlatch. Without this the manager stays in 'preparing' with a
                // settled promise still parked in prepPromise, so
                // hasPendingOrReadyPrep() reads true for the life of the page
                // and ensureTrackPrepared() never tries again — every later
                // preset in the session loads with no landing-pad track.
                this.prepStatus = 'idle';
                this.prepPromise = null;
                return undefined;
            });

        const result = await this.prepPromise;
        return result?.trackIndex;
    }

    /**
     * True when a prep is already in flight or done for the current
     * vendor. Unlike ``isPrepared()`` (which only flips true once the
     * up-front prep *resolves*), this covers the in-flight window so a
     * fast clip-tap doesn't start a second, racing prepare.
     */
    hasPendingOrReadyPrep(): boolean {
        return (
            this.prepPromise !== null ||
            this.trackPreparedForCurrentVendor ||
            this.prepSkipped
        );
    }

    /**
     * Await the in-flight up-front prep (if any) and return its track
     * index. Returns ``undefined`` when no prep is pending.
     */
    async awaitPrep(): Promise<number | undefined> {
        if (!this.prepPromise) return this.preparedTrackIndex;
        const result = await this.prepPromise;
        return result?.trackIndex;
    }

    markAsUsed() {
        this.trackPreparedForCurrentVendor = false;
    }

    reset() {
        this.prepStatus = 'idle';
        this.prepPromise = null;
        this.trackPreparedForCurrentVendor = false;
        this.prepSkipped = false;
        this.preparedTrackIndex = undefined;
        this.preparedTrackType = undefined;
    }

    skipPrepAndMarkReady() {
        this.prepStatus = 'ready';
        // Mark this vendor as "prep skipped" so ensureTrackPrepared()/
        // hasPendingOrReadyPrep() never fire an up-front prep. Used by
        // replace-instrument mode and the Audio vendor (which preps on
        // demand at load time). This flag survives markAsUsed() — only
        // reset() (a fresh vendor selection) clears it — so the 2nd+ load
        // in a session doesn't re-enable pre-prep and orphan a track.
        // getTrackIndex() stays undefined; the load path preps and reads
        // the acked track directly.
        this.prepSkipped = true;
        logger.debug('Skipping track prep, marking ready', { component: 'presetLoader' });
    }
}

/**
 * Commit the visible outcome of a load onto the track that received it: the
 * auto-color rule, plus the landing pulse the strip wears while its new name
 * arrives. `markLanded` also resolves whatever pending state the browser armed
 * at commit time — including onto a DIFFERENT track than the one marked, when
 * Python's reuse decision sends the load somewhere other than the landing pad.
 *
 * These two always fire together and always at the same instant — the prepare
 * ack — so they share one call. The pulse is the load's only confirmation now
 * that the browser closes optimistically instead of holding itself open until
 * Live answers: it is what tells you a folder-hold's random pick actually
 * landed, and where. Colour can legitimately no-op (no rule matched the
 * preset's category); the pulse never does, so it cannot be folded into
 * `applyAutoColorOnPrepareAck` itself.
 */
function landPresetOnTrack(opts: {
    trackPath: string;
    presetPath: string;
    /** A sample loaded from the browser: the audio color, no role. */
    audio?: boolean;
    /** A browser Place's role (`Preset.role`) — coloring's answer outright. */
    placeRole?: string | null;
}): void {
    applyAutoColorOnPrepareAck(opts);
    // Protocol 3.7.0 — record the rail alongside the colour. Both are
    // derived from the same load at the same instant; the difference is
    // that the role is *persisted* by Live, so it does not have to be
    // re-derived next session.
    applyAutoRoleOnPrepareAck(opts);
    presetLandingStore.markLanded(opts.trackPath);
}

/**
 * Point the central display at the instrument this load is about to produce.
 *
 * Called BEFORE the wire round trip, not after: the display switches off the
 * device-list update that carries the new instrument, and that update can
 * arrive before (or long after) the load promise settles. Arming up front lets
 * the coordinator take whichever update carries it.
 *
 * Only for loads that land an instrument on a MIDI track. A sample loaded as an
 * audio clip has no instrument to show — clip view is already the right answer
 * there, and the coordinator retires a stray request when it sees an audio
 * track.
 */
function showInstrumentWhenItLands(): void {
    instrumentDisplayCoordinator.requestInstrumentView();
}

/**
 * Load an audio file onto a fresh audio track as a clip.
 *
 * Two wires depending on the file: an ``.alc`` (Ableton Live Clip, carrying
 * warp/loop/gain) routes through the atomic ``prepare_for_preset`` endpoint so
 * Live's Browser creates the track and loads the clip with metadata preserved;
 * a raw sample preps an empty audio track then loads into its first slot via
 * ``clip/load_file`` (``create_audio_clip``). Shared by the browser's clip
 * pick (``audio``: the audio color, no role) and the Recent replay of a
 * clip-loaded sample (colored from its path, as a Recent sample always was).
 */
async function loadAudioClipFromPath(
    finalPath: string,
    preset: Preset,
    audio: boolean
): Promise<void> {
    if (finalPath.toLowerCase().endsWith('.alc')) {
        const result = await prepareForPreset('audio', finalPath, '', ...placeArgs(preset));
        setTrackName(result.trackPath, preset.name);
        landPresetOnTrack({
            trackPath: result.trackPath,
            presetPath: preset.path,
            audio,
        });
    } else {
        const prep = await prepareForPreset('audio', '');
        loadFileIntoSlot(prep.trackPath, '', finalPath);
        setTrackName(prep.trackPath, preset.name);
        landPresetOnTrack({
            trackPath: prep.trackPath,
            presetPath: preset.path,
            audio,
        });
    }
    browserNavigationStore.loadedPresetPath = preset.path;
}

/**
 * Load a preset. (Name is historical — there is no variant selection any
 * more: catalog grouping is off, so a tile *is* a file, and the loader sends
 * that file's path unchanged. The folder-hold random pick is separate and
 * lives in the adapters' `getRandomPreset`.)
 *
 * Routes through the atomic ``prepare_for_preset`` endpoint for
 * instrument presets so the create-or-reuse decision stays server-
 * authoritative. Audio files travel a different wire
 * (``clip/load_file``) since the Browser tree doesn't expose raw
 * audio leaves.
 *
 * ``trackIndex`` is a hint indicating where the up-front prep
 * landed; if Python's reuse decision picks a different track (e.g.
 * the hinted track grew clips since), the ack carries the new index
 * and we follow it for the rename + Permute follow-up.
 *
 * ``replaceTrackPath`` (replace-instrument mode) pins the load to an
 * exact track, bypassing Python's reuse-vs-create decision. Live
 * swaps the instrument in the track's instrument slot in place,
 * leaving clips / Permute / FX untouched.
 */
export async function loadPresetWithVariant(
    preset: Preset,
    vendorId?: string,
    trackIndex?: number,
    replaceTrackPath?: string,
    loadTarget: 'clip' | 'simpler' = 'clip'
): Promise<void> {
    // Sample-backed Recent entries re-load against the stored absolute
    // filesystem path (no prepare_for_preset — there's no preset on disk,
    // only a file). `loadTarget` records how the sample was originally
    // loaded so we replay it identically; legacy capture/convert entries
    // carry none and default to Simpler.
    if (preset.kind === 'sample' && preset.filePath) {
        const target = preset.loadTarget ?? 'simpler';
        if (target === 'clip') {
            // Replay as an audio clip. No explicit Recent re-add: the entry
            // is already present (dedup would just bump it).
            await loadAudioClipFromPath(preset.filePath, preset, false);
        } else {
            // The loader handles its own MIDI track prep + Empty-Simpler swap
            // and bumps move-to-front via armAutoStartMarker's onResolved
            // callback (same hook the original capture used).
            showInstrumentWhenItLands();
            const prep = await loadCaptureIntoSimpler(preset.filePath);
            if (prep) {
                // Color from the sample's own folder (a Recent sample carries
                // its absolute path, and a Place's is `<Place>/Samples/…`),
                // not the Recent button's purple — the sample is still
                // drum/bass/key/etc.
                landPresetOnTrack({
                    trackPath: prep.trackPath,
                    presetPath: preset.path,
                });
            }
            browserNavigationStore.loadedPresetPath = preset.path;
        }
        return;
    }

    // The tile's own file, always. Variant randomization is gone (catalog
    // grouping is off — one tile per file); a legacy grouped catalog loads its
    // first variant, which is what `fullPath` already points at.
    const finalPath = preset.fullPath;

    const audio = isAudioFile(finalPath);
    logger.debug('loadPresetWithVariant', {
        component: 'presetLoader', finalPath, trackIndex, audio,
    });

    if (audio) {
        // A sample or clip from a Place (which holds presets AND samples).
        // It is colored as audio with no role: a Place's role says what a
        // preset in it is, and a sample's own folder is its Place's
        // `Samples`, which came from the old audio library.
        //
        // Audio mode does NOT pre-prep a track (see selectCategory) — every
        // path creates its track at load time, so an .alc (whose Browser
        // load makes its own track) never leaves an orphan empty track
        // behind, and the Simpler path preps its own MIDI track.
        // `loadTarget` (the header's Simpler | Audio arm) decides what the
        // sample becomes.
        if (loadTarget === 'simpler') {
            // Drop the sample onto a fresh Simpler on a fresh MIDI track. An
            // .alc is resolved to its underlying sample server-side
            // (SimplerLoadComponent → alc_resolver). loadCaptureIntoSimpler
            // auto-adds to Recent (source 'capture').
            showInstrumentWhenItLands();
            const prep = await loadCaptureIntoSimpler(finalPath);
            if (prep) {
                landPresetOnTrack({
                    trackPath: prep.trackPath,
                    presetPath: preset.path,
                    audio: true,
                });
            }
            browserNavigationStore.loadedPresetPath = preset.path;
            return;
        }

        // loadTarget === 'clip': land the sample/clip on an audio track, then
        // remember it in Recent so it can be replayed the same way.
        await loadAudioClipFromPath(finalPath, preset, true);
        recentInstrumentsStore.addSample(preset.name, finalPath, 'browser', 'clip');
        return;
    }

    showInstrumentWhenItLands();

    // Instrument preset — route through the atomic endpoint. Python's
    // TrackPrepareComponent appends Permute as part of the prep, so no
    // UI-side device/load follow-up is needed here. In replace mode,
    // `replaceTrackPath` forces the load onto that exact track (swap in
    // place); otherwise Python decides reuse-vs-create.
    const result = await prepareForPreset('midi', finalPath, replaceTrackPath, ...placeArgs(preset));

    // Rename the track to the preset name.
    setTrackName(result.trackPath, preset.name);
    // Auto-color and role. A preset from a Place — or a Recent entry whose
    // file lies in one, or the swap pill's step through a Place's folder —
    // carries its Place's role (`Preset.role`), and that is the answer
    // outright. Only a Recent entry outside every Place has none, and is
    // read from its path.
    landPresetOnTrack({
        trackPath: result.trackPath,
        presetPath: preset.path,
        placeRole: preset.role,
    });
    browserNavigationStore.loadedPresetPath = preset.path;

    // Track in recent instruments (a load from a Place; Recent re-loads its own).
    if (vendorId && vendorId !== 'recent-instruments') {
        recentInstrumentsStore.addInstrument(preset, vendorId);
        logger.debug('Added to recent instruments', { component: 'presetLoader' });
    }
}

/**
 * Replace audio clip at specific location.
 */
export async function replaceAudioClip(
    preset: Preset,
    trackIndex: number,
    clipIndex: number
): Promise<void> {
    logger.debug('Replacing audio clip at:', { component: 'presetLoader', trackIndex, clipIndex });

    // Select target track (v3 path-addressed)
    const trackPath = `tracks/${trackIndex}`;
    await selectTrack(trackPath);

    const finalPath = preset.fullPath;

    // Load audio file into the target slot. ClipsComponent.handle_load_file
    // handles replace semantics (deletes any existing clip in the slot)
    // and calls ClipSlot.create_audio_clip, which accepts arbitrary
    // absolute paths — unlike /looping/v3/device/load's Browser walk,
    // which cannot resolve raw audio leaves under user_library.
    const slotPath = `${trackPath}/slots/${clipIndex}`;
    await loadFileIntoSlot(trackPath, slotPath, finalPath);

    logger.debug('Audio clip replaced', { component: 'presetLoader' });
}
