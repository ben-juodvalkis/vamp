/**
 * Server start (SvelteKit). The Places service reads Live's library, the
 * ticks and the cached catalogs here, at boot, so the first request finds
 * them ready rather than paying for the build itself (onboarding.plan.md §9:
 * the server's start no slower than today's warm start, when the catalog
 * was built before the servers came up).
 */
import { building } from '$app/environment';
import { placesService } from '$lib/server/places/service';

// The gate's serve step (scripts/gate.sh) loads `/` from the build for a few
// seconds and stops it: no Places scan, and no writes to the caches the real
// server on :8889 shares.
if (!building && !process.env.LOOPING_GATE_SERVE) placesService();
