/**
 * Bridge Connection Status Store
 *
 * Tracks the connection status of all backend services that the bridge
 * communicates with. This allows the UI to show real-time connection
 * status and adapt features based on service availability.
 */
import { logger } from '$lib/utils/logger';

export type ServiceStatus = 'connected' | 'disconnected' | 'unknown' | 'error';

export interface BridgeConnectionStatus {
    pythonSurface: ServiceStatus;
    lastUpdate: number;
}

/**
 * The Looping AX Helper as the bridge sees it (ADR-439), from
 * `/bridge/ax_helper [state, detail]`: `ready`, or one of the named errors
 * every AX-driven control reports instead of silently doing nothing.
 */
export type AxHelperState = 'ready' | 'ax-untrusted' | 'ax-helper-down' | 'unknown';

/**
 * One feature switch as the bridge reports it, from `/bridge/features [json]`
 * (general-release audit §7b; the bridge side is `bridge/utils/features.js`).
 *
 * - `enabled`: the config switched it on. Off → draw nothing for it.
 * - `available`: what it drives has been seen since the bridge started (the
 *   mixer answered, ...). On but unavailable → draw it greyed out and inert,
 *   saying `reason` — the swap pill's grey-with-a-reason.
 */
export interface FeatureState {
    enabled: boolean;
    available: boolean;
    reason: string;
}

/**
 * What a feature the bridge has not named reads as: off. Nothing is drawn for
 * a subsystem until the bridge vouches for it, which it does in the same
 * burst as `/bridge/connection_status` on every connect — so a stranger's
 * iPad never flashes a strip it has no mixer for, and the rig's appears with
 * the rest of the first frame.
 */
const FEATURE_OFF: FeatureState = Object.freeze({ enabled: false, available: false, reason: '' });

function sameFeatures(a: Record<string, FeatureState>, b: Record<string, FeatureState>): boolean {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((id) => {
        const x = a[id];
        const y = b[id];
        return (
            y !== undefined &&
            x.enabled === y.enabled &&
            x.available === y.available &&
            x.reason === y.reason
        );
    });
}

class BridgeStatusStore {
    // Reactive state using Svelte 5 runes
    status = $state<BridgeConnectionStatus>({
        pythonSurface: 'unknown',
        lastUpdate: Date.now()
    });

    axHelper = $state<{ state: AxHelperState; detail: string }>({ state: 'unknown', detail: '' });

    /** Every switch the bridge has reported, by id. Empty until it does. */
    features = $state<Record<string, FeatureState>>({});

    updateAxHelper(state: string, detail?: string) {
        const known: AxHelperState[] = ['ready', 'ax-untrusted', 'ax-helper-down'];
        const next = (known as string[]).includes(state) ? (state as AxHelperState) : 'unknown';
        if (this.axHelper.state === next && this.axHelper.detail === (detail ?? '')) return;
        this.axHelper = { state: next, detail: detail ?? '' };
        if (next !== 'ready') logger.warn('AX helper not ready', { component: 'bridgeStatus', state: next, detail });
    }

    /**
     * Take a `/bridge/features` snapshot. The bridge repeats it with every 5 s
     * ping, so an identical one is dropped rather than re-assigned — every
     * reader would otherwise re-run on the beat. A frame that does not parse
     * leaves the last good snapshot standing.
     */
    updateFeatures(json: string) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(json);
        } catch {
            logger.warn('Unreadable /bridge/features frame', { component: 'bridgeStatus', json });
            return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            logger.warn('Unreadable /bridge/features frame', { component: 'bridgeStatus', json });
            return;
        }
        const next: Record<string, FeatureState> = {};
        for (const [id, raw] of Object.entries(parsed as Record<string, unknown>)) {
            if (!raw || typeof raw !== 'object') continue;
            const entry = raw as Record<string, unknown>;
            next[id] = {
                enabled: entry.enabled === true,
                available: entry.available === true,
                reason: typeof entry.reason === 'string' ? entry.reason : ''
            };
        }
        if (sameFeatures(this.features, next)) return;
        this.features = next;
    }

    /** One switch's whole state; off for a feature the bridge never named. */
    feature(id: string): FeatureState {
        return this.features[id] ?? FEATURE_OFF;
    }

    /** Is this subsystem switched on? A feature the bridge never named is off. */
    isFeatureOn(id: string): boolean {
        return this.feature(id).enabled;
    }

    /**
     * Why a switched-on feature cannot be used right now, for a control to
     * draw: '' when it can — and when it is off, since then nothing is drawn
     * at all — else the bridge's reason, never blank.
     */
    unavailableReason(id: string): string {
        const { enabled, available, reason } = this.feature(id);
        if (!enabled || available) return '';
        return reason || 'Unavailable';
    }

    /**
     * Update from a /bridge/connection_status message. The bridge sends one
     * argument, the Python surface's status; the Omnisphere/NI slots that
     * used to follow it went with those servers (2026-09-23).
     */
    updateFromBridge(pythonSurface: string) {
        this.status = {
            pythonSurface: this.parseStatus(pythonSurface),
            lastUpdate: Date.now()
        };

        // Use $state.snapshot() to avoid proxy warning
        logger.debug('[BridgeStatus] Updated:', { component: 'bridgeStatus', data: $state.snapshot(this.status) });
    }

    /**
     * Update a specific service status
     */
    updateService(service: keyof Omit<BridgeConnectionStatus, 'lastUpdate'>, status: ServiceStatus) {
        this.status[service] = status;
        this.status.lastUpdate = Date.now();
    }

    /**
     * Parse status string from bridge into our ServiceStatus type
     */
    private parseStatus(status?: string): ServiceStatus {
        if (!status) return 'unknown';

        const normalized = status.toLowerCase();
        if (normalized === 'connected' || normalized === 'ready') {
            return 'connected';
        } else if (normalized === 'disconnected' || normalized === 'closed') {
            return 'disconnected';
        } else if (normalized === 'error' || normalized === 'failed') {
            return 'error';
        }

        return 'unknown';
    }

    /**
     * Check if a specific service is available
     */
    isServiceAvailable(service: keyof Omit<BridgeConnectionStatus, 'lastUpdate'>): boolean {
        return this.status[service] === 'connected';
    }

    /**
     * Check if the primary backend is connected
     */
    areCriticalServicesConnected(): boolean {
        return this.status.pythonSurface === 'connected';
    }

    /**
     * Get a human-readable description of the overall connection state
     */
    getOverallStatus(): { status: 'good' | 'partial' | 'disconnected'; message: string } {
        const connected = Object.entries(this.status)
            .filter(([key]) => key !== 'lastUpdate')
            .filter(([_, value]) => value === 'connected')
            .map(([key]) => key);

        if (connected.length === 0) {
            return {
                status: 'disconnected',
                message: 'No services connected'
            };
        }
        return {
            status: 'good',
            message: 'All services connected'
        };
    }

    /**
     * Reset all statuses to unknown
     */
    reset() {
        this.status = {
            pythonSurface: 'unknown',
            lastUpdate: Date.now()
        };
    }
}

// Export singleton instance
export const bridgeStatus = new BridgeStatusStore();
