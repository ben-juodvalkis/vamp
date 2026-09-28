/**
 * The Places catalog's freshness, client side (onboarding.plan.md §6.4, §9).
 *
 * The Mac's Places service bumps a version whenever the catalog changed — a
 * tick, a Place added in Live, Live's index rewritten, thumbnails baked — and
 * pushes it over `/api/places/events` (server-sent events). This module keeps
 * that one connection, and when the version moves it drops the client's
 * memoized index and adapters and dispatches a `places-changed` window event,
 * which the browser answers by re-reading the rail. Until then the iPad keeps
 * showing what it has.
 *
 * It also carries the first-run verdict from `/api/places/list`
 * (`settingsStore.firstRun`): while the Mac has saved nothing, Settings opens
 * by itself as the onboarding checklist (§7).
 */
import { clearPlacesIndexCache, fetchedPlacesVersion, noteStreamVersion } from './adapters/placesAdapter';
import { settingsStore } from '$lib/stores/v6/settingsStore.svelte';
import { logger } from '$lib/utils/logger';

export const PLACES_CHANGED_EVENT = 'places-changed';

/**
 * Warm Safari's HTTP cache with every ticked Place's files (onboarding.plan.md
 * §9), in rail order, presets before samples, one at a time, in idle time. The
 * bodies are read and dropped: nothing lands in JavaScript memory — the
 * browser keeps one Place's tree at a time, the open one — but a Place's first
 * open, or a switch back to one, is then a 304 and a parse rather than a
 * transfer of megabytes over the link mid-set. The routes' ETags make a
 * re-warm after a reload or a catalog change a handful of tiny requests.
 *
 * A newer warm-up cancels an older one (a catalog change mid-warm). Safari
 * has no `requestIdleCallback`, so a short timeout stands in for idle.
 */
let warmToken = 0;

export async function warmPlacesCache(
	places: ReadonlyArray<{ file: string; samplesFile?: string }>,
	fetchFn: typeof fetch = fetch
): Promise<string[]> {
	const token = ++warmToken;
	const files = [...places.map((p) => p.file), ...places.map((p) => p.samplesFile).filter((f): f is string => !!f)];
	const warmed: string[] = [];
	for (const file of files) {
		await new Promise((r) => setTimeout(r, 0));
		if (token !== warmToken) break;
		try {
			const res = await fetchFn(`/api/places/${file}`, { cache: 'default' });
			// Read the body so the cache holds it whole; the text goes nowhere.
			await res.text();
			if (res.ok) warmed.push(file);
		} catch (err) {
			logger.debug('Places warm-up: fetch failed', { component: 'placesLive', file, err: String(err) });
		}
	}
	return warmed;
}

/**
 * The Place a catalog item lives in and its path inside it, for a load that
 * names its Place (protocol 3.11.0): `[source, rel]`, or `['', '']` for an
 * item with no Place behind it (a Recent entry), which the surface resolves
 * by path through Live's own library.
 */
export function placeArgs(preset: { source?: string; placePath?: string; fullPath: string }): [string, string] {
	const root = preset.placePath?.replace(/\/+$/, '');
	if (!preset.source || !root || !preset.fullPath.startsWith(`${root}/`)) return ['', ''];
	return [preset.source, preset.fullPath.slice(root.length + 1)];
}
export const PLACES_EVENTS_URL = '/api/places/events';
export const PLACES_LIST_URL = '/api/places/list';
export const PLACES_TICKS_URL = '/api/places/ticks';

export interface PlacesSource {
	key: string;
	kind: 'place' | 'user-library' | 'pack';
	name: string;
	path: string;
	icon: string;
	present: boolean;
	ticked: boolean;
	id: string | null;
	totalItems: number | null;
}

export interface PlacesListing {
	firstRun: boolean;
	version: number;
	/** This checkout's Max devices folder and the Place the surface reaches it through, if any. */
	m4lDevices?: { path: string; place: string | null; exact: boolean };
	source: 'index' | 'disk';
	indexState: { ok: boolean; note: string; file: string | null };
	libraryCfg: string | null;
	sources: PlacesSource[];
}

let source: EventSource | null = null;
let lastVersion = 0;

/**
 * What the browser does when the Mac says the catalog changed. The index the
 * adapter holds carries the version it was built at (`metadata.version`), so
 * an event that names the same version — the stream's opening event, a
 * reconnect — is nothing to do, and one that names another is a refetch,
 * even when it is the first event heard (a bump between the index fetch and
 * the stream opening, which the thumbnail bake makes common at start).
 */
export function applyPlacesVersion(version: number): void {
	if (version === lastVersion) return;
	lastVersion = version;
	noteStreamVersion(version);
	// Nothing fetched yet: the index in flight answers with the current
	// version, and the adapter compares it against the stream on arrival.
	if (fetchedPlacesVersion() === 0) return;
	if (version === fetchedPlacesVersion()) return;
	clearPlacesIndexCache();
	logger.info('Places changed on the Mac; re-reading', { component: 'placesLive', version });
	if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PLACES_CHANGED_EVENT, { detail: { version } }));
}

/** Open the event stream once. A browser without EventSource does nothing. */
export function startPlacesLive(): void {
	if (source || typeof window === 'undefined' || typeof EventSource === 'undefined') return;
	try {
		source = new EventSource(PLACES_EVENTS_URL);
	} catch {
		return;
	}
	source.addEventListener('version', (e) => {
		const v = Number((e as MessageEvent).data);
		if (Number.isFinite(v)) applyPlacesVersion(v);
	});
	source.onerror = () => {
		// The stream reconnects by itself. A refused stream (the shot harness
		// answers 204) stays closed; that is one warning, not a loop.
		if (source?.readyState === EventSource.CLOSED) logger.debug('Places event stream closed', { component: 'placesLive' });
	};
}

export function stopPlacesLive(): void {
	source?.close();
	source = null;
	lastVersion = 0;
}

/** The Mac's listing: every tickable folder, plus the first-run verdict, which lands in `settingsStore`. */
export async function fetchPlacesListing(): Promise<PlacesListing> {
	const res = await fetch(PLACES_LIST_URL, { cache: 'no-store' });
	if (!res.ok) throw new Error(`Failed to load ${PLACES_LIST_URL} (${res.status})`);
	const listing = (await res.json()) as PlacesListing;
	settingsStore.firstRun = listing.firstRun === true;
	return listing;
}

/** Save the ticks on the Mac. The answer is the new listing. */
export async function savePlacesTicks(ticked: string[]): Promise<PlacesListing> {
	const res = await fetch(PLACES_TICKS_URL, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ ticked })
	});
	if (!res.ok) throw new Error(`Failed to save ticks (${res.status})`);
	const listing = (await res.json()) as PlacesListing;
	settingsStore.firstRun = listing.firstRun === true;
	return listing;
}

/** On a first run, open Settings by itself, once. */
export async function openSettingsOnFirstRun(): Promise<void> {
	try {
		const listing = await fetchPlacesListing();
		if (listing.firstRun) settingsStore.openSettings();
	} catch (err) {
		logger.debug('No Places listing yet', { component: 'placesLive', err: String(err) });
	}
}
