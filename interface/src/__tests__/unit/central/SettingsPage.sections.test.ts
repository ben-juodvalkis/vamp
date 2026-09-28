/**
 * Settings' sections (plan.md §11): a sidebar of General, Places and
 * Connection, with Setup ahead of them on a first run. Each section is a tab
 * panel that stays mounted while hidden; the page remembers where it was
 * left. Places groups its folders, folds the Packs, filters, and saves each
 * tick as it is made. A first run ends with Finish setup (which saves) or
 * Set up later (which does not), and the checklist no longer vanishes when
 * the first tick saves the Mac's ticks file.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/api/simpleClient.js', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
import SettingsPage from '$lib/components/v6/settings/SettingsPage.svelte';
import { settingsStore } from '$lib/stores/v6/settingsStore.svelte';
import type { PlacesListing, PlacesSource } from '$lib/services/placesLive';

const LIB = '/Users/me/Music/User Library';
const source = (kind: PlacesSource['kind'], name: string, ticked: boolean): PlacesSource => ({
	key: `${kind}:${LIB}/${name}`,
	kind,
	name,
	path: `${LIB}/${name}`,
	icon: '',
	present: true,
	ticked,
	id: name.toLowerCase(),
	totalItems: ticked ? 100 : null
});

function listingWith(sources: PlacesSource[], firstRun = false): PlacesListing {
	return {
		firstRun,
		version: 1,
		m4lDevices: { path: '/repo/Vamp Devices', place: null, exact: false },
		source: 'index',
		indexState: { ok: true, note: '', file: null },
		libraryCfg: null,
		sources
	};
}

const SOURCES = [
	source('place', 'Desktop', false),
	source('place', 'Drum', true),
	source('user-library', 'User Library', false),
	...Array.from({ length: 14 }, (_, i) => source('pack', `Pack ${String(i + 1).padStart(2, '0')}`, false))
];

/** A Mac answering /api/places/* and /api/network. `ticks` records every save. */
function fakeMac(initial: PlacesListing) {
	let listing = initial;
	const ticks: string[][] = [];
	const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
		if (url.endsWith('/api/places/list')) return Response.json(listing);
		if (url.endsWith('/api/places/ticks')) {
			const ticked = (JSON.parse(String(init?.body)) as { ticked: string[] }).ticked;
			ticks.push(ticked);
			listing = { ...listing, firstRun: false, sources: listing.sources.map((s) => ({ ...s, ticked: ticked.includes(s.key) })) };
			return Response.json(listing);
		}
		if (url.endsWith('/api/network'))
			return Response.json({ hostname: 'studio.local', addresses: [{ ip: '192.168.100.1', kind: 'usb-c', iface: 'en7' }] });
		return new Response('', { status: 404 });
	});
	vi.stubGlobal('fetch', fetchFn);
	return { ticks };
}

const panel = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`#set-panel-${id}`)!;

beforeEach(() => {
	settingsStore.section = 'general';
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	settingsStore.closeSettings();
	settingsStore.firstRun = false;
	settingsStore.section = 'general';
});

describe('Settings sections', () => {
	it('opens on General, and a tab shows its own section alone', async () => {
		fakeMac(listingWith(SOURCES));
		const { getByRole, container } = render(SettingsPage);
		expect(getByRole('tab', { name: /General/ }).getAttribute('aria-selected')).toBe('true');
		expect(panel(container, 'general').hidden).toBe(false);
		expect(panel(container, 'places').hidden).toBe(true);

		await fireEvent.click(getByRole('tab', { name: /Places/ }));
		expect(getByRole('tab', { name: /Places/ }).getAttribute('aria-selected')).toBe('true');
		expect(panel(container, 'places').hidden).toBe(false);
		expect(panel(container, 'general').hidden).toBe(true);
		expect(settingsStore.section).toBe('places');
	});

	it('moves between tabs with the arrow keys', async () => {
		fakeMac(listingWith(SOURCES));
		const { getByRole } = render(SettingsPage);
		const list = getByRole('tablist');
		await fireEvent.keyDown(list, { key: 'ArrowDown' });
		expect(settingsStore.section).toBe('places');
		await fireEvent.keyDown(list, { key: 'End' });
		expect(settingsStore.section).toBe('connection');
		await fireEvent.keyDown(list, { key: 'ArrowDown' });
		expect(settingsStore.section).toBe('general');
	});

	it('reopens where it was left', async () => {
		fakeMac(listingWith(SOURCES));
		settingsStore.section = 'connection';
		const { getByRole } = render(SettingsPage);
		expect(getByRole('tab', { name: /Connection/ }).getAttribute('aria-selected')).toBe('true');
	});

	it('shows no Setup tab once the Mac has saved something', () => {
		fakeMac(listingWith(SOURCES));
		const { queryByRole } = render(SettingsPage);
		expect(queryByRole('tab', { name: /Setup/ })).toBeNull();
	});

	it('names the Mac’s address for the iPad, never the page’s localhost', async () => {
		fakeMac(listingWith(SOURCES));
		const { container } = render(SettingsPage);
		await waitFor(() => expect(panel(container, 'connection').textContent).toContain('http://192.168.100.1'));
		expect(panel(container, 'connection').textContent).not.toContain('localhost');
	});
});

describe('Settings → Places', () => {
	it('lists the ticked first, and keeps the Packs folded until asked', async () => {
		fakeMac(listingWith(SOURCES));
		const { container, getByRole } = render(SettingsPage);
		await fireEvent.click(getByRole('tab', { name: /Places/ }));
		await waitFor(() => expect(container.querySelector('[data-group="shown"]')).toBeTruthy());

		const groups = [...container.querySelectorAll<HTMLElement>('[data-group]')].map((g) => g.dataset.group);
		expect(groups).toEqual(['shown', 'places', 'user-library', 'packs']);
		const shown = container.querySelector<HTMLElement>('[data-group="shown"]')!;
		expect(within(shown).getByRole('checkbox', { name: 'Show Drum in the browser' })).toBeTruthy();

		const packs = container.querySelector<HTMLElement>('[data-group="packs"]')!;
		expect(within(packs).queryAllByRole('checkbox')).toHaveLength(0);
		await fireEvent.click(within(packs).getByRole('button', { name: /Packs/ }));
		expect(within(packs).getAllByRole('checkbox')).toHaveLength(14);
	});

	it('filters by name, reaching into the folded Packs', async () => {
		fakeMac(listingWith(SOURCES));
		const { container, getByRole, getByLabelText } = render(SettingsPage);
		await fireEvent.click(getByRole('tab', { name: /Places/ }));
		await waitFor(() => expect(getByLabelText('Filter folders by name or path')).toBeTruthy());

		await fireEvent.input(getByLabelText('Filter folders by name or path'), { target: { value: 'pack 07' } });
		const boxes = within(panel(container, 'places')).getAllByRole('checkbox');
		expect(boxes.map((b) => b.getAttribute('aria-label'))).toEqual(['Show the Pack Pack 07 in the browser']);

		await fireEvent.input(getByLabelText('Filter folders by name or path'), { target: { value: 'zzz' } });
		expect(panel(container, 'places').textContent).toContain('No folder matches “zzz”');
	});

	it('saves a tick as it is made, and the row stays in its group', async () => {
		const mac = fakeMac(listingWith(SOURCES));
		const { container, getByRole } = render(SettingsPage);
		await fireEvent.click(getByRole('tab', { name: /Places/ }));
		await waitFor(() => expect(getByRole('checkbox', { name: 'Show Desktop in the browser' })).toBeTruthy());

		await fireEvent.click(getByRole('checkbox', { name: 'Show Desktop in the browser' }));
		await waitFor(() => expect(mac.ticks).toHaveLength(1));
		expect(mac.ticks[0].sort()).toEqual([`place:${LIB}/Desktop`, `place:${LIB}/Drum`].sort());

		const places = container.querySelector<HTMLElement>('[data-group="places"]')!;
		await waitFor(() => expect(within(places).getByRole('checkbox', { name: 'Show Desktop in the browser' })).toBeChecked());
		expect(getByRole('tab', { name: /Places/ }).textContent).toContain('2');
	});
});

describe('Settings on a first run', () => {
	it('opens on Setup, and Finish setup saves the ticks and closes', async () => {
		const mac = fakeMac(listingWith(SOURCES.map((s) => ({ ...s, ticked: false })), true));
		settingsStore.firstRun = true;
		settingsStore.openSettings();
		const { getByRole } = render(SettingsPage);
		expect(getByRole('tab', { name: /Setup/ }).getAttribute('aria-selected')).toBe('true');

		const finish = getByRole('button', { name: 'Finish setup' });
		await waitFor(() => expect(finish).not.toBeDisabled());
		await fireEvent.click(finish);
		await waitFor(() => expect(settingsStore.open).toBe(false));
		expect(mac.ticks).toEqual([[]]);
		expect(settingsStore.firstRun).toBe(false);
	});

	it('Set up later closes and saves nothing, so the checklist comes back', async () => {
		const mac = fakeMac(listingWith(SOURCES.map((s) => ({ ...s, ticked: false })), true));
		settingsStore.firstRun = true;
		settingsStore.openSettings();
		const { getByRole } = render(SettingsPage);
		await fireEvent.click(getByRole('button', { name: 'Set up later' }));
		expect(settingsStore.open).toBe(false);
		expect(mac.ticks).toEqual([]);
		expect(settingsStore.firstRun).toBe(true);
	});

	it('keeps the checklist after the first tick saves, with Finish the only way on', async () => {
		fakeMac(listingWith(SOURCES.map((s) => ({ ...s, ticked: false })), true));
		settingsStore.firstRun = true;
		settingsStore.openSettings();
		const { getByRole, queryByRole, getByText } = render(SettingsPage);

		await fireEvent.click(getByRole('button', { name: 'Open Places' }));
		expect(settingsStore.section).toBe('places');
		await waitFor(() => expect(getByRole('checkbox', { name: 'Show Drum in the browser' })).toBeTruthy());
		await fireEvent.click(getByRole('checkbox', { name: 'Show Drum in the browser' }));
		await waitFor(() => expect(settingsStore.firstRun).toBe(false));

		expect(getByRole('tab', { name: /Setup/ })).toBeTruthy();
		expect(getByText(/set up Vamp/)).toBeTruthy();
		expect(queryByRole('button', { name: 'Set up later' })).toBeNull();
		expect(getByRole('button', { name: 'Finish setup' })).not.toBeDisabled();
		expect(getByRole('tab', { name: /Setup/ }).textContent).toContain('1/3');
	});
});
