/**
 * The Mac's Places listing, as Settings holds it while it is open: one read
 * of `/api/places/list` shared by the Places section and the first-run
 * checklist, so a tick in one is the other's at once (they each fetched
 * their own before, and the checklist caught up only on the next
 * `places-changed`). Created by `SettingsPage` and handed down.
 *
 * Every tick is saved on the Mac as it is made (`savePlacesTicks`), and the
 * answer is the new listing. `finish` saves the ticks as they stand — the
 * first-run checklist's last word, which ends the first run even with
 * nothing ticked.
 */
import { fetchPlacesListing, savePlacesTicks, PLACES_CHANGED_EVENT, type PlacesListing, type PlacesSource } from '$lib/services/placesLive';
import { logger } from '$lib/utils/logger';

export function createPlacesListing() {
	let listing = $state<PlacesListing | null>(null);
	let failed = $state('');
	let saveError = $state('');
	let saving = $state(false);

	async function refresh() {
		try {
			listing = await fetchPlacesListing();
			failed = '';
		} catch (err) {
			failed = String(err);
			logger.warn('Settings: no Places listing', { component: 'placesListing', err: String(err) });
		}
	}

	async function save(keys: string[]): Promise<boolean> {
		saving = true;
		try {
			listing = await savePlacesTicks(keys);
			saveError = '';
			return true;
		} catch (err) {
			saveError = String(err);
			logger.warn('Settings: ticks not saved', { component: 'placesListing', err: String(err) });
			return false;
		} finally {
			saving = false;
		}
	}

	return {
		get listing() {
			return listing;
		},
		get failed() {
			return failed;
		},
		get saveError() {
			return saveError;
		},
		get saving() {
			return saving;
		},
		get tickedCount() {
			return (listing?.sources ?? []).filter((s) => s.ticked).length;
		},
		refresh,
		/** Read the listing now and again whenever the Mac says the catalog changed. Returns the teardown. */
		watch(): () => void {
			void refresh();
			const onChanged = () => void refresh();
			window.addEventListener(PLACES_CHANGED_EVENT, onChanged);
			return () => window.removeEventListener(PLACES_CHANGED_EVENT, onChanged);
		},
		/** Flip one folder's tick. A folder not on this Mac, or a save in flight, is left alone. */
		async toggle(s: PlacesSource): Promise<void> {
			if (!listing || saving || !s.present) return;
			await save(listing.sources.filter((x) => (x.key === s.key ? !s.ticked : x.ticked)).map((x) => x.key));
		},
		/** Save the ticks as they stand, which ends a first run. False when it could not. */
		async finish(): Promise<boolean> {
			if (!listing || saving) return false;
			return save(listing.sources.filter((s) => s.ticked).map((s) => s.key));
		}
	};
}

export type PlacesListingState = ReturnType<typeof createPlacesListing>;
