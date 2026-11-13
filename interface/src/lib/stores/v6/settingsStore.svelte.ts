/**
 * Settings store (Svelte 5 runes) — whether the full-page Settings is open,
 * which of its sections is showing, and why (plan.md §11, onboarding.plan.md
 * §7).
 *
 * Settings is a full-page view over the whole app, opened from the gear in
 * the master track's central view, or on the Mac by Vamp for Mac's
 * "Settings…" (⌘,), which sets `#settings` on its window (ADR-520). Its
 * sections run down a sidebar in three groups (ADR-534): Play (Recording,
 * Controllers), Browse (Library, whose id is `places`; Grooves) and System (Connection,
 * Integrations), and on a first run the Setup checklist ahead of them. A
 * narrow window shows the list or one section, with a way back.
 *
 * `firstRun` is the Mac's verdict, not the browser's: the server says whether
 * anything has ever been saved on this machine, and while it says no the
 * page opens by itself as the onboarding checklist. Nothing here is persisted
 * in the browser — a reload on the iPad must not remember "open". The section
 * is remembered only for as long as the page is loaded, so the gear reopens
 * where you left it.
 */

export type SettingsSection = 'setup' | 'recording' | 'controllers' | 'places' | 'grooves' | 'connection' | 'integrations';

function createSettingsStore() {
	let open = $state(false);
	let firstRun = $state(false);
	let section = $state<SettingsSection>('recording');

	return {
		get open(): boolean {
			return open;
		},
		set open(value: boolean) {
			open = value;
		},
		/** Open Settings, on `at` if given, else where it was last left. */
		openSettings(at?: SettingsSection) {
			if (at) section = at;
			open = true;
		},
		closeSettings() {
			open = false;
		},
		toggle() {
			open = !open;
		},
		/** The section showing. `setup` exists only on a first run; the page falls back from it otherwise. */
		get section(): SettingsSection {
			return section;
		},
		set section(value: SettingsSection) {
			section = value;
		},
		/** The Mac has never saved a setting: Settings opens as the checklist. */
		get firstRun(): boolean {
			return firstRun;
		},
		set firstRun(value: boolean) {
			firstRun = value;
		}
	};
}

export const settingsStore = createSettingsStore();

const SECTIONS: readonly SettingsSection[] = ['setup', 'recording', 'controllers', 'places', 'grooves', 'connection', 'integrations'];

/** Names an address may still carry from before ADR-534 split General up. */
const FORMER: Readonly<Record<string, SettingsSection>> = { general: 'recording', capture: 'recording', features: 'integrations', library: 'places' };

/**
 * Open Settings from an address: `#settings`, or `#settings/<section>`.
 * Vamp for Mac's "Settings…" (⌘,) sets it on its window's page (ADR-520);
 * any browser can use it too. Returns whether the hash asked for Settings,
 * so the caller can clear it and a later "Settings…" lands again.
 */
export function openSettingsFromHash(hash: string): boolean {
	const match = /^#settings(?:\/([a-z]+))?$/.exec(hash);
	if (!match) return false;
	const name = match[1];
	const at = name && (SECTIONS.includes(name as SettingsSection) ? (name as SettingsSection) : FORMER[name]);
	settingsStore.openSettings(at || undefined);
	return true;
}
