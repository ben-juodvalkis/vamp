/**
 * Live's groove files and which are ticked for the Groove view, as the Mac
 * lists them (`/api/grooves`). One read shared by Settings → Grooves and the
 * Groove view, so a tick in one is the other's at once. Every tick is saved on
 * the Mac as it is made, in order — the order is the Groove view's tiles — and
 * the answer is the new listing.
 */
import type { GrooveFile, GroovesListing } from '$lib/types/grooves';
import { logger } from '$lib/utils/logger';

export const GROOVES_URL = '/api/grooves';

class GroovesStore {
	private _listing = $state<GroovesListing | null>(null);
	private _failed = $state('');
	private _saving = $state(false);
	private _saveError = $state('');
	private inflight: Promise<void> | null = null;

	get listing(): GroovesListing | null {
		return this._listing;
	}
	get failed(): string {
		return this._failed;
	}
	get saving(): boolean {
		return this._saving;
	}
	get saveError(): string {
		return this._saveError;
	}
	get ticked(): string[] {
		return this._listing?.ticked ?? [];
	}
	/** The ticked files in tick order: the Groove view's tiles. */
	get tickedFiles(): GrooveFile[] {
		const byName = new Map((this._listing?.files ?? []).map((f) => [f.name, f]));
		return this.ticked.map((n) => byName.get(n)).filter((f): f is GrooveFile => !!f);
	}

	/** Read the listing. Concurrent callers share one request. */
	refresh(fetchFn: typeof fetch = fetch): Promise<void> {
		this.inflight ??= (async () => {
			try {
				const res = await fetchFn(GROOVES_URL, { cache: 'no-store' });
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				this._listing = (await res.json()) as GroovesListing;
				this._failed = '';
			} catch (err) {
				this._failed = String(err);
				logger.warn('Grooves: no listing from the Mac', { component: 'groovesStore', err: String(err) });
			} finally {
				this.inflight = null;
			}
		})();
		return this.inflight;
	}

	/** Save these ticks, in this order. False when the Mac did not take them. */
	async save(ticked: string[], fetchFn: typeof fetch = fetch): Promise<boolean> {
		this._saving = true;
		try {
			const res = await fetchFn(GROOVES_URL, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ticked })
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			this._listing = (await res.json()) as GroovesListing;
			this._saveError = '';
			return true;
		} catch (err) {
			this._saveError = String(err);
			logger.warn('Grooves: ticks not saved', { component: 'groovesStore', err: String(err) });
			return false;
		} finally {
			this._saving = false;
		}
	}

	/** Tick (appended, the last tile) or untick one groove. */
	async toggle(name: string, fetchFn: typeof fetch = fetch): Promise<void> {
		if (!this._listing || this._saving) return;
		const ticked = this.ticked;
		await this.save(ticked.includes(name) ? ticked.filter((n) => n !== name) : [...ticked, name], fetchFn);
	}
}

export const groovesStore = new GroovesStore();
