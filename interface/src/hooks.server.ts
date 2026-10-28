/**
 * Server start (SvelteKit). The Places service reads Live's library, the
 * ticks and the cached catalogs here, at boot, so the first request finds
 * them ready rather than paying for the build itself (onboarding.plan.md §9:
 * the server's start no slower than today's warm start, when the catalog
 * was built before the servers came up).
 */
import { building } from '$app/environment';
import { placesService } from '$lib/server/places/service';
import { json, type Handle } from '@sveltejs/kit';
import { OPEN_PAIRING_ROUTES, trustOf } from '$lib/server/pairing/service';

// The gate's serve step (scripts/gate.sh) loads `/` from the build for a few
// seconds and stops it: no Places scan, and no writes to the caches the real
// server on :8889 shares.
if (!building && !process.env.LOOPING_GATE_SERVE) placesService();

/**
 * The pairing gate (ADR-491). Every `/api/*` route but the pairing flow
 * itself answers only a trusted caller: the Mac (Vamp for iPad over the
 * cable included) or a paired device, or everyone with pairing off.
 * `/api/ws-auth` is among them, so an unpaired device gets no proof for the
 * bridge's challenge and cannot drive Live; the others change or list
 * things on the Mac (`/api/places/rebuild`, `PUT /api/grooves`,
 * `/api/network`). The page itself, and its scripts, stay open: they hold
 * nothing secret, and they are what shows the pairing screen.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	if (path.startsWith('/api/') && !OPEN_PAIRING_ROUTES.includes(path)) {
		const trust = trustOf(event);
		if (!trust.trusted) {
			return json({ error: 'not-paired' }, { status: 401, headers: { 'cache-control': 'no-store' } });
		}
	}
	return resolve(event);
};
