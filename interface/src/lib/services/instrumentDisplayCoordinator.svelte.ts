/**
 * Instrument Display Coordinator
 * Coordinates between device observer, instrument detection, and central display.
 * Handles automatic view switching when the selected track's instrument changes.
 */

import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { instrumentService, type InstrumentInfo } from './instrumentService';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import { currentInstrumentStore } from '$lib/stores/v6/currentInstrumentStore.svelte';
import { captureStore } from '$lib/stores/v6/captureStore.svelte';
// import { formatPresetPath } from '$lib/utils/presetPathFormatter';
import { browser } from '$app/environment';
import { logger } from '$lib/utils/logger';

/**
 * How long a pending "show the instrument when it lands" request stays armed.
 * A preset load arms it before the wire round trip and it is consumed by the
 * device-list update that carries the new instrument. The window only has to
 * outlast a load (prepare_for_preset times out at 8s) plus the device settle;
 * past that the request is stale and must not hijack an unrelated selection.
 */
const INSTRUMENT_VIEW_REQUEST_WINDOW_MS = 15000;

class InstrumentDisplayCoordinator {
  private currentInstrument: InstrumentInfo | null = null;
  // Disposer returned by $effect.root(). Holding it is the ONLY way to stop
  // the effect: an effect root outlives every component, so dropping the
  // return value leaves the tree permanently subscribed to
  // selectedTrackStore and destroy() tears down nothing.
  private disposeEffects: (() => void) | null = null;
  private lastProcessedTrackIndex: number | null = null;
  private skipNextAutoViewSwitch: boolean = false; // One-shot flag to respect explicit view choices
  // Timestamp of a pending requestInstrumentView() (null = none armed).
  private instrumentViewRequestedAt: number | null = null;

  /**
   * Mark that the user explicitly chose a view (e.g., tapping mini sequencer)
   * The coordinator will skip auto view switching for the next device-list update only.
   */
  suppressAutoViewSwitch() {
    this.skipNextAutoViewSwitch = true;
    // Newest gesture wins: an explicit view choice retires any instrument-view
    // request armed by an earlier load.
    this.instrumentViewRequestedAt = null;
    logger.debug('View auto-switch suppressed for next device-list update', { component: 'instrumentDisplayCoordinator' });
  }

  /**
   * Ask for the instrument view as soon as an instrument shows up on the
   * selected track. Armed by the browser BEFORE the load goes out, and
   * consumed by the device-list update that carries the new instrument.
   *
   * The plain auto-switch can't cover a load on its own. It only switches on a
   * *new* track, and a load lands its instrument in two steps: the track
   * appears (or is reused) with no instrument yet, then the device list
   * arrives. By the second update the track is no longer new, so a load that
   * reused the selected track — replace mode, or Python reusing an empty track
   * you were already on — left you sitting on the clip/system/device view you
   * came from. This request bridges the two updates.
   */
  requestInstrumentView() {
    this.instrumentViewRequestedAt = Date.now();
    // Newest gesture wins, mirroring suppressAutoViewSwitch: loading an
    // instrument is an explicit ask to look at it.
    this.skipNextAutoViewSwitch = false;
    logger.debug('Instrument view requested for the next device-list update', { component: 'instrumentDisplayCoordinator' });
  }

  /**
   * Peek at the pending request, expiring it if it went stale. Deliberately
   * not consuming: the empty-device update that precedes the instrument must
   * leave the request armed for the update that actually carries it.
   */
  private hasPendingInstrumentViewRequest(): boolean {
    if (this.instrumentViewRequestedAt === null) return false;
    if (Date.now() - this.instrumentViewRequestedAt > INSTRUMENT_VIEW_REQUEST_WINDOW_MS) {
      logger.debug('Instrument view request expired', { component: 'instrumentDisplayCoordinator' });
      this.instrumentViewRequestedAt = null;
      return false;
    }
    return true;
  }

  /**
   * Initialize the coordinator
   * Sets up subscriptions to device and track type changes
   */
  initialize() {
    logger.debug('Initializing...', { component: 'instrumentDisplayCoordinator' });

    if (!browser) return;

    // Idempotent: a second initialize() without a destroy() would stand up a
    // second effect root, and every track change would then be handled twice.
    if (this.disposeEffects) {
      logger.debug('Already initialized, ignoring', { component: 'instrumentDisplayCoordinator' });
      return;
    }

    // Watch selectedTrackStore for changes using $effect
    // Now watches trackType along with devices to make view decisions atomically
    //
    // PR-4a-6b3 (2026-04-16): reads `devicesByPath` (v3 DeviceRecord[]
    // derived from the v3 normalized store). Array order matches LOM
    // chain order, so instrument detection returns the chain-first
    // instrument.
    this.disposeEffects = $effect.root(() => {
      $effect(() => {
        const devices = selectedTrackStore.devicesByPath;
        const trackIndex = selectedTrackStore.trackIndex;
        const trackType = selectedTrackStore.trackType;
        const isCapturing = captureStore.isActive;

        logger.debug('Track state received:', { component: 'instrumentDisplayCoordinator', trackIndex, trackType, deviceCount: devices.length, isCapturing });
        this.handleTrackChange(trackIndex, trackType, devices, isCapturing);
      });
    });

    logger.debug('Initialized successfully', { component: 'instrumentDisplayCoordinator' });
  }

  /**
   * Handle track changes with track type awareness
   * Uses track type to determine appropriate view (audio → clip, midi → instrument/clip)
   */
  private async handleTrackChange(
    trackIndex: number,
    trackType: 'midi' | 'audio' | null,
    devices: import('$lib/stores/v6/selectedTrackStore.svelte').DeviceRecord[],
    isCapturing: boolean = false
  ) {
    const isNewTrack = trackIndex !== this.lastProcessedTrackIndex;
    this.lastProcessedTrackIndex = trackIndex;

    // While a capture is in progress, hold the current view steady. The
    // track selection will change as the new MIDI track and Simpler are
    // created underneath us, but the user is mid-recording and should
    // stay on whatever view they were on. When capture goes idle this
    // $effect re-runs (captureStore.isActive is reactive) and the normal
    // view-switch logic runs with the final settled track state.
    if (isCapturing) {
      logger.debug('Capture in progress - suppressing auto view switch', { component: 'instrumentDisplayCoordinator', trackIndex });
      return;
    }

    // Check if we should respect an explicit user view choice (one-shot flag)
    const isViewOverrideActive = this.skipNextAutoViewSwitch;
    if (isViewOverrideActive) {
      this.skipNextAutoViewSwitch = false; // Consume the flag
    }

    // Armed by a preset load (see requestInstrumentView). Peeked, not consumed:
    // the empty-device update that precedes the instrument has to leave it
    // standing for the update that actually carries the instrument.
    const instrumentViewRequested = this.hasPendingInstrumentViewRequest();

    logger.debug('Processing track change', {
      component: 'instrumentDisplayCoordinator',
      trackIndex,
      trackType,
      isNewTrack,
      isViewOverrideActive,
      instrumentViewRequested,
      deviceCount: devices.length
    });

    // If user explicitly chose a view recently, don't auto-switch
    // (e.g., tapped mini sequencer to show clip view)
    if (isViewOverrideActive) {
      logger.debug('View override active - skipping auto view switch', { component: 'instrumentDisplayCoordinator' });
      // Still update instrument detection for later use
      const instrument = instrumentService.findInstrumentInDeviceList(devices);
      if (instrument) {
        this.currentInstrument = instrument;
        const instrumentType = await instrumentService.identifyInstrumentTypeAsync(instrument, trackIndex);
        currentInstrumentStore.setInstrument(instrument, instrumentType);
      } else {
        this.currentInstrument = null;
        currentInstrumentStore.clear();
      }
      return;
    }

    // MASTER TRACK: Don't change view (session store already showed system view)
    if (trackIndex === -1) {
      logger.debug('Master track - leaving view unchanged', { component: 'instrumentDisplayCoordinator' });
      // Nothing here can satisfy a pending request; drop it rather than let it
      // fire on some later, unrelated selection.
      this.instrumentViewRequestedAt = null;
      this.currentInstrument = null;
      currentInstrumentStore.clear();
      return;
    }

    // AUDIO TRACK: Always show clip view
    if (trackType === 'audio') {
      logger.debug('Audio track detected - showing clip view', { component: 'instrumentDisplayCoordinator' });
      // An audio track never carries an instrument — clip view is the right
      // answer even if a request is armed, so retire it.
      this.instrumentViewRequestedAt = null;
      this.currentInstrument = null;
      currentInstrumentStore.clear();
      if (isNewTrack) {
        centralDisplayStore.setView('clip', undefined, null, 'Clip');
      }
      return;
    }

    // MIDI TRACK (or unknown): Show instrument if found, otherwise clip view
    const instrument = instrumentService.findInstrumentInDeviceList(devices);

    if (instrument) {
      logger.debug('Found instrument:', { component: 'instrumentDisplayCoordinator', instrument });
      this.currentInstrument = instrument;

      // Identify instrument type (async for nested detection)
      const instrumentType = await instrumentService.identifyInstrumentTypeAsync(instrument, trackIndex);
      logger.debug('Identified as:', { component: 'instrumentDisplayCoordinator', instrumentType });

      // Update reactive store for app-wide access
      currentInstrumentStore.setInstrument(instrument, instrumentType);

      // Show instrument view for new track, for a load that asked for it, or
      // update if already showing instrument. The request is consumed here —
      // the instrument it was waiting for has arrived.
      const currentView = centralDisplayStore.view;
      this.instrumentViewRequestedAt = null;
      if (isNewTrack || instrumentViewRequested || currentView.type === 'instrument') {
        logger.debug('Showing instrument view', { component: 'instrumentDisplayCoordinator', isNewTrack, instrumentViewRequested });
        centralDisplayStore.setView('instrument', instrumentType, { instrument });
      } else {
        logger.debug(`Not updating display (current view type: ${currentView.type})`, { component: 'instrumentDisplayCoordinator' });
      }
    } else {
      logger.debug('No instrument found', { component: 'instrumentDisplayCoordinator' });
      this.currentInstrument = null;
      currentInstrumentStore.clear();

      // A load is in flight and its instrument hasn't arrived yet: hold the
      // current view rather than flashing clip view on the way through. The
      // request stays armed for the update that carries the instrument.
      if (instrumentViewRequested) {
        logger.debug('Instrument view requested, awaiting the device list', { component: 'instrumentDisplayCoordinator', trackIndex });
        return;
      }

      // For new MIDI track without instrument, show clip view
      if (isNewTrack) {
        logger.debug('MIDI track without instrument - showing clip view', { component: 'instrumentDisplayCoordinator' });
        centralDisplayStore.setView('clip', undefined, null, 'Clip');
      } else {
        // If already on instrument view, show "ready" state
        const currentView = centralDisplayStore.view;
        if (currentView.type === 'instrument') {
          logger.debug('Clearing instrument data (keeping view type)', { component: 'instrumentDisplayCoordinator' });
          centralDisplayStore.setView('instrument', currentView.subType || 'drumrack', { instrument: null });
        }
      }
    }
  }

  /**
   * Get the current detected instrument
   */
  getCurrentInstrument(): InstrumentInfo | null {
    return this.currentInstrument;
  }

  /**
   * Show the current instrument in the central display
   * This is the main public API for "show me the current instrument"
   * Used when user re-taps the selected track or after loading a preset
   */
  async showCurrentInstrument() {
    logger.debug('showCurrentInstrument() called', { component: 'instrumentDisplayCoordinator' });

    const trackIndex = selectedTrackStore.trackIndex;
    const trackType = selectedTrackStore.trackType;

    // Audio tracks always show clip view
    if (trackType === 'audio') {
      logger.debug('Audio track - showing clip view', { component: 'instrumentDisplayCoordinator' });
      centralDisplayStore.setView('clip', undefined, null, 'Clip');
      return;
    }

    if (this.currentInstrument) {
      logger.debug('Showing cached instrument:', { component: 'instrumentDisplayCoordinator', instrument: this.currentInstrument });

      // Identify type and update view (async for nested detection)
      const instrumentType = await instrumentService.identifyInstrumentTypeAsync(this.currentInstrument, trackIndex);
      centralDisplayStore.setView('instrument', instrumentType, { instrument: this.currentInstrument });
    } else {
      logger.debug('No cached instrument, checking device list...', { component: 'instrumentDisplayCoordinator' });

      // Check current device list (v3 path-keyed view; see initialize() comment)
      const devices = selectedTrackStore.devicesByPath;
      const instrument = instrumentService.findInstrumentInDeviceList(devices);

      if (instrument) {
        logger.debug('Found instrument in device list:', { component: 'instrumentDisplayCoordinator', instrument });
        this.currentInstrument = instrument;

        const instrumentType = await instrumentService.identifyInstrumentTypeAsync(instrument, trackIndex);

        // Update reactive store
        currentInstrumentStore.setInstrument(instrument, instrumentType);

        centralDisplayStore.setView('instrument', instrumentType, { instrument });
      } else {
        logger.debug('No instrument found, showing clip view', { component: 'instrumentDisplayCoordinator' });

        // Clear reactive store
        currentInstrumentStore.clear();

        // Show clip view for MIDI tracks without instruments
        centralDisplayStore.setView('clip', undefined, null, 'Clip');
      }
    }
  }

  /**
   * Cleanup subscriptions
   */
  destroy() {
    logger.debug('Cleaning up...', { component: 'instrumentDisplayCoordinator' });
    this.disposeEffects?.();
    this.disposeEffects = null;
    this.currentInstrument = null;
    this.lastProcessedTrackIndex = null;
    currentInstrumentStore.clear();
  }
}

// Export singleton instance
export const instrumentDisplayCoordinator = new InstrumentDisplayCoordinator();