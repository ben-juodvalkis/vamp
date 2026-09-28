/**
 * Clip Display Coordinator
 * Coordinates between detail clip changes and central display
 */

import { session } from '$lib/stores/session.svelte';
import { centralDisplayStore } from '$lib/stores/v6/centralDisplayStore.svelte';
import { browser } from '$app/environment';
import { logger } from '$lib/utils/logger';

class ClipDisplayCoordinator {
	private currentClipIndices: { track: number; scene: number } | null = null;
	// See the note on InstrumentDisplayCoordinator.disposeEffects: an
	// $effect.root whose disposer is dropped can never be stopped.
	private disposeEffects: (() => void) | null = null;

	/**
	 * Initialize the coordinator
	 * Sets up subscriptions to detail clip changes
	 */
	initialize() {
		logger.debug('Initializing...', { component: 'clipDisplayCoordinator' });

		if (!browser) return;

		// Idempotent — a second root would handle every focus change twice.
		if (this.disposeEffects) {
			logger.debug('Already initialized, ignoring', { component: 'clipDisplayCoordinator' });
			return;
		}

		// PR-5e1: watch Python-surface focusedClipIndices rather than
		// legacy M4L detailClipIndices. The central-display auto-switch
		// now follows the v3 focus channel so it keeps working even
		// while the liveAPI-v6.js selectedClipChanged outlet is broken.
		this.disposeEffects = $effect.root(() => {
			$effect(() => {
				const clipIndices = session.focusedClipIndices;
				this.handleDetailClipChange(clipIndices);
			});
		});

		logger.debug('Initialized successfully', { component: 'clipDisplayCoordinator' });
	}

	/**
	 * Handle detail clip changes
	 * Updates display if already showing clip view
	 */
	private handleDetailClipChange(clipIndices: { track: number; scene: number } | null) {
		// Store current state
		this.currentClipIndices = clipIndices;

		if (!clipIndices) {
			logger.debug('No detail clip selected', { component: 'clipDisplayCoordinator' });

			// If showing clip view, clear the clip data but keep the view type
			const currentView = centralDisplayStore.view;
			if (currentView.type === 'clip') {
				logger.debug('Clearing clip data (keeping view type)', { component: 'clipDisplayCoordinator' });
				centralDisplayStore.setView('clip', undefined, { clipIndices: null });
			}
			return;
		}

		logger.debug('Detail clip detected', {
			component: 'clipDisplayCoordinator',
			track: clipIndices.track,
			scene: clipIndices.scene
		});

		// Only auto-update display if we're already showing a clip view
		// This prevents stealing focus from other views like device effects
		const currentView = centralDisplayStore.view;
		if (currentView.type === 'clip') {
			logger.debug('Updating clip view automatically', { component: 'clipDisplayCoordinator' });
			centralDisplayStore.setView('clip', undefined, { clipIndices });
		} else {
			logger.debug('Not updating display', {
				component: 'clipDisplayCoordinator',
				currentViewType: currentView.type
			});
		}
	}

	/**
	 * Get the current clip indices
	 */
	getCurrentClipIndices(): { track: number; scene: number } | null {
		return this.currentClipIndices;
	}

	/**
	 * Show the current clip in the central display
	 * This is the main public API for "show me the current clip controls"
	 */
	showCurrentClip() {
		logger.debug('showCurrentClip() called', { component: 'clipDisplayCoordinator' });

		const clipIndices = this.currentClipIndices || session.focusedClipIndices;

		if (!clipIndices) {
			logger.debug('No clip selected, showing empty clip view', { component: 'clipDisplayCoordinator' });
			centralDisplayStore.setView('clip', undefined, { clipIndices: null });
			return;
		}

		logger.debug('Showing clip view', { component: 'clipDisplayCoordinator' });
		centralDisplayStore.setView('clip', undefined, { clipIndices });
	}

	/**
	 * Cleanup
	 */
	destroy() {
		logger.debug('Cleaning up...', { component: 'clipDisplayCoordinator' });
		this.disposeEffects?.();
		this.disposeEffects = null;
		this.currentClipIndices = null;
	}
}

// Export singleton instance
export const clipDisplayCoordinator = new ClipDisplayCoordinator();
