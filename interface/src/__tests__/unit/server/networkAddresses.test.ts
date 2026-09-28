/**
 * `GET /api/network`'s addresses: the ones an iPad on the desk can reach.
 * USB-C (the configured address, or a self-assigned 169.254) first; loopback,
 * IPv6 and tunnels (Tailscale's utun, AirDrop's awdl) left out.
 */
import { describe, it, expect } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import { classifyAddresses } from '$lib/server/networkAddresses';

const v4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal }) as NetworkInterfaceInfo;
const v6 = (address: string) => ({ address, family: 'IPv6', internal: false }) as NetworkInterfaceInfo;

describe('classifyAddresses', () => {
	it('keeps the LAN and the USB-C link, USB-C first, and drops the rest', () => {
		expect(
			classifyAddresses(
				{
					lo0: [v4('127.0.0.1', true)],
					en0: [v6('fe80::1'), v4('10.0.0.52')],
					utun4: [v4('100.87.240.59')],
					awdl0: [v4('169.254.9.9')],
					en7: [v4('192.168.100.1')]
				},
				'192.168.100.1'
			)
		).toEqual([
			{ ip: '192.168.100.1', kind: 'usb-c', iface: 'en7' },
			{ ip: '10.0.0.52', kind: 'network', iface: 'en0' }
		]);
	});

	it('reads a self-assigned address as the USB-C link', () => {
		expect(classifyAddresses({ en8: [v4('169.254.20.1')] })).toEqual([{ ip: '169.254.20.1', kind: 'usb-c', iface: 'en8' }]);
	});
});
