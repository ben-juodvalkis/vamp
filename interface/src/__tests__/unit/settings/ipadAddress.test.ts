/**
 * "Open on the iPad" (Settings → Connection, and the first-run checklist's
 * last step). The page's own origin used to be the answer, which on the Mac
 * is `http://localhost:3000` — on the iPad, `localhost` is the iPad. The
 * Mac's own addresses stand in for a loopback host, on this page's port.
 */
import { describe, it, expect } from 'vitest';
import { ipadAddresses, isLoopbackHost } from '$lib/components/v6/settings/ipadAddress';
import type { MacAddresses } from '$lib/types/network';

const MAC: MacAddresses = {
	hostname: 'looping-studio.local',
	addresses: [
		{ ip: '192.168.100.1', kind: 'usb-c', iface: 'en7' },
		{ ip: '192.168.50.12', kind: 'network', iface: 'en0' }
	]
};
const at = (hostname: string, port: string) => ({ protocol: 'http:', hostname, port });

describe('ipadAddresses', () => {
	it('on the Mac’s localhost, names the Mac’s addresses on this page’s port, USB-C first, the name last', () => {
		expect(ipadAddresses(at('localhost', '3000'), MAC)).toEqual([
			{ url: 'http://192.168.100.1:3000', kind: 'usb-c' },
			{ url: 'http://192.168.50.12:3000', kind: 'network' },
			{ url: 'http://looping-studio.local:3000', kind: 'name' }
		]);
	});

	it('never offers a loopback address', () => {
		for (const host of ['localhost', '127.0.0.1', '::1', '[::1]', 'app.localhost']) {
			expect(isLoopbackHost(host), host).toBe(true);
			expect(ipadAddresses(at(host, '8889'), MAC).some((a) => a.url.includes(host))).toBe(false);
		}
	});

	it('on the iPad, its own address comes first, once', () => {
		expect(ipadAddresses(at('192.168.100.1', '8889'), MAC).map((a) => a.url)).toEqual([
			'http://192.168.100.1:8889',
			'http://192.168.50.12:8889',
			'http://looping-studio.local:8889'
		]);
		expect(ipadAddresses(at('looping-studio.local', '8889'), MAC)[0]).toEqual({
			url: 'http://looping-studio.local:8889',
			kind: 'this-page'
		});
	});

	it('before the Mac has answered, offers only a page address that is not loopback', () => {
		expect(ipadAddresses(at('localhost', '3000'), null)).toEqual([]);
		expect(ipadAddresses(at('192.168.50.12', '3000'), null)).toEqual([{ url: 'http://192.168.50.12:3000', kind: 'this-page' }]);
	});

	it('leaves the port off when the page has none', () => {
		expect(ipadAddresses(at('localhost', ''), MAC)[0].url).toBe('http://192.168.100.1');
	});
});
