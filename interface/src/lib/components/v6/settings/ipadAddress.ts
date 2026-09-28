/**
 * The address to type on the iPad (Settings' Connection section and the
 * first-run checklist's last step).
 *
 * The page's own origin is the answer only when it is already a network
 * address — on the iPad, or on the Mac opened by IP. On the Mac it is usually
 * `localhost`, which on the iPad names the iPad, so the Mac's own addresses
 * (`/api/network`) stand in for the host, with this page's port: whichever
 * server is serving this page (`npm run dev` on 3000, `npm run ipad` on
 * 8889) is the one that is running.
 */

import type { MacAddresses } from '$lib/types/network';

export type AddressKind = 'usb-c' | 'network' | 'name' | 'this-page';

export interface IpadAddress {
	url: string;
	kind: AddressKind;
}

export const NETWORK_URL = '/api/network';

export function isLoopbackHost(host: string): boolean {
	const h = host.replace(/^\[|\]$/g, '').toLowerCase();
	return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\./.test(h);
}

/**
 * Every address the iPad could open this page at, best first: the page's own
 * when it is not loopback, then the Mac's USB-C and network addresses, then
 * its Bonjour name (stable when the Wi-Fi address changes). No duplicates.
 * `mac` null means the Mac's addresses are not known (yet, or at all).
 */
export function ipadAddresses(
	loc: { protocol: string; hostname: string; port: string },
	mac: MacAddresses | null
): IpadAddress[] {
	const port = loc.port ? `:${loc.port}` : '';
	const url = (host: string) => `${loc.protocol}//${host}${port}`;
	const out: IpadAddress[] = [];
	const seen = new Set<string>();
	const add = (host: string, kind: AddressKind) => {
		const key = host.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		out.push({ url: url(host), kind });
	};
	if (!isLoopbackHost(loc.hostname)) {
		const own = mac?.addresses.find((a) => a.ip === loc.hostname);
		add(loc.hostname, own ? own.kind : 'this-page');
	}
	for (const a of mac?.addresses ?? []) add(a.ip, a.kind);
	if (mac?.hostname) add(mac.hostname, 'name');
	return out;
}

export const ADDRESS_KIND_LABEL: Record<AddressKind, string> = {
	'usb-c': 'USB-C',
	network: 'Wi-Fi or Ethernet',
	name: 'By name, on the same Wi-Fi',
	'this-page': 'This page'
};

export async function fetchMacAddresses(fetchFn: typeof fetch = fetch): Promise<MacAddresses> {
	const res = await fetchFn(NETWORK_URL, { cache: 'no-store' });
	if (!res.ok) throw new Error(`Failed to load ${NETWORK_URL} (${res.status})`);
	return (await res.json()) as MacAddresses;
}
