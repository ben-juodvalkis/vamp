/**
 * Central Display Store V6
 * Manages what content is shown in the central display area
 * Can show device controls, config panels, track parameters, instruments, etc.
 *
 * NOTE: Instrument detection and automatic updates are handled by
 * instrumentDisplayCoordinator. This store only manages view state.
 */
import { logger } from '$lib/utils/logger';

export type CentralViewType = 'device' | 'instrument' | 'clip' | 'permute' | 'groove' | 'config' | 'track' | 'default' | 'custom' | 'debug' | 'system';

export interface CentralViewData {
	type: CentralViewType;
	subType?: string; // e.g., 'autofilter', 'delay', 'drumrack', etc.
	data?: any; // Context-specific data for the view
	title?: string; // Optional title for the view
	wide?: boolean; // If true, central view takes 2/3 width; if false/undefined, takes 1/3 width
}

class CentralDisplayStore {
	// Current view state - default to system view
	private currentView = $state<CentralViewData>({
		type: 'system'
	});

	// Track last device and clip interactions for persistence
	private lastDeviceView = $state<CentralViewData | null>(null);
	private lastClipView = $state<CentralViewData | null>(null);

	/**
	 * Set the current view
	 */
	setView(type: CentralViewType, subType?: string, data?: any, title?: string, wide?: boolean) {
		// Auto-set wide=true for instrument, clip, permute and groove views if not explicitly specified
		if (wide === undefined) {
			wide = type === 'instrument' || type === 'clip' || type === 'permute' || type === 'groove';
		}

		const newView: CentralViewData = {
			type,
			subType,
			data,
			title,
			wide
		};

		// Check if view has actually changed (ignore data for comparison)
		const hasChanged =
			this.currentView.type !== newView.type ||
			this.currentView.subType !== newView.subType ||
			this.currentView.title !== newView.title;

		// Store device and clip views for quick recall
		if (type === 'device') {
			this.lastDeviceView = newView;
		} else if (type === 'clip') {
			this.lastClipView = newView;
		}

		this.currentView = newView;

		// Only log if the view type/subtype actually changed
		if (hasChanged) {
			logger.debug('Central display view changed:', { component: 'centralDisplay', type, subType, title, wide });
		}
	}

	/**
	 * Clear the view back to default
	 */
	clearView() {
		this.currentView = {
			type: 'default'
		};
	}

	/**
	 * Return to the last device view (if any)
	 */
	returnToLastDevice() {
		if (this.lastDeviceView) {
			this.currentView = this.lastDeviceView;
		}
	}

	/**
	 * Return to the last clip view (if any)
	 */
	returnToLastClip() {
		if (this.lastClipView) {
			this.currentView = this.lastClipView;
		}
	}

	/**
	 * Get the current view (reactive)
	 */
	get view(): CentralViewData {
		return this.currentView;
	}

	/**
	 * Check if a specific view is active
	 */
	isViewActive(type: CentralViewType, subType?: string): boolean {
		return this.currentView.type === type &&
			   (!subType || this.currentView.subType === subType);
	}

	/**
	 * Show the current instrument view
	 * Delegates to instrumentDisplayCoordinator
	 */
	showCurrentInstrument() {
		logger.debug('showCurrentInstrument() - delegating to coordinator', { component: 'CentralDisplayStore' });

		// Dynamic import to avoid circular dependencies
		import('$lib/services/instrumentDisplayCoordinator.svelte').then(({ instrumentDisplayCoordinator }) => {
			instrumentDisplayCoordinator.showCurrentInstrument();
		});
	}

	/**
	 * Show the current clip view
	 * Delegates to clipDisplayCoordinator
	 */
	showCurrentClip() {
		logger.debug('showCurrentClip() - delegating to coordinator', { component: 'CentralDisplayStore' });

		// Dynamic import to avoid circular dependencies
		import('$lib/services/clipDisplayCoordinator.svelte').then(({ clipDisplayCoordinator }) => {
			clipDisplayCoordinator.showCurrentClip();
		});
	}
}

// Export singleton instance
export const centralDisplayStore = new CentralDisplayStore();