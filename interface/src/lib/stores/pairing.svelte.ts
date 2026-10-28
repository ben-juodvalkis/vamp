/**
 * Pairing Store (ADR-491)
 *
 * Two halves, one per side of a pairing:
 *
 * - `required`: this device is not paired, so the page shows the pairing
 *   screen instead of the interface. Set when `/api/pair/state` says so on
 *   load, or when the bridge login is refused (`pairing-required`, from
 *   `WebSocketConnection`).
 * - `requests`: other devices asking to pair, shown as Allow / Ignore
 *   banners on this screen while it is trusted. Fed by the bridge's
 *   `/bridge/pairing` and, for requests announced before this screen
 *   connected, by `/api/pair/decide`.
 */
import { logger } from '$lib/utils/logger';

export interface PairingRequestView {
	id: string;
	name: string;
	address: string;
}

class PairingStore {
	required = $state(false);
	requests = $state<PairingRequestView[]>([]);

	markRequired() {
		this.required = true;
	}

	/** One `/bridge/pairing` JSON argument: a request, or how one ended. */
	onBridgeMessage(raw: string) {
		let event: { type?: string; id?: string; name?: string; address?: string };
		try {
			event = JSON.parse(raw);
		} catch {
			return;
		}
		if (!event.id) return;
		if (event.type === 'request') {
			if (this.requests.some((r) => r.id === event.id)) return;
			this.requests = [
				...this.requests,
				{ id: event.id, name: event.name ?? 'A device', address: event.address ?? '' }
			];
		} else if (event.type === 'resolved') {
			this.requests = this.requests.filter((r) => r.id !== event.id);
		}
	}

	async loadWaiting() {
		try {
			const res = await fetch('/api/pair/decide', { cache: 'no-store' });
			if (!res.ok) return;
			const body = await res.json();
			if (Array.isArray(body?.waiting)) this.requests = body.waiting;
		} catch (e) {
			logger.debug('Could not read waiting pairing requests', { error: String(e) });
		}
	}

	async decide(id: string, allow: boolean) {
		this.requests = this.requests.filter((r) => r.id !== id);
		try {
			await fetch('/api/pair/decide', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id, allow })
			});
		} catch (e) {
			logger.warn('Pairing decision not sent', { error: String(e) });
		}
	}
}

export const pairingStore = new PairingStore();
