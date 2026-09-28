/**
 * Server start (SvelteKit). The Places service reads Live's library, the
 * ticks and the cached catalogs here, at boot, so the first request finds
 * them ready rather than paying for the build itself (onboarding.plan.md §9:
 * the server's start no slower than today's warm start, when the catalog
 * was built before the servers came up).
 */
import { building } from '$app/environment';
import { placesService } from '$lib/server/places/service';

if (!building) placesService();
